import { describe, it, expect } from 'vitest';
import { parseSource, resolveReference, rewrite, verifyTargets } from '../src/references';
import { digest, textBytes, type Source } from '../src/domain/model';
import { vaultPath } from '../src/domain/paths';
async function replace(text: string, path = 'note.md'): Promise<string> {
  const parsed = parseSource(path, text);
  parsed.references.forEach((reference) => {
    reference.target = 'old.png';
  });
  const source: Source = { ...parsed, path, text, digest: await digest(textBytes(text)) };
  return rewrite(source, new Map([['old.png', 'assets/new image.png']])).text;
}
describe('source-aware reference rewriting', () => {
  it.each([
    ['![[old.png|300]]', '![[assets/new image.png|300]]'],
    ['[[old.png|alias]]', '[[assets/new image.png|alias]]'],
    ['![alt](old.png "title")', '![alt](/assets/new%20image.png "title")'],
    ['[label](<old.png>)', '[label](</assets/new%20image.png>)'],
    ['![a [nested] label](old.png)', '![a [nested] label](/assets/new%20image.png)'],
    ['[p]: old.png "title"\n\n![alt][p]', '[p]: /assets/new%20image.png "title"\n\n![alt][p]'],
    ['中文 ![[old.png]]\r\nKeep text', '中文 ![[assets/new image.png]]\r\nKeep text'],
    ['![[old.png#section|100x200]]', '![[assets/new image.png#section|100x200]]'],
  ])('preserves source syntax: %s', async (before, after) => {
    expect(await replace(before)).toBe(after);
  });
  it('does not rewrite code, frontmatter, or HTML', async () => {
    const text =
      '---\ncover: old.png\n---\n`![[old.png]]`\n\n```md\n![[old.png]]\n```\n<img src="old.png">';
    expect(await replace(text)).toBe(text);
    expect(parseSource('note.md', text).hints.join(' ')).toContain('old.png');
  });
  it('rewrites multiple Canvas text references without serializing unrelated JSON', async () => {
    const before =
      '{ "nodes": [{"id":"t","type":"text","text":"![[old.png|20]] and ![x](old.png)"}], "custom": 42 }';
    const after = await replace(before, 'a.canvas');
    expect(after).toContain('![[assets/new image.png|20]] and ![x](/assets/new%20image.png)');
    expect(after).toContain(', "custom": 42 }');
  });
  it('includes Canvas file and group-background references', async () => {
    const text = JSON.stringify({
      nodes: [
        { id: '1', type: 'file', file: 'old.png', subpath: '#x' },
        { id: '2', type: 'group', background: 'old.png' },
      ],
    });
    const result = JSON.parse(await replace(text, 'x.canvas')) as {
      nodes: { file?: string; background?: string; subpath?: string }[];
    };
    expect(result.nodes[0]).toEqual({
      id: '1',
      type: 'file',
      file: 'assets/new image.png',
      subpath: '#x',
    });
    expect(result.nodes[1]?.background).toBe('assets/new image.png');
  });
  it.each([
    [
      'note.md',
      '[![alt](old.png)](https://example.com)',
      '[![alt](/assets/new%20image.png)](https://example.com)',
    ],
    [
      'note.md',
      '[![alt](old.png)](old.png)',
      '[![alt](/assets/new%20image.png)](/assets/new%20image.png)',
    ],
    [
      'note.md',
      '[![alt][photo]](https://example.com)\n\n[photo]: old.png',
      '[![alt][photo]](https://example.com)\n\n[photo]: /assets/new%20image.png',
    ],
    [
      'map.canvas',
      '{"nodes":[{"id":"t","type":"text","text":"[![alt](old.png)](https://example.com)"}]}',
      '{"nodes":[{"id":"t","type":"text","text":"[![alt](/assets/new%20image.png)](https://example.com)"}]}',
    ],
  ])('rewrites nested images and verifies their targets in %s: %s', (path, text, expected) => {
    const files = ['old.png', 'assets/new image.png'];
    const parsed = parseSource(path, text);
    parsed.references.forEach((ref) => {
      ref.target = resolveReference(ref, files).target;
    });
    const source: Source = { ...parsed, path, text, digest: '' };
    const replacements = new Map([['old.png', 'assets/new image.png']]);
    const after = rewrite(source, replacements).text;
    expect(parsed.references).toHaveLength(2);
    expect(after).toBe(expected);
    expect(() =>
      verifyTargets(
        [source],
        [{ path, text: after }],
        files,
        ['assets/new image.png'],
        replacements,
      ),
    ).not.toThrow();
  });
  it('preserves protective hints surrounding overlapping nested syntax ranges', () => {
    const parsed = parseSource(
      'note.md',
      'before.png [![alt](old.png)](https://example.com) after.png',
    );
    expect(parsed.hints.join(' ')).toContain('before.png');
    expect(parsed.hints.join(' ')).toContain('after.png');
    expect(parsed.hints.join(' ')).not.toContain('old.png');
  });
  it.each([
    ['old&#46;png#fragment', '#fragment'],
    ['old&#46;png&#35;fragment', '&#35;fragment'],
    ['old.png&num;fragment', '&num;fragment'],
    ['old.png\\#fragment', '\\#fragment'],
    ['old.png?x=&#38;y&amp;z=2#fragment', '?x=&#38;y&amp;z=2#fragment'],
    ['old.png&#63;x=1&amp;y=2', '&#63;x=1&amp;y=2'],
    ['old.png&quest;x=1', '&quest;x=1'],
    ['old.png\\?x=1;', '\\?x=1;'],
  ])('preserves the exact query/fragment source spelling: %s', async (destination, suffix) => {
    const text = `![alt](<${destination}> "title")`;
    const ref = parseSource('note.md', text).references[0]!;
    expect(resolveReference(ref, ['old.png']).target).toBe('old.png');
    const after = await replace(text);
    expect(after).toBe(`![alt](</assets/new%20image.png${suffix}> "title")`);
    expect(
      resolveReference(parseSource('note.md', after).references[0]!, ['assets/new image.png'])
        .target,
    ).toBe('assets/new image.png');
  });
  it.each([
    '{',
    '{"nodes": [1]}',
    '{"nodes":[{"id":"x","type":"file","file":1}]}',
    '{"nodes":[{"id":"x","type":"text","text":"a"},{"id":"x","type":"text","text":"b"}]}',
  ])('rejects malformed Canvas: %s', (text) =>
    expect(() => parseSource('x.canvas', text)).toThrow(),
  );
  it('rejects malformed frontmatter and BOM sources', () => {
    expect(() => parseSource('x.md', '---\ncover: a.png')).toThrow();
    expect(() => parseSource('x.md', '\uFEFFhello')).toThrow();
  });
});
describe('path resolution', () => {
  it('blocks duplicate Canvas JSON keys and protects unknown attachment fields', () => {
    expect(() =>
      parseSource('a.canvas', '{"nodes":[{"id":"x","type":"file","file":"a.png","file":"b.png"}]}'),
    ).toThrow('Duplicate JSON');
    expect(parseSource('a.canvas', '{"nodes":[],"customImage":"b.png"}').hints).toContain('b.png');
  });
  it('accepts external autolinks and preserves escaped Wiki examples', async () => {
    expect(parseSource('a.md', '<https://example.com/image.png>').references).toHaveLength(1);
    const example = '\\[[old.png]]';
    expect(await replace(example)).toBe(example);
    expect(parseSource('a.md', example).hints.join(' ')).toContain('old.png');
  });
  it('parses uppercase Canvas extensions and literal percent signs in Canvas paths', () => {
    const result = parseSource(
      'Map.CANVAS',
      '{"nodes":[{"id":"x","type":"file","file":"100%20.png"}]}',
    );
    expect(resolveReference(result.references[0]!, ['100%20.png']).target).toBe('100%20.png');
  });
  it('treats a duplicate basename as ambiguous', () => {
    const ref = parseSource('note.md', '![[a.png]]').references[0]!;
    expect(resolveReference(ref, ['one/a.png', 'two/a.png']).ambiguous).toBe(true);
  });
  it('resolves relative Markdown paths and URI-encoded characters', () => {
    const ref = parseSource('notes/a.md', '![a](../assets/a%20b.png)').references[0]!;
    expect(resolveReference(ref, ['assets/a b.png']).target).toBe('assets/a b.png');
  });
  it.each([
    ['a&amp;b.png', 'a&b.png'],
    ['a&#38;b.png', 'a&b.png'],
    ['a&#x26;b.png', 'a&b.png'],
    ['a&#X26;b.png#fragment', 'a&b.png'],
    ['a&#38;b.png?x=1', 'a&b.png'],
    ['a&amp;amp;b.png', 'a&amp;b.png'],
    ['a%2520b.png', 'a%20b.png'],
    ['a&percnt;2520b.png', 'a%20b.png'],
    ['a&#x25;23b.png', 'a#b.png'],
    ['a\\(b\\).png', 'a(b).png'],
    ['a&lpar;b&rpar;.png', 'a(b).png'],
  ])('resolves syntax and URI escapes exactly once: %s', (destination, target) => {
    const ref = parseSource('note.md', `![alt](${destination})`).references[0]!;
    expect(resolveReference(ref, [target])).toEqual({ target, ambiguous: false, external: false });
  });
  it('treats decoded Markdown schemes and email autolinks as external', () => {
    for (const text of ['![alt](&#104;ttps://example.com/a.png)', '<a@example.com>']) {
      const ref = parseSource('note.md', text).references[0]!;
      expect(resolveReference(ref, []).external).toBe(true);
    }
  });
  it.each([
    '[bookmark](weread://bestbookmark?id=123)',
    '[[weread://bestbookmark]]',
    '[bookmark](weread%3A%2F%2Fbestbookmark)',
    '[app](custom+app://document/123)',
    '[network](//example.com/image.png)',
  ])('recognizes external application links: %s', (text) => {
    const ref = parseSource('note.md', text).references[0]!;
    expect(ref).toBeDefined();
    expect(resolveReference(ref, [])).toEqual({ target: '', ambiguous: false, external: true });
  });
  it.each([
    'file:///assets/photo.png',
    'app://local/assets/photo.png',
    'javascript:photo.png',
    'C:/assets/photo.png',
  ])('keeps possible filesystem or unsafe URLs blocked: %s', (url) => {
    const ref = parseSource('note.md', `[link](<${url}>)`).references[0]!;
    expect(resolveReference(ref, [])).toEqual({ target: '', ambiguous: true, external: false });
  });
  it('preserves application URLs when updating an image in the same Canvas text node', () => {
    const text = JSON.stringify({
      nodes: [
        { id: 'text', type: 'text', text: '[bookmark](weread://bestbookmark?id=123) ![[old.png]]' },
      ],
    });
    const parsed = parseSource('map.canvas', text);
    for (const ref of parsed.references)
      ref.target = resolveReference(ref, ['old.png', 'new.png']).target;
    const source: Source = { ...parsed, path: 'map.canvas', text, digest: '' };
    const replacements = new Map([['old.png', 'new.png']]);
    const after = rewrite(source, replacements).text;
    expect(after).toContain('weread://bestbookmark?id=123');
    expect(after).toContain('![[new.png]]');
    expect(() =>
      verifyTargets(
        [source],
        [{ path: source.path, text: after }],
        ['old.png', 'new.png'],
        ['new.png'],
        replacements,
      ),
    ).not.toThrow();
  });
  it('keeps entity spellings, fragments, and queries literal in Canvas file paths', () => {
    const path = 'a&amp;b%20.png#literal?value';
    const text = JSON.stringify({ nodes: [{ id: 'f', type: 'file', file: path }] });
    expect(resolveReference(parseSource('map.canvas', text).references[0]!, [path]).target).toBe(
      path,
    );
  });
  it.each(['/etc/passwd', '../escape', 'file:///secret', 'a\\b', 'a\u0000b'])(
    'rejects unsafe path: %s',
    (path) => expect(() => vaultPath(path)).toThrow(),
  );
});
