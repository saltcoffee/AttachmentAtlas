import { App, FileSystemAdapter, MarkdownView, TextFileView, TFile, type Editor } from 'obsidian';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { assert, type Reference, type VaultFileChange, type VaultPort } from '../domain/model';
import { active, sourcePath, vaultPath } from '../domain/paths';
import { SourceStateError, message } from '../domain/messages';
import { assertBaseContextsClosed } from './base-contexts';
export class ObsidianVault implements VaultPort {
  private ownWrite?: { path: string };
  private editorWrites = new Set<WeakMap<Editor, string>>();
  constructor(private app: App) {}
  attachmentFolder(sourcePath: string): string {
    const folder = this.app.fileManager.getNewFileParent(
      sourcePath,
      'attachment-atlas-scan.png',
    ).path;
    return folder === '/' || folder === '' ? '' : vaultPath(folder);
  }
  resolve(reference: Reference): string | null {
    const path =
      reference.style === 'markdown' ? decodeURIComponent(reference.linkpath) : reference.linkpath;
    return (
      this.app.metadataCache.getFirstLinkpathDest(path.replace(/^\//, ''), reference.source)
        ?.path ?? null
    );
  }
  async guard(path: string): Promise<void> {
    assert(vaultPath(path) === path, 'Non-canonical vault path.');
    const adapter = this.app.vault.adapter;
    assert(adapter instanceof FileSystemAdapter, 'Desktop filesystem required.');
    let current = adapter.getBasePath();
    assert(!(await lstat(current)).isSymbolicLink(), 'Symlink vault roots are not supported.');
    for (const part of path.split('/')) {
      current = join(current, part);
      try {
        assert(
          !(await lstat(current)).isSymbolicLink(),
          'Symbolic links are not supported for attachment operations.',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
    }
  }
  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    assert(file instanceof TFile, message('File not found: {path}', { path }));
    return file;
  }
  list() {
    return this.app.vault
      .getFiles()
      .map((file) => ({ path: file.path, size: file.stat.size, mtime: file.stat.mtime }));
  }
  async readText(path: string): Promise<string> {
    await this.guard(path);
    const text = await this.app.vault.read(this.file(path));
    this.assertSourceContents(new Map([[path, text]]));
    return text;
  }
  assertSourceContents(expected: ReadonlyMap<string, string>): void {
    for (const type of ['markdown', 'canvas'])
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        if (leaf.isDeferred) continue;
        const view = leaf.view;
        if (!(view instanceof TextFileView) || !view.file) {
          const path: unknown = leaf.getViewState().state?.file;
          assert(typeof path === 'string' && !expected.has(path),
            message('Save the open editor before scanning: {path}', { path: typeof path === 'string' ? path : '' }));
          continue;
        }
        const path = view.file.path, text = expected.get(path);
        if (text === undefined) continue;
        const current = view instanceof MarkdownView ? view.editor.getValue() : view.getViewData();
        let equal = current === text;
        if (!equal && type === 'canvas') {
          // Native Canvas serializes its public view data with its own whitespace. Equal JSON
          // values are harmless; changed nodes/paths or malformed contents never match.
          try { equal = JSON.stringify(JSON.parse(current)) === JSON.stringify(JSON.parse(text)); }
          catch { equal = false; }
        }
        if (!equal)
          throw new SourceStateError(
            'unsaved-source',
            message('Save the open editor before scanning: {path}', { path }),
          );
      }
  }
  assertBaseContextsClosed(paths: readonly string[]): void {
    assertBaseContextsClosed(this.app, paths);
  }
  watchSourceChanges(onChange: (path: string) => void): () => void {
    let observedWrite: typeof this.ownWrite;
    const editorWrites = new WeakMap<Editor, string>();
    this.editorWrites.add(editorWrites);
    const changed = (path: string) => {
      if (active(path) && sourcePath(path)) onChange(path);
    };
    const vault = this.app.vault,
      workspace = this.app.workspace,
      events = [
        vault.on('create', (file) => changed(file.path)),
        vault.on('modify', (file) => {
          const write = this.ownWrite;
          if (write?.path === file.path && observedWrite !== write) {
            observedWrite = write;
            return;
          }
          changed(file.path);
        }),
        vault.on('delete', (file) => changed(file.path)),
        vault.on('rename', (file, oldPath) => {
          changed(oldPath);
          changed(file.path);
        }),
      ],
      editor = workspace.on('editor-change', (editor, info) => {
        // The host can synchronize an open editor after process resolves. Only an exact match
        // to our written text is harmless; an actual edit is always observed, even on this path.
        if (editorWrites.get(editor) === editor.getValue()) return;
        editorWrites.delete(editor);
        if (info.file) changed(info.file.path);
      }),
      basePath = vault.getFiles().find((file) => active(file.path) && /\.base$/i.test(file.path))?.path,
      contextChanged = () => { if (basePath) onChange(basePath); },
      contexts = [
        workspace.on('file-open', contextChanged),
        workspace.on('layout-change', contextChanged),
        workspace.on('window-open', contextChanged),
        workspace.on('window-close', contextChanged),
      ];
    return () => {
      this.editorWrites.delete(editorWrites);
      events.forEach((event) => vault.offref(event));
      workspace.offref(editor);
      contexts.forEach((event) => workspace.offref(event));
    };
  }
  watchFileChanges(
    paths: readonly string[],
    onChange: (change: VaultFileChange) => void,
  ): () => void {
    const watched = new Set(paths);
    const relevant = (path: string) => watched.has(path) || [...watched].some((w) => w.startsWith(`${path}/`));
    const emit = (kind: VaultFileChange['kind'], path: string, oldPath?: string) => {
      if (relevant(path) || (oldPath !== undefined && relevant(oldPath)))
        onChange({ kind, path, ...(oldPath === undefined ? {} : { oldPath }) });
    };
    const vault = this.app.vault,
      events = [
        vault.on('create', (file) => emit('create', file.path)),
        vault.on('modify', (file) => emit('modify', file.path)),
        vault.on('delete', (file) => emit('delete', file.path)),
        vault.on('rename', (file, oldPath) => emit('rename', file.path, oldPath)),
      ];
    return () => events.forEach((event) => vault.offref(event));
  }
  async readBinary(path: string): Promise<ArrayBuffer> {
    await this.guard(path);
    return this.app.vault.readBinary(this.file(path));
  }
  async exists(path: string): Promise<boolean> {
    await this.guard(path);
    return this.app.vault.adapter.exists(path);
  }
  async process(path: string, transform: (text: string) => string): Promise<void> {
    await this.readText(path);
    try {
      await this.app.vault.process(this.file(path), (text) => {
        const after = transform(text);
        // Arm only after the caller's final proof passed, and consume at most one modify event.
        this.ownWrite = { path };
        for (const leaf of this.app.workspace.getLeavesOfType('markdown'))
          if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path)
            for (const editors of this.editorWrites) editors.set(leaf.view.editor, after);
        return after;
      });
    } finally {
      this.ownWrite = undefined;
    }
  }
  async remove(path: string, beforeHostRemove: () => void): Promise<void> {
    assert(active(path), 'Only active attachment paths can be removed.');
    await this.guard(path);
    // Exactly one synchronous final assertion, then start the host deletion without another await.
    beforeHostRemove();
    await this.app.fileManager.trashFile(this.file(path));
  }
}
