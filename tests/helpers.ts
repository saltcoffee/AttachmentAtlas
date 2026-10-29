import {
  type FileEntry,
  type VaultPort,
  digest,
  textBytes,
  type Snapshot,
  DEFAULT_SETTINGS,
} from '../src/domain/model';
import { scan } from '../src/application/scan';
import { buildPlan } from '../src/application/plan';
import type { Plan } from '../src/domain/model';
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
export function recyclePlan(snapshot: Snapshot, retirePaths: readonly string[]): Plan {
  return buildPlan(snapshot, { kind: 'recycle-unreferenced', retirePaths });
}
export function mergePlan(
  snapshot: Snapshot,
  retirePaths: readonly string[],
  keepPath: string,
): Plan {
  const keep = snapshot.media.find((image) => image.path === keepPath);
  if (!keep?.digest) throw new Error('Retained image was not fully checked.');
  return buildPlan(snapshot, {
    kind: 'merge-exact',
    groupKey: `${keep.size}:${keep.digest}`,
    keepPath,
    retirePaths,
  });
}

/** Add a valid ancillary PNG text chunk, keeping the real file size at exactly 1 MiB. */
export function oneMiBPng(): ArrayBuffer {
  const original = new Uint8Array(PNG),
    output = new Uint8Array(1024 * 1024);
  const insertAt = original.length - 12,
    chunkLength = output.length - original.length;
  const chunk = new Uint8Array(chunkLength),
    view = new DataView(chunk.buffer);
  const dataLength = chunkLength - 12;
  view.setUint32(0, dataLength);
  chunk.set(new TextEncoder().encode('tEXt'), 4);
  chunk.set(new TextEncoder().encode('padding\0'), 8);
  chunk.fill(97, 16, dataLength + 8);
  let crc = 0xffffffff;
  for (const value of chunk.subarray(4, dataLength + 8)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(dataLength + 8, (crc ^ 0xffffffff) >>> 0);
  output.set(original.subarray(0, insertAt));
  output.set(chunk, insertAt);
  output.set(original.subarray(insertAt), insertAt + chunkLength);
  return output.buffer;
}
