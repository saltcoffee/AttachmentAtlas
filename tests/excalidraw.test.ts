import { describe, expect, it } from 'vitest';
import LZString from 'lz-string';
import { parseSource, resolveReference, rewrite } from '../src/references';
import { decompressScene } from '../src/references/excalidraw-compression';
import { OperationService } from '../src/application/execute';
import { digest, textBytes, type Source } from '../src/domain/model';
import { drawing } from './excalidraw-fixtures';
import { MemoryVault, PNG, mergePlan, recyclePlan, snapshot } from './helpers';

describe('bounded Excalidraw decompression', () => {
  it.each([
    '{"type":"excalidraw"}',
    '中文 😀 [[assets/photo.png]]',
    'abc'.repeat(1000),
    '\u0000'.repeat(80),
  ])('reads upstream LZ-String payloads: %s', (text) => {
    expect(decompressScene(LZString.compressToBase64(text))).toBe(text);
  });
  it('rejects truncated, corrupt, trailing and oversized payloads', () => {
    const payload = LZString.compressToBase64('abc'.repeat(500));
    for (const bad of ['', '!!!!', payload.slice(0, -5), payload + 'AAAA'])
      expect(() => decompressScene(bad)).toThrow();
    expect(() => decompressScene(payload, 100)).toThrow('budget');
  });
});

describe('read-only Excalidraw reference indexing', () => {
  it.each([true, false])(
    'reads drawings with compressed=%s and protects embedded attachments',
    async (compressed) => {
      const text = drawing(
        [{ id: 'image', type: 'image', fileId: 'file1' }],
        '## Embedded Files\nfile1: [[used.png]]\n',
        compressed,
      );
      const vault = new MemoryVault({
        'used.png': PNG,
        'other.png': PNG,
        'map.excalidraw.md': text,
      });
      const result = await snapshot(vault);
      expect(result.blockers).toEqual([]);
      const used = result.media.find((image) => image.path === 'used.png')!;
      expect(used.references).toHaveLength(1);
      expect(used.references[0]?.readOnly).toBe(true);
      expect(used.reasons).toContain(
        'Referenced by an Excalidraw drawing. Retain this image; drawing references are read-only.',
      );
      expect(() => mergePlan(result, ['used.png'], 'other.png')).toThrow('read-only');
      expect(() => recyclePlan(result, ['used.png'])).toThrow();
      // Retaining the drawing's attachment permits unrelated duplicate copies to be merged.
      const plan = mergePlan(result, ['other.png'], 'used.png');
      const operations = new OperationService(vault, digest);
      await operations.execute(plan, result);
      expect(await vault.readText('map.excalidraw.md')).toBe(text);
      expect(vault.removed).toEqual(['other.png']);
      expect(await vault.readBinary('used.png')).toEqual(PNG);
    },
  );
  it('allows immediate cleanup next to a drawing with no attachments', async () => {
    const text = drawing([{ id: 'text', type: 'text', text: 'A synthetic mind map' }]);
    const vault = new MemoryVault({ 'unused.png': PNG, 'map.excalidraw.md': text });
    const result = await snapshot(vault);
    expect(result.blockers).toEqual([]);
    const plan = recyclePlan(result, ['unused.png']);
    await new OperationService(vault, digest).execute(plan, result);
    expect(vault.removed).toEqual(['unused.png']);
    expect(await vault.readText('map.excalidraw.md')).toBe(text);
  });
  it.each(['rawText', 'originalText', 'text', 'link'])(
    'indexes references stored only in scene.%s',
    async (field) => {
      const text = drawing([{ id: 'text', type: 'text', [field]: '![image](used.png)' }]);
      const result = await snapshot(
        new MemoryVault({ 'used.png': PNG, 'map.excalidraw.md': text }),
      );
      expect(result.blockers).toEqual([]);
      expect(result.media[0]?.references).toHaveLength(1);
    },
  );
  it('includes plain element links, unknown attachment fields and quoted frontmatter markers', async () => {
    const text = drawing([
      {
        id: 'shape',
        type: 'rectangle',
        link: 'used.png',
        customData: { unknownAttachment: 'other.png' },
      },
    ]).replace('excalidraw-plugin:', '"excalidraw-plugin":');
    const result = await snapshot(
      new MemoryVault({ 'used.png': PNG, 'other.png': PNG, 'map.md': text }),
    );
    expect(result.blockers).toEqual([]);
    expect(result.media.find((image) => image.path === 'used.png')?.references).toHaveLength(1);
    expect(result.media.find((image) => image.path === 'other.png')?.reasons).toContain(
      'Possible reference in unsupported syntax or plain text.',
    );
  });
  it('reads standalone scene JSON without treating embedded data URLs as vault attachments', () => {
    const text = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      elements: [
        { id: 'img', type: 'image', fileId: 'one' },
        { id: 'link', type: 'rectangle', link: '[[used.png]]' },
      ],
      files: { one: { dataURL: 'data:image/png;base64,used.png' } },
    });
    const parsed = parseSource('map.excalidraw', text);
    expect(parsed.references).toHaveLength(1);
    expect(resolveReference(parsed.references[0]!, ['used.png']).target).toBe('used.png');
    expect(parsed.hints.join(' ')).not.toContain('base64');
  });
  it('never produces drawing edits even if passed a replacement map directly', () => {
    const text = drawing([], '## Embedded Files\nfile1: [[used.png]]\n');
    const parsed = parseSource('map.excalidraw.md', text);
    parsed.references.forEach((reference) => {
      reference.target = 'used.png';
    });
    const source: Source = { ...parsed, path: 'map.excalidraw.md', text, digest: '' };
    expect(() => rewrite(source, new Map([['used.png', 'other.png']]))).toThrow('read-only');
  });
  it.each([
    '---\nexcalidraw-plugin: parsed\n---\n',
    drawing().replace(/N4[^\n]*/, 'invalid'),
    drawing().replace('compressed-json', 'unknown-codec'),
    drawing([], '', false).replace('"elements":[]', '"elements":[],"elements":[]'),
    drawing([], '', false).replace('"version":2', '"version":9'),
    drawing([{ id: 'image', type: 'image', fileId: 'missing' }]),
    drawing([
      { id: 'duplicate', type: 'text' },
      { id: 'duplicate', type: 'rectangle' },
    ]),
  ])('keeps unknown or damaged drawing coverage blocked: %s', async (text) => {
    const result = await snapshot(
      new MemoryVault({ 'unused.png': PNG, 'map.excalidraw.md': text }),
    );
    expect(result.blockers).not.toEqual([]);
    expect(() => recyclePlan(result, ['unused.png'])).toThrow('coverage');
  });
  it('rechecks drawings changed after preview before removing any image', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG, 'map.excalidraw.md': drawing() });
    const result = await snapshot(vault);
    const plan = recyclePlan(result, ['unused.png']);
    vault.files.set(
      'map.excalidraw.md',
      textBytes(drawing([], '## Embedded Files\nfile1: [[unused.png]]\n')),
    );
    await expect(new OperationService(vault, digest).execute(plan, result)).rejects.toThrow(
      'sources changed',
    );
    expect(vault.removed).toEqual([]);
  });
});
