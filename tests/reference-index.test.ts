import { describe, expect, it } from 'vitest';
import { protectedImagePaths } from '../src/application/reference-index';
import { basename } from '../src/domain/paths';
import { OperationCancelled, yieldToHost } from '../src/application/cancellation';
import { MemoryVault, PNG, recyclePlan } from './helpers';
import { scan } from '../src/application/scan';
import { DEFAULT_SETTINGS, digest } from '../src/domain/model';
import { renderMessage } from '../src/domain/messages';

function original(paths: readonly string[], hints: readonly string[]): Set<string> {
  return new Set(
    paths.filter((path) =>
      hints.some(
        (hint) =>
          hint.includes(path) ||
          hint.includes(basename(path)) ||
          hint.includes(encodeURI(path)) ||
          hint.includes(encodeURIComponent(basename(path))),
      ),
    ),
  );
}

describe('protective reference index', () => {
  it.each([
    { paths: [], hints: ['anything.png'] },
    { paths: ['images/a.png'], hints: [] },
    { paths: ['images/a.png'], hints: ['prefiximages/a.pngsuffix'] },
    { paths: ['a/x.png', 'b/x.png', 'b/y.png'], hints: ['unrelated/x.png?query'] },
    { paths: ['Images/A.PNG', 'images/a.png'], hints: ['Images/a.PNG'] },
    { paths: ['图 片/猫 #?.png', '图 片/狗.png'], hints: [encodeURI('图 片/猫 #?.png')] },
    { paths: ['图 片/猫 #?.png'], hints: [encodeURIComponent('猫 #?.png')] },
    { paths: ['a/你好😀.png', 'b/e\u0301.png', 'c/é.png'], hints: ['你好😀.png e\u0301.png'] },
    { paths: ['a/hello.png'], hints: ['hel', 'lo.png'] },
    { paths: ['a/png.png', 'b/g.png', 'c/ng.png', 'd/xpng.png'], hints: ['xpng.png'] },
    { paths: ['foo/foo.png', 'foo.png', 'xoo.png'], hints: ['foo.png'.repeat(1000), 'xoo.png'] },
    { paths: ['a/中文.png'], hints: [encodeURI('a/中文.png').toLowerCase()] },
    { paths: ['a/a[1]+(2).png'], hints: ['a[1]+(2).png'] },
  ])('matches the existing substring protection for %j', async ({ paths, hints }) => {
    expect(await protectedImagePaths(paths, hints)).toEqual(original(paths, hints));
  });

  it('preserves the original short-circuit behavior for malformed Unicode paths', async () => {
    const paths = ['a/\ud800.png'];
    expect(await protectedImagePaths(paths, ['\ud800.png'])).toEqual(
      original(paths, ['\ud800.png']),
    );
    const statistics: unknown[] = [];
    await expect(
      protectedImagePaths(paths, ['unrelated'], undefined, (stats) => statistics.push(stats)),
    ).rejects.toThrow(URIError);
    expect(statistics).toMatchObject([{ mode: 'direct', fallbackReason: 'invalid-uri' }]);
    expect(await protectedImagePaths(paths, [])).toEqual(new Set());
  });

  it('falls back without losing any protection when the index exceeds its bound', async () => {
    const paths = Array.from({ length: 200 }, (_, i) => `images/${i}${'x'.repeat(4000)}.png`);
    const hints = [paths[199]!, 'anything else'];
    const statistics: unknown[] = [];
    expect(
      await protectedImagePaths(paths, hints, undefined, (stats) => statistics.push(stats)),
    ).toEqual(original(paths, hints));
    expect(statistics).toMatchObject([
      { mode: 'direct', fallbackReason: 'state-limit', stateCount: 65536 },
    ]);
  });

  it('reports index use and empty work without changing protection', async () => {
    const statistics: unknown[] = [];
    const observe = (stats: unknown) => statistics.push(stats);
    expect(await protectedImagePaths(['a.png'], ['a.png'], undefined, observe)).toEqual(
      new Set(['a.png']),
    );
    expect(await protectedImagePaths(['a.png'], [], undefined, observe)).toEqual(new Set());
    expect(statistics).toMatchObject([
      {
        mode: 'indexed',
        fallbackReason: null,
        pathCount: 1,
        hintCount: 1,
        stateCount: 6,
        patternUnits: 5,
      },
      { mode: 'empty', fallbackReason: null, stateCount: 0, estimatedBytes: 0 },
    ]);
  });

  it('reports the pattern budget fallback for a large shared-name working set', async () => {
    const paths = Array.from({ length: 85000 }, (_, i) => `${i}/same-name.png`);
    const statistics: unknown[] = [];
    const protectedPaths = await protectedImagePaths(paths, ['unrelated'], undefined, (stats) =>
      statistics.push(stats),
    );
    expect(protectedPaths.size).toBe(0);
    expect(statistics).toMatchObject([{ mode: 'direct', fallbackReason: 'pattern-limit' }]);
  });

  it('reports the estimated weight fallback before state or pattern limits', async () => {
    const paths = [
      ...Array.from({ length: 32 }, (_, i) => `images/f${i}-${'x'.repeat(1990)}.png`),
      ...Array.from({ length: 125000 }, (_, i) => `${i}/a.png`),
    ];
    const statistics: unknown[] = [];
    const protectedPaths = await protectedImagePaths(paths, ['unrelated'], undefined, (stats) =>
      statistics.push(stats),
    );
    expect(protectedPaths.size).toBe(0);
    expect(statistics).toMatchObject([{ mode: 'direct', fallbackReason: 'weight-limit' }]);
  });

  it('matches deterministic randomized overlapping, encoded and Unicode inputs', async () => {
    let seed = 18;
    const random = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    };
    const parts = ['a', 'aa', 'ba', '中', '😀', ' ', '#', '%', '.', '+', '?', 'é', 'e\u0301'];
    for (let round = 0; round < 80; round++) {
      const paths = Array.from(
        { length: 40 },
        (_, i) =>
          `${i % 5}/${Array.from({ length: 5 }, () => parts[random(parts.length)]).join('')}.png`,
      );
      const hints = Array.from({ length: 20 }, () => {
        const path = paths[random(paths.length)]!;
        return ['', path, basename(path), encodeURI(path), encodeURIComponent(basename(path))][
          random(5)
        ]!;
      });
      hints.push('unrelated text', hints.slice(0, 3).join(''));
      expect(await protectedImagePaths(paths, hints)).toEqual(original(paths, hints));
    }
  });

  it('does not publish partial protection after cancellation during matching', async () => {
    const controller = new AbortController();
    const running = protectedImagePaths(
      ['a/a.png'],
      ['a.png', 'x'.repeat(128 * 1024)],
      controller.signal,
    );
    await yieldToHost();
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(OperationCancelled);
  });

  it('honors cancellation before building an index', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      protectedImagePaths(['a.png'], ['a.png'], controller.signal),
    ).rejects.toBeInstanceOf(OperationCancelled);
  });

  it('honors cancellation while building a large index', async () => {
    const controller = new AbortController();
    const paths = Array.from({ length: 100 }, (_, index) => `${index}/${'a'.repeat(1000)}.png`);
    const running = protectedImagePaths(paths, ['unrelated'], controller.signal);
    await yieldToHost();
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(OperationCancelled);
  });

  it('honors cancellation in fallback even when every path matches immediately', async () => {
    const controller = new AbortController();
    const paths = Array.from({ length: 5000 }, (_, index) => `${index}/\ud800.png`);
    const running = protectedImagePaths(paths, ['\ud800.png'], controller.signal);
    await yieldToHost();
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(OperationCancelled);
  });

  it('preserves scan protection and prevents recycling matching plain or unresolved hints', async () => {
    const paths = [
      'a/shared.png',
      'b/shared.png',
      '图/猫 #?.png',
      'x/unused.png',
      'refs/broken.png',
      'x/custom.png',
    ];
    const vault = new MemoryVault({
      ...Object.fromEntries(paths.map((path) => [path, PNG])),
      'notes/main.md': `cover: shared.png\n${encodeURI(paths[2]!)}\n![[missing/broken.png]]`,
      'notes/board.canvas': '{"nodes":[],"customImage":"custom.png"}',
    });
    const progress: string[] = [];
    const statistics: unknown[] = [];
    const result = await scan(vault, digest, {
      revision: 1,
      settings: DEFAULT_SETTINGS,
      progress: (event) => progress.push(renderMessage(event)),
      referenceIndexStats: (stats) => statistics.push(stats),
    });
    expect(progress).toContain('Building reference protection index.');
    expect(progress.indexOf('Building reference protection index.')).toBeLessThan(
      progress.findIndex((event) => event.startsWith('Fingerprinting image')),
    );
    expect(statistics).toMatchObject([{ mode: 'indexed', fallbackReason: null }]);
    const hints = result.sources.flatMap((source) => source.hints);
    const protectedPaths = original(paths, hints);
    expect(result.blockers).toEqual([]);
    expect(
      new Set(
        result.media
          .filter((image) =>
            image.reasons.includes('Possible reference in unsupported syntax or plain text.'),
          )
          .map((image) => image.path),
      ),
    ).toEqual(protectedPaths);
    for (const path of protectedPaths) expect(() => recyclePlan(result, [path])).toThrow();
    expect(recyclePlan(result, ['x/unused.png']).kind).toBe('recycle-unreferenced');
  });
});
