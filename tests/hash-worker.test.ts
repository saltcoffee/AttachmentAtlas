import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE, digest, textBytes } from '../src/domain/model';

async function worker() {
  const scope = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    postMessage: vi.fn(),
  };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('../src/workers/hash-worker');
  return {
    postMessage: scope.postMessage,
    receive: (data: unknown) => scope.onmessage!(new MessageEvent('message', { data })),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('fingerprint worker scope', () => {
  it('hashes and replies through the worker scope without a window', async () => {
    const fixture = await worker();
    const data = textBytes('attachment image');
    fixture.receive({ version: 1, id: 7, data });
    const hash = await digest(data);
    await vi.waitFor(() =>
      expect(fixture.postMessage).toHaveBeenCalledExactlyOnceWith({ version: 1, id: 7, hash }),
    );
  });

  it.each([
    null,
    { version: 2, id: 1, data: textBytes('image') },
    { version: 1, id: '1', data: textBytes('image') },
    { version: 1, id: 1, data: 'image' },
    { version: 1, id: 1, data: new ArrayBuffer(MAX_IMAGE + 1) },
  ])('ignores invalid messages: %j', async (data) => {
    const fixture = await worker();
    fixture.receive(data);
    expect(fixture.postMessage).not.toHaveBeenCalled();
  });
});
