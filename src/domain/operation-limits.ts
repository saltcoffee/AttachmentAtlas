import { assert } from './model';

export const MAX_RETIRE_COUNT = 100;
export const MAX_MERGE_RETIRE_BYTES = 192 * 1024 * 1024;
export const MAX_BASE_REVIEW_BYTES = 256 * 1024 * 1024;
export const MAX_BASE_REVIEW_READS = 4096;
const UTF8 = new TextEncoder();

export interface BaseReviewBudget {
  readonly sources: number;
  readonly sourceBytes: number;
  readonly rounds: number;
  readonly reads: number;
  readonly readBytes: number;
}

/**
 * Conservative upper bound for extra `.base` review work in one plan:
 * `rounds = documents + images + 3`, `reads = sources × rounds`, `bytes = sourceBytes × rounds`.
 * The three fixed rounds cover the execution-entry/merge safety scan, the post-rewrite target
 * check, and the final check.
 */
export function baseReviewBudget(
  sources: readonly { readonly kind: string; readonly text: string }[],
  documents: number,
  images: number,
): BaseReviewBudget {
  assert(
    Number.isSafeInteger(documents) && documents >= 0 && Number.isSafeInteger(images) && images >= 0,
    'Invalid review budget inputs.',
  );
  const bases = sources.filter((source) => source.kind === 'base');
  let sourceBytes = 0;
  for (const base of bases) {
    const bytes = UTF8.encode(base.text).byteLength;
    assert(Number.isSafeInteger(bytes), 'Base review budget is too large.');
    sourceBytes += bytes;
    assert(Number.isSafeInteger(sourceBytes), 'Base review budget is too large.');
  }
  const rounds = documents + images + 3;
  const reads = bases.length * rounds;
  const readBytes = sourceBytes * rounds;
  assert(
    [rounds, reads, readBytes].every((value) => Number.isSafeInteger(value)),
    'Base review budget is too large.',
  );
  return { sources: bases.length, sourceBytes, rounds, reads, readBytes };
}

export function assertBaseReviewBudget(budget: BaseReviewBudget): void {
  assert(
    budget.reads <= MAX_BASE_REVIEW_READS && budget.readBytes <= MAX_BASE_REVIEW_BYTES,
    'Base review budget exceeded. Reduce the selected images or rewritten documents.',
  );
}

/** Counts actual `.base` reads performed during execution against the plan's upper bound. */
export class BaseReviewAccount {
  private reads = 0;
  private bytes = 0;
  constructor(readonly budget: BaseReviewBudget) {}
  reserve(bytes: number): void {
    assert(Number.isSafeInteger(bytes) && bytes >= 0, 'Image size is invalid.');
    this.reads += 1;
    this.bytes += bytes;
    assert(
      this.reads <= this.budget.reads &&
        this.bytes <= this.budget.readBytes &&
        this.reads <= MAX_BASE_REVIEW_READS &&
        this.bytes <= MAX_BASE_REVIEW_BYTES,
      'Base review budget exceeded. Reduce the selected images or rewritten documents.',
    );
  }
}

export function checkedByteTotal(sizes: readonly number[]): number {
  let total = 0;
  for (const size of sizes) {
    assert(Number.isSafeInteger(size) && size >= 0, 'Image size is invalid.');
    total += size;
    assert(Number.isSafeInteger(total), 'Selected image byte total is too large.');
  }
  return total;
}
