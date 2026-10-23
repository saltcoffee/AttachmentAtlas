import { fromMarkdown } from 'mdast-util-from-markdown';
import { decodeString } from 'micromark-util-decode-string';
import { assert, type EditableReference, type Reference } from '../domain/model';
interface SyntaxNode {
  type: string;
  url?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: SyntaxNode[];
}
interface Parsed {
  references: EditableReference[];
  hints: string[];
}
export function parseMarkdown(text: string, source: string): Parsed {
  const references: EditableReference[] = [],
    hints: string[] = [];
  const excluded: [number, number][] = [];
  const wikiRanges: [number, number][] = [];
  let frontEnd = 0;
  const front = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
  if (front) {
    frontEnd = front[0].length;
    hints.push(front[0]);
    excluded.push([0, frontEnd]);
  } else if (/^(?:\uFEFF)?---\r?\n/.test(text)) throw new Error('Unterminated frontmatter.');
  const add = (
    start: number,
    end: number,
    style: Reference['style'],
    destination = text.slice(start, end),
    autolink = false,
  ) => {
    const raw = text.slice(start, end);
    const suffix = destination.search(/[#?]/);
    const linkpath = suffix < 0 ? destination : destination.slice(0, suffix);
    const pathEnd =
      suffix < 0
        ? end
        : start +
          (style === 'markdown' && !autolink ? markdownPathEnd(raw, linkpath) : raw.search(/[#?]/));
    if (pathEnd > start)
      references.push({
        source,
        readOnly: false,
        start,
        end: pathEnd,
        raw: text.slice(start, pathEnd),
        linkpath,
        target: '',
        style,
      });
  };
  function visit(node: SyntaxNode): void {
    const start = node.position?.start.offset,
      end = node.position?.end.offset;
    if (start !== undefined && end !== undefined && start >= frontEnd) {
      if (['code', 'inlineCode', 'html'].includes(node.type)) {
        excluded.push([start, end]);
        hints.push(text.slice(start, end));
        return;
      }
      if (['link', 'image', 'definition'].includes(node.type)) {
        const raw = text.slice(start, end);
        const autolink = raw.startsWith('<') && raw.endsWith('>');
        const destination = autolink
          ? ([1, raw.length - 1] as [number, number])
          : destinationRange(raw, node.type === 'definition');
        assert(destination && node.url !== undefined, 'Unsupported Markdown destination syntax.');
        add(start + destination[0], start + destination[1], 'markdown', node.url, autolink);
        excluded.push([start, end]);
      }
    }
    node.children?.forEach(visit);
  }
  visit(fromMarkdown(text));
  const wiki = /!?\[\[([^\]\r\n]+)\]\]/g;
  for (const match of text.matchAll(wiki)) {
    const start = match.index;
    let backslashes = 0;
    for (let index = start - 1; index >= 0 && text[index] === '\\'; index--) backslashes++;
    if (backslashes % 2) continue;
    if (excluded.some(([a, b]) => start < b && start + match[0].length > a)) continue;
    const content = match[1]!;
    let length = content.search(/[|#]/);
    if (length < 0) length = content.length;
    if (content[length - 1] === '\\') length--;
    const offset = start + (match[0].startsWith('!') ? 3 : 2);
    add(offset, offset + length, 'wiki');
    wikiRanges.push([start, start + match[0].length]);
  }
  // Unknown constructs remain protective hints; they never authorize a mutation.
  // Parent links and nested images overlap. Consume their union using original offsets.
  const fragments: string[] = [];
  let cursor = 0;
  for (const [start, end] of [...excluded, ...wikiRanges].sort((a, b) => a[0] - b[0])) {
    if (start > cursor) fragments.push(text.slice(cursor, start));
    cursor = Math.max(cursor, end);
  }
  fragments.push(text.slice(cursor));
  const remainder = fragments.join(' ');
  hints.push(remainder.replace(/https?:\/\/[^\s)"']+/g, ''));
  return { references, hints };
}
function markdownPathEnd(raw: string, linkpath: string): number {
  // Decode complete escape/entity tokens before looking for a URL suffix: the '#'
  // in '&#38;' belongs to the entity, while '&#35;' itself introduces a fragment.
  for (const match of raw.matchAll(
    /\\[^\r\n]|&(?:#(?:[xX][\da-fA-F]+|\d+)|[A-Za-z][A-Za-z\d]*);|[#?]/g,
  )) {
    const decoded = decodeString(match[0]);
    const separator = decoded.search(/[#?]/);
    if (separator < 0) continue;
    const end = match.index + (decoded === match[0] ? separator : 0);
    assert(decodeString(raw.slice(0, end)) === linkpath, 'Unsupported Markdown URL suffix.');
    return end;
  }
  throw new Error('Unsupported Markdown URL suffix.');
}
function destinationRange(raw: string, definition: boolean): [number, number] | null {
  let cursor = 0;
  if (definition) {
    const prefix = /^ {0,3}\[(?:\\.|[^\]])+\]:\s*/.exec(raw);
    if (!prefix) return null;
    cursor = prefix[0].length;
  } else {
    cursor = raw.startsWith('!') ? 2 : 1;
    let depth = 1;
    while (cursor < raw.length && depth) {
      const c = raw[cursor++];
      if (c === '\\') cursor++;
      else if (c === '[') depth++;
      else if (c === ']') depth--;
    }
    if (raw[cursor++] !== '(') return null;
    while (/\s/.test(raw[cursor] ?? '') && cursor < raw.length) cursor++;
  }
  if (raw[cursor] === '<') {
    const start = ++cursor;
    while (cursor < raw.length) {
      if (raw[cursor] === '\\') cursor += 2;
      else if (raw[cursor] === '>') return [start, cursor];
      else cursor++;
    }
    return null;
  }
  const start = cursor;
  let depth = 0;
  while (cursor < raw.length) {
    const c = raw[cursor]!;
    if (c === '\\') {
      cursor += 2;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth === 0) break;
      depth--;
    }
    if (/\s/.test(c)) break;
    cursor++;
  }
  return cursor > start ? [start, cursor] : null;
}
