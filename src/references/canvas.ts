import {
  parseTree,
  findNodeAtLocation,
  type ParseError,
  type Node as JsonNode,
} from 'jsonc-parser';
import { assert, type Reference } from '../domain/model';
import { parseMarkdown } from './markdown';
export function parseCanvas(
  text: string,
  source: string,
): { references: Reference[]; hints: string[] } {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  assert(tree?.type === 'object' && !errors.length, 'Invalid Canvas JSON.');
  const validateKeys = (node: JsonNode) => {
    if (node.type === 'object') {
      const keys = (node.children ?? []).map(
        (property) => property.children?.[0]?.value as unknown,
      );
      assert(
        new Set(keys).size === keys.length,
        'Duplicate JSON object keys require manual review.',
      );
    }
    node.children?.forEach(validateKeys);
  };
  validateKeys(tree);
  const nodes = findNodeAtLocation(tree, ['nodes']);
  assert(!nodes || nodes.type === 'array', 'Invalid Canvas nodes.');
  const references: Reference[] = [],
    hints: string[] = [],
    ids = new Set<string>();
  const handled = new Set<number>();
  for (const [index, node] of (nodes?.children ?? []).entries()) {
    assert(node.type === 'object', 'Invalid Canvas node.');
    const id = findNodeAtLocation(tree, ['nodes', index, 'id']);
    const type = findNodeAtLocation(tree, ['nodes', index, 'type']);
    assert(
      typeof id?.value === 'string' && !ids.has(id.value),
      'Missing or duplicate Canvas node ID.',
    );
    ids.add(id.value);
    assert(typeof type?.value === 'string', 'Invalid Canvas node type.');
    const field =
      type.value === 'file'
        ? 'file'
        : type.value === 'group'
          ? 'background'
          : type.value === 'text'
            ? 'text'
            : null;
    if (!field) {
      assert(type.value === 'link', 'Unsupported Canvas node type.');
      continue;
    }
    const value = findNodeAtLocation(tree, ['nodes', index, field]);
    if (!value && field === 'background') continue;
    assert(
      value?.type === 'string' && typeof value.value === 'string',
      'Invalid Canvas reference.',
    );
    handled.add(value.offset);
    if (field === 'text') {
      const parsed = parseMarkdown(value.value, source);
      const outer = { start: value.offset, end: value.offset + value.length, text: value.value };
      references.push(...parsed.references.map((reference) => ({ ...reference, outer })));
      hints.push(...parsed.hints);
    } else
      references.push({
        source,
        readOnly: false,
        start: value.offset,
        end: value.offset + value.length,
        raw: value.value,
        linkpath: value.value,
        target: '',
        style: 'json',
      });
  }
  const collectUnknownStrings = (node: JsonNode) => {
    if (node.type === 'string' && !handled.has(node.offset) && typeof node.value === 'string')
      hints.push(node.value);
    node.children?.forEach(collectUnknownStrings);
  };
  collectUnknownStrings(tree);
  return { references, hints };
}
