import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createFixture, samples } from './batch-benchmark-fixture.mjs';
import { requireCompletedResult } from './benchmark-result.mjs';

const option = (key, fallback) =>
  process.argv.find((arg) => arg.startsWith(`--${key}=`))?.split('=')[1] ?? fallback;
const mode = option('mode', 'current'),
  repetitions = Number(option('repetitions', '1'));
const requested = option('sample', 'B17-2M');
if (
  !['baseline', 'current'].includes(mode) ||
  !Number.isInteger(repetitions) ||
  repetitions < 1 ||
  repetitions > 10
)
  throw new Error('Use --mode=baseline|current and --repetitions=1..10.');
const selected = requested.split(',');
if (selected.some((sample) => !samples.includes(sample)))
  throw new Error('Specify sample names explicitly; the default is one B17-2M round.');
const baselinePath = 'artifacts/v0.1.7-baseline.cjs';
let source;
if (mode === 'baseline') {
  try {
    source = await readFile(baselinePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(
      `Frozen 0.1.6 baseline not found at ${baselinePath}. Provide the archived baseline bundle; current sources cannot replace it.`,
    );
  }
} else {
  const built = await build({
    stdin: {
      contents: `export {scan} from './src/application/scan'; export {buildPlan} from './src/application/plan'; export {OperationService} from './src/application/execute'; export {digest,DEFAULT_SETTINGS} from './src/domain/model';`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  source = built.outputFiles[0].text;
}
const module = { exports: {} };
new Function('module', 'exports', 'require', source)(
  module,
  module.exports,
  createRequire(import.meta.url),
);
const { scan, buildPlan, OperationService, digest, DEFAULT_SETTINGS } = module.exports;
const report = {
  measurements: [],
  fixtures: [],
  mode,
  measuredAt: new Date().toISOString(),
  runtime: process.version,
  system: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model,
  sourceDigest: createHash('sha256').update(source).digest('hex'),
  cache:
    'Warm filesystem cache; no cache flush. Node filesystem adapter, not Obsidian UI or FileManager.',
};
// One file per run keeps its source and environment attached to every recorded round.
const reportPath = `artifacts/v0.1.7-batch-${mode}-${report.measuredAt.replace(/[:.]/g, '-')}-${randomUUID()}.json`;
await mkdir('artifacts', { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
for (const sample of selected) {
  process.stdout.write(`Preparing ${sample}\n`);
  const fixture = await createFixture(sample);
  report.fixtures.push({ sample, root: fixture.root, inventory: fixture.inventory });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  for (let repeat = 1; repeat <= repetitions; repeat++) {
    await fixture.restore();
    const row = {
      sample,
      repeat,
      scanMs: 0,
      planMs: 0,
      executeMs: 0,
      userScans: 0,
      previews: 0,
      confirmations: 0,
    };
    const tasks = mode === 'baseline' ? fixture.groups.map((group) => [group]) : [fixture.groups];
    for (const groups of tasks) {
      let start = performance.now();
      const snapshot = await scan(fixture.vault, digest, {
        revision: 1,
        settings: DEFAULT_SETTINGS,
      });
      row.scanMs += performance.now() - start;
      row.userScans++;
      const choices = groups.map((group) => {
        const keep = snapshot.media.find((image) => image.path === group.keepPath);
        if (!keep?.digest) throw new Error('Fixture image not fully checked.');
        return { ...group, groupKey: `${keep.size}:${keep.digest}` };
      });
      start = performance.now();
      // The frozen baseline bundle is the only consumer of the historical request protocol.
      const plan = buildPlan(
        snapshot,
        mode === 'baseline'
          ? { kind: 'merge-exact', ...choices[0] }
          : { kind: 'merge-exact', groups: choices },
      );
      row.planMs += performance.now() - start;
      row.previews++;
      row.confirmations++;
      start = performance.now();
      const result = await new OperationService(fixture.vault, digest).execute(plan, snapshot);
      row.executeMs += performance.now() - start;
      if (mode === 'current') requireCompletedResult(result);
      process.stdout.write(
        `${sample} round ${repeat}: ${row.confirmations}/${tasks.length} task(s)\n`,
      );
    }
    await fixture.verify();
    row.totalMs = row.scanMs + row.planMs + row.executeMs;
    Object.assign(row, fixture.metrics());
    report.measurements.push(row);
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(row) + '\n');
  }
}
process.stdout.write(`Report: ${reportPath}\n`);
