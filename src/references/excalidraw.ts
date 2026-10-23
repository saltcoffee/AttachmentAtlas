import { parseTree, type Node as JsonNode, type ParseError } from 'jsonc-parser';
import { assert, type Reference } from '../domain/model';
import { parseMarkdown } from './markdown';
import { decompressScene } from './excalidraw-compression';
import { externalLink } from './urls';

export function excalidrawSource(path: string, text: string): boolean {
  if (/\.excalidraw(?:\.md)?$/i.test(path)) return true;
  const front = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text)?.[1];
  return (
    (!!front &&
      /^(?:excalidraw-plugin|"excalidraw-plugin"|'excalidraw-plugin')[ \t]*:/m.test(front)) ||
    (/^# Excalidraw Data[ \t]*\r?$/m.test(text) && /^##? Drawing[ \t]*\r?$/m.test(text))
  );
}

export function parseExcalidraw(
  text: string,
  source: string,
): { references: Reference[]; hints: string[] } {
  const references: Reference[] = [],
    hints: string[] = [];
  const registered = new Set<string>();
  const seen = new Set<string>();
  const collectMarkdown = (value: string) => {
    const parsed = parseMarkdown(value, source);
    hints.push(...parsed.hints);
    for (const ref of parsed.references) {
      const key = `${ref.style}:${ref.linkpath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push({
        source,
        raw: ref.raw,
        linkpath: ref.linkpath,
        target: '',
        style: ref.style,
        readOnly: true,
      });
    }
    return parsed.references.length;
  };
  let scene = text;
  if (!/\.excalidraw$/i.test(source)) {
    // Only a complete, uniquely identified drawing fence is removed from the Markdown header.
    const sections = [
      ...text.matchAll(
        /^##? Drawing[ \t]*\r?\n[ \t\r\n]*```(json|compressed-json)[ \t]*\r?\n([\s\S]*?)^```[ \t]*(?:\r?\n|$)/gm,
      ),
    ];
    assert(sections.length === 1, 'Missing or ambiguous Excalidraw drawing section.');
    const section = sections[0]!;
    const prefix = text.slice(0, section.index);
    const suffix = text.slice(section.index + section[0].length);
    collectMarkdown(`${prefix}\n${suffix}`);
    for (const match of prefix.matchAll(/^(\w+):\s*(?:!?\[\[|(?:https?|ftps?|file):\/\/|\$\$)/gm))
      registered.add(match[1]!);
    scene = section[1] === 'compressed-json' ? decompressScene(section[2]!) : section[2]!;
  }
  const errors: ParseError[] = [];
  const tree = parseTree(scene, errors, { disallowComments: true, allowTrailingComma: false });
  assert(tree?.type === 'object' && errors.length === 0, 'Invalid Excalidraw scene JSON.');
  const fields = new Map(
    (tree.children ?? []).map((property) => [
      property.children?.[0]?.value as string,
      property.children?.[1],
    ]),
  );
  assert(
    fields.get('type')?.value === 'excalidraw' &&
      fields.get('elements')?.type === 'array' &&
      [1, 2].includes(fields.get('version')?.value as number),
    'Unsupported Excalidraw scene format.',
  );
  if (fields.has('files'))
    assert(fields.get('files')?.type === 'object', 'Invalid Excalidraw file registry.');
  for (const property of fields.get('files')?.children ?? []) {
    assert(property.children?.[1]?.type === 'object', 'Invalid Excalidraw file registry.');
    registered.add(property.children[0]!.value as string);
  }
  const ids = new Set<string>();
  for (const element of fields.get('elements')?.children ?? []) {
    assert(element.type === 'object', 'Invalid Excalidraw element.');
    const properties = new Map(
      (element.children ?? []).map((property) => [
        property.children?.[0]?.value as string,
        property.children?.[1],
      ]),
    );
    const id = properties.get('id')?.value as unknown;
    assert(
      typeof id === 'string' && !ids.has(id) && typeof properties.get('type')?.value === 'string',
      'Invalid or duplicate Excalidraw element ID.',
    );
    ids.add(id);
    if (properties.get('type')?.value === 'image' && properties.get('isDeleted')?.value !== true) {
      const fileId = properties.get('fileId')?.value as unknown;
      assert(
        typeof fileId === 'string' && registered.has(fileId),
        'Unresolved Excalidraw image data requires manual review.',
      );
    }
  }
  const stack: { node: JsonNode; field?: string }[] = [{ node: tree }];
  let nodes = 0;
  while (stack.length) {
    const { node, field } = stack.pop()!;
    assert(++nodes <= 200_000, 'Excalidraw scene exceeds the parsing budget.');
    if (node.type === 'object') {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const name = property.children?.[0]?.value as string;
        assert(!keys.has(name), 'Duplicate Excalidraw JSON keys require manual review.');
        keys.add(name);
        if (property.children?.[1]) stack.push({ node: property.children[1], field: name });
      }
    } else if (node.type === 'array') {
      for (const child of node.children ?? []) stack.push({ node: child });
    } else if (node.type === 'string' && typeof node.value === 'string') {
      const value = node.value;
      if (!value || externalLink(value)) continue;
      const beforeHints = hints.length;
      const count = collectMarkdown(value);
      if (field === 'link' && !count) {
        hints.length = beforeHints;
        const linkpath = value.split(/[#?]/)[0]!;
        if (linkpath)
          references.push({
            source,
            raw: linkpath,
            linkpath,
            target: '',
            style: 'wiki',
            readOnly: true,
          });
      }
    }
  }
  return { references, hints };
}
