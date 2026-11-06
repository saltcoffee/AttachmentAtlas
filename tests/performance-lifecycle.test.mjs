import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { writeFile, mkdir, mkdtemp, symlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';
import { createPerformanceDirectory } from '../scripts/performance-temp.mjs';
import { createPerformanceFixture } from '../scripts/performance-fixture.mjs';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original();
  return { ...actual, writeFile: vi.fn(actual.writeFile), mkdtemp: vi.fn(actual.mkdtemp) };
});

const script = fileURLToPath(new URL('../scripts/benchmark-performance.mjs', import.meta.url));
const digest = (text) => createHash('sha256').update(text).digest('hex');

async function failingBaseline(waitForAbort) {
  const directory = await createPerformanceDirectory('atlas-performance-lifecycle-');
  onTestFinished(directory.dispose);
  await mkdir(join(directory.root, 'artifacts'));
  const source = waitForAbort
    ? `exports.scan = async (_, hash, {signal}) => { signal.throwIfAborted(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), {once:true})); };`
    : `exports.scan = () => { throw new Error('simulated scan failure'); };`;
  const bundle = `artifacts/v0.1.8-baseline-0000000-${digest(source).slice(0, 12)}.cjs`;
  await writeFile(join(directory.root, bundle), source);
  await writeFile(join(directory.root, 'package-lock.json'), '{}');
  await writeFile(
    join(directory.root, 'artifacts/v0.1.8-baseline.json'),
    JSON.stringify({
      bundle,
      digest: digest(source),
      dependencyDigest: digest('{}'),
    }),
  );
  return directory;
}

function reportFor(stdout, cwd) {
  const path = stdout.match(/^Report: (.+)$/m)?.[1];
  expect(path).toBeTruthy();
  const report = JSON.parse(readFileSync(join(cwd, path), 'utf8'));
  expect(report.state).toBe('failed');
  expect(report.summary.successfulRounds).toBe(0);
  expect(report.cleanup.state).toBe('removed');
  expect(existsSync(report.fixture.root)).toBe(false);
  return report;
}

describe('performance fixture lifecycle', () => {
  it('removes a partially generated fixture when a write fails', async () => {
    vi.mocked(writeFile).mockRejectedValueOnce(new Error('simulated full disk'));
    await expect(createPerformanceFixture('B18-2M')).rejects.toThrow('simulated full disk');
    const root = await vi.mocked(mkdtemp).mock.results.at(-1).value;
    expect(existsSync(root)).toBe(false);
  });

  it('removes nested files and symlinks while preserving their external target', async () => {
    const directory = await createPerformanceDirectory('atlas-performance-lifecycle-');
    const outside = await createPerformanceDirectory('atlas-performance-target-');
    onTestFinished(directory.dispose);
    onTestFinished(outside.dispose);
    await mkdir(join(directory.root, 'nested'));
    await writeFile(join(directory.root, 'nested/data.txt'), 'fixture');
    await writeFile(join(outside.root, 'keep.txt'), 'outside');
    await symlink(outside.root, join(directory.root, 'outside-link'));
    await directory.dispose();
    expect(existsSync(directory.root)).toBe(false);
    expect(readFileSync(join(outside.root, 'keep.txt'), 'utf8')).toBe('outside');
    await directory.dispose();
  });

  it.each([false, true])(
    'removes a CLI fixture after failure or timeout (timeout=%s)',
    async (timeout) => {
      const directory = await failingBaseline(timeout);
      const child = spawnSync(
        process.execPath,
        [script, '--implementation=baseline', '--sample=B18-2M', '--timeout-ms=1000'],
        {
          cwd: directory.root,
          encoding: 'utf8',
          timeout: 10000,
        },
      );
      expect(child.status).toBe(1);
      const report = reportFor(child.stdout, directory.root);
      expect(report.measurements[0].deadlineReached).toBe(timeout);
      expect(report.measurements[0].issue).toContain(
        timeout ? 'cancelled' : 'simulated scan failure',
      );
    },
    15000,
  );

  it.each(['SIGINT', 'SIGTERM'])(
    'cleans the fixture before exiting after %s',
    async (signal) => {
      const directory = await failingBaseline(true);
      const child = spawn(
        process.execPath,
        [script, '--implementation=baseline', '--sample=B18-2M'],
        { cwd: directory.root },
      );
      let stdout = '',
        stopped = false;
      child.stdout.on('data', (data) => {
        stdout += data.toString();
        if (!stopped && stdout.includes('Report:')) {
          stopped = true;
          child.kill(signal);
        }
      });
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      expect(code).toBe(1);
      const report = reportFor(stdout, directory.root);
      expect(report.measurements[0]).toMatchObject({
        deadlineReached: false,
        cancellationRequested: true,
      });
    },
    15000,
  );
});
