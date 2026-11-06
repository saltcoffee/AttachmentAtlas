import { describe, expect, it, onTestFinished } from 'vitest';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { crc32, inflateSync } from 'node:zlib';
import { performanceImage } from '../scripts/performance-images.mjs';
import { performanceOptions, summarizePerformance } from '../scripts/benchmark-performance.mjs';
import { createPerformanceFixture, selectionForFixture } from '../scripts/performance-fixture.mjs';
import { createPerformanceDirectory } from '../scripts/performance-temp.mjs';
import { requireCompletedResult } from '../scripts/benchmark-result.mjs';
import { imageFormat, imageDimensions } from '../src/domain/image';
import { digest, DEFAULT_SETTINGS } from '../src/domain/model';
import { scan } from '../src/application/scan';
import { buildPlan } from '../src/application/plan';
import { OperationService } from '../src/application/execute';

describe('performance sample images', () => {
  it.each(['png', 'jpg', 'webp'])(
    'creates supported, deterministic %s images with distinct byte identities',
    (format) => {
      for (const size of [2048, 65536, 65538, 1024 * 1024]) {
        const data = performanceImage(size, 'first', format);
        const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        const detected = imageFormat(bytes, `sample.${format}`);
        expect(detected).not.toBeNull();
        expect(imageDimensions(bytes, detected)).toEqual({ width: 2, height: 2 });
        expect(data.length).toBe(size);
        expect(data.equals(performanceImage(size, 'first', format))).toBe(true);
        expect(data.equals(performanceImage(size, 'second', format))).toBe(false);
      }
    },
  );

  it('uses valid PNG chunk checksums and an actual decodable pixel stream', () => {
    const data = performanceImage(4096, 'valid-crc');
    let image;
    for (let offset = 8; offset < data.length;) {
      const length = data.readUInt32BE(offset);
      expect(data.readUInt32BE(offset + length + 8)).toBe(
        crc32(data.subarray(offset + 4, offset + length + 8)),
      );
      if (data.toString('ascii', offset + 4, offset + 8) === 'IDAT')
        image = inflateSync(data.subarray(offset + 8, offset + length + 8));
      if (data.toString('ascii', offset + 4, offset + 8) === 'tEXt') {
        const text = data.subarray(offset + 8, offset + length + 8);
        expect(text.indexOf(0)).toBe(8);
        expect(text.lastIndexOf(0)).toBe(8);
      }
      offset += length + 12;
    }
    expect(image).toEqual(Buffer.from([0, 35, 80, 110, 35, 80, 110, 0, 35, 80, 110, 35, 80, 110]));
  });
});

