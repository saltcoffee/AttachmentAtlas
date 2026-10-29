import { describe, expect, it } from 'vitest';
import { documentSegments, textChunks, validatePatchOutput } from '../src/ui/plan-preview';
import { applySourcePatches } from '../src/references';
import type { SourcePatch } from '../src/domain/model';

describe('plan preview source context', () => {
  it('keeps separate windows when they only touch before a multiline edit, without duplicating source context', () => {
    const before = Array.from(
      { length: 20 },
      (_, index) => `L${String(index).padStart(2, '0')}xx\n`,
    ).join('');
    const patches = [
      { start: 0, end: 1, value: 'A\n' },
      { start: 42, end: 43, value: 'B' },
    ];
    const after = applySourcePatches(before, patches);
    const segments = documentSegments({ path: 'note.md', before, after, patches, edits: [] });
    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.before).join('')).toBe(
      before.slice(0, before.indexOf('L11')),
    );
    expect(segments[0]!.after.endsWith('L02xx\n')).toBe(true);
    expect(segments[1]!.after.startsWith('L04xx\n')).toBe(true);
  });
  it('merges nearby contexts with three lines on either side and preserves CRLF', () => {
    const before = Array.from({ length: 14 }, (_, index) => `line ${index}`).join('\r\n');
    const patches = [4, 7].map((index) => {
      const start = before.indexOf(`line ${index}`);
      return { start, end: start + 6, value: `new ${index}` };
    });
    const after = applySourcePatches(before, patches);
    const segments = documentSegments({ path: 'note.md', before, after, patches, edits: [] });
    expect(segments).toEqual([
      {
        before: Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\r\n') + '\r\n',
        after:
          Array.from({ length: 10 }, (_, index) =>
            [4, 7].includes(index + 1) ? `new ${index + 1}` : `line ${index + 1}`,
          ).join('\r\n') + '\r\n',
      },
    ]);
  });

  it('preserves all of a large single-line Canvas with many changed targets', () => {
    const before = JSON.stringify({
      nodes: Array.from({ length: 1000 }, (_, index) => ({
        id: String(index),
        type: 'file',
        file: 'b.png',
        metadata: 'x'.repeat(4000),
      })),
    });
    const patches = Array.from(before.matchAll(/"b\.png"/g), (match) => ({
      start: match.index,
      end: match.index + match[0].length,
      value: '"longer.png"',
    }));
    const after = before.replaceAll('"b.png"', '"longer.png"');
    const segments = documentSegments({ path: 'large.canvas', before, after, patches, edits: [] });
    expect(segments.map((segment) => segment.before).join('')).toBe(before);
    expect(segments.map((segment) => segment.after).join('')).toBe(after);
    expect(
      segments.every((segment) => segment.before.length <= 2000 && segment.after.length <= 2000),
    ).toBe(true);
    expect(validatePatchOutput(before, after, patches)).toBe(true);
  });

  it('keeps surrogate pairs intact at chunk boundaries', () => {
    const text = 'a'.repeat(1999) + '😀' + 'b'.repeat(2000);
    const chunks = textChunks(text);
    expect(chunks.join('')).toBe(text);
    expect(chunks[0]).toHaveLength(1999);
    expect(chunks[1]!.startsWith('😀')).toBe(true);
  });

  it('validates variable-length patches in arbitrary order and rejects corruption', () => {
    const before = 'a😀b\r\nold.png xyz',
      patches = [
        { start: 6, end: 13, value: '/longer/new.png' },
        { start: 0, end: 1, value: '' },
      ],
      after = applySourcePatches(before, patches);
    expect(validatePatchOutput(before, after, patches)).toBe(true);
    expect(validatePatchOutput(before, after + 'extra', patches)).toBe(false);
    expect(validatePatchOutput(before, 'changed' + after, patches)).toBe(false);
    expect(validatePatchOutput(before, after, [...patches, patches[0]!])).toBe(false);
    for (const start of [NaN, Infinity, -1, 0.5])
      expect(validatePatchOutput(before, after, [{ start, end: 1, value: '' }])).toBe(false);
    expect(validatePatchOutput(before, before, [] as SourcePatch[])).toBe(true);
  });
});
