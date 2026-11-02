export class OperationCancelled extends Error {
  constructor() {
    super('Operation cancelled.');
    this.name = 'OperationCancelled';
  }
}
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OperationCancelled();
}

/** Yield a host task, including during byte comparisons that otherwise hold the UI thread. */
export function yieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
