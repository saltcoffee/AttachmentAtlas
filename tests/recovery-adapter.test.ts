import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { FileSystemAdapter, TFile } from 'obsidian';
import { lstat } from 'node:fs/promises';
import { ObsidianVault } from '../src/infrastructure/obsidian-vault';
import { DEFAULT_SETTINGS, RECOVERY_ROOT, digest } from '../src/domain/model';
import { recoveryDirectory } from '../src/domain/recovery';
import { parseSource } from '../src/references';
import { scan } from '../src/application/scan';
import { MemoryVault, PNG } from './helpers';

vi.mock('obsidian', () => ({
  FileSystemAdapter: class {},
  MarkdownView: class {},
  TFile: class {},
}));
vi.mock('node:fs/promises', () => ({ lstat: vi.fn() }));

function setup() {
  const root = recoveryDirectory(crypto.randomUUID());
  const adapter = Object.assign(new FileSystemAdapter(), {
    getBasePath: () => '/fixture-vault',
    stat: vi.fn().mockResolvedValue({ type: 'file', size: 10 }),
    remove: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
  // The platform boundary is mocked; no real filesystem or Obsidian vault is opened.
  const file = Object.assign(new TFile(), { path: 'images/a.png' });
  const deleteActive = vi.fn(),
    trashActive = vi.fn().mockResolvedValue(undefined);
  const app = {
    vault: { adapter, getAbstractFileByPath: () => file, delete: deleteActive },
    fileManager: { trashFile: trashActive },
  } as unknown as App;
  const vault = new ObsidianVault(app);
  return { root, adapter, disk: vault.disk(), vault, file, deleteActive, trashActive };
}

describe('native recovery deletion boundary', () => {
  beforeEach(() => {
    vi.mocked(lstat).mockReset();
    vi.mocked(lstat).mockResolvedValue({ isSymbolicLink: () => false } as Awaited<
      ReturnType<typeof lstat>
    >);
  });

  it('removes one exact file and an empty folder with recursion disabled', async () => {
    const f = setup(),
      path = `${f.root}/plan.json`;
    await f.disk.removeFile(path);
    expect(f.adapter.remove).toHaveBeenCalledExactlyOnceWith(path);
    f.adapter.stat.mockResolvedValue({ type: 'folder', size: 0 });
    await f.disk.removeEmptyFolder(f.root);
    expect(f.adapter.rmdir).toHaveBeenCalledExactlyOnceWith(f.root, false);
  });

  it('uses FileManager.trashFile for one active attachment to honor deletion preferences', async () => {
    const f = setup();
    await f.vault.remove(f.file.path);
    expect(f.trashActive).toHaveBeenCalledExactlyOnceWith(f.file);
    expect(f.deleteActive).not.toHaveBeenCalled();
  });

  it('propagates trash failures instead of falling back to permanent deletion', async () => {
    const fixture = setup();
    fixture.trashActive.mockRejectedValue(new Error('Trash unavailable'));
    await expect(fixture.vault.remove(fixture.file.path)).rejects.toThrow('Trash unavailable');
    expect(fixture.deleteActive).not.toHaveBeenCalled();
  });

  it('blocks symbolic links before an active attachment reaches trash', async () => {
    const fixture = setup();
    vi.mocked(lstat).mockResolvedValue({ isSymbolicLink: () => true } as Awaited<
      ReturnType<typeof lstat>
    >);
    await expect(fixture.vault.remove(fixture.file.path)).rejects.toThrow(/ymlink|ymbolic/);
    expect(fixture.trashActive).not.toHaveBeenCalled();
    expect(fixture.deleteActive).not.toHaveBeenCalled();
  });

  it.each(['.trash/existing.png', `${RECOVERY_ROOT}/plan.json`, '.obsidian/config.json'])(
    'blocks active-file removal in internal directories: %s',
    async (path) => {
      const f = setup();
      await expect(f.vault.remove(path)).rejects.toThrow('Only active attachment');
      expect(f.deleteActive).not.toHaveBeenCalled();
      expect(f.trashActive).not.toHaveBeenCalled();
    },
  );

  it.each(['note.md', '.trash/image.png', `${RECOVERY_ROOT}/../note.md`, RECOVERY_ROOT])(
    'blocks deletion outside a single recovery object: %s',
    async (path) => {
      const f = setup();
      await expect(f.disk.removeFile(path)).rejects.toThrow();
      await expect(f.disk.removeEmptyFolder(path)).rejects.toThrow();
      expect(f.adapter.remove).not.toHaveBeenCalled();
      expect(f.adapter.rmdir).not.toHaveBeenCalled();
    },
  );

  it.each(['root', 'parent', 'file'])('blocks symbolic links at the %s boundary', async (level) => {
    const f = setup(),
      path = `${f.root}/plan.json`;
    const symbolicPath =
      level === 'root'
        ? '/fixture-vault'
        : level === 'parent'
          ? `/fixture-vault/${f.root}`
          : `/fixture-vault/${path}`;
    vi.mocked(lstat).mockImplementation(
      async (target) =>
        ({ isSymbolicLink: () => target === symbolicPath }) as Awaited<ReturnType<typeof lstat>>,
    );
    await expect(f.disk.removeFile(path)).rejects.toThrow(/ymlink|ymbolic/);
    expect(f.adapter.remove).not.toHaveBeenCalled();
  });

  it('refuses nonempty folders and refuses to treat folders as files', async () => {
    const f = setup();
    f.adapter.stat.mockResolvedValue({ type: 'folder', size: 0 });
    f.adapter.list.mockResolvedValue({ files: [`${f.root}/private.txt`], folders: [] });
    await expect(f.disk.removeEmptyFolder(f.root)).rejects.toThrow('non-empty');
    await expect(f.disk.removeFile(f.root)).rejects.toThrow('one explicit file');
    expect(f.adapter.remove).not.toHaveBeenCalled();
    expect(f.adapter.rmdir).not.toHaveBeenCalled();
  });
});

describe('Obsidian attachment configuration and reference resolution', () => {
  it.each([
    ['notes/current.md', 'configured/images'],
    ['notes/current.md', 'notes/attachments'],
    ['notes/current.md', 'notes'],
    ['', 'configured/images'],
    ['', ''],
    ['notes/current.md', '/'],
  ])('uses attachment settings for source %s and folder %s', async (source, configured) => {
    const getNewFileParent = vi.fn((_source: string, newFilePath?: string) => ({
      path: newFilePath?.endsWith('.png') ? configured : 'new-notes',
    }));
    const createFolder = vi.fn();
    const app = { fileManager: { getNewFileParent }, vault: { createFolder } } as unknown as App;
    const folder = new ObsidianVault(app).attachmentFolder(source);
    expect(folder).toBe(configured === '/' ? '' : configured);
    expect(getNewFileParent).toHaveBeenCalledExactlyOnceWith(
      source,
      expect.stringMatching(/\.png$/),
    );
    expect(createFolder).not.toHaveBeenCalled();

    const inside = folder ? `${folder}/a.png` : 'a.png';
    const result = await scan(new MemoryVault({ [inside]: PNG, 'other/b.png': PNG }), digest, {
      revision: 1,
      settings: { ...DEFAULT_SETTINGS, scope: folder },
    });
    expect(result.media.find((media) => media.path === inside)?.reasons).toEqual([]);
    expect(result.media.find((media) => media.path === 'other/b.png')?.reasons).toEqual(
      folder ? ['Outside the selected image scope.'] : [],
    );
  });

  it.each([
    ['a&amp;b.png', 'a&b.png'],
    ['a&#38;b.png#fragment', 'a&b.png'],
    ['a%2520b.png', 'a%20b.png'],
    ['../assets/a&#x26;b.png?x=1', '../assets/a&b.png'],
  ])('passes the syntax-decoded path to Obsidian once: %s', (destination, expected) => {
    const getFirstLinkpathDest = vi.fn(() => ({ path: 'resolved.png' }));
    const app = { metadataCache: { getFirstLinkpathDest } } as unknown as App;
    const reference = parseSource('notes/current.md', `![alt](${destination})`).references[0]!;
    expect(new ObsidianVault(app).resolve(reference)).toBe('resolved.png');
    expect(getFirstLinkpathDest).toHaveBeenCalledExactlyOnceWith(expected, 'notes/current.md');
  });
});
