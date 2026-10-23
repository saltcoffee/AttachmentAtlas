import { describe, expect, it } from 'vitest';
import { RecoveryCleanupService } from '../src/application/cleanup-recovery';
import { OperationService } from '../src/application/execute';
import { buildPlan } from '../src/application/plan';
import { WriteLock } from '../src/application/write-lock';
import { digest, RECOVERY_ROOT, textBytes } from '../src/domain/model';
import { canCleanRecovery, cleanupMarkerPath, recoveryDirectory } from '../src/domain/recovery';
import {
  parseCleanupRecord,
  serializeCleanupRecord,
  validateCleanupRecord,
} from '../src/infrastructure/cleanup-record';
import { RecoveryStore } from '../src/infrastructure/recovery-store';
import { MemoryDisk, MemoryVault, PNG, snapshot } from './helpers';

async function setup(execute = true) {
  const vault = new MemoryVault({ 'a.png': PNG, 'b.png': PNG, 'note.md': '![[b.png]]' });
  const disk = new MemoryDisk(),
    store = new RecoveryStore(disk),
    lock = new WriteLock();
  const operations = new OperationService(vault, store, digest, lock);
  const scan = await snapshot(vault),
    plan = buildPlan(scan, ['b.png'], 'a.png');
  if (execute) await operations.execute(plan, scan);
  const cleanup = new RecoveryCleanupService(store, lock);
  const root = recoveryDirectory(plan.id),
    marker = cleanupMarkerPath(plan.id);
  return { vault, disk, store, lock, operations, scan, plan, cleanup, root, marker };
}

describe('recovery cleanup eligibility and preview', () => {
  it('previews exact paths and sizes without writing or deleting anything', async () => {
    const f = await setup(),
      before = new Map(f.disk.files),
      writes = f.disk.writeCount;
    const preview = await f.cleanup.preview([f.plan.id]);
    expect(preview.totalBytes).toBe(
      [...before.values()].reduce((n, data) => n + data.byteLength, 0),
    );
    expect(preview.selections[0]?.remainingFiles.map((file) => file.path).sort()).toEqual(
      [...before.keys()].sort(),
    );
    expect(f.disk.files).toEqual(before);
    expect(f.disk.writeCount).toBe(writes);
    expect(f.disk.removed).toEqual([]);
    expect(canCleanRecovery((await f.store.history())[0]!)).toBe(true);
  });

  it.each(['prepared', 'writing:note.md', 'needsRecovery', 'unknown'])(
    'protects %s records',
    async (state) => {
      const f = await setup();
      await f.store.append(f.plan.id, state);
      expect(canCleanRecovery((await f.store.history())[0]!)).toBe(false);
      await expect(f.cleanup.preview([f.plan.id])).rejects.toThrow('Only completed');
      expect(f.disk.removed).toEqual([]);
    },
  );

  it('accepts restored records without changing the restored content', async () => {
    const f = await setup();
    f.disk.failOnWrite = f.disk.writeCount + 2; // Persist restored, then fail before the cleanup marker is created.
    expect((await f.operations.restore(f.plan)).cleanupError).toContain('Disk full');
    f.disk.failOnWrite = -1;
    const content = new Map(f.vault.files);
    const preview = await f.cleanup.preview([f.plan.id]);
    expect(preview.selections[0]?.record.state).toBe('restored');
    await f.cleanup.execute(preview);
    expect(f.vault.files).toEqual(content);
  });

  it('accepts fully rolled-back operations', async () => {
    const f = await setup(false);
    f.vault.onRemove = () => {
      throw new Error('Test removal failure');
    };
    await expect(f.operations.execute(f.plan, f.scan)).rejects.toThrow('Test removal failure');
    expect((await f.store.history())[0]?.state).toBe('rolledBack');
    await f.cleanup.execute(await f.cleanup.preview([f.plan.id]));
    expect(await f.vault.readText('note.md')).toBe('![[b.png]]');
    expect(await f.vault.readBinary('b.png')).toEqual(PNG);
  });

  it.each(['plan', 'journal', 'image', 'missing-image', 'unknown-file', 'nested-folder'])(
    'rejects damaged or unexpected inventory: %s',
    async (kind) => {
      const f = await setup(),
        image = `${f.root}/${f.plan.retire[0]!.digest}.bin`;
      if (kind === 'plan') f.disk.files.set(`${f.root}/plan.json`, textBytes('invalid'));
      if (kind === 'journal') f.disk.files.set(`${f.root}/000000.json`, textBytes('invalid'));
      if (kind === 'image') f.disk.files.set(image, textBytes('broken'));
      if (kind === 'missing-image') f.disk.files.delete(image);
      if (kind === 'unknown-file') f.disk.files.set(`${f.root}/private.txt`, textBytes('keep'));
      if (kind === 'nested-folder') f.disk.folders.add(`${f.root}/private`);
      await expect(f.cleanup.preview([f.plan.id])).rejects.toThrow();
      expect(f.disk.removed).toEqual([]);
      expect(await f.disk.exists(f.marker)).toBe(false);
    },
  );

  it('rejects invalid IDs, duplicate selections and oversized batches', async () => {
    const f = await setup();
    for (const ids of [
      [],
      ['../notes'],
      [f.plan.id, f.plan.id],
      Array<string>(101).fill(f.plan.id),
    ]) {
      await expect(f.cleanup.preview(ids)).rejects.toThrow();
    }
    expect(f.disk.removed).toEqual([]);
  });

  it('rejects cancellation before preview or execution without changing storage', async () => {
    const f = await setup(),
      preview = await f.cleanup.preview([f.plan.id]);
    const before = new Map(f.disk.files),
      controller = new AbortController();
    controller.abort();
    await expect(f.cleanup.preview([f.plan.id], controller.signal)).rejects.toThrow('cancelled');
    await expect(f.cleanup.execute(preview, controller.signal)).rejects.toThrow('cancelled');
    expect(f.disk.files).toEqual(before);
    expect(f.lock.busy).toBe(false);
  });
});

