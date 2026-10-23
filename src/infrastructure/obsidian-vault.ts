import { App, FileSystemAdapter, MarkdownView, TFile } from 'obsidian';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { RECOVERY_ROOT, assert, type Reference, type VaultPort } from '../domain/model';
import { active, dirname, vaultPath } from '../domain/paths';
import type { RecoveryDisk } from './recovery-store';
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
  async createBinary(path: string, data: ArrayBuffer): Promise<void> {
    await this.guard(path);
    assert(!(await this.exists(path)), 'Restore target already exists.');
    const parent = dirname(path);
    if (parent && !(await this.exists(parent))) await this.app.vault.createFolder(parent);
    await this.app.vault.createBinary(path, data);
  }
  async remove(path: string): Promise<void> {
    assert(active(path), 'Only active attachment paths can be removed.');
    await this.guard(path);
    await this.app.fileManager.trashFile(this.file(path));
  }
  disk(): RecoveryDisk {
    const adapter = this.app.vault.adapter;
    const guard = async (path: string) => {
      assert(
        path === RECOVERY_ROOT || path.startsWith(`${RECOVERY_ROOT}/`),
        'Recovery access outside its directory.',
      );
      await this.guard(path);
    };
    return {
      removeFile: async (path) => {
        await guard(path);
        assert(path !== RECOVERY_ROOT, 'The recovery root cannot be deleted.');
        const stats = await adapter.stat(path);
        assert(stats?.type === 'file', 'Cleanup accepts one explicit file at a time.');
        await adapter.remove(path);
      },
      removeEmptyFolder: async (path) => {
        await guard(path);
        assert(path !== RECOVERY_ROOT, 'The recovery root cannot be deleted.');
        const stats = await adapter.stat(path);
        assert(stats?.type === 'folder', 'Cleanup directory is missing.');
        const listing = await adapter.list(path);
        assert(
          !listing.files.length && !listing.folders.length,
          'Cleanup cannot remove a non-empty folder.',
        );
        await adapter.rmdir(path, false);
      },
      size: async (path) => {
        await guard(path);
        const stats = await adapter.stat(path);
        assert(stats?.type === 'file', 'Recovery object is missing.');
        return stats.size;
      },
      exists: async (path) => {
        await guard(path);
        return adapter.exists(path);
      },
      mkdir: async (path) => {
        await guard(path);
        if (!(await adapter.exists(path))) await adapter.mkdir(path);
      },
      list: async (path) => {
        await guard(path);
        return adapter.list(path);
      },
      read: async (path) => {
        await guard(path);
        return adapter.read(path);
      },
      readBinary: async (path) => {
        await guard(path);
        return adapter.readBinary(path);
      },
      writeNew: async (path, content) => {
        await guard(path);
        assert(!(await adapter.exists(path)), 'Recovery record already exists.');
        await adapter.write(path, content);
      },
      writeBinaryNew: async (path, data) => {
        await guard(path);
        assert(!(await adapter.exists(path)), 'Recovery object already exists.');
        await adapter.writeBinary(path, data);
      },
    };
  }
}
