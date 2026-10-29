import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, readFile, rename, access } from 'node:fs/promises';
import { tmpdir, cpus, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

// All writes stay in a newly created synthetic vault. Recycle means rename into its .trash.
// The fixture is retained for inspection; this script never deletes files or uses a personal vault.
const repetitions = Number(
  process.argv.find((value) => value.startsWith('--repetitions='))?.split('=')[1] ?? 3,
);
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 10)
  throw new Error('Use 1–10 repetitions.');
const built = await build({
  stdin: {
    contents: `export {scan} from './src/application/scan'; export {buildPlan} from './src/application/plan'; export {OperationService} from './src/application/execute'; export {digest,DEFAULT_SETTINGS} from './src/domain/model'; export {oneMiBPng} from './tests/helpers';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'cjs',
  write: false,
});
const module = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(
  module,
  module.exports,
  createRequire(import.meta.url),
);
const { scan, buildPlan, OperationService, digest, DEFAULT_SETTINGS, oneMiBPng } = module.exports;
const root = await mkdtemp(join(tmpdir(), 'attachment-atlas-execution-'));
await mkdir(join(root, 'images'));
await mkdir(join(root, 'notes'));
await mkdir(join(root, '.trash'));
const paths = Array.from(
  { length: 120 },
  (_, index) => `images/${String(index).padStart(3, '0')}.png`,
);
const entries = new Map();
const image = new Uint8Array(oneMiBPng());
for (const path of paths) {
  await writeFile(join(root, path), image);
  entries.set(path, { path, size: image.byteLength, mtime: 0 });
}
const originals = new Map();
for (let index = 0; index < 10; index++) {
  const path = `notes/${String(index).padStart(2, '0')}.md`;
  const prefix = `![[${paths[index + 1]}]]\n\n`;
  const body =
    '# Heading\n\nA paragraph with **emphasis** and ordinary words.\n\n- item one\n- item two\n\n';
  const text = (prefix + body.repeat(200)).slice(0, 8 * 1024);
  originals.set(path, text);
  await writeFile(join(root, path), text);
  entries.set(path, { path, size: Buffer.byteLength(text), mtime: 0 });
}
let metrics;
const vault = {
  list: () => [...entries.values()].map((file) => ({ ...file })),
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
  },
  async remove(path) {
    await rename(join(root, path), join(root, '.trash', path.split('/').at(-1)));
    entries.delete(path);
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
const measurements = [];
for (const count of [1, 20, 100])
  for (let repeat = 1; repeat <= repetitions; repeat++) {
    for (const path of paths)
      if (!entries.has(path)) {
        await rename(join(root, '.trash', path.split('/').at(-1)), join(root, path));
        entries.set(path, { path, size: image.byteLength, mtime: 0 });
      }
    for (const [path, text] of originals) {
      await writeFile(join(root, path), text);
      entries.set(path, { path, size: Buffer.byteLength(text), mtime: 0 });
    }
    metrics = { textReads: 0, textBytes: 0, binaryReads: 0, binaryBytes: 0 };
    let start = performance.now();
    const snapshot = await scan(vault, digest, { revision: 1, settings: DEFAULT_SETTINGS });
    const scanMs = performance.now() - start;
    start = performance.now();
    const plan = buildPlan(snapshot, {
      kind: 'merge-exact',
      groupKey: `${image.byteLength}:${snapshot.media[0].digest}`,
      keepPath: paths[0],
      retirePaths: paths.slice(1, count + 1),
    });
    const planMs = performance.now() - start;
    metrics = { textReads: 0, textBytes: 0, binaryReads: 0, binaryBytes: 0 };
    start = performance.now();
    await new OperationService(vault, digest).execute(plan, snapshot);
    const executeMs = performance.now() - start;
    if (entries.size !== 130 - count || !(await vault.exists(paths[0])))
      throw new Error('Unexpected benchmark result.');
    const measurement = {
      count,
      repeat,
      documents: plan.documents.length,
      scanMs,
      planMs,
      executeMs,
      ...metrics,
    };
    measurements.push(measurement);
    console.log(JSON.stringify(measurement));
  }
const summary = [1, 20, 100].map((count) => {
  const rows = measurements.filter((row) => row.count === count),
    times = rows.map((row) => row.executeMs).sort((a, b) => a - b);
  return {
    count,
    documents: rows[0].documents,
    medianExecuteMs: times[Math.floor(times.length / 2)],
    maxExecuteMs: Math.max(...times),
    textReads: rows[0].textReads,
    textBytes: rows[0].textBytes,
    binaryBytes: rows[0].binaryBytes,
  };
});
const report = {
  measuredAt: new Date().toISOString(),
  runtime: process.version,
  system: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model,
  repetitions,
  fixtureRoot: root,
  imageCount: 120,
  imageBytes: image.byteLength,
  sourceCount: 10,
  sourceBytes: [...originals.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0),
  cache: 'Warm filesystem cache: fixtures written immediately before measurements; no cache flush.',
  scope:
    'Production scan/plan/execute modules with a real Node filesystem VaultPort. This is not Obsidian FileManager or editor performance.',
  summary,
  measurements,
};
await mkdir('artifacts', { recursive: true });
const output = resolve('artifacts/v0.1.6-execution-benchmark.json');
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: output, fixtureRoot: root, summary }));
