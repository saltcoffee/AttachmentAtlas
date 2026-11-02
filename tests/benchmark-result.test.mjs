import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { requireCompletedResult } from '../scripts/benchmark-result.mjs';

const complete = {
  outcome: 'completed',
  finalVerification: 'passed',
  documents: [],
  images: [{ path: 'copy.png', state: 'verified' }],
};

describe('benchmark evidence acceptance', () => {
  it('rejects a missing frozen baseline without building or writing a replacement', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'atlas-missing-baseline-'));
    const child = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../scripts/benchmark-batch-merge.mjs', import.meta.url)),
        '--mode=baseline',
      ],
      { cwd, encoding: 'utf8' },
    );
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain('Frozen 0.1.6 baseline not found');
    expect(existsSync(join(cwd, 'artifacts'))).toBe(false);
  });

  it('accepts an actually confirmed completed task', () => {
    expect(() => requireCompletedResult(complete)).not.toThrow();
  });
  it.each([
    { ...complete, outcome: 'cancelled' },
    { ...complete, outcome: 'failed', finalVerification: 'failed' },
    { ...complete, images: [{ path: 'copy.png', state: 'unconfirmed' }] },
    { ...complete, documents: [{ path: 'note.md', state: 'not-started' }] },
    undefined,
  ])('rejects non-success evidence and makes an uncaught CLI task exit nonzero (%j)', (result) => {
    expect(() => requireCompletedResult(result)).toThrow('Benchmark task did not complete');
    const script = `import { requireCompletedResult } from './scripts/benchmark-result.mjs'; requireCompletedResult(${JSON.stringify(result) ?? 'undefined'});`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    });
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain('Benchmark task did not complete');
  });
});
