import type { Plan } from '../domain/model';
import { groupChanges, retiringImages } from '../domain/operation-plan';
import type { Text } from '../domain/messages';

export type ActionState = 'not-started' | 'verified' | 'unconfirmed';
export type GroupState = 'completed' | 'partial' | 'unprocessed' | 'unconfirmed';
export type ExecutionStage =
  | 'validate-plan'
  | 'preflight'
  | 'prove-groups'
  | 'rewrite'
  | 'verify-references'
  | 'remove'
  | 'final-verify';
export interface ActionResult {
  readonly path: string;
  readonly state: ActionState;
}
export interface ExecutionResult {
  readonly kind: Plan['kind'];
  readonly outcome: 'completed' | 'cancelled' | 'failed';
  readonly cancellationRequested: boolean;
  readonly stoppedAt: ExecutionStage;
  readonly finalVerification: 'passed' | 'failed' | 'cancelled' | 'not-run';
  readonly documents: readonly ActionResult[];
  readonly images: readonly (ActionResult & { readonly size: number })[];
  readonly groups: readonly {
    readonly groupKey: string;
    readonly keepPath: string;
    readonly state: GroupState;
    readonly documentPaths: readonly string[];
    readonly retirePaths: readonly string[];
    readonly plannedEdits: number;
    readonly verifiedEdits: number;
  }[];
  readonly issue?: {
    readonly stage: ExecutionStage;
    readonly path?: string;
    readonly detail: Text;
  };
}

/** Tracks observed actions only; no document text is retained in the resulting report. */
export class ExecutionRecorder {
  stage: ExecutionStage = 'validate-plan';
  path: string | undefined;
  finalVerification: ExecutionResult['finalVerification'] = 'not-run';
  readonly documents = new Map<string, ActionState>();
  readonly images = new Map<string, ActionState>();
  constructor(private readonly plan: Plan) {
    for (const doc of plan.documents) this.documents.set(doc.path, 'not-started');
    for (const image of retiringImages(plan)) this.images.set(image.path, 'not-started');
  }
  finish(
    outcome: ExecutionResult['outcome'],
    cancellationRequested: boolean,
    detail?: Text,
  ): ExecutionResult {
    const documents = [...this.documents].map(([path, state]) => ({ path, state }));
    const images = retiringImages(this.plan).map((image) => ({
      path: image.path,
      size: image.size,
      state: this.images.get(image.path)!,
    }));
    const groups =
      this.plan.kind === 'merge-exact'
        ? this.plan.groups.map((group) => {
            const changes = groupChanges(this.plan, group);
            const states = [
              ...changes.map((doc) => this.documents.get(doc.path)!),
              ...group.retire.map((image) => this.images.get(image.path)!),
            ];
            const state: GroupState = states.includes('unconfirmed')
              ? 'unconfirmed'
              : states.every((state) => state === 'verified')
                ? 'completed'
                : states.includes('verified')
                  ? 'partial'
                  : 'unprocessed';
            return {
              groupKey: group.groupKey,
              keepPath: group.keep.path,
              state,
              documentPaths: changes.map((doc) => doc.path),
              retirePaths: group.retire.map((image) => image.path),
              plannedEdits: changes.reduce((sum, doc) => sum + doc.edits, 0),
              verifiedEdits: changes.reduce(
                (sum, doc) => sum + (this.documents.get(doc.path) === 'verified' ? doc.edits : 0),
                0,
              ),
            };
          })
        : [];
    return {
      kind: this.plan.kind,
      outcome,
      cancellationRequested,
      stoppedAt: this.stage,
      finalVerification: this.finalVerification,
      documents,
      images,
      groups,
      ...(detail === undefined ? {} : { issue: { stage: this.stage, path: this.path, detail } }),
    };
  }
}
