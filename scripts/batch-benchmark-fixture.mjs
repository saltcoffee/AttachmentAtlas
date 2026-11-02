import { mkdtemp, mkdir, writeFile, readFile, rename, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { crc32 } from 'node:zlib';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64',
);

export function paddedPng(size, identity) {
  const data = Buffer.alloc(size, 97);
  const at = png.length - 12;
  png.copy(data, 0, 0, at);
  const length = size - png.length - 12;
  data.writeUInt32BE(length, at);
  data.write('tEXt', at + 4);
  data.write(`identity\0${identity}\0`, at + 8);
  data.writeUInt32BE(crc32(data.subarray(at + 4, at + 8 + length)), at + 8 + length);
  png.copy(data, at + 12 + length, at);
  return data;
}

export const samples = [
  'B17-01',
  'B17-10',
  'B17-100',
  'B17-2M',
  ...[1000, 10000].flatMap((n) => [1, 20, 100].map((count) => `L17-${n}-${count}`)),
];

export async function createFixture(sample) {
  if (!samples.includes(sample)) throw new Error(`Unknown sample: ${sample}`);
  const large = sample.startsWith('L17-');
  const total = large ? Number(sample.split('-')[1]) : 0;
  const count = large
    ? Number(sample.split('-')[2])
    : { 'B17-01': 2, 'B17-10': 20, 'B17-100': 100, 'B17-2M': 20 }[sample];
  const groupCount = Math.ceil(count / 2);
  const size = (sample === 'B17-2M' ? 2 : 1) * 1024 * 1024;
  const root = await mkdtemp(join(tmpdir(), `atlas-${sample}-`));
  const entries = new Map(),
    originals = new Map(),
    groups = [];
  let metrics;
  const resetMetrics = () =>
    (metrics = {
      textReads: 0,
      textBytes: 0,
      binaryReads: 0,
      binaryBytes: 0,
      writes: 0,
      removals: 0,
      lists: 0,
    });
  resetMetrics();
  async function add(path, data) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), data);
    entries.set(path, { path, size: Buffer.byteLength(data), mtime: 0 });
  }
  for (let index = 0, remaining = count; index < groupCount; index++) {
    const prefix = `images/g${String(index).padStart(3, '0')}`;
    const keepPath = `${prefix}/keep.png`,
      copies = Math.min(2, remaining);
    const retirePaths = Array.from({ length: copies }, (_, i) => `${prefix}/copy${i}.png`);
    const data = paddedPng(size, `group-${index}`);
    for (const path of [keepPath, ...retirePaths]) await add(path, data);
    groups.push({ keepPath, retirePaths });
    remaining -= copies;
  }
  const targetPaths = groups.flatMap((group) => group.retirePaths);
  const wiki = targetPaths.map((path) => `![[${path}]]`).join('\n');
  for (let index = 0; index < 12; index++) {
    const path = `notes/${String(index).padStart(2, '0')}.${index < 10 ? 'md' : 'canvas'}`;
    const text =
      index < 10
        ? `${wiki}\n`
        : JSON.stringify({
            nodes: [{ id: 'shared', type: 'text', text: wiki }],
            edges: [],
          });
    const padded = text.padEnd((index < 10 ? 8 : 16) * 1024, ' ');
    originals.set(path, padded);
    await add(path, padded);
  }
  if (large) {
    const backgroundCount = total - entries.size + 12;
    for (let index = 0; index < backgroundCount; index++)
      await add(
        `background/i${String(index).padStart(5, '0')}.png`,
        paddedPng(512 * 1024, `background-${index}`),
      );
    for (let index = 0; index < total - 12; index++) {
      const path = `background/n${String(index).padStart(5, '0')}.md`;
      await add(
        path,
        `![[background/i${String(index % backgroundCount).padStart(5, '0')}.png]]\n`.padEnd(
          1024,
          ' ',
        ),
      );
    }
  }
  const vault = {
    list() {
      metrics.lists++;
      return [...entries.values()].map((file) => ({ ...file }));
    },
    async readText(path) {
      const text = await readFile(join(root, path), 'utf8');
      metrics.textReads++;
      metrics.textBytes += Buffer.byteLength(text);
      return text;
    },
    async readBinary(path) {
      const data = await readFile(join(root, path));
      metrics.binaryReads++;
      metrics.binaryBytes += data.byteLength;
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    },
    async process(path, transform) {
      const text = transform(await this.readText(path));
      await writeFile(join(root, path), text);
      entries.set(path, { path, size: Buffer.byteLength(text), mtime: 0 });
      metrics.writes++;
    },
    async remove(path) {
      const destination = join(root, '.trash', path);
      await mkdir(dirname(destination), { recursive: true });
      await rename(join(root, path), destination);
      entries.delete(path);
      metrics.removals++;
    },
    async exists(path) {
      try {
        await access(join(root, path));
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    },
  };
  return {
    root,
    groups,
    count,
    vault,
    sample,
    inventory: [...entries.values()],
    resetMetrics,
    metrics: () => ({ ...metrics }),
    async restore() {
      for (const path of targetPaths)
        if (!entries.has(path)) {
          await rename(join(root, '.trash', path), join(root, path));
          entries.set(path, { path, size, mtime: 0 });
        }
      for (const [path, text] of originals) await writeFile(join(root, path), text);
      resetMetrics();
    },
    async verify() {
      for (const group of groups) {
        if (!(await vault.exists(group.keepPath))) throw new Error('Retained image missing.');
        for (const path of group.retirePaths)
          if (await vault.exists(path)) throw new Error('Selected copy was not removed.');
      }
    },
  };
}