describe('confirmed cleanup and mutation boundaries', () => {
  it('deletes only the selected recovery files, plan last and marker last', async () => {
    const f = await setup();
    const other = { ...f.plan, id: crypto.randomUUID() };
    await f.store.prepare(other, new MemoryVault({ 'b.png': PNG }));
    await f.store.append(other.id, 'completed');
    f.disk.files.set('.trash/b.png', PNG.slice(0));
    f.disk.files.set('private.txt', textBytes('keep'));
    const active = new Map(f.vault.files),
      trash = [...f.vault.removed];
    const untouched = new Map([...f.disk.files].filter(([path]) => !path.startsWith(`${f.root}/`)));
    const preview = await f.cleanup.preview([f.plan.id]);
    const result = await f.cleanup.execute(preview);
    expect(result).toEqual({ removedRecords: 1, releasedBytes: preview.totalBytes });
    expect(f.disk.files).toEqual(untouched);
    expect(f.disk.removed.slice(-2)).toEqual([`${f.root}/plan.json`, f.marker]);
    expect(f.disk.removed.every((path) => path.startsWith(`${f.root}/`) || path === f.marker)).toBe(
      true,
    );
    expect(f.disk.removedFolders).toEqual([f.root]);
    expect(f.disk.folders.has(RECOVERY_ROOT)).toBe(true);
    expect(f.vault.files).toEqual(active);
    expect(f.vault.removed).toEqual(trash);
    expect((await f.store.history()).map((entry) => entry.id)).toEqual([other.id]);
    expect(await f.store.loadPlan(other.id)).toEqual(other);
  });

  it('requires a new preview if a record changes after confirmation preview', async () => {
    const f = await setup(),
      preview = await f.cleanup.preview([f.plan.id]);
    await f.store.append(f.plan.id, 'completed');
    await expect(f.cleanup.execute(preview)).rejects.toThrow('changed after preview');
    expect(f.disk.removed).toEqual([]);
    expect(await f.disk.exists(f.marker)).toBe(false);
  });

  it('validates the whole selected batch before creating markers or deleting files', async () => {
    const f = await setup(),
      other = { ...f.plan, id: crypto.randomUUID() };
    await f.store.prepare(other, new MemoryVault({ 'b.png': PNG }));
    await f.store.append(other.id, 'completed');
    const preview = await f.cleanup.preview([f.plan.id, other.id]);
    f.disk.files.set(`${recoveryDirectory(other.id)}/unexpected`, textBytes('keep'));
    await expect(f.cleanup.execute(preview)).rejects.toThrow();
    expect(f.disk.removed).toEqual([]);
    expect(await f.disk.exists(f.marker)).toBe(false);
  });

  it('never deletes before every batch marker is persisted', async () => {
    const f = await setup(),
      other = { ...f.plan, id: crypto.randomUUID() };
    await f.store.prepare(other, new MemoryVault({ 'b.png': PNG }));
    await f.store.append(other.id, 'completed');
    const preview = await f.cleanup.preview([f.plan.id, other.id]);
    f.disk.failOnWrite = f.disk.writeCount + 2;
    await expect(f.cleanup.execute(preview)).rejects.toThrow('Disk full');
    expect(f.disk.removed).toEqual([]);
    expect((await f.store.history()).find((entry) => entry.id === f.plan.id)?.state).toBe(
      'cleanupPending',
    );
    f.disk.failOnWrite = -1;
    const result = await f.cleanup.execute(await f.cleanup.preview([f.plan.id, other.id]));
    expect(result.removedRecords).toBe(2);
    expect(await f.store.history()).toEqual([]);
  });

  it('does not recreate a purged record from a stale restore dialog', async () => {
    const f = await setup();
    await f.cleanup.execute(await f.cleanup.preview([f.plan.id]));
    const active = new Map(f.vault.files),
      writes = f.disk.writeCount;
    await expect(f.operations.restore(f.plan)).rejects.toThrow();
    expect(f.vault.files).toEqual(active);
    expect(f.disk.writeCount).toBe(writes);
    expect(await f.store.history()).toEqual([]);
  });

  it('shares its write lock with image operations and releases it after failure', async () => {
    const f = await setup(),
      release = f.lock.acquire();
    await expect(f.cleanup.preview([f.plan.id])).rejects.toThrow('running');
    await expect(f.operations.restore(f.plan)).rejects.toThrow('running');
    await expect(f.operations.execute(f.plan, f.scan)).rejects.toThrow('running');
    release();
    await f.cleanup.preview([f.plan.id]);
    expect(f.lock.busy).toBe(false);
  });
});

