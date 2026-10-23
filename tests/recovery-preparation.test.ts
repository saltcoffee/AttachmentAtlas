import { describe, expect, it, vi } from 'vitest';
import { RECOVERY_ROOT, digest, textBytes } from '../src/domain/model';
import { recoveryDirectory } from '../src/domain/recovery';
import { buildPlan } from '../src/application/plan';
import { OperationService } from '../src/application/execute';
import { RecoveryStore } from '../src/infrastructure/recovery-store';
import { MemoryDisk, MemoryVault, PNG, snapshot } from './helpers';

async function setup() {
  const vault = new MemoryVault({ 'unused.png': PNG, 'note.md': 'Unrelated text.' });
  const disk = new MemoryDisk();
  const recovery = new RecoveryStore(disk);
  const service = new OperationService(vault, recovery, digest);
  const result = await snapshot(vault);
  const plan = buildPlan(result, ['unused.png']);
  return { vault, disk, recovery, service, result, plan, root: recoveryDirectory(plan.id) };
}

describe('recovery preparation failures', () => {
  it('discards only its empty folder after a first-write failure and allows retry after restart', async () => {
    const f = await setup();
    f.disk.failOnWrite = 1;
    await expect(f.service.execute(f.plan, f.result)).rejects.toThrow('Disk full');
    expect(await f.recovery.history()).toEqual([]);
    expect(f.disk.folders).toEqual(new Set([RECOVERY_ROOT]));
    expect(f.disk.removedFolders).toEqual([f.root]);
    expect(f.disk.removed).toEqual([]);
    expect(await f.vault.readBinary('unused.png')).toEqual(PNG);
    expect(await f.vault.readText('note.md')).toBe('Unrelated text.');
    expect(f.vault.removed).toEqual([]);

    const restarted = new OperationService(f.vault, new RecoveryStore(f.disk), digest);
    await restarted.execute(f.plan, f.result);
    expect(await f.vault.exists('unused.png')).toBe(false);
    expect((await f.recovery.history())[0]?.state).toBe('completed');
  });

  it('does not discard a pre-existing empty operation folder', async () => {
    const f = await setup();
    await f.disk.mkdir(f.root);
    await expect(f.recovery.prepare(f.plan, f.vault)).rejects.toThrow('already exists');
    expect(f.disk.folders.has(f.root)).toBe(true);
    expect(f.disk.removedFolders).toEqual([]);
    expect(f.disk.files.size).toBe(0);
  });

  it('preserves a partial first write for manual recovery', async () => {
    const f = await setup();
    vi.spyOn(f.disk, 'writeNew').mockImplementationOnce(async (path) => {
      f.disk.files.set(path, textBytes('partial plan'));
      throw new Error('Interrupted write.');
    });
    await expect(f.service.execute(f.plan, f.result)).rejects.toThrow('Interrupted write');
    expect(await f.disk.read(`${f.root}/plan.json`)).toBe('partial plan');
    expect(f.disk.removedFolders).toEqual([]);
    expect(f.disk.removed).toEqual([]);
    expect((await f.recovery.history())[0]?.state).toBe('needsRecovery');
    expect(f.vault.removed).toEqual([]);
  });

  it.each(['file', 'folder'])(
    'preserves an unexpected %s created during preparation',
    async (kind) => {
      const f = await setup();
      const unknown = `${f.root}/unknown`;
      vi.spyOn(f.disk, 'writeNew').mockImplementationOnce(async () => {
        if (kind === 'file') f.disk.files.set(unknown, textBytes('keep me'));
        else await f.disk.mkdir(unknown);
        throw new Error('Interrupted write.');
      });
      await expect(f.service.execute(f.plan, f.result)).rejects.toThrow('Interrupted write');
      expect(await f.disk.exists(unknown)).toBe(true);
      expect(f.disk.removedFolders).toEqual([]);
      expect(f.disk.removed).toEqual([]);
      expect(f.vault.removed).toEqual([]);
    },
  );

  it('preserves the original write error if empty-folder removal also fails', async () => {
    const f = await setup();
    f.disk.failWrite = true;
    f.disk.onRemoveFolder = () => {
      throw new Error('Removal denied.');
    };
    await expect(f.service.execute(f.plan, f.result)).rejects.toThrow('Disk full');
    expect(f.disk.folders.has(f.root)).toBe(true);
    expect(f.disk.removed).toEqual([]);
    expect(f.vault.removed).toEqual([]);
  });

  it('refuses to remove a folder that becomes nonempty during cleanup', async () => {
    const f = await setup();
    f.disk.failWrite = true;
    f.disk.onRemoveFolder = () => {
      f.disk.files.set(`${f.root}/new.txt`, textBytes('keep me'));
    };
    await expect(f.service.execute(f.plan, f.result)).rejects.toThrow('Disk full');
    expect(await f.disk.read(`${f.root}/new.txt`)).toBe('keep me');
    expect(f.disk.removedFolders).toEqual([]);
    expect(f.disk.removed).toEqual([]);
    expect(f.vault.removed).toEqual([]);
  });
});
