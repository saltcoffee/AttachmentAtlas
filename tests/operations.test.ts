import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, digest, textBytes } from '../src/domain/model';
import { scan, unreferencedReasons } from '../src/application/scan';
import { OperationService } from '../src/application/execute';
import { loadState } from '../src/infrastructure/settings';
import { MemoryVault, PNG, mergePlan, recyclePlan, snapshot } from './helpers';
describe('scan and plans', () => {
  it('recycles a newly created, unreferenced image immediately', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG });
    const list = vault.list.bind(vault);
    vault.list = () => list().map((file) => ({ ...file, mtime: Date.now() }));
    const result = await scan(vault, digest, {
      revision: 1,
      settings: DEFAULT_SETTINGS,
    });
    expect(unreferencedReasons(result.media[0]!, result)).toEqual([]);
    const plan = recyclePlan(result, ['unused.png']);
    expect(plan.kind).toBe('recycle-unreferenced');
    const operations = new OperationService(vault, digest);
    await operations.execute(plan, result);
    expect(vault.removed).toEqual(['unused.png']);
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
    expect(() => recyclePlan(result, ['unused.png'])).toThrow();
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
    const plan = mergePlan(result, ['folder/b.png'], 'a.png');
    expect(plan.documents).toHaveLength(1);
  });
});
describe('execution with native trash', () => {
  async function setup() {
    const vault = new MemoryVault({
      'keep.png': PNG,
      'b.png': PNG,
      'c.png': PNG,
      'first.md': '![[b.png|250]] and [original](b.png)',
      'second.md': '![[c.png]]',
    });
    const result = await snapshot(vault);
    const plan = mergePlan(result, ['b.png', 'c.png'], 'keep.png');
    const service = new OperationService(vault, digest);
    return { vault, service, result, plan };
  }

  it('retains a protected canonical image without moving it', async () => {
    const vault = new MemoryVault({
      'canonical/a.png': PNG,
      'imports/b.png': PNG,
      'note.md': '![[imports/b.png]]',
    });
    const result = await scan(vault, digest, {
      revision: 1,
      settings: { scope: 'imports', preferredFolder: 'canonical', protectedPaths: ['canonical'] },
    });
    await new OperationService(vault, digest).execute(
      mergePlan(result, ['imports/b.png'], 'canonical/a.png'),
      result,
    );
    expect(await vault.readBinary('canonical/a.png')).toEqual(PNG);
    expect(await vault.readText('note.md')).toBe('![[canonical/a.png]]');
  });

  it('updates all references before recycling any original and creates no backup files', async () => {
    const { vault, service, result, plan } = await setup();
    const originalPaths = new Set(vault.files.keys());
    vault.onRemove = () => {
      for (const doc of plan.documents)
        expect(vault.files.get(doc.path)).toEqual(textBytes(doc.after));
    };
    await service.execute(plan, result);
    expect(vault.removed).toEqual(['b.png', 'c.png']);
    expect(await vault.readText('first.md')).toBe('![[keep.png|250]] and [original](/keep.png)');
    expect(await vault.readText('second.md')).toBe('![[keep.png]]');
    expect(await vault.readBinary('keep.png')).toEqual(PNG);
    expect([...vault.files.keys()].every((path) => originalPaths.has(path))).toBe(true);
  });

  it('recycles an unreferenced image without creating or touching hidden data', async () => {
    const hidden = '.private-fixture/existing/original.bin';
    const vault = new MemoryVault({ 'unused.png': PNG, [hidden]: PNG, 'note.md': 'No images.' });
    const result = await snapshot(vault);
    await new OperationService(vault, digest).execute(recyclePlan(result, ['unused.png']), result);
    expect(vault.removed).toEqual(['unused.png']);
    expect([...vault.files.keys()]).toEqual([hidden, 'note.md']);
    expect(await vault.readBinary(hidden)).toEqual(PNG);
  });

  it('rejects a new reference source after preview without modifying files', async () => {
    const { vault, service, plan, result } = await setup();
    vault.files.set('new.md', textBytes('![[b.png]]'));
    await expect(service.execute(plan, result)).rejects.toThrow('sources changed');
    expect(vault.removed).toEqual([]);
    expect(await vault.readText('first.md')).toBe(plan.documents[0]!.before);
  });

  it('rejects same-size image changes even without an mtime change', async () => {
    const { vault, service, plan, result } = await setup();
    const changed = PNG.slice(0);
    new Uint8Array(changed)[40] = 10;
    vault.files.set('b.png', changed);
    await expect(service.execute(plan, result)).rejects.toThrow('Image changed');
    expect(vault.removed).toEqual([]);
  });

  it('keeps every original when a reference write fails, without reverting valid earlier updates', async () => {
    const { vault, service, plan, result } = await setup();
    vault.onProcess = (path) => {
      if (path === 'second.md') throw new Error('Write denied.');
    };
    await expect(service.execute(plan, result)).rejects.toThrow('Write denied');
    expect(await vault.readText('first.md')).toBe(plan.documents[0]!.after);
    expect(await vault.readText('second.md')).toBe(plan.documents[1]!.before);
    expect(vault.removed).toEqual([]);
    expect(await vault.readBinary('b.png')).toEqual(PNG);
    expect(await vault.readBinary('c.png')).toEqual(PNG);
  });

  it('detects a write that did not persist before recycling images', async () => {
    const { vault, service, plan, result } = await setup();
    vault.process = async () => undefined;
    await expect(service.execute(plan, result)).rejects.toThrow('write verification');
    expect(vault.removed).toEqual([]);
  });

  it('stops on a late source and keeps all originals', async () => {
    const { vault, service, plan, result } = await setup();
    vault.onProcess = () => vault.files.set('new.md', textBytes('![[b.png]]'));
    await expect(service.execute(plan, result)).rejects.toThrow('Active vault files changed');
    expect(vault.removed).toEqual([]);
    expect(await vault.readText('new.md')).toBe('![[b.png]]');
  });

  it('stops after a trash failure and preserves successful deletions and valid updated references', async () => {
    const { vault, service, plan, result } = await setup();
    vault.onRemove = (path) => {
      if (path === 'c.png') throw new Error('Trash unavailable.');
    };
    await expect(service.execute(plan, result)).rejects.toThrow('Trash unavailable');
    expect(vault.removed).toEqual(['b.png']);
    expect(await vault.exists('b.png')).toBe(false);
    expect(await vault.readBinary('c.png')).toEqual(PNG);
    for (const doc of plan.documents) expect(await vault.readText(doc.path)).toBe(doc.after);
    expect(service.busy).toBe(false);
    vault.onRemove = undefined;
    const fresh = await snapshot(vault);
    await service.execute(mergePlan(fresh, ['c.png'], 'keep.png'), fresh);
    expect(vault.removed).toEqual(['b.png', 'c.png']);
  });

  it('keeps later user edits and stops remaining deletions', async () => {
    const { vault, service, plan, result } = await setup();
    vault.onRemove = () => vault.files.set('first.md', textBytes('My later edit'));
    await expect(service.execute(plan, result)).rejects.toThrow('Document changed');
    expect(await vault.readText('first.md')).toBe('My later edit');
    expect(vault.removed).toEqual(['b.png']);
    expect(await vault.exists('c.png')).toBe(true);
  });

  it('rechecks each image immediately before trashing it', async () => {
    const { vault, service, plan, result } = await setup();
    vault.onRemove = () => vault.files.set('c.png', textBytes('New user file'));
    await expect(service.execute(plan, result)).rejects.toThrow('Image changed immediately');
    expect(vault.removed).toEqual(['b.png']);
    expect(await vault.readText('c.png')).toBe('New user file');
  });

  it('detects a changed retained image before recycling another duplicate', async () => {
    const { vault, service, plan, result } = await setup();
    vault.onRemove = () => vault.files.set('keep.png', textBytes('Changed retained image'));
    await expect(service.execute(plan, result)).rejects.toThrow('Retained image changed');
    expect(vault.removed).toEqual(['b.png']);
    expect(await vault.exists('c.png')).toBe(true);
  });

  it('cancels before execution without changing notes or images', async () => {
    const { vault, service, plan, result } = await setup();
    const before = new Map(vault.files);
    const controller = new AbortController();
    controller.abort();
    await expect(service.execute(plan, result, controller.signal)).rejects.toThrow('cancelled');
    expect(vault.files).toEqual(before);
    expect(service.busy).toBe(false);
  });

  it('cancels between reference writes and preserves every image', async () => {
    const { vault, service, plan, result } = await setup();
    const controller = new AbortController();
    vault.onProcess = () => controller.abort();
    await expect(service.execute(plan, result, controller.signal)).rejects.toThrow('cancelled');
    expect(vault.removed).toEqual([]);
    expect(await vault.readText('first.md')).toBe(plan.documents[0]!.after);
    expect(await vault.readText('second.md')).toBe(plan.documents[1]!.before);
  });

  it('cancels between image deletions without restoring already recycled files', async () => {
    const { vault, service, plan, result } = await setup();
    const controller = new AbortController();
    vault.onRemove = () => controller.abort();
    await expect(service.execute(plan, result, controller.signal)).rejects.toThrow('cancelled');
    expect(vault.removed).toEqual(['b.png']);
    expect(await vault.exists('b.png')).toBe(false);
    expect(await vault.exists('c.png')).toBe(true);
  });

  it('rejects concurrent writes while the first operation is running', async () => {
    const { vault, service, plan, result } = await setup();
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const readBinary = vault.readBinary.bind(vault);
    vault.readBinary = async (path) => {
      await gate;
      return readBinary(path);
    };
    const pending = service.execute(plan, result);
    expect(service.busy).toBe(true);
    await expect(service.execute(plan, result)).rejects.toThrow('Another operation');
    resume();
    await pending;
    expect(service.busy).toBe(false);
  });
});
