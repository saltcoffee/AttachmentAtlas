import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { FileSystemAdapter, MarkdownView, TextFileView, TFile } from 'obsidian';
import { lstat } from 'node:fs/promises';
import { ObsidianVault } from '../src/infrastructure/obsidian-vault';
import { DEFAULT_SETTINGS, digest } from '../src/domain/model';
import { coverageIssueNextStep } from '../src/domain/reference-coverage';
import { parseSource } from '../src/references';
import { scan } from '../src/application/scan';
import { MemoryVault, PNG } from './helpers';

vi.mock('obsidian', () => {
  class FileView {}
  class TextFileView extends FileView {}
  return {
    FileSystemAdapter: class {},
    TextFileView,
    FileView,
    MarkdownView: class extends TextFileView {},
    TFile: class {},
  };
});
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
      await f.vault.remove(f.file.path, () => {});
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
      await expect(fixture.vault.remove(fixture.file.path, () => {})).rejects.toThrow('Deletion failed');
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
    await expect(fixture.vault.remove(fixture.file.path, () => {})).rejects.toThrow(/ymlink|ymbolic/);
    expect(fixture.trashActive).not.toHaveBeenCalled();
    expect(fixture.deleteActive).not.toHaveBeenCalled();
    expect(fixture.trashViaPreference).not.toHaveBeenCalled();
  });

  it.each(['.trash/existing.png', '.private-fixture/data.bin', '.obsidian/config.json'])(
    'blocks active-file removal in internal directories: %s',
    async (path) => {
      const f = setup();
      await expect(f.vault.remove(path, () => {})).rejects.toThrow('Only active attachment');
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

describe('reference source change observation', () => {
  it('observes source and editor changes, ignores images, and releases every event subscription', () => {
    const callbacks = new Map<string, (file: { path: string }, oldPath: string) => void>(),
      editorCallbacks = new Map<
        string,
        (editor: object, info: { file: { path: string } | null }) => void
      >(),
      offVault = vi.fn((event: { name: string }) => callbacks.delete(event.name)),
      offWorkspace = vi.fn((event: { name: string }) => editorCallbacks.delete(event.name)),
      app = {
        vault: {
          getFiles: () => [{ path: 'catalog.base' }],
          on: (name: string, callback: (file: { path: string }, oldPath: string) => void) => {
            callbacks.set(name, callback);
            return { name };
          },
          offref: offVault,
        },
        workspace: {
          on: (
            name: string,
            callback: (editor: object, info: { file: { path: string } | null }) => void,
          ) => {
            editorCallbacks.set(name, callback);
            return { name };
          },
          offref: offWorkspace,
        },
      } as unknown as App,
      changed = vi.fn(),
      stop = new ObsidianVault(app).watchSourceChanges(changed),
      emit = (name: string, path: string, oldPath = '') => callbacks.get(name)?.({ path }, oldPath);
    emit('create', 'new.md');
    emit('modify', 'map.canvas');
    emit('delete', 'drawing.excalidraw');
    emit('rename', 'archive.txt', 'old.md');
    emit('rename', 'renamed.md', 'source.txt');
    emit('modify', 'images/a.png');
    emit('modify', '.private/note.md');
    editorCallbacks.get('editor-change')?.({ getValue: () => 'changed' }, { file: { path: 'unsaved.md' } });
    for (const event of ['file-open', 'layout-change', 'window-open', 'window-close'])
      editorCallbacks.get(event)?.({}, { file: null });
    expect(changed.mock.calls.map(([path]) => path)).toEqual([
      'new.md',
      'map.canvas',
      'drawing.excalidraw',
      'old.md',
      'renamed.md',
      'unsaved.md',
      'catalog.base',
      'catalog.base',
      'catalog.base',
      'catalog.base',
    ]);
    stop();
    expect(offVault).toHaveBeenCalledTimes(4);
    expect(offWorkspace).toHaveBeenCalledTimes(5);
    expect(callbacks.size).toBe(0);
    expect(editorCallbacks.size).toBe(0);
  });
});

describe('Bases open-context verification', () => {
  function baseApp(leaves: unknown[], options: { throwEnumerate?: boolean } = {}) {
    const adapter = Object.assign(new FileSystemAdapter(), {
      getBasePath: () => '/fixture-vault',
    });
    const baseFile = Object.assign(new TFile(), { path: 'views/catalog.base' });
    const app = {
      vault: {
        adapter,
        getAbstractFileByPath: (path: string) => (path === baseFile.path ? baseFile : null),
        read: async () => 'views:\n  - type: table\n    name: T\n    order:\n      - file.name\n',
      },
      workspace: {
        getLeavesOfType: () => [],
        iterateAllLeaves: (callback: (leaf: unknown) => void) => {
          if (options.throwEnumerate) throw new Error('No enumeration');
          leaves.forEach(callback);
        },
        on: () => ({ name: 'event' }),
        offref: () => undefined,
      },
    } as unknown as App;
    return new ObsidianVault(app);
  }

  it('returns the base text when no open context hosts it', async () => {
    const vault = baseApp([]);
    expect(() => vault.assertBaseContextsClosed(['views/catalog.base'])).not.toThrow();
    await expect(vault.readText('views/catalog.base')).resolves.toContain('views:');
  });

  it('blocks an open Bases view and an embedding note', async () => {
    expect(() => vaultRead(baseApp([{ view: { getViewType: () => 'bases' } }]))).toThrow(
      /Open Bases view/,
    );
    const note = Object.assign(new TFile(), { path: 'notes/embed.md' });
    expect(() => vaultRead(
        baseApp([
          {
            view: Object.assign(new MarkdownView({} as never), {
              getViewType: () => 'markdown',
              file: note,
              editor: { getValue: () => '![[views/catalog.base]]' },
            }),
          },
        ]),
      )).toThrow(/embeds this Bases source/);
  });

  it('reports capability unsupported when contexts cannot be enumerated', async () => {
    expect(() => vaultRead(baseApp([], { throwEnumerate: true }))).toThrow(
      /cannot verify open Bases contexts/,
    );
  });

  it.each([
    '{"nodes":[{"id":"base","type":"file","file":"views/cat\\u0061log.base"}],"edges":[]}',
    JSON.stringify({ nodes: [{ id: 'text', type: 'text', text: '![](views/cat%61log.base)' }], edges: [] }),
  ])('blocks decoded in-memory Canvas embeds without rereading disk: %s', (text) => {
    const view = Object.assign(Object.create(TextFileView.prototype) as TextFileView, {
      file: { path: 'embed.canvas' },
      getViewType: () => 'canvas',
      getViewData: () => text,
    });
    expect(() => vaultRead(baseApp([{ view }]))).toThrow(/embeds this Bases source/);
  });

  it('fails closed when an open Canvas lacks the public text capability', () => {
    const view = { file: { path: 'embed.canvas' }, getViewType: () => 'canvas' };
    expect(() => vaultRead(baseApp([{ view }]))).toThrow(/cannot verify open Bases contexts/);
  });

  it('requires a Canvas hosting another note to close because nested Base state is not public', () => {
    const view = Object.assign(Object.create(TextFileView.prototype) as TextFileView, {
      file: { path: 'indirect.canvas' }, getViewType: () => 'canvas',
      getViewData: () => '{"nodes":[{"id":"note","type":"file","file":"embed.md"}],"edges":[]}',
    });
    expect(() => vaultRead(baseApp([{ view }]))).toThrow(/embeds this Bases source: indirect.canvas/);
  });

  it('compares current Canvas contents synchronously while allowing native JSON whitespace', () => {
    let text = '{\n"nodes":[],"edges":[]\n}';
    const view = Object.assign(Object.create(TextFileView.prototype) as TextFileView, {
      file: { path: 'map.canvas' }, getViewType: () => 'canvas', getViewData: () => text,
    });
    const app = { workspace: { getLeavesOfType: (type: string) => type === 'canvas' ? [{ view }] : [] } } as unknown as App;
    const vault = new ObsidianVault(app);
    const expected = new Map([['map.canvas', '{"nodes":[],"edges":[]}']]);
    expect(() => vault.assertSourceContents(expected)).not.toThrow();
    text = '{"nodes":[{"id":"image","type":"file","file":"copy.png"}],"edges":[]}';
    expect(() => vault.assertSourceContents(expected)).toThrow(/Save the open editor/);
  });

  it('requires a known deferred file context to be closed without reading its disk contents', () => {
    const leaf = {
      isDeferred: true,
      view: { getViewType: () => 'canvas' },
      getViewState: () => ({ state: { file: 'embed.canvas' } }),
    };
    expect(() => vaultRead(baseApp([leaf]))).toThrow(/embeds this Bases source: embed.canvas/);
  });

  it('does not reread Canvas disk files when checking 32 Bases sources', async () => {
    const data = vi.fn(() => '{"nodes":[],"edges":[]}');
    const view = Object.assign(Object.create(TextFileView.prototype) as TextFileView, {
      file: { path: 'unrelated.canvas' }, getViewType: () => 'canvas', getViewData: data,
    });
    const vault = baseApp([{ view }]);
    const paths = Array.from({ length: 32 }, (_, index) => `catalog-${index}.base`);
    vault.assertBaseContextsClosed(paths);
    expect(data).toHaveBeenCalledOnce();
    // Reading a Base is a file read only; context data is checked once per boundary, not per file.
    for (let index = 0; index < 32; index++) await vault.readText('views/catalog.base');
    expect(data).toHaveBeenCalledOnce();
  });

  function vaultRead(vault: ObsidianVault): void {
    vault.assertBaseContextsClosed(['views/catalog.base']);
  }
});

describe('scan diagnostics for unsaved source contents', () => {
  it('reports an unsaved Canvas separately from a disk read failure and recovers after save', async () => {
    vi.mocked(lstat).mockResolvedValue({ isSymbolicLink: () => false } as Awaited<
      ReturnType<typeof lstat>
    >);
    const path = 'map.canvas';
    const saved = '{"nodes":[],"edges":[]}';
    const edited = '{"nodes":[{"id":"image","type":"file","file":"copy.png"}],"edges":[]}';
    const file = Object.assign(new TFile(), { path, stat: { size: saved.length, mtime: 1 } });
    const view = Object.assign(Object.create(TextFileView.prototype) as TextFileView, {
      file,
      getViewData: () => edited,
    });
    const read = vi.fn().mockResolvedValue(saved);
    const app = {
      vault: {
        adapter: Object.assign(new FileSystemAdapter(), { getBasePath: () => '/fixture-vault' }),
        getFiles: () => [file],
        getAbstractFileByPath: () => file,
        read,
      },
      workspace: { getLeavesOfType: (type: string) => (type === 'canvas' ? [{ view }] : []) },
    } as unknown as App;
    const vault = new ObsidianVault(app);
    const scanVault = () => scan(vault, digest, { revision: 1, settings: DEFAULT_SETTINGS });

    const unsaved = await scanVault();
    expect(unsaved.coverageIssues).toMatchObject([{ code: 'unsaved-source', source: path }]);
    expect(coverageIssueNextStep(unsaved.coverageIssues[0]!.code)).toBe(
      'Save the source, then scan again.',
    );
    read.mockResolvedValueOnce(edited);
    expect((await scanVault()).coverageIssues).toEqual([]);
    read.mockRejectedValueOnce(new Error('I/O failure'));
    expect((await scanVault()).coverageIssues).toMatchObject([
      { code: 'source-read-failed', source: path },
    ]);
  });
});
