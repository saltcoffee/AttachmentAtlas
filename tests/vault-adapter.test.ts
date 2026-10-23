import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { FileSystemAdapter, TFile } from 'obsidian';
import { lstat } from 'node:fs/promises';
import { ObsidianVault } from '../src/infrastructure/obsidian-vault';
import { DEFAULT_SETTINGS, digest } from '../src/domain/model';
import { parseSource } from '../src/references';
import { scan } from '../src/application/scan';
import { MemoryVault, PNG } from './helpers';

vi.mock('obsidian', () => ({
  FileSystemAdapter: class {},
  MarkdownView: class {},
  TFile: class {},
}));
vi.mock('node:fs/promises', () => ({ lstat: vi.fn() }));

function setup(trashOption: 'system' | 'local' | 'none' = 'system') {
  const adapter = Object.assign(new FileSystemAdapter(), {
    getBasePath: () => '/fixture-vault',
    stat: vi.fn().mockResolvedValue({ type: 'file', size: 10 }),
    remove: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
  // The platform boundary is mocked; no real filesystem or Obsidian vault is opened.
  const file = Object.assign(new TFile(), { path: 'images/a.png' });
  const activePaths = new Set([file.path]);
  const deleteActive = vi.fn(async (_target: TFile) => {
    activePaths.delete(file.path);
  });
  const trashActive = vi.fn(async (_target: TFile, _system: boolean) => {
    activePaths.delete(file.path);
  });
  // Model the host's deletion preferences at the FileManager boundary.
  const trashViaPreference = vi.fn(async (target: TFile) => {
    if (trashOption === 'none') await deleteActive(target);
    else await trashActive(target, trashOption === 'system');
  });
  const app = {
    vault: {
      adapter,
      getAbstractFileByPath: (path: string) => (activePaths.has(path) ? file : null),
      delete: deleteActive,
      trash: trashActive,
    },
    fileManager: { trashFile: trashViaPreference },
  } as unknown as App;
  const vault = new ObsidianVault(app);
  return { vault, file, activePaths, deleteActive, trashActive, trashViaPreference };
}

describe('native attachment deletion boundary', () => {
  beforeEach(() => {
    vi.mocked(lstat).mockReset();
    vi.mocked(lstat).mockResolvedValue({ isSymbolicLink: () => false } as Awaited<
      ReturnType<typeof lstat>
    >);
  });

  it.each(['system', 'local', 'none'] as const)(
    'delegates deletion to FileManager and respects the host setting: %s',
    async (trashOption) => {
      const f = setup(trashOption);
      await f.vault.remove(f.file.path);
      expect(f.trashViaPreference).toHaveBeenCalledExactlyOnceWith(f.file);
      if (trashOption === 'none') {
        expect(f.deleteActive).toHaveBeenCalledExactlyOnceWith(f.file);
        expect(f.trashActive).not.toHaveBeenCalled();
      } else {
        expect(f.trashActive).toHaveBeenCalledExactlyOnceWith(f.file, trashOption === 'system');
        expect(f.deleteActive).not.toHaveBeenCalled();
      }
      expect(f.activePaths.has(f.file.path)).toBe(false);
    },
  );

  it.each(['system', 'local', 'none'] as const)(
    'propagates FileManager failures without a deletion fallback: %s',
    async (trashOption) => {
      const fixture = setup(trashOption);
      fixture.trashViaPreference.mockRejectedValue(new Error('Deletion failed'));
      await expect(fixture.vault.remove(fixture.file.path)).rejects.toThrow('Deletion failed');
      expect(fixture.trashViaPreference).toHaveBeenCalledExactlyOnceWith(fixture.file);
      expect(fixture.deleteActive).not.toHaveBeenCalled();
      expect(fixture.trashActive).not.toHaveBeenCalled();
      expect(fixture.activePaths.has(fixture.file.path)).toBe(true);
    },
  );

  it('blocks symbolic links before an active attachment reaches trash', async () => {
    const fixture = setup();
    vi.mocked(lstat).mockResolvedValue({ isSymbolicLink: () => true } as Awaited<
      ReturnType<typeof lstat>
    >);
    await expect(fixture.vault.remove(fixture.file.path)).rejects.toThrow(/ymlink|ymbolic/);
    expect(fixture.trashActive).not.toHaveBeenCalled();
    expect(fixture.deleteActive).not.toHaveBeenCalled();
    expect(fixture.trashViaPreference).not.toHaveBeenCalled();
  });

  it.each(['.trash/existing.png', '.private-fixture/data.bin', '.obsidian/config.json'])(
    'blocks active-file removal in internal directories: %s',
    async (path) => {
      const f = setup();
      await expect(f.vault.remove(path)).rejects.toThrow('Only active attachment');
      expect(f.deleteActive).not.toHaveBeenCalled();
      expect(f.trashActive).not.toHaveBeenCalled();
      expect(f.trashViaPreference).not.toHaveBeenCalled();
    },
  );
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
