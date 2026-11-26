import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, MAX_SOURCE, digest, textBytes, type Source } from '../src/domain/model';
import { parseSource } from '../src/references';
import { matchAnyFilter, matchStaticImage } from '../src/references/base-expression';
import { scan, unreferencedReasons } from '../src/application/scan';
import { buildPlan } from '../src/application/plan';
import { OperationService } from '../src/application/execute';
import { ExecutionVerifier } from '../src/application/execute-validation';
import { SourceStateError, renderMessage } from '../src/domain/messages';
import { MemoryVault, PNG, mergePlan, recyclePlan, snapshot } from './helpers';

const table = `views:
  - type: table
    name: Files
    order:
      - file.name
      - file.mtime
`;

const withFormula = `filters: 'file.ext == "md"'
formulas:
  cover: 'image("images/cover.png")'
views:
  - type: table
    name: Notes
    order:
      - file.name
      - formula.cover
`;

function codes(result: Awaited<ReturnType<typeof snapshot>>): string[] {
  return result.coverageIssues.map((issue) => issue.code);
}

describe('Bases expression lexer', () => {
  it('matches only complete supported productions', () => {
    expect(matchStaticImage('image("images/a b.png")')).toBe('images/a b.png');
    expect(matchStaticImage('image("中文 😀.png")')).toBe('中文 😀.png');
    expect(matchStaticImage('image("a.png") + "b"')).toBeNull();
    expect(matchStaticImage('image(file.name)')).toBeNull();
    expect(matchStaticImage('image("a\\"b.png")')).toBe('a"b.png');
    expect(matchStaticImage('image("a\\q.png")')).toBeNull();
    expect(matchAnyFilter('file.ext == "md"')).toBe(true);
    expect(matchAnyFilter('file.inFolder("Notes")')).toBe(true);
    expect(matchAnyFilter('file.ext == "md" and file.inFolder("Notes")')).toBe(false);
    expect(matchAnyFilter('file.ext == "markdown"')).toBe(false);
    expect(matchAnyFilter('file.ext == "md" and')).toBe(false);
  });
});

describe('supported Bases subsets', () => {
  it('lifts the global block for a static table and recycles an unrelated image', async () => {
    const vault = new MemoryVault({ 'catalog.base': table, 'unused.png': PNG });
    const result = await snapshot(vault);
    expect(codes(result)).toEqual([]);
    expect(unreferencedReasons(result.media[0]!, result)).toEqual([]);
    const plan = buildPlan(result, { kind: 'recycle-unreferenced', retirePaths: ['unused.png'] });
    await new OperationService(vault, digest).execute(plan, result);
    expect(vault.removed).toEqual(['unused.png']);
    expect(await vault.readText('catalog.base')).toBe(table);
  });

  it('protects a fixed formula target read-only and leaves unrelated images recyclable', async () => {
    const vault = new MemoryVault({
      'images/cover.png': PNG,
      'unused.png': PNG,
      'catalog.base': withFormula,
    });
    const result = await snapshot(vault);
    expect(codes(result)).toEqual([]);
    const cover = result.media.find((image) => image.path === 'images/cover.png')!;
    expect(cover.references).toHaveLength(1);
    expect(cover.references[0]?.readOnly).toBe(true);
    expect(cover.references[0]?.sourceKind).toBe('base');
    expect(cover.reasons).toContain(
      'Referenced by a Bases view. Retain this image; Bases references are read-only.',
    );
    expect(() =>
      buildPlan(result, { kind: 'recycle-unreferenced', retirePaths: ['images/cover.png'] }),
    ).toThrow('Image is referenced');
    const plan = buildPlan(result, { kind: 'recycle-unreferenced', retirePaths: ['unused.png'] });
    await new OperationService(vault, digest).execute(plan, result);
    expect(vault.removed).toEqual(['unused.png']);
    expect(await vault.readText('catalog.base')).toBe(withFormula);
  });

  it('merges another copy while keeping the formula target and never rewriting the base', async () => {
    const vault = new MemoryVault({
      'images/cover.png': PNG,
      'images/copy.png': PNG,
      'note.md': '![[images/copy.png]]',
      'catalog.base': withFormula,
    });
    const result = await snapshot(vault);
    expect(codes(result)).toEqual([]);
    const keep = result.media.find((image) => image.path === 'images/cover.png')!;
    const plan = buildPlan(result, {
      kind: 'merge-exact',
      groups: [
        {
          groupKey: `${keep.size}:${keep.digest}`,
          keepPath: 'images/cover.png',
          retirePaths: ['images/copy.png'],
        },
      ],
    });
    await new OperationService(vault, digest).execute(plan, result);
    expect(vault.removed).toEqual(['images/copy.png']);
    expect(await vault.readText('note.md')).toBe('![[images/cover.png]]');
    expect(await vault.readText('catalog.base')).toBe(withFormula);
  });
});

