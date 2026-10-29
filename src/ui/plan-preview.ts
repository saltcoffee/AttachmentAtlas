import type { DocumentChange, SourcePatch } from '../domain/model';

export interface PreviewSegment {
  readonly before: string;
  readonly after: string;
}
interface Window {
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
}
const MAX_SEGMENT_UNITS = 2000;

export function documentSegments(document: DocumentChange): PreviewSegment[] {
  const patches = [...document.patches].sort((a, b) => a.start - b.start),
    windows: Window[] = [],
    beforeLines = lineStarts(document.before),
    afterLines = lineStarts(document.after);
  let delta = 0;
  for (const patch of patches) {
    const afterStart = patch.start + delta,
      afterEnd = afterStart + patch.value.length,
      beforeWindow = contextWindow(document.before, beforeLines, patch.start, patch.end),
      afterWindow = contextWindow(document.after, afterLines, afterStart, afterEnd),
      next = {
        beforeStart: beforeWindow.start,
        beforeEnd: beforeWindow.end,
        afterStart: afterWindow.start,
        afterEnd: afterWindow.end,
      },
      previous = windows.at(-1);
    if (
      previous &&
      // A context boundary can touch in the source yet have a gap after a multiline edit.
      next.beforeStart <= previous.beforeEnd &&
      next.afterStart <= previous.afterEnd
    ) {
      previous.beforeEnd = Math.max(previous.beforeEnd, next.beforeEnd);
      previous.afterEnd = Math.max(previous.afterEnd, next.afterEnd);
    } else windows.push(next);
    delta += patch.value.length - (patch.end - patch.start);
  }
  const result: PreviewSegment[] = [];
  for (const window of windows) {
    const before = safeSlice(document.before, window.beforeStart, window.beforeEnd),
      after = safeSlice(document.after, window.afterStart, window.afterEnd);
    result.push(...pairChunks(before, after));
  }
  return result;
}

export function textChunks(text: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + MAX_SEGMENT_UNITS);
    if (isSplitSurrogate(text, end)) end--;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks.length ? chunks : [''];
}

function pairChunks(before: string, after: string): PreviewSegment[] {
  const beforeParts = textChunks(before),
    afterParts = textChunks(after),
    count = Math.max(beforeParts.length, afterParts.length);
  return Array.from({ length: count }, (_, index) => ({
    before: beforeParts[index] ?? '',
    after: afterParts[index] ?? '',
  }));
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let newline = text.indexOf('\n'); newline >= 0; newline = text.indexOf('\n', newline + 1))
    starts.push(newline + 1);
  return starts;
}

function lineAt(starts: readonly number[], offset: number): number {
  let low = 0,
    high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return low;
}

function contextWindow(
  text: string,
  starts: readonly number[],
  start: number,
  end: number,
): { start: number; end: number } {
  return {
    start: starts[Math.max(0, lineAt(starts, start) - 3)]!,
    end: starts[lineAt(starts, Math.max(start, end - 1)) + 4] ?? text.length,
  };
}

function safeSlice(text: string, start: number, end: number): string {
  let safeEnd = end;
  if (isSplitSurrogate(text, safeEnd)) safeEnd--;
  return text.slice(start, safeEnd);
}
function isSplitSurrogate(text: string, boundary: number): boolean {
  if (boundary <= 0 || boundary >= text.length) return false;
  const previous = text.charCodeAt(boundary - 1),
    next = text.charCodeAt(boundary);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

export function validatePatchOutput(
  before: string,
  after: string,
  patches: readonly SourcePatch[],
): boolean {
  let beforeCursor = 0,
    afterCursor = 0;
  for (const patch of [...patches].sort((a, b) => a.start - b.start)) {
    if (
      !Number.isSafeInteger(patch.start) ||
      !Number.isSafeInteger(patch.end) ||
      patch.start < beforeCursor ||
      patch.start > patch.end ||
      patch.end > before.length
    )
      return false;
    const unchangedLength = patch.start - beforeCursor;
    if (
      before.slice(beforeCursor, patch.start) !==
      after.slice(afterCursor, afterCursor + unchangedLength)
    )
      return false;
    afterCursor += unchangedLength;
    if (!after.startsWith(patch.value, afterCursor)) return false;
    afterCursor += patch.value.length;
    beforeCursor = patch.end;
  }
  return before.slice(beforeCursor) === after.slice(afterCursor);
}
