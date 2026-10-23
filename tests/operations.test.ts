import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, digest, textBytes } from '../src/domain/model';
import { buildPlan } from '../src/application/plan';
import { scan, unreferencedReasons } from '../src/application/scan';
import { OperationService } from '../src/application/execute';
import { RecoveryStore } from '../src/infrastructure/recovery-store';
import { loadState } from '../src/infrastructure/settings';
import { MemoryDisk, MemoryVault, PNG, snapshot } from './helpers';
describe('scan and plans', () => {
  it('recycles and restores a newly created, unreferenced image immediately', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG });
    vault.list = () => [{ path: 'unused.png', size: PNG.byteLength, mtime: Date.now() }];
    const result = await scan(vault, digest, {
      revision: 1,
      settings: DEFAULT_SETTINGS,
    });
    expect(unreferencedReasons(result.media[0]!, result)).toEqual([]);
    const plan = buildPlan(result, ['unused.png']);
    expect(plan.kind).toBe('recycle-unreferenced');
    const operations = new OperationService(vault, new RecoveryStore(new MemoryDisk()), digest);
    await operations.execute(plan, result);
    expect(vault.removed).toEqual(['unused.png']);
    await operations.restore(plan);
    expect(await vault.readBinary('unused.png')).toEqual(PNG);
  });
  it('preserves existing settings while dropping obsolete observation data', () => {
    const settings = { scope: 'assets', protectedPaths: ['keep'], preferredFolder: 'assets' };
    expect(
      loadState({ version: 1, settings, observations: { 'old.png': { firstSeen: 1 } } }),
    ).toEqual({ settings, reset: false });
  });
  it('discovers references outside the selected image folder', async () => {
    const vault = new MemoryVault({
      'assets/a.png': PNG,
      'elsewhere/note.md': '![[assets/a.png]]',
    });
    const result = await scan(vault, digest, {
      revision: 1,
      settings: { ...DEFAULT_SETTINGS, scope: 'assets' },
    });
    expect(result.media[0]?.references).toHaveLength(1);
  });
  it('blocks unknown containers globally and plain-text hints locally', async () => {
    const vault = new MemoryVault({
      'unused.png': PNG,
      'view.base': 'filters: []',
      'note.md': 'cover: unused.png',
    });
    const result = await snapshot(vault);
    expect(result.blockers).toHaveLength(1);
    expect(result.media[0]?.reasons).not.toHaveLength(0);
    expect(() => buildPlan(result, ['unused.png'])).toThrow();
  });
  it('does not confuse equal size with exact duplicates', async () => {
    const different = PNG.slice(0);
    new Uint8Array(different)[40] = 10;
    const result = await snapshot(new MemoryVault({ 'a.png': PNG, 'b.png': different }));
    expect(result.duplicates).toHaveLength(0);
  });
  it('ignores animated PNG files', async () => {
    const bytes = new Uint8Array(PNG.slice(0));
    bytes.set(new TextEncoder().encode('acTL'), 12);
    const result = await snapshot(new MemoryVault({ 'animated.png': bytes.buffer }));
    expect(result.media[0]?.digest).toBe('');
  });
  it('cancels without changing the vault', async () => {
    const vault = new MemoryVault({ 'a.png': PNG });
    const controller = new AbortController();
    controller.abort();
    await expect(
      scan(vault, digest, {
        revision: 1,
        settings: DEFAULT_SETTINGS,
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
    expect(vault.removed).toEqual([]);
  });
  it('blocks target drift for previously unresolved short links', async () => {
    const vault = new MemoryVault({
      'a.png': PNG,
      'folder/b.png': PNG,
      'note.md': '![[a.png]] ![[b.png]]',
    });
    const result = await snapshot(vault);
    const plan = buildPlan(result, ['folder/b.png'], 'a.png');
    expect(plan.documents).toHaveLength(1);
  });
});
describe('execution and recovery', () => {
  it('allows a protected canonical image to be retained without moving it', async () => {
    const vault = new MemoryVault({
      'canonical/a.png': PNG,
      'imports/b.png': PNG,
      'note.md': '![[imports/b.png]]',
    });
    const result = await scan(vault, digest, {
      revision: 1,
      settings: { scope: 'imports', preferredFolder: 'canonical', protectedPaths: ['canonical'] },
    });
    const plan = buildPlan(result, ['imports/b.png'], 'canonical/a.png');
    await new OperationService(vault, new RecoveryStore(new MemoryDisk()), digest).execute(
      plan,
      result,
    );
    expect(await vault.readBinary('canonical/a.png')).toEqual(PNG);
    expect(await vault.readText('note.md')).toBe('![[canonical/a.png]]');
  });
  async function setup() {
    const vault = new MemoryVault({
      'a.png': PNG,
      'b.png': PNG,
      'note.md': '![[b.png|250]] and [original](b.png)',
    });
    const disk = new MemoryDisk(),
      recovery = new RecoveryStore(disk),
      service = new OperationService(vault, recovery, digest);
    const result = await snapshot(vault),
      plan = buildPlan(result, ['b.png'], 'a.png');
    return { vault, disk, recovery, service, result, plan };
  }
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'preserves original bytes when recovery write %s fails',
    async (step) => {
      const { vault, disk, service, plan, result } = await setup();
      disk.failOnWrite = step;
      await expect(service.execute(plan, result)).rejects.toThrow();
      const original = vault.files.get('b.png');
      const backup = disk.files.get(
        `.attachment-atlas-recovery/${plan.id}/${plan.retire[0]!.digest}.bin`,
      );
      expect(original ?? backup).toEqual(PNG);
      expect(await vault.readText('note.md')).toBe(plan.documents[0]!.before);
    },
  );
  it('recovers after a restart with a retiring intent and no done record', async () => {
    const { vault, disk, recovery, plan } = await setup();
    await recovery.prepare(plan, vault);
    await recovery.append(plan.id, 'writing:note.md');
    vault.files.set('note.md', textBytes(plan.documents[0]!.after));
    await recovery.append(plan.id, 'retiring:b.png');
    await vault.remove('b.png');
    const restartedStore = new RecoveryStore(disk),
      loaded = (await restartedStore.history())[0]!;
    await new OperationService(vault, restartedStore, digest).restore(
      await restartedStore.loadPlan(loaded.id),
    );
    expect(await vault.readBinary('b.png')).toEqual(PNG);
    expect(await vault.readText('note.md')).toBe(plan.documents[0]!.before);
  });
  it('merges exact images and restores original bytes and references', async () => {
    const { vault, recovery, service, result, plan } = await setup();
    await service.execute(plan, result);
    expect(vault.removed).toEqual(['b.png']);
    expect(await vault.readText('note.md')).toBe('![[a.png|250]] and [original](/a.png)');
    expect((await recovery.history())[0]?.state).toBe('completed');
    await service.restore(plan);
    expect(await vault.readText('note.md')).toBe('![[b.png|250]] and [original](b.png)');
    expect(await vault.readBinary('b.png')).toEqual(PNG);
    expect(await recovery.history()).toEqual([]);
    await expect(service.restore(plan)).rejects.toThrow();
  });
  it('recycles a stable unreferenced image and recovers it', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG, 'note.md': 'No images.' }),
      recovery = new RecoveryStore(new MemoryDisk());
    const service = new OperationService(vault, recovery, digest),
      result = await snapshot(vault),
      plan = buildPlan(result, ['unused.png']);
    await service.execute(plan, result);
    expect(await vault.exists('unused.png')).toBe(false);
    await service.restore(plan);
    expect(await vault.readBinary('unused.png')).toEqual(PNG);
  });
  it('rejects a new source introduced after preview', async () => {
    const { vault, service, plan, result } = await setup();
    vault.files.set('new.md', textBytes('![[b.png]]'));
    await expect(service.execute(plan, result)).rejects.toThrow('sources changed');
    expect(vault.removed).toEqual([]);
  });
  it('rejects same-size image changes even without an mtime change', async () => {
    const { vault, service, plan, result } = await setup();
    const changed = PNG.slice(0);
    new Uint8Array(changed)[40] = 10;
    vault.files.set('b.png', changed);
    await expect(service.execute(plan, result)).rejects.toThrow('Image changed');
    expect(vault.removed).toEqual([]);
  });
  it('compensates reference writes when recycling fails', async () => {
    const { vault, service, recovery, plan, result } = await setup();
    vault.onRemove = () => {
      throw new Error('Permission denied.');
    };
    await expect(service.execute(plan, result)).rejects.toThrow('Permission denied');
    expect(await vault.readText('note.md')).toContain('![[b.png|250]]');
    expect((await recovery.history())[0]?.state).toBe('rolledBack');
  });
  it('stops on a late edit and keeps recovery materials', async () => {
    const { vault, service, recovery, plan, result } = await setup();
    vault.onRemove = () => {
      vault.files.set('note.md', textBytes('My later edit'));
    };
    await expect(service.execute(plan, result)).rejects.toThrow('Document changed');
    expect(await vault.readText('note.md')).toBe('My later edit');
    expect((await recovery.history())[0]?.state).toBe('needsRecovery');
  });
  it('never overwrites later edits during recovery', async () => {
    const { vault, service, plan, result } = await setup();
    await service.execute(plan, result);
    vault.files.set('note.md', textBytes('User edit'));
    await expect(service.restore(plan)).rejects.toThrow('Recovery conflict');
    expect(await vault.readText('note.md')).toBe('User edit');
  });
  it('never overwrites a new image at the old path', async () => {
    const { vault, service, plan, result } = await setup();
    await service.execute(plan, result);
    vault.files.set('b.png', textBytes('User file'));
    await expect(service.restore(plan)).rejects.toThrow('path conflict');
    expect(await vault.readText('b.png')).toBe('User file');
  });
  it('makes no user-content changes if recovery storage is full', async () => {
    const { vault, disk, service, plan, result } = await setup();
    disk.failWrite = true;
    await expect(service.execute(plan, result)).rejects.toThrow('Disk full');
    expect(vault.removed).toEqual([]);
    expect(await vault.readText('note.md')).toContain('b.png');
  });
  it('identifies corrupt recovery records and blocks new writes', async () => {
    const { disk, recovery, service, plan, result } = await setup();
    await recovery.prepare(plan, new MemoryVault({ 'b.png': PNG }));
    disk.files.set(`.attachment-atlas-recovery/${plan.id}/000000.json`, textBytes('broken'));
    expect((await recovery.history())[0]?.state).toBe('needsRecovery');
    await expect(service.execute(plan, result)).rejects.toThrow('unfinished');
  });
});