describe('unsupported Bases sources remain globally blocked', () => {
  it.each([
    ['dynamic formula', 'formulas:\n  cover: image(file.name)\nviews:\n  - type: table\n    name: T\n    order:\n      - formula.cover\n', 'dynamic-base-expression'],
    ['unknown view field', 'views:\n  - type: table\n    name: T\n    columnSize: 2\n    order:\n      - file.name\n', 'unsupported-base-structure'],
    ['missing default columns', 'views:\n  - type: table\n    name: T\n', 'unsupported-base-structure'],
    ['empty filters', 'filters: []\nviews:\n  - type: table\n    name: T\n    order:\n      - file.name\n', 'unsupported-base-structure'],
    ['duplicate key', 'views:\n  - type: table\n    name: T\n    name: U\nviews: []\n', 'invalid-base-yaml'],
    ['multi document', 'views: []\n---\nviews: []\n', 'invalid-base-yaml'],
    ['anchor', 'formulas:\n  cover: &x image("a.png")\nviews:\n  - type: table\n    name: T\n    order:\n      - formula.cover\n', 'invalid-base-yaml'],
    ['alias', 'formulas:\n  a: &x image("a.png")\n  cover: *x\nviews:\n  - type: table\n    name: T\n    order:\n      - formula.cover\n', 'invalid-base-yaml'],
    ['tag', 'views:\n  - type: table\n    name: !custom T\n    order:\n      - file.name\n', 'invalid-base-yaml'],
  ])('blocks %s', async (_label, text, code) => {
    const result = await snapshot(new MemoryVault({ 'catalog.base': text, 'unused.png': PNG }));
    expect(codes(result)).toContain(code);
    expect(() =>
      buildPlan(result, { kind: 'recycle-unreferenced', retirePaths: ['unused.png'] }),
    ).toThrow('Reference coverage is incomplete.');
  });

  it('blocks a missing fixed image target', async () => {
    const result = await snapshot(
      new MemoryVault({ 'catalog.base': withFormula, 'unused.png': PNG }),
    );
    expect(codes(result)).toContain('unresolved-base-target');
  });

  it('keeps blocking when one unrelated source is unsupported', async () => {
    const result = await snapshot(
      new MemoryVault({
        'good.base': table,
        'bad.base': 'formulas:\n  cover: image(file.name)\nviews:\n  - type: table\n    name: T\n    order:\n      - formula.cover\n',
        'unused.png': PNG,
      }),
    );
    expect(result.coverageIssues.length).toBeGreaterThan(0);
    expect(result.coverageIssues.some((issue) => issue.source === 'bad.base')).toBe(true);
  });
});

describe('executable base code blocks', () => {
  it('blocks a real base code fence but not ordinary code samples', async () => {
    const result = await snapshot(
      new MemoryVault({
        'note.md': '```base\nviews:\n  - type: table\n    name: T\n```\n',
        'unused.png': PNG,
      }),
    );
    expect(codes(result)).toContain('unsupported-inline-base');

    const sample = await snapshot(
      new MemoryVault({
        'note.md': '```yaml\nviews:\n  - type: table\n    name: T\n```\n',
        'unused.png': PNG,
      }),
    );
    expect(codes(sample)).toEqual([]);
  });
});