describe('interrupted cleanup and restart', () => {
  it('retains verified state and requires a fresh preview to continue after a file failure', async () => {
    const f = await setup(),
      preview = await f.cleanup.preview([f.plan.id]);
    f.disk.onRemove = () => {
      if (f.disk.removed.length === 1) throw new Error('Permission denied');
    };
    await expect(f.cleanup.execute(preview)).rejects.toThrow('Permission denied');
    expect(f.disk.removed).toHaveLength(1);
    expect((await f.store.history())[0]?.state).toBe('cleanupPending');
    const before = new Map(f.disk.files);
    await expect(f.operations.restore(f.plan)).rejects.toThrow('being cleaned');
    expect(f.disk.files).toEqual(before);
    await expect(f.operations.execute(f.plan, f.scan)).rejects.toThrow('unfinished');
    f.disk.onRemove = undefined;
    await expect(f.cleanup.execute(preview)).rejects.toThrow('changed after preview');
    const restarted = new RecoveryCleanupService(new RecoveryStore(f.disk));
    const remaining = await restarted.preview([f.plan.id]);
    expect(remaining.selections[0]?.resuming).toBe(true);
    expect(remaining.totalBytes).toBe(
      [...f.disk.files.values()].reduce((sum, data) => sum + data.byteLength, 0),
    );
    await restarted.execute(remaining);
    expect(await f.store.history()).toEqual([]);
  });

  it('stops at a file boundary and supports an explicitly confirmed continuation', async () => {
    const f = await setup(),
      controller = new AbortController();
    f.disk.onRemove = () => controller.abort();
    await expect(
      f.cleanup.execute(await f.cleanup.preview([f.plan.id]), controller.signal),
    ).rejects.toThrow('stopped');
    expect(f.disk.removed).toHaveLength(1);
    expect((await f.store.history())[0]?.state).toBe('cleanupPending');
    f.disk.onRemove = undefined;
    await f.cleanup.execute(await f.cleanup.preview([f.plan.id]));
    expect(await f.store.history()).toEqual([]);
  });

  it.each(['folder', 'marker'])('can resume a failure removing the final %s', async (target) => {
    const f = await setup();
    if (target === 'folder')
      f.disk.onRemoveFolder = () => {
        throw new Error('Final failure');
      };
    else
      f.disk.onRemove = (path) => {
        if (path === f.marker) throw new Error('Final failure');
      };
    await expect(f.cleanup.execute(await f.cleanup.preview([f.plan.id]))).rejects.toThrow(
      'Final failure',
    );
    const pending = (await f.store.history())[0]!;
    expect(pending.state).toBe('cleanupPending');
    expect(canCleanRecovery(pending)).toBe(true);
    const preview = await f.cleanup.preview([f.plan.id]);
    expect(preview.selections[0]?.remainingFiles).toEqual([]);
    expect(preview.totalBytes).toBe(await f.disk.size(f.marker));
    f.disk.onRemoveFolder = undefined;
    f.disk.onRemove = undefined;
    await f.cleanup.execute(preview);
    expect(await f.store.history()).toEqual([]);
  });

  it('preserves unexpected files that appear during cleanup', async () => {
    const f = await setup(),
      unexpected = `${f.root}/unrelated.txt`;
    f.disk.onRemove = () => {
      f.disk.files.set(unexpected, textBytes('keep'));
    };
    await expect(f.cleanup.execute(await f.cleanup.preview([f.plan.id]))).rejects.toThrow(
      'not empty',
    );
    expect(await f.disk.read(unexpected)).toBe('keep');
    expect(f.disk.removedFolders).toEqual([]);
    expect((await f.store.history())[0]?.state).toBe('needsRecovery');
    await expect(f.cleanup.preview([f.plan.id])).rejects.toThrow('inventory');
  });

  it('rechecks each file checksum immediately before deleting it', async () => {
    const f = await setup(),
      image = `${f.root}/${f.plan.retire[0]!.digest}.bin`;
    f.disk.onRemove = () => {
      f.disk.files.set(image, textBytes('changed'));
    };
    await expect(f.cleanup.execute(await f.cleanup.preview([f.plan.id]))).rejects.toThrow(
      'size changed',
    );
    expect(await f.disk.read(image)).toBe('changed');
    expect(await f.disk.exists(`${f.root}/plan.json`)).toBe(true);
    expect((await f.store.history())[0]?.state).toBe('needsRecovery');
  });

  it('blocks a corrupt marker instead of guessing which files remain', async () => {
    const f = await setup(),
      selection = (await f.cleanup.preview([f.plan.id])).selections[0]!;
    await f.store.beginCleanup(selection);
    f.disk.files.set(f.marker, textBytes('corrupt'));
    expect(canCleanRecovery((await f.store.history())[0]!)).toBe(false);
    await expect(f.cleanup.preview([f.plan.id])).rejects.toThrow();
    expect(f.disk.removed).toEqual([]);
  });
});

