import type { Plan, Snapshot } from '../domain/model';
import { AtlasError } from '../domain/messages';
import type { SelectionRequest } from '../application/plan';
import { planBuildOutput } from './plan-protocol';

declare const __ATLAS_PLAN_WORKER_SOURCE__: string;

/** Each preview owns its worker so cancellation stops parsing, including a single large source. */
export class PlanClient {
  private sequence = 0;
  private stop: (() => void) | null = null;

  build(snapshot: Snapshot, selection: SelectionRequest): Promise<Plan> {
    this.cancel();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let worker: Worker | null = null;
      let settled = false;
      const finish = (result: Plan | Error) => {
        if (settled) return;
        settled = true;
        worker?.terminate();
        this.stop = null;
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      this.stop = () => finish(new Error('Preview construction cancelled.'));
      try {
        const url = URL.createObjectURL(
          new Blob([__ATLAS_PLAN_WORKER_SOURCE__], { type: 'text/javascript' }),
        );
        try {
          worker = new Worker(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        worker.onmessage = (event: MessageEvent<unknown>) => {
          if (settled) return;
          const result = planBuildOutput.safeParse(event.data);
          if (!result.success || result.data.id !== id) {
            finish(new Error('Invalid preview worker response.'));
            return;
          }
          finish(result.data.ok ? result.data.plan : new AtlasError(result.data.error));
        };
        worker.onerror = () => finish(new Error('Preview worker failed. Try previewing again.'));
        worker.onmessageerror = () => finish(new Error('Invalid preview worker response.'));
        worker.postMessage({ version: 1, id, snapshot, selection });
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error('Preview worker failed. Try previewing again.'),
        );
      }
    });
  }

  cancel(): void {
    this.stop?.();
  }
}
