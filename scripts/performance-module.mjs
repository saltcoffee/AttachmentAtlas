import assert from 'node:assert/strict';
import process from 'node:process';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const baselineFile = 'artifacts/v0.1.8-baseline.json';
const checksum = (text) => createHash('sha256').update(text).digest('hex');

async function measuredBundle() {
  // These wrappers observe the same functions in both revisions without changing their results.
  const functions = [
    { suffix: '/src/references/index.ts', name: 'parseSource', async: false, metric: 'parse' },
    { suffix: '/src/domain/model.ts', name: 'digest', async: true, metric: 'digest' },
  ];
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
    plugins: [
      {
        name: 'performance-observation',
        setup(builder) {
          builder.onLoad(
            { filter: /src[\\/](references[\\/]index|domain[\\/]model)\.ts$/ },
            async ({ path }) => {
              const normalized = path.replaceAll('\\', '/');
              const spec = functions.find((item) => normalized.endsWith(item.suffix));
              assert(spec, 'Unknown instrumentation target.');
              const source = await readFile(path, 'utf8');
              const start = `export ${spec.async ? 'async ' : ''}function ${spec.name}(`;
              assert.equal(
                source.split(start).length,
                2,
                `Instrumentation target changed: ${path}`,
              );
              const original = `unmeasured_${spec.name}`;
              const contents =
                source.replace(start, `${spec.async ? 'async ' : ''}function ${original}(`) +
                `
            export ${spec.async ? 'async ' : ''}function ${spec.name}(...args: Parameters<typeof ${original}>): ${spec.async ? 'Promise<Awaited<ReturnType<typeof ' + original + '>>>' : 'ReturnType<typeof ' + original + '>'} {
              const row = (globalThis as unknown as {__atlasPerformance?: Record<string, number>}).__atlasPerformance;
              const started = performance.now();
              if (row) row.${spec.metric}Calls++;
              try { return ${spec.async ? 'await ' : ''}${original}(...args); }
              finally { if (row) row.${spec.metric}Ms += performance.now() - started; }
            }
          `;
              return { contents, loader: 'ts' };
            },
          );
        },
      },
    ],
  });
  return built.outputFiles[0].text;
}

export async function freezePerformanceBaseline() {
  const existing = await readFile(baselineFile, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  assert.equal(existing, null, 'A baseline is already frozen; it must not be overwritten.');
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src', 'package-lock.json']);
  assert.equal(
    execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'src'], {
      encoding: 'utf8',
    }).trim(),
    '',
    'Freeze before adding production files.',
  );
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const source = await measuredBundle();
  const digest = checksum(source);
  const bundle = `artifacts/v0.1.8-baseline-${revision.slice(0, 7)}-${digest.slice(0, 12)}.cjs`;
  await mkdir('artifacts', { recursive: true });
  await writeFile(bundle, source, { flag: 'wx' });
  const metadata = {
    revision,
    bundle,
    digest,
    instrumentation: 1,
    frozenAt: new Date().toISOString(),
    dependencyDigest: checksum(await readFile('package-lock.json')),
    scope:
      'Production application functions with parse/digest observation wrappers; native UI and FileManager are not included.',
  };
  await writeFile(baselineFile, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  return metadata;
}

export async function loadPerformanceModule(mode) {
  let source, metadata;
  if (mode === 'baseline') {
    metadata = JSON.parse(await readFile(baselineFile, 'utf8'));
    assert(
      /^artifacts\/v0\.1\.8-baseline-[a-f0-9]{7}-[a-f0-9]{12}\.cjs$/.test(metadata.bundle),
      'Invalid frozen baseline bundle path.',
    );
    source = await readFile(metadata.bundle, 'utf8');
    assert.equal(checksum(source), metadata.digest, 'Frozen baseline checksum mismatch.');
    assert.equal(
      checksum(await readFile('package-lock.json')),
      metadata.dependencyDigest,
      'Baseline dependency versions changed.',
    );
  } else {
    assert.equal(mode, 'current');
    source = await measuredBundle();
    metadata = {
      digest: checksum(source),
      instrumentation: 1,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      workingTree: true,
    };
  }
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', source)(
    loaded,
    loaded.exports,
    createRequire(import.meta.url),
  );
  return { api: loaded.exports, metadata };
}
