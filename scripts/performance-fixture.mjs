import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile, rename, access, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { performanceImage } from './performance-images.mjs';
import { createPerformanceDirectory } from './performance-temp.mjs';

const MiB = 1024 * 1024;
export const performanceSamples = {
  'B18-S1K': {
    images: 1000,
    sources: 1000,
    bytes: 512 * MiB,
    groups: 50,
    unused: 100,
    imageSize: MiB,
  },
  'B18-L10K': {
    images: 10000,
    sources: 10000,
    bytes: 5 * 1024 * MiB,
    groups: 500,
    unused: 100,
    imageSize: MiB,
  },
  'B18-2M': { images: 30, sources: 12, bytes: 60 * MiB, groups: 10, unused: 0, imageSize: 2 * MiB },
};

export function selectionForFixture(fixture, task, count) {
  assert(['merge', 'recycle'].includes(task), 'Unknown operation task.');
  if (task === 'recycle') {
    assert(fixture.unused.length >= count, 'Not enough unreferenced images in this sample.');
    return { kind: 'recycle-unreferenced', retirePaths: fixture.unused.slice(0, count) };
  }
  let remaining = count;
  const groups = [];
  for (const group of fixture.groups) {
    const retirePaths = group.retirePaths.slice(0, remaining);
    if (retirePaths.length) groups.push({ ...group, retirePaths });
    remaining -= retirePaths.length;
    if (!remaining) break;
  }
  assert(remaining === 0, 'Not enough duplicate copies in this sample.');
  return { kind: 'merge-exact', groups };
}

export async function createPerformanceFixture(sample, signal) {
  assert(Object.hasOwn(performanceSamples, sample), 'Unknown performance sample.');
  const spec = performanceSamples[sample];
  const disk = await statfs(tmpdir());
  assert(disk.bavail * disk.bsize > spec.bytes + 128 * MiB, 'Insufficient fixture disk space.');
  signal?.throwIfAborted();
  const directory = await createPerformanceDirectory(`atlas-${sample}-`);
  try {
    return await populateFixture(sample, directory, signal);
  } catch (error) {
    try {
      await directory.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Fixture generation and cleanup failed.');
    }
    throw error;
  }
}