describe('base source model', () => {
  it('records the source kind and a display range for a fixed formula', async () => {
    const parsed = parseSource('catalog.base', withFormula);
    expect(parsed.references).toHaveLength(1);
    const reference = parsed.references[0]!;
    expect(reference.style).toBe('base-literal');
    expect(reference.sourceKind).toBe('base');
    const source: Source = {
      path: 'catalog.base',
      text: withFormula,
      digest: '',
      kind: 'base',
      references: parsed.references,
      hints: parsed.hints,
    };
    expect(source.references[0]?.linkpath).toBe('images/cover.png');
  });

  it('reports a dynamic formula with a readable detail', async () => {
    const result = await snapshot(
      new MemoryVault({
        'catalog.base': 'formulas:\n  cover: image(file.name)\nviews:\n  - type: table\n    name: T\n    order:\n      - formula.cover\n',
        'unused.png': PNG,
      }),
    );
    const issue = result.coverageIssues.find((item) => item.code === 'dynamic-base-expression')!;
    expect(renderMessage(issue.detail!)).toContain('formulas.cover');
  });
});

describe('execution boundaries with a base source', () => {
  it.each([
    ['note.md', '![[copy.png]]'],
    ['map.canvas', JSON.stringify({ nodes: [{ id: 'copy', type: 'file', file: 'copy.png' }], edges: [] })],
  ])('blocks a later external edit to the already rewritten %s before deleting', async (path, text) => {
    const vault = new MemoryVault({ 'keep.png': PNG, 'copy.png': PNG, [path]: text, 'catalog.base': table });
    const state = await snapshot(vault);
    const plan = mergePlan(state, ['copy.png'], 'keep.png');
    const remove = vault.remove.bind(vault);
    vault.remove = async (image, beforeHostRemove) => {
      expect(await vault.readText(path)).toContain('keep.png');
      vault.files.set(path, textBytes(text));
      return remove(image, beforeHostRemove);
    };
    const result = await new OperationService(vault, digest).execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(result.stoppedAt).toBe('remove');
    expect(vault.removed).toEqual([]);
    expect(await vault.exists('copy.png')).toBe(true);
  });

  it('rechecks open contexts synchronously after the asynchronous removal guard', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG, 'catalog.base': table });
    const state = await snapshot(vault);
    let opened = false;
    vault.assertBaseContextsClosed = () => { if (opened) throw new Error('Open Bases view'); };
    const remove = vault.remove.bind(vault);
    vault.remove = async (path, beforeHostRemove) => {
      opened = true;
      return remove(path, beforeHostRemove);
    };
    const result = await new OperationService(vault, digest).execute(recyclePlan(state, ['unused.png']), state);
    expect(result.outcome).toBe('failed');
    expect(result.stoppedAt).toBe('remove');
    expect(vault.removed).toEqual([]);
  });

  it('blocks unsaved Canvas edits even before a source-change notification is delivered', async () => {
    const original = '{"nodes":[{"id":"image","type":"file","file":"copy.png"}],"edges":[]}';
    const vault = new MemoryVault({ 'keep.png': PNG, 'copy.png': PNG, 'map.canvas': original });
    const state = await snapshot(vault);
    let editorText = original;
    vault.assertSourceContents = (expected) => {
      if (editorText !== expected.get('map.canvas')) throw new Error('Unsaved Canvas change');
    };
    const process = vault.process.bind(vault), remove = vault.remove.bind(vault);
    vault.process = async (path, transform) => {
      await process(path, transform);
      editorText = await vault.readText(path);
    };
    vault.remove = async (path, proof) => {
      editorText = original;
      return remove(path, proof);
    };
    const result = await new OperationService(vault, digest).execute(mergePlan(state, ['copy.png'], 'keep.png'), state);
    expect(result.outcome).toBe('failed');
    expect(result.stoppedAt).toBe('remove');
    expect(vault.removed).toEqual([]);
    expect(await vault.exists('copy.png')).toBe(true);
  });

  it('invalidates the operation even when a newly opened context is closed before removal', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG, 'catalog.base': table });
    const state = await snapshot(vault);
    let changed!: (path: string) => void;
    const stop = vi.fn();
    vi.spyOn(vault, 'watchSourceChanges').mockImplementation((onChange) => { changed = onChange; return stop; });
    const remove = vault.remove.bind(vault);
    vault.remove = async (path, beforeHostRemove) => {
      changed('catalog.base');
      return remove(path, beforeHostRemove);
    };
    const result = await new OperationService(vault, digest).execute(recyclePlan(state, ['unused.png']), state);
    expect(result.outcome).toBe('failed');
    expect(result.stoppedAt).toBe('remove');
    expect(vault.removed).toEqual([]);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not delete a copy when the base gains its reference before the host removal', async () => {
    const vault = new MemoryVault({
      'images/cover.png': PNG,
      'images/copy.png': PNG,
      'note.md': '![[images/copy.png]]',
      'catalog.base': table,
    });
    const result = await snapshot(vault);
    expect(codes(result)).toEqual([]);
    const keep = result.media.find((image) => image.path === 'images/cover.png')!;
    const plan = buildPlan(result, {
      kind: 'merge-exact',
      groups: [
        {
          groupKey: `${keep.size}:${keep.digest}`,
          keepPath: 'images/cover.png',
          retirePaths: ['images/copy.png'],
        },
      ],
    });
    // Simulate a `.base` change during the adapter's asynchronous path check: before the final
    // synchronous callback runs, the base now references the copy that was about to be deleted.
    const baseWithCopy = withFormula.replace('images/cover.png', 'images/copy.png');
    const remove = vault.remove.bind(vault);
    vault.remove = async (path, beforeHostRemove) => {
      vault.files.set('catalog.base', textBytes(baseWithCopy));
      return remove(path, beforeHostRemove);
    };
    const execution = await new OperationService(vault, digest).execute(plan, result);
    expect(execution.outcome).toBe('failed');
    expect(execution.stoppedAt).toBe('remove');
    expect(vault.removed).toEqual([]);
    expect(await vault.exists('images/copy.png')).toBe(true);
  });

  it('stops remaining deletions when the base source changes between boundaries', async () => {
    const vault = new MemoryVault({ 'a.png': PNG, 'b.png': PNG, 'catalog.base': table });
    const result = await snapshot(vault);
    const plan = buildPlan(result, { kind: 'recycle-unreferenced', retirePaths: ['a.png', 'b.png'] });
    vault.onRemove = () => vault.files.set('catalog.base', textBytes(table.replace('file.mtime', 'file.size')));
    const execution = await new OperationService(vault, digest).execute(plan, result);
    expect(execution.outcome).toBe('failed');
    expect(vault.removed).toEqual(['a.png']);
    expect(await vault.exists('b.png')).toBe(true);
  });

  it('rejects the final host removal when a participating image changed', async () => {
    const vault = new MemoryVault({ 'a.png': PNG, 'note.md': 'No images.' });
    const result = await snapshot(vault);
    const plan = buildPlan(result, { kind: 'recycle-unreferenced', retirePaths: ['a.png'] });
    const verifier = new ExecutionVerifier(vault, plan, result);
    try {
      await verifier.verify(new Set(), new Set());
      vault.files.set('a.png', PNG);
      expect(() => verifier.beforeHostRemove('a.png')).toThrow('Participating image changed');
    } finally {
      verifier.dispose();
    }
  });

  it('accepts only the expected single-path host removal', async () => {
    const vault = new MemoryVault({ 'a.png': PNG, 'note.md': 'No images.' });
    const result = await snapshot(vault);
    const plan = buildPlan(result, { kind: 'recycle-unreferenced', retirePaths: ['a.png'] });
    const verifier = new ExecutionVerifier(vault, plan, result);
    try {
      await verifier.verify(new Set(), new Set());
      verifier.beforeHostRemove('a.png');
      vault.files.delete('a.png');
      expect(() => verifier.assertParticipantProof()).not.toThrow();
      verifier.clearExpectedRemoval();
    } finally {
      verifier.dispose();
    }
  });
});


