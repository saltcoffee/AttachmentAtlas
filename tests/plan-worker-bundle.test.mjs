import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { setTimeout, clearTimeout } from 'node:timers';
import { buildWorker } from '../scripts/build-worker.mjs';
import { MemoryVault, PNG, mergePlan, snapshot } from './helpers';

describe('packaged preview worker', () => {
  it('builds the production worker and parses named entities without a window or document', async () => {
    const bundled = await buildWorker('src/workers/plan-worker.ts', true);
    const result = await snapshot(
      new MemoryVault({
        'keep.png': PNG,
        'copy.png': PNG,
        'note.md': '![中文😀](co&#112;y.png)',
      }),
    );
    const plan = mergePlan(result, ['copy.png'], 'keep.png');
    const script = `import('node:worker_threads').then(({parentPort}) => {
      globalThis.self = {postMessage: (data) => parentPort.postMessage(data)};
      ${bundled.outputFiles[0].text}
      parentPort.on('message', (data) => self.onmessage({data}));
    });`;
    const worker = new Worker(script, { eval: true });
    try {
      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Preview worker did not respond.')), 4000);
        const settle = (callback) => (value) => {
          clearTimeout(timer);
          callback(value);
        };
        worker.once('message', settle(resolve));
        worker.once('error', settle(reject));
        worker.postMessage({
          version: 1,
          id: 1,
          snapshot: result,
          selection: {
            kind: 'merge-exact',
            groupKey: `${PNG.byteLength}:${result.media[0].digest}`,
            keepPath: 'keep.png',
            retirePaths: ['copy.png'],
          },
        });
      });
      expect(response).toEqual({ version: 1, id: 1, ok: true, plan });
      expect(plan.documents[0].after).toBe('![中文😀](/keep.png)');
      expect(Object.keys(bundled.metafile.inputs)).not.toContain(
        'node_modules/decode-named-character-reference/index.dom.js',
      );
    } finally {
      await worker.terminate();
    }
  });
});
