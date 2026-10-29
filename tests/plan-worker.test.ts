import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanClient } from '../src/infrastructure/plan-client';
import { AtlasError } from '../src/domain/messages';
import { MemoryVault, PNG, mergePlan, snapshot } from './helpers';

async function fixture() {
  const result = await snapshot(
    new MemoryVault({
      'keep.png': PNG,
      'copy.png': PNG,
      'map.canvas': JSON.stringify({
        nodes: [{ id: '1', type: 'text', text: '![[copy.png]] ![中文😀](copy.png)' }],
      }),
    }),
  );
  const selection = {
    kind: 'merge-exact' as const,
    groupKey: `${PNG.byteLength}:${result.media[0]!.digest}`,
    keepPath: 'keep.png',
    retirePaths: ['copy.png'],
  };
  return { result, selection, plan: mergePlan(result, ['copy.png'], 'keep.png') };
}
async function worker() {
  const scope = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    postMessage: vi.fn(),
  };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('../src/workers/plan-worker');
  return {
    send: (data: unknown) => scope.onmessage!(new MessageEvent('message', { data })),
    reply: scope.postMessage,
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('plan worker domain boundary', () => {
  it('returns the same source patches and logical edits as the canonical plan builder', async () => {
    const { result, selection, plan } = await fixture(),
      scope = await worker();
    scope.send({ version: 1, id: 1, snapshot: result, selection });
    expect(scope.reply).toHaveBeenCalledExactlyOnceWith({ version: 1, id: 1, ok: true, plan });
    expect(plan.documents[0]!.edits).toHaveLength(2);
  });
  it('preserves structured diagnostics for invalid selections', async () => {
    const { result, selection } = await fixture(),
      scope = await worker();
    scope.send({
      version: 1,
      id: 3,
      snapshot: result,
      selection: { ...selection, retirePaths: [] },
    });
    expect(scope.reply).toHaveBeenCalledWith({
      version: 1,
      id: 3,
      ok: false,
      error: 'Select 1–100 distinct images.',
    });
  });
  it('rejects malformed input without invoking source parsing', async () => {
    const scope = await worker();
    scope.send({ version: 1, id: 2, snapshot: {}, selection: {} });
    expect(scope.reply).toHaveBeenCalledWith({
      version: 1,
      id: 2,
      ok: false,
      error: 'Invalid preview worker request.',
    });
  });
});

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    MockWorker.instances.push(this);
  }
  reply(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}
function client() {
  MockWorker.instances = [];
  vi.stubGlobal('__ATLAS_PLAN_WORKER_SOURCE__', 'worker source');
  vi.stubGlobal('Worker', MockWorker);
  return new PlanClient();
}

describe('preview worker lifecycle', () => {
  it('settles success, validates the response and releases the worker', async () => {
    const { result, selection, plan } = await fixture(),
      plans = client();
    const pending = plans.build(result, selection),
      worker = MockWorker.instances[0]!;
    const id = worker.postMessage.mock.calls[0]![0].id as number;
    worker.reply({ version: 1, id, ok: true, plan });
    await expect(pending).resolves.toEqual(plan);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('terminates a cancelled build and ignores its late response after starting another', async () => {
    const { result, selection, plan } = await fixture(),
      plans = client();
    const first = plans.build(result, selection),
      rejected = expect(first).rejects.toThrow('cancelled');
    const old = MockWorker.instances[0]!;
    const second = plans.build(result, selection),
      current = MockWorker.instances[1]!;
    await rejected;
    expect(old.terminate).toHaveBeenCalledTimes(1);
    old.reply({ version: 1, id: 1, ok: true, plan });
    current.reply({ version: 1, id: 2, ok: true, plan });
    await expect(second).resolves.toEqual(plan);
    expect(current.terminate).toHaveBeenCalledTimes(1);
  });
  it('preserves localized errors from the worker', async () => {
    const { result, selection } = await fixture(),
      plans = client();
    const pending = plans.build(result, selection),
      rejected = expect(pending).rejects.toBeInstanceOf(AtlasError);
    MockWorker.instances[0]!.reply({
      version: 1,
      id: 1,
      ok: false,
      error: { template: 'Document changed: {path}', values: { path: '中文.md' } },
    });
    await rejected;
  });
  it.each(['malformed', 'error', 'messageerror'] as const)(
    'stops on a %s response',
    async (mode) => {
      const { result, selection } = await fixture(),
        plans = client();
      const pending = plans.build(result, selection),
        rejected = expect(pending).rejects.toThrow();
      const worker = MockWorker.instances[0]!;
      if (mode === 'malformed') worker.reply({ version: 1, id: 1, ok: true, plan: {} });
      if (mode === 'error') worker.onerror?.();
      if (mode === 'messageerror') worker.onmessageerror?.();
      await rejected;
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    },
  );
});