describe('performance measurement evidence', () => {
  const script = fileURLToPath(new URL('../scripts/benchmark-performance.mjs', import.meta.url));
  it('does not create a fixture or rebuild a missing baseline', async () => {
    const directory = await createPerformanceDirectory('atlas-performance-no-baseline-');
    onTestFinished(directory.dispose);
    const cwd = directory.root;
    const child = spawnSync(process.execPath, [script, '--implementation=baseline'], {
      cwd,
      encoding: 'utf8',
    });
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain('v0.1.8-baseline.json');
    expect(existsSync(join(cwd, 'artifacts'))).toBe(false);
  });

  it('rejects a corrupted baseline before executing it or creating a fixture', async () => {
    const directory = await createPerformanceDirectory('atlas-performance-corrupt-baseline-');
    onTestFinished(directory.dispose);
    const cwd = directory.root;
    mkdirSync(join(cwd, 'artifacts'));
    const bundle = 'artifacts/v0.1.8-baseline-1234567-123456789abc.cjs';
    writeFileSync(join(cwd, bundle), 'throw new Error("Untrusted code executed");');
    writeFileSync(
      join(cwd, 'artifacts/v0.1.8-baseline.json'),
      JSON.stringify({ bundle, digest: 'incorrect' }),
    );
    const child = spawnSync(process.execPath, [script, '--implementation=baseline'], {
      cwd,
      encoding: 'utf8',
    });
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain('checksum mismatch');
    expect(child.stderr).not.toContain('Untrusted code executed');
  });

  it('refuses to overwrite an existing baseline even outside a git checkout', async () => {
    const directory = await createPerformanceDirectory('atlas-performance-existing-baseline-');
    onTestFinished(directory.dispose);
    const cwd = directory.root;
    mkdirSync(join(cwd, 'artifacts'));
    writeFileSync(join(cwd, 'artifacts/v0.1.8-baseline.json'), '{}\n');
    const child = spawnSync(process.execPath, [script, '--freeze'], { cwd, encoding: 'utf8' });
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain('already frozen');
  });

  it.each([
    ['--sample=unknown'],
    ['--task=unknown'],
    ['--count=101'],
    ['--mode=quick'],
    ['--implementation=old'],
    ['--repetitions=0'],
    ['--timeout-ms=0'],
    ['--sample=B18-2M', '--task=recycle'],
    ['--sample=B18-2M', '--task=merge', '--count=100'],
  ])('rejects invalid or over-budget task options: %j', (...args) => {
    expect(() => performanceOptions(args)).toThrow();
  });

  it('defaults to one explicit-size scan instead of launching a matrix', () => {
    expect(performanceOptions([])).toMatchObject({
      sample: 'B18-S1K',
      task: 'scan',
      repetitions: 1,
      freeze: false,
    });
  });

  it('keeps failed and cancelled rounds out of successful timing summaries', () => {
    const completed = (totalMs) => ({
      outcome: 'completed',
      scanMs: totalMs,
      planMs: 0,
      executeMs: 0,
      totalMs,
    });
    const summary = summarizePerformance([
      completed(10),
      { ...completed(1), outcome: 'cancelled' },
      completed(20),
      { ...completed(1000), outcome: 'failed' },
      completed(30),
      completed(40),
    ]);
    expect(summary.successfulRounds).toBe(4);
    expect(summary.timing.totalMs).toEqual({ median: 25, worst: 40 });
    expect(summarizePerformance([{ outcome: 'failed' }]).timing).toBeNull();
  });

  it('reports absent stages as unavailable instead of a zero-duration success', () => {
    expect(
      summarizePerformance([
        { outcome: 'completed', scanMs: 12, planMs: null, executeMs: null, totalMs: 13 },
      ]).timing,
    ).toEqual({
      scanMs: { median: 12, worst: 12 },
      planMs: null,
      executeMs: null,
      totalMs: { median: 13, worst: 13 },
    });
  });

  it('verifies real fixture writes and trash moves, then restores identical task inputs', async () => {
    const fixture = await createPerformanceFixture('B18-2M');
    onTestFinished(fixture.dispose);
    const manifest = JSON.parse(await readFile(fixture.inventory.manifest, 'utf8'));
    expect(manifest.files).toHaveLength(42);
    expect(
      manifest.files.filter((file) => file.format).reduce((sum, file) => sum + file.size, 0),
    ).toBe(60 * 1024 * 1024);
    expect(fixture.vault.list().some((file) => file.path === 'fixture-manifest.json')).toBe(false);
    const snapshot = await scan(fixture.vault, digest, { revision: 1, settings: DEFAULT_SETTINGS });
    expect(snapshot.blockers).toEqual([]);
    const selection = selectionForFixture(fixture, 'merge', 20);
    for (const group of selection.groups) {
      const keep = snapshot.media.find((image) => image.path === group.keepPath);
      group.groupKey = `${keep.size}:${keep.digest}`;
    }
    const plan = buildPlan(snapshot, selection);
    const result = await new OperationService(fixture.vault, digest).execute(plan, snapshot);
    requireCompletedResult(result);
    expect(result.images).toHaveLength(20);
    await fixture.verify(plan);
    await fixture.restore();
    expect(fixture.vault.list()).toHaveLength(42);
    for (const source of snapshot.sources)
      expect(await fixture.vault.readText(source.path)).toBe(source.text);
    for (const image of snapshot.media)
      expect(await digest(await fixture.vault.readBinary(image.path))).toBe(image.digest);
    await fixture.dispose();
    expect(existsSync(fixture.root)).toBe(false);
  }, 15000);

  it('selects exactly the requested copies without silently filling from unreferenced images', () => {
    const fixture = {
      unused: ['unused.png'],
      groups: [
        { keepPath: 'a.png', retirePaths: ['a1.png', 'a2.png'] },
        { keepPath: 'b.png', retirePaths: ['b1.png', 'b2.png'] },
      ],
    };
    const plan = selectionForFixture(fixture, 'merge', 3);
    expect(plan.groups.flatMap((group) => group.retirePaths)).toEqual([
      'a1.png',
      'a2.png',
      'b1.png',
    ]);
    expect(selectionForFixture(fixture, 'recycle', 1).retirePaths).toEqual(['unused.png']);
    expect(() => selectionForFixture(fixture, 'merge', 5)).toThrow();
    expect(() => selectionForFixture(fixture, 'recycle', 2)).toThrow();
  });
});