describe('filter and hint precision', () => {
  it.each([
    'filters: {and: \'file.ext == "md"\'}',
    'filters: \'file.ext == "md" and file.inFolder("Notes")\'',
    'filters: {and: []}',
    'filters: {and: [\'file.ext == "md" and file.inFolder("Notes")\']}',
  ])('rejects an unverified filter form before allowing cleanup: %s', async (filter) => {
    const result = await snapshot(new MemoryVault({ 'catalog.base': `${filter}\n${table}`, 'unused.png': PNG }));
    expect(codes(result)).toContain('unsupported-base-structure');
    expect(() => recyclePlan(result, ['unused.png'])).toThrow('Reference coverage is incomplete.');
  });

  it('accepts the and mapping of allowed conditions and rejects bare or unknown forms', async () => {
    const andBase = `filters:\n  and:\n    - 'file.ext == "md"'\n    - 'file.inFolder("Notes")'\nviews:\n  - type: table\n    name: T\n    order:\n      - file.name\n`;
    expect(
      codes(await snapshot(new MemoryVault({ 'catalog.base': andBase, 'unused.png': PNG }))),
    ).toEqual([]);
    const bare = `filters:\n  - 'file.ext == "md"'\nviews:\n  - type: table\n    name: T\n    order:\n      - file.name\n`;
    expect(
      codes(await snapshot(new MemoryVault({ 'catalog.base': bare, 'unused.png': PNG }))),
    ).toContain('unsupported-base-structure');
    const orBase = `filters:\n  or:\n    - 'file.ext == "md"'\n    - 'file.inFolder("Notes")'\nviews:\n  - type: table\n    name: T\n    order:\n      - file.name\n`;
    expect(
      codes(await snapshot(new MemoryVault({ 'catalog.base': orBase, 'unused.png': PNG }))),
    ).toContain('unsupported-base-structure');
  });

  it('does not protect an unrelated same-name image via the recognized formula', async () => {
    const vault = new MemoryVault({
      'images/cover.png': PNG,
      'archive/cover.png': PNG,
      'catalog.base': withFormula,
    });
    const result = await snapshot(vault);
    expect(codes(result)).toEqual([]);
    const archive = result.media.find((image) => image.path === 'archive/cover.png')!;
    expect(archive.reasons).toEqual([]);
    const plan = buildPlan(result, {
      kind: 'recycle-unreferenced',
      retirePaths: ['archive/cover.png'],
    });
    await new OperationService(vault, digest).execute(plan, result);
    expect(vault.removed).toEqual(['archive/cover.png']);
  });
});

