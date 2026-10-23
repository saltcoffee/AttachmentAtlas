import { assert, type EditableReference, type Reference, type Source } from '../domain/model';
import { basename, dirname, vaultPath } from '../domain/paths';
import { parseCanvas } from './canvas';
import { parseMarkdown } from './markdown';
import { message } from '../domain/messages';
import { externalLink } from './urls';
import { excalidrawSource, parseExcalidraw } from './excalidraw';
export function resolveReference(
  reference: Reference,
  files: string[],
): { target: string; ambiguous: boolean; external: boolean } {
  let raw = reference.linkpath;
  if (externalLink(raw)) return { target: '', ambiguous: false, external: true };
  try {
    if (reference.style === 'markdown') raw = decodeURIComponent(raw);
  } catch {
    return { target: '', ambiguous: true, external: false };
  }
  if (externalLink(raw)) return { target: '', ambiguous: false, external: true };
  if (/^[a-z][\w+.-]*:/i.test(raw)) return { target: '', ambiguous: true, external: false };
  try {
    const candidates = new Set<string>();
    if (reference.style === 'json') {
      const exact = vaultPath(raw);
      if (files.includes(exact)) candidates.add(exact);
    } else if (!raw.includes('/') && reference.style === 'wiki') {
      files.filter((path) => basename(path) === raw).forEach((path) => candidates.add(path));
    } else {
      if (!raw.startsWith('/')) {
        const parent = dirname(reference.source);
        const relative = vaultPath(parent ? `${parent}/${raw}` : raw);
        if (files.includes(relative)) candidates.add(relative);
      }
      if (!raw.startsWith('../') && !raw.startsWith('./')) {
        const root = vaultPath(raw.replace(/^\//, ''));
        if (files.includes(root)) candidates.add(root);
      }
    }
    return {
      target: candidates.size === 1 ? [...candidates][0]! : '',
      ambiguous: candidates.size > 1,
      external: false,
    };
  } catch {
    return { target: '', ambiguous: true, external: false };
  }
}
export function parseSource(
  path: string,
  text: string,
): { references: Reference[]; hints: string[] } {
  assert(!text.startsWith('\uFEFF'), 'BOM-encoded sources require manual review.');
  if (excalidrawSource(path, text)) return parseExcalidraw(text, path);
  return path.toLowerCase().endsWith('.canvas')
    ? parseCanvas(text, path)
    : parseMarkdown(text, path);
}
function targetText(reference: Reference, path: string): string {
  if (reference.style === 'json') return JSON.stringify(path);
  if (reference.style === 'wiki') {
    assert(!/[#|[\]%]/.test(path), 'This retained filename needs manual Wiki-link review.');
    return path;
  }
  const encoded = path
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
  return `/${encoded}`;
}
interface Patch {
  start: number;
  end: number;
  value: string;
}
function apply(text: string, patches: Patch[]): string {
  let previous = text.length;
  for (const patch of patches.sort((a, b) => b.start - a.start)) {
    assert(patch.end <= previous && patch.start <= patch.end, 'Overlapping reference patches.');
    text = text.slice(0, patch.start) + patch.value + text.slice(patch.end);
    previous = patch.start;
  }
  return text;
}
export function rewrite(source: Source, replacements: Map<string, string>): string {
  const patches: Patch[] = [];
  const nested = new Map<
    number,
    { outer: NonNullable<EditableReference['outer']>; patches: Patch[] }
  >();
  for (const ref of source.references) {
    const target = replacements.get(ref.target);
    if (!target) continue;
    assert(!ref.readOnly, 'Excalidraw references are read-only. Retain the referenced image.');
    const patch = { start: ref.start, end: ref.end, value: targetText(ref, target) };
    if (ref.outer) {
      const group = nested.get(ref.outer.start) ?? { outer: ref.outer, patches: [] };
      group.patches.push(patch);
      nested.set(ref.outer.start, group);
    } else patches.push(patch);
  }
  for (const { outer, patches: inner } of nested.values())
    patches.push({
      start: outer.start,
      end: outer.end,
      value: JSON.stringify(apply(outer.text, inner)),
    });
  return apply(source.text, patches);
}
export function verifyTargets(
  before: Source[],
  after: { path: string; text: string }[],
  filesBefore: string[],
  filesAfter: string[],
  replacements: Map<string, string>,
): void {
  for (const source of before) {
    const updated = after.find((item) => item.path === source.path);
    assert(updated, 'Reference source disappeared.');
    const refs = parseSource(source.path, updated.text).references;
    assert(refs.length === source.references.length, 'Reference count changed unexpectedly.');
    for (const [index, ref] of source.references.entries()) {
      const old = resolveReference(ref, filesBefore),
        next = resolveReference(refs[index]!, filesAfter);
      assert(
        !next.ambiguous && next.target === (replacements.get(old.target) ?? old.target),
        message('Reference target changed unexpectedly: {path}', { path: source.path }),
      );
    }
  }
}
