import {
  type FileEntry,
  type VaultPort,
  digest,
  textBytes,
  type Snapshot,
  DEFAULT_SETTINGS,
} from '../src/domain/model';
import type { RecoveryDisk } from '../src/infrastructure/recovery-store';
import { scan } from '../src/application/scan';
export const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
    'base64',
  ),
).buffer;
export class MemoryVault implements VaultPort {
  files = new Map<string, ArrayBuffer>();
  removed: string[] = [];
  onProcess?: (path: string) => void;
  onRemove?: (path: string) => void;
  constructor(entries: Record<string, string | ArrayBuffer>) {
    for (const [path, data] of Object.entries(entries))
      this.files.set(path, typeof data === 'string' ? textBytes(data) : data.slice(0));
  }
  list(): FileEntry[] {
    return [...this.files].map(([path, data]) => ({
      path,
      size: data.byteLength,
      mtime: Date.now() - 3 * 86_400_000,
    }));
  }
  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  }
  async readBinary(path: string): Promise<ArrayBuffer> {
    const data = this.files.get(path);
    if (!data) throw new Error(`Not found: ${path}`);
    return data.slice(0);
  }
  async process(path: string, transform: (text: string) => string): Promise<void> {
    this.onProcess?.(path);
    this.files.set(path, textBytes(transform(await this.readText(path))));
  }
  async createBinary(path: string, data: ArrayBuffer): Promise<void> {
    if (this.files.has(path)) throw new Error('Target exists.');
    this.files.set(path, data.slice(0));
  }
  async remove(path: string): Promise<void> {
    this.onRemove?.(path);
    if (!this.files.delete(path)) throw new Error('File missing.');
    this.removed.push(path);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}
export class MemoryDisk implements RecoveryDisk {
  removed: string[] = [];
  removedFolders: string[] = [];
  onRemove?: (path: string) => void;
  onRemoveFolder?: (path: string) => void;
  async removeFile(path: string): Promise<void> {
    this.onRemove?.(path);
    if (!this.files.delete(path)) throw new Error('Missing cleanup file.');
    this.removed.push(path);
  }
  async removeEmptyFolder(path: string): Promise<void> {
    this.onRemoveFolder?.(path);
    const listing = await this.list(path);
    if (listing.files.length || listing.folders.length) throw new Error('Folder is not empty.');
    if (!this.folders.delete(path)) throw new Error('Missing cleanup folder.');
    this.removedFolders.push(path);
  }
  async size(path: string): Promise<number> {
    const value = this.files.get(path);
    if (!value) throw new Error('Missing object.');
    return value.byteLength;
  }
  files = new Map<string, ArrayBuffer>();
  folders = new Set<string>();
  failWrite = false;
  writeCount = 0;
  failOnWrite = -1;
  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }
  async list(path: string) {
    const immediate = (name: string) =>
      name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes('/');
    return {
      files: [...this.files.keys()].filter(immediate),
      folders: [...this.folders].filter(immediate),
    };
  }
  async read(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  }
  async writeNew(path: string, content: string): Promise<void> {
    await this.writeBinaryNew(path, textBytes(content));
  }
  async readBinary(path: string): Promise<ArrayBuffer> {
    const value = this.files.get(path);
    if (!value) throw new Error('Missing recovery object.');
    return value.slice(0);
  }
  async writeBinaryNew(path: string, data: ArrayBuffer): Promise<void> {
    if (this.failWrite || ++this.writeCount === this.failOnWrite) throw new Error('Disk full.');
    if (this.files.has(path)) throw new Error('File exists.');
    this.files.set(path, data.slice(0));
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }
}
export async function snapshot(vault: MemoryVault): Promise<Snapshot> {
  return scan(vault, digest, {
    revision: 1,
    settings: DEFAULT_SETTINGS,
  });
}