describe('base review budget and actual source size', () => {
  it('rejects a plan whose base review cost exceeds the read and byte limits', async () => {
    const padding = '\n# ' + 'x'.repeat(64 * 1024);
    const entries: Record<string, string | ArrayBuffer> = {};
    for (let index = 0; index < 48; index++) entries[`base-${index}.base`] = table + padding;
    for (let index = 0; index < 100; index++) entries[`img-${index}.png`] = PNG;
    const vault = new MemoryVault(entries);
    const result = await snapshot(vault);
    expect(result.coverageIssues).toEqual([]);
    const retirePaths = Array.from({ length: 100 }, (_, index) => `img-${index}.png`);
    expect(() =>
      buildPlan(result, { kind: 'recycle-unreferenced', retirePaths }),
    ).toThrow('Base review budget');
  });

  it('checks the actual UTF-8 bytes after reading, not only the listed metadata size', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG });
    vault.files.set('catalog.base', textBytes(table + '\n# ' + 'x'.repeat(300 * 1024)));
    const listed = vault.list.bind(vault);
    vault.list = () =>
      listed().map((file) => (file.path === 'catalog.base' ? { ...file, size: 64 } : file));
    const result = await snapshot(vault);
    expect(codes(result)).toContain('source-budget-exceeded');
  });
});

