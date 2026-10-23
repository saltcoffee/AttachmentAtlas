import {
  type FileEntry,
  type VaultPort,
  digest,
  textBytes,
  type Snapshot,
  DEFAULT_SETTINGS,
} from '../src/domain/model';
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
  async remove(path: string): Promise<void> {
    this.onRemove?.(path);
    if (!this.files.delete(path)) throw new Error('File missing.');
    this.removed.push(path);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}
export async function snapshot(vault: MemoryVault): Promise<Snapshot> {
  return scan(vault, digest, {
    revision: 1,
    settings: DEFAULT_SETTINGS,
  });
}