async function populateFixture(sample, directory, signal) {
  const spec = performanceSamples[sample],
    root = directory.root;
  const entries = new Map(),
    originals = new Map(),
    imageDigests = new Map();
  const listeners = new Set(),
    changed = new Set(),
    removed = new Set();
  const groups = [],
    unused = [],
    background = [];
  const formats = { png: 0, jpg: 0, webp: 0 };
  const manifestFiles = [];
  const inventoryHash = createHash('sha256');
  let totalBytes = 0;
  async function add(path, data) {
    signal?.throwIfAborted();
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), data);
    entries.set(path, { path, size: Buffer.byteLength(data), mtime: 0 });
  }
  async function addImage(path, bytes, identity, format = 'png') {
    const data = performanceImage(bytes, identity, format);
    const digest = createHash('sha256').update(data).digest('hex');
    await add(path, data);
    imageDigests.set(path, digest);
    manifestFiles.push({ path, size: bytes, digest, format, width: 2, height: 2 });
    inventoryHash.update(JSON.stringify([path, bytes, digest]) + '\n');
    formats[format]++;
    totalBytes += bytes;
  }
  for (let index = 0; index < spec.groups; index++) {
    const prefix = `images/g${String(index).padStart(4, '0')}`;
    const keepPath = `${prefix}/keep.png`;
    const retirePaths = [`${prefix}/copy0.png`, `${prefix}/copy1.png`];
    for (const path of [keepPath, ...retirePaths])
      await addImage(path, spec.imageSize, `group-${index}`);
    groups.push({ keepPath, retirePaths });
  }
  for (let index = 0; index < spec.unused; index++) {
    const path = `unused/u${String(index).padStart(4, '0')}.png`;
    await addImage(path, MiB, `unused-${index}`);
    unused.push(path);
  }
  const backgroundCount = spec.images - entries.size;
  const remainder = spec.bytes - totalBytes;
  const unit = backgroundCount ? Math.floor(remainder / backgroundCount / 2) * 2 : 0;
  for (let index = 0; index < backgroundCount; index++) {
    const format = ['png', 'png', 'png', 'jpg', 'webp'][index % 5];
    const bytes = unit + (index < (remainder - unit * backgroundCount) / 2 ? 2 : 0);
    const path = `background/i${String(index).padStart(5, '0')}.${format}`;
    await addImage(path, bytes, `background-${index}`, format);
    background.push(path);
  }
  assert.equal(totalBytes, spec.bytes);
  const shared = groups.slice(0, 50).flatMap((group) => group.retirePaths);
  for (let index = 0; index < spec.sources; index++) {
    const targets = index < 12 ? [...shared] : [];
    if (background.length) targets.push(background[index % background.length]);
    if (groups.length > 50) targets.push(groups[index % groups.length].retirePaths[index % 2]);
    const wiki = targets.map((path) => `![[${path}]]`).join('\n');
    const canvas = index % 10 === 9;
    const body = canvas
      ? JSON.stringify({ nodes: [{ id: 'text', type: 'text', text: wiki }], edges: [] })
      : `${wiki}\n\nOrdinary text and protective hints, without image paths.\n`;
    assert(Buffer.byteLength(body) <= 4096, 'Fixture source budget mismatch.');
    const text = body.padEnd(4096, ' ');
    const path = `notes/n${String(index).padStart(5, '0')}.${canvas ? 'canvas' : 'md'}`;
    originals.set(path, text);
    const digest = createHash('sha256').update(text).digest('hex');
    manifestFiles.push({ path, size: Buffer.byteLength(text), digest, targets });
    inventoryHash.update(JSON.stringify([path, digest]) + '\n');
    await add(path, text);
  }
  const notify = (path) => {
    if (/\.(md|canvas|excalidraw)$/i.test(path)) for (const listener of listeners) listener(path);
  };
  const vault = {
    list: () => [...entries.values()].map((file) => ({ ...file })),
    readText: (path) => readFile(join(root, path), 'utf8'),
    async readBinary(path) {
      const data = await readFile(join(root, path));
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    },
    watchSourceChanges(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async process(path, transform) {
      assert(originals.has(path), 'Only fixture sources may be rewritten.');
      const text = transform(await this.readText(path));
      await writeFile(join(root, path), text);
      entries.set(path, { path, size: Buffer.byteLength(text), mtime: 0 });
      changed.add(path);
      notify(path);
    },
    async remove(path) {
      assert(imageDigests.has(path), 'Only fixture images may be moved.');
      const destination = join(root, '.trash', path);
      await mkdir(dirname(destination), { recursive: true });
      await rename(join(root, path), destination);
      entries.delete(path);
      removed.add(path);
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
  const inventory = {
    ...spec,
    formats,
    sourceBytes: spec.sources * 4096,
    digest: inventoryHash.digest('hex'),
    generator: 2,
    manifest: join(root, 'fixture-manifest.json'),
  };
  await writeFile(
    inventory.manifest,
    JSON.stringify({ sample, inventory, files: manifestFiles }, null, 2) + '\n',
    { flag: 'wx' },
  );
  return {
    root,
    dispose: directory.dispose,
    sample,
    groups,
    unused,
    vault,
    inventory,
    observation: {
      assurance: 'notifications-only',
      scopeId: `controlled-fixture:${root}`,
      scope:
        'Controlled fixture writes only; external writers and native Obsidian are not covered.',
    },
    async restore() {
      assert.equal(listeners.size, 0, 'Operation listener leaked.');
      for (const path of removed) {
        const destination = join(root, path);
        await rename(join(root, '.trash', path), destination);
        const data = await readFile(destination);
        entries.set(path, { path, size: data.length, mtime: 0 });
      }
      for (const path of changed) {
        await writeFile(join(root, path), originals.get(path));
        entries.set(path, { path, size: Buffer.byteLength(originals.get(path)), mtime: 0 });
      }
      changed.clear();
      removed.clear();
    },
    async verify(plan) {
      const retiring =
        plan.kind === 'merge-exact' ? plan.groups.flatMap((group) => group.retire) : plan.retire;
      const keep = plan.kind === 'merge-exact' ? plan.groups.map((group) => group.keep.path) : [];
      for (const image of retiring) {
        assert.equal(await vault.exists(image.path), false);
        const data = await readFile(join(root, '.trash', image.path));
        assert.equal(createHash('sha256').update(data).digest('hex'), imageDigests.get(image.path));
      }
      for (const path of keep) {
        const data = await readFile(join(root, path));
        assert.equal(createHash('sha256').update(data).digest('hex'), imageDigests.get(path));
      }
      const documents = new Map(plan.documents.map((doc) => [doc.path, doc.after]));
      for (const [path, text] of originals)
        assert.equal(await readFile(join(root, path), 'utf8'), documents.get(path) ?? text);
      assert.equal(listeners.size, 0, 'Operation listener leaked.');
      assert.equal(entries.size, spec.images + spec.sources - retiring.length);
    },
  };
}