describe('Bases context exception handling', () => {
  it('preserves SourceStateError codes and details across multiple base files without reading them', async () => {
    const vault = new MemoryVault({
      'a.base': table,
      'b.base': table,
      'note.md': '![[ref.png]]',
      'ref.png': PNG,
      'copy.png': PNG,
      'unused.png': PNG,
    });
    const readText = vi.spyOn(vault, 'readText');
    vault.assertBaseContextsClosed = () => {
      throw new SourceStateError('unsaved-source', 'Save and close Bases views before scanning.');
    };
    const result = await snapshot(vault);
    const baseIssues = result.coverageIssues.filter((issue) => issue.sourceKind === 'base');
    expect(baseIssues).toHaveLength(2);
    expect(baseIssues.map((issue) => [issue.source, issue.code])).toEqual([
      ['a.base', 'unsaved-source'],
      ['b.base', 'unsaved-source'],
    ]);
    expect(renderMessage(baseIssues[0]!.detail!)).toBe(
      'Save and close Bases views before scanning.',
    );
    expect(readText).not.toHaveBeenCalledWith('a.base');
    expect(readText).not.toHaveBeenCalledWith('b.base');
    expect(result.sources.map((source) => source.path)).toEqual(['note.md']);
    expect(result.sources[0]!.references[0]?.target).toBe('ref.png');
    expect(() => recyclePlan(result, ['unused.png'])).toThrow('Reference coverage is incomplete.');
    expect(() => mergePlan(result, ['copy.png'], 'ref.png')).toThrow(
      'Reference coverage is incomplete.',
    );
  });

  it.each<[string, unknown, string]>([
    ['plain Error', new Error('Host context check failed'), 'Host context check failed'],
    ['string', 'host failure', 'host failure'],
    ['empty string', '', ''],
    ['undefined', undefined, 'undefined'],
    ['zero', 0, '0'],
    ['false', false, 'false'],
  ])('normalizes thrown %s into source-read-failed per base source', async (_label, thrown, expectedReason) => {
    const vault = new MemoryVault({
      'a.base': table,
      'b.base': table,
      'note.md': 'Plain note.',
      'unused.png': PNG,
    });
    const readText = vi.spyOn(vault, 'readText');
    vault.assertBaseContextsClosed = () => {
      throw thrown;
    };
    const result = await snapshot(vault);
    const baseIssues = result.coverageIssues.filter((issue) => issue.sourceKind === 'base');
    expect(baseIssues).toHaveLength(2);
    expect(baseIssues.map((issue) => [issue.source, issue.code])).toEqual([
      ['a.base', 'source-read-failed'],
      ['b.base', 'source-read-failed'],
    ]);
    expect(renderMessage(baseIssues[0]!.detail!)).toBe(`a.base: ${expectedReason}`);
    expect(renderMessage(baseIssues[1]!.detail!)).toBe(`b.base: ${expectedReason}`);
    expect(readText).not.toHaveBeenCalledWith('a.base');
    expect(readText).not.toHaveBeenCalledWith('b.base');
    expect(result.sources.map((source) => source.path)).toEqual(['note.md']);
  });

  it('reads and parses all base files normally when context assertion succeeds', async () => {
    const vault = new MemoryVault({
      'a.base': table,
      'b.base': table,
      'note.md': 'Plain note.',
    });
    const result = await snapshot(vault);
    expect(result.coverageIssues).toEqual([]);
    expect(result.sources.map((source) => source.path)).toEqual(['a.base', 'b.base', 'note.md']);
  });
});

