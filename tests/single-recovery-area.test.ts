import { describe, expect, it } from 'vitest';
import { OperationService } from '../src/application/execute';
import { RecoveryCleanupService } from '../src/application/cleanup-recovery';
import { WriteLock } from '../src/application/write-lock';
import { buildPlan } from '../src/application/plan';
import { digest, RECOVERY_ROOT, textBytes } from '../src/domain/model';
import { cleanupMarkerPath, recoveryDirectory } from '../src/domain/recovery';
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
  const cleanup = new RecoveryCleanupService(store, lock);
  if (execute) await operations.execute(plan, scan);
  return {
    vault,
    disk,
    store,
    operations,
    cleanup,
    scan,
    plan,
    root: recoveryDirectory(plan.id),
    marker: cleanupMarkerPath(plan.id),
  };
}

describe('single recovery area lifecycle', () => {
  it('keeps recoverable image bytes until successful restoration and then removes the operation data', async () => {
    const f = await setup();
    const blob = `${f.root}/${f.plan.retire[0]!.digest}.bin`;
    expect(await f.vault.exists('b.png')).toBe(false);
    expect(await f.disk.readBinary(blob)).toEqual(PNG);
    expect(await f.operations.restore(f.plan)).toEqual({});
    expect(await f.vault.readBinary('b.png')).toEqual(PNG);
    expect(await f.vault.readText('note.md')).toBe('![[b.png]]');
    expect(await f.store.history()).toEqual([]);
    expect(await f.disk.exists(f.root)).toBe(false);
    expect(await f.disk.exists(f.marker)).toBe(false);
    expect(f.disk.folders.has(RECOVERY_ROOT)).toBe(true);
  });

  it('preserves other recovery records and existing shared trash during automatic disposal', async () => {
    const f = await setup(),
      other = { ...f.plan, id: crypto.randomUUID() };
    await f.store.prepare(other, new MemoryVault({ 'b.png': PNG }));
    await f.store.append(other.id, 'completed');
    f.vault.files.set('.trash/existing.png', PNG.slice(0));
    const untouched = new Map([...f.disk.files].filter(([path]) => !path.startsWith(`${f.root}/`)));
    await f.operations.restore(f.plan);
    expect(f.disk.files).toEqual(untouched);
    expect(await f.vault.readBinary('.trash/existing.png')).toEqual(PNG);
    expect((await f.store.history()).map((entry) => entry.id)).toEqual([other.id]);
  });

  it('does not remove an original if the recovery copy is corrupted before retirement', async () => {
    const f = await setup(false),
      blob = `${f.root}/${f.plan.retire[0]!.digest}.bin`;
    f.vault.onProcess = () => {
      f.disk.files.set(blob, textBytes('corrupt'));
    };
    await expect(f.operations.execute(f.plan, f.scan)).rejects.toThrow('checksum');
    expect(f.vault.removed).toEqual([]);
    expect(await f.vault.readBinary('b.png')).toEqual(PNG);
    expect(await f.disk.exists(`${f.root}/plan.json`)).toBe(true);
  });

  it('retains every recovery file when restoration has a document conflict', async () => {
    const f = await setup(),
      files = new Map(f.disk.files);
    f.vault.files.set('note.md', textBytes('New user content'));
    await expect(f.operations.restore(f.plan)).rejects.toThrow('Recovery conflict');
    expect(await f.vault.readText('note.md')).toBe('New user content');
    expect(await f.vault.readBinary('b.png')).toEqual(PNG);
    for (const [path, data] of files) expect(f.disk.files.get(path)).toEqual(data);
    expect(f.disk.removed).toEqual([]);
    expect((await f.store.history())[0]?.state).toBe('needsRecovery');
  });

  it('rechecks restored images after writing references before disposing backups', async () => {
    const f = await setup();
    f.vault.onProcess = () => {
      f.vault.files.set('b.png', textBytes('Concurrent edit'));
    };
    await expect(f.operations.restore(f.plan)).rejects.toThrow('final verification');
    expect(await f.vault.readText('b.png')).toBe('Concurrent edit');
    expect(f.disk.removed).toEqual([]);
    expect((await f.store.history())[0]?.state).toBe('needsRecovery');
  });

  it('rechecks all restored documents before disposing backups', async () => {
    const f = await setup(false);
    f.vault.files.set('other.md', textBytes('![[b.png]]'));
    const scan = await snapshot(f.vault),
      plan = buildPlan(scan, ['b.png'], 'a.png');
    await f.operations.execute(plan, scan);
    const first = plan.documents[0]!,
      last = plan.documents.at(-1)!;
    f.vault.onProcess = (path) => {
      if (path === last.path) f.vault.files.set(first.path, textBytes('Concurrent document edit'));
    };
    await expect(f.operations.restore(plan)).rejects.toThrow('final verification');
    expect(await f.vault.readText(first.path)).toBe('Concurrent document edit');
    expect(f.disk.removed).toEqual([]);
  });

  it('keeps recovery data if recording the verified restoration fails', async () => {
    const f = await setup();
    f.disk.failOnWrite = f.disk.writeCount + 1;
    await expect(f.operations.restore(f.plan)).rejects.toThrow('Disk full');
    expect(await f.vault.readText('note.md')).toBe('![[b.png]]');
    expect(f.disk.removed).toEqual([]);
    expect((await f.store.history())[0]?.state).toBe('needsRecovery');
  });

  it('reports restored content separately from a failure creating the disposal marker', async () => {
    const f = await setup();
    f.disk.failOnWrite = f.disk.writeCount + 2;
    expect((await f.operations.restore(f.plan)).cleanupError).toContain('Disk full');
    expect((await f.store.history())[0]?.state).toBe('restored');
    expect(await f.vault.readBinary('b.png')).toEqual(PNG);
    expect(f.disk.removed).toEqual([]);
    f.disk.failOnWrite = -1;
    await f.cleanup.execute(await f.cleanup.preview([f.plan.id]));
    expect(await f.store.history()).toEqual([]);
  });

  it.each(['first-file', 'later-file', 'folder', 'marker'])(
    'keeps restoration successful and allows cleanup to resume after a %s failure',
    async (target) => {
      const f = await setup();
      f.disk.onRemove = (path) => {
        if (
          target === 'first-file' ||
          (target === 'later-file' && f.disk.removed.length === 1) ||
          (target === 'marker' && path === f.marker)
        )
          throw new Error('Disposal failure');
      };
      if (target === 'folder')
        f.disk.onRemoveFolder = () => {
          throw new Error('Disposal failure');
        };
      const result = await f.operations.restore(f.plan);
      expect(result.cleanupError).toBe('Disposal failure');
      expect(await f.vault.readText('note.md')).toBe('![[b.png]]');
      expect(await f.vault.readBinary('b.png')).toEqual(PNG);
      expect((await f.store.history())[0]?.state).toBe('cleanupPending');
      f.disk.onRemove = undefined;
      f.disk.onRemoveFolder = undefined;
      const restarted = new RecoveryCleanupService(new RecoveryStore(f.disk));
      const active = new Map(f.vault.files);
      await restarted.execute(await restarted.preview([f.plan.id]));
      expect(f.vault.files).toEqual(active);
      expect(await f.store.history()).toEqual([]);
    },
  );

  it('can stop automatic disposal after restoration without losing restored files', async () => {
    const f = await setup(),
      controller = new AbortController();
    f.disk.onRemove = () => controller.abort();
    expect((await f.operations.restore(f.plan, controller.signal)).cleanupError).toContain(
      'stopped',
    );
    expect(f.disk.removed).toHaveLength(1);
    expect(await f.vault.readBinary('b.png')).toEqual(PNG);
    expect((await f.store.history())[0]?.state).toBe('cleanupPending');
  });

  it('retains data when restoration is cancelled before writing', async () => {
    const f = await setup(),
      controller = new AbortController();
    controller.abort();
    await expect(f.operations.restore(f.plan, controller.signal)).rejects.toThrow('stopped');
    expect(f.disk.removed).toEqual([]);
    expect(await f.vault.exists('b.png')).toBe(false);
  });

  it('does not automatically dispose un-restored operations', async () => {
    const f = await setup();
    await expect(f.cleanup.discardRestored(f.plan.id)).rejects.toThrow('Only verified restored');
    expect(f.disk.removed).toEqual([]);
    expect(await f.disk.exists(f.marker)).toBe(false);
  });
});
