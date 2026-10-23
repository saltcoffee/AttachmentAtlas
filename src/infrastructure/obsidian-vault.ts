import { App, FileSystemAdapter, MarkdownView, TFile } from 'obsidian';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { assert, type Reference, type VaultPort } from '../domain/model';
import { active, vaultPath } from '../domain/paths';
import { message } from '../domain/messages';
export class ObsidianVault implements VaultPort {
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
    for (const leaf of this.app.workspace.getLeavesOfType('markdown'))
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path)
        assert(
          leaf.view.editor.getValue() === text,
          message('Save the open editor before scanning: {path}', { path }),
        );
    return text;
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
    await this.app.vault.process(this.file(path), transform);
  }
  async remove(path: string): Promise<void> {
    assert(active(path), 'Only active attachment paths can be removed.');
    await this.guard(path);
    await this.app.fileManager.trashFile(this.file(path));
  }
}