describe('cleanup manifest storage boundary', () => {
  it('rejects paths outside the selected operation, unknown names, and duplicate paths', async () => {
    const f = await setup(),
      record = (await f.cleanup.preview([f.plan.id])).selections[0]!.record;
    const file = record.files[0]!;
    for (const path of [
      'note.md',
      '.trash/a.png',
      `${f.root}/../plan.json`,
      `${f.root}/nested/plan.json`,
      `${f.root}/private.txt`,
      `${recoveryDirectory(crypto.randomUUID())}/plan.json`,
    ]) {
      expect(() =>
        validateCleanupRecord({ ...record, files: [...record.files, { ...file, path }] }),
      ).toThrow();
    }
    expect(() => validateCleanupRecord({ ...record, files: [...record.files, file] })).toThrow(
      'Duplicate',
    );
    expect(() =>
      validateCleanupRecord({
        ...record,
        files: record.files.filter((item) => !item.path.endsWith('/plan.json')),
      }),
    ).toThrow('missing');
  });

  it('verifies checksum and identity when parsing stored manifests', async () => {
    const f = await setup(),
      record = (await f.cleanup.preview([f.plan.id])).selections[0]!.record;
    const text = await serializeCleanupRecord(record);
    expect(await parseCleanupRecord(text, record.id)).toEqual(record);
    await expect(parseCleanupRecord(text, crypto.randomUUID())).rejects.toThrow('identity');
    const envelope = JSON.parse(text) as { payload: string };
    envelope.payload += ' ';
    await expect(parseCleanupRecord(JSON.stringify(envelope), record.id)).rejects.toThrow(
      'checksum',
    );
  });
});
