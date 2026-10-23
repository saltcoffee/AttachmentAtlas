import { assert, MAX_IMAGE } from '../domain/model';
declare const __ATLAS_WORKER_SOURCE__: string;
export class HashClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending: {
    id: number;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timer: number;
  } | null = null;
  hash = (data: ArrayBuffer): Promise<string> => {
    assert(data.byteLength <= MAX_IMAGE, 'Fingerprint task exceeds its byte budget.');
    assert(!this.pending, 'Only one fingerprint task can run at a time.');
    if (!this.worker) {
      const url = URL.createObjectURL(
        new Blob([__ATLAS_WORKER_SOURCE__], { type: 'text/javascript' }),
      );
      try {
        this.worker = new Worker(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      this.worker.onmessage = (event: MessageEvent<unknown>) => {
        const value = event.data as {
          version?: unknown;
          id?: unknown;
          hash?: unknown;
          error?: unknown;
        };
        const pending = this.pending;
        if (!value || value.version !== 1 || !pending || value.id !== pending.id) return;
        this.pending = null;
        window.clearTimeout(pending.timer);
        if (typeof value.hash === 'string' && /^[a-f0-9]{64}$/.test(value.hash))
          pending.resolve(value.hash);
        else pending.reject(new Error('Invalid fingerprint worker response.'));
      };
      this.worker.onerror = () => this.dispose();
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending = {
        id,
        resolve,
        reject,
        timer: window.setTimeout(() => this.dispose(), 60_000),
      };
      this.worker!.postMessage({ version: 1, id, data }, [data]);
    });
  };
  dispose(): void {
    if (this.pending) {
      window.clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Fingerprint task stopped.'));
      this.pending = null;
    }
    this.worker?.terminate();
    this.worker = null;
  }
}