describe('full-vault block and single-image read-only protection', () => {
  it('blocks all writes and deletions while Bases view is open, then protects only the read-only target once closed', async () => {
    const vault = new MemoryVault({
      'catalog.base': withFormula,
      'images/cover.png': PNG,
      'images/copy.png': PNG,
      'unused.png': PNG,
      'note.md': '![[images/copy.png]]',
    });
    let viewOpen = true;
    vault.assertBaseContextsClosed = () => {
      if (viewOpen) throw new SourceStateError('unsaved-source', 'Close Bases view.');
    };
    const processSpy = vi.spyOn(vault, 'process');
    const removeSpy = vi.spyOn(vault, 'remove');

    const blocked = await snapshot(vault);
    expect(codes(blocked)).toEqual(['unsaved-source']);
    expect(() => recyclePlan(blocked, ['unused.png'])).toThrow('Reference coverage is incomplete.');
    expect(() => mergePlan(blocked, ['images/copy.png'], 'images/cover.png')).toThrow(
      'Reference coverage is incomplete.',
    );
    expect(processSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();

    viewOpen = false;
    const ready = await snapshot(vault);
    expect(codes(ready)).toEqual([]);
    expect(() => recyclePlan(ready, ['images/cover.png'])).toThrow('Image is referenced');
    expect(removeSpy).not.toHaveBeenCalled();

    const recycle = recyclePlan(ready, ['unused.png']);
    await new OperationService(vault, digest).execute(recycle, ready);
    expect(processSpy).not.toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(vault.removed).toEqual(['unused.png']);

    const afterRecycle = await snapshot(vault);
    const merge = mergePlan(afterRecycle, ['images/copy.png'], 'images/cover.png');
    await new OperationService(vault, digest).execute(merge, afterRecycle);
    expect(processSpy).toHaveBeenCalledTimes(1);
    expect(processSpy).toHaveBeenCalledWith('note.md', expect.any(Function));
    expect(vault.removed).toEqual(['unused.png', 'images/copy.png']);
    expect(await vault.exists('images/cover.png')).toBe(true);
    expect(await vault.readText('catalog.base')).toBe(withFormula);
    expect(await vault.readText('note.md')).toBe('![[images/cover.png]]');
  });
});

describe('UTF-8 byte reuse in scan', () => {
  it('encodes each source body once for both budget validation and digesting', async () => {
    const entries: Record<string, string | ArrayBuffer> = {
      'ascii.md': 'Plain ASCII note with ![[a.png]]',
      'unicode.md': '中文笔记与表情 😀🎨 ![[b.png]]',
      'empty.md': '',
      'catalog.base': table,
      'a.png': PNG,
      'b.png': PNG,
    };
    const vault = new MemoryVault(entries);
    const encodeSpy = vi.spyOn(TextEncoder.prototype, 'encode');
    const readTextSpy = vi.spyOn(vault, 'readText');
    let digestCalls = 0;
    const trackedDigest = async (data: ArrayBuffer) => {
      digestCalls++;
      return digest(data);
    };
    try {
      const result = await scan(vault, trackedDigest, {
        revision: 1,
        settings: DEFAULT_SETTINGS,
      });
      expect(result.coverageIssues).toEqual([]);
      expect(result.sources).toHaveLength(4);
      expect(readTextSpy).toHaveBeenCalledTimes(4);
      expect(encodeSpy).toHaveBeenCalledTimes(4);
      expect(digestCalls).toBe(2);
      for (const source of result.sources) {
        expect(source.digest).toBe(await digest(textBytes(source.text)));
      }
    } finally {
      encodeSpy.mockRestore();
    }
  });

  it('enforces UTF-8 byte budgets across base, markdown, and multi-source scans', async () => {
    const baseLimit = 256 * 1024;
    const baseHeader = table + '\n# ';
    const exactBase = baseHeader + 'a'.repeat(baseLimit - Buffer.byteLength(baseHeader));
    expect(Buffer.byteLength(exactBase)).toBe(baseLimit);
    const okBaseVault = new MemoryVault({ 'ok.base': exactBase });
    expect(codes(await snapshot(okBaseVault))).toEqual([]);

    const overBaseVault = new MemoryVault({ 'over.base': exactBase + 'é' });
    expect(codes(await snapshot(overBaseVault))).toEqual(['source-budget-exceeded']);

    const exactMarkdown = 'x'.repeat(MAX_SOURCE);
    const okMdVault = new MemoryVault({ 'ok.md': exactMarkdown });
    expect(codes(await snapshot(okMdVault))).toEqual([]);

    const staleOverMdVault = new MemoryVault({ 'over.md': exactMarkdown + 'x' });
    const listed = staleOverMdVault.list.bind(staleOverMdVault);
    staleOverMdVault.list = () =>
      listed().map((file) => (file.path === 'over.md' ? { ...file, size: 10 } : file));
    expect(codes(await snapshot(staleOverMdVault))).toEqual(['source-budget-exceeded']);

    const twoMiBCanvas = '{"nodes":[],"edges":[]}'.padEnd(2 * 1024 * 1024, ' ');
    const multiEntries: Record<string, string> = {};
    for (let i = 0; i < 8; i++)
      multiEntries[`chunk-${String(i).padStart(2, '0')}.canvas`] = twoMiBCanvas;
    expect(codes(await snapshot(new MemoryVault(multiEntries)))).toEqual([]);
  });
});
