import { assert } from './model';

export const MAX_RETIRE_COUNT = 100;
export const MAX_MERGE_RETIRE_BYTES = 192 * 1024 * 1024;

export function checkedByteTotal(sizes: readonly number[]): number {
  let total = 0;
  for (const size of sizes) {
    assert(Number.isSafeInteger(size) && size >= 0, 'Image size is invalid.');
    total += size;
    assert(Number.isSafeInteger(total), 'Selected image byte total is too large.');
  }
  return total;
}
