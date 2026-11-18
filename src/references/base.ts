import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  type Node,
  type Pair,
} from 'yaml';
import { asMessage, message, type Text } from '../domain/messages';
import { vaultPath } from '../domain/paths';
import type { CoverageIssue } from '../domain/reference-coverage';
import { makeIssue, type SourceKind } from '../domain/reference-coverage';
import type { BaseReference, Reference } from '../domain/model';
import {
  matchAnyFilter,
  matchStaticImage,
} from './base-expression';

export interface BaseAnalysis {
  readonly references: Reference[];
  readonly hints: string[];
  readonly issues: CoverageIssue[];
}

const ROOT_KEYS = new Set(['filters', 'views', 'properties', 'formulas']);
const FILE_PROPERTIES = new Set([
  'file.name',
  'file.ext',
  'file.path',
  'file.folder',
  'file.size',
  'file.ctime',
  'file.mtime',
]);
const VIEW_KEYS = new Set(['type', 'name', 'order', 'limit']);
const PROPERTY_KEYS = new Set(['displayName']);
const FORMULA_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SOURCE_KIND: SourceKind = 'base';

function scalarString(node: Node | null | undefined): string | null {
  return isScalar(node) && typeof node.value === 'string' ? node.value : null;
}

function fieldPath(name: string, suffix?: string): string {
  return suffix ? `${name}.${suffix}` : name;
}

function unsupported(source: string, field: string): CoverageIssue {
  return makeIssue(
    'unsupported-base-structure',
    source,
    SOURCE_KIND,
    message('Unsupported Bases field in {path}: {field}', { path: source, field }),
  );
}

function dynamic(source: string, field: string): CoverageIssue {
  return makeIssue(
    'dynamic-base-expression',
    source,
    SOURCE_KIND,
    message('Dynamic Bases expression in {path}: {field}', { path: source, field }),
  );
}

function invalid(source: string, reason: Text): CoverageIssue {
  return makeIssue(
    'invalid-base-yaml',
    source,
    SOURCE_KIND,
    message('{path}: {reason}', { path: source, reason: asMessage(reason) }),
  );
}

/** Walk the AST to reject anchors, aliases, merge keys, explicit tags and directives. */
function walkForbidden(contents: Node | null): string | null {
  const stack: Node[] = contents ? [contents] : [];
  while (stack.length) {
    const node = stack.pop()!;
    if (isAlias(node)) return 'YAML aliases are not supported.';
    if ((node as { anchor?: string }).anchor) return 'YAML anchors are not supported.';
    if ((node as { tag?: string }).tag) return 'Explicit YAML tags are not supported.';
    if (isMap(node))
      for (const pair of node.items) {
        if (scalarString(pair.key as Node) === '<<') return 'YAML merge keys are not supported.';
        if (pair.key) stack.push(pair.key as Node);
        if (pair.value) stack.push(pair.value as Node);
      }
    else if (isSeq(node)) for (const item of node.items) stack.push(item as Node);
  }
  return null;
}

function validateFilters(node: Node, source: string, issues: CoverageIssue[]): void {
  if (isScalar(node)) {
    const text = scalarString(node);
    if (text === null || !matchAnyFilter(text)) issues.push(unsupported(source, 'filters'));
    return;
  }
  // Combined filters require a non-empty YAML `and` list of single allowed conditions.
  if (isMap(node)) {
    const pairs = node.items;
    if (pairs.length !== 1 || scalarString(pairs[0]!.key as Node) !== 'and') {
      issues.push(unsupported(source, 'filters'));
      return;
    }
    const value = pairs[0]!.value as Node | null;
    if (isSeq(value)) {
      if (!value.items.length) {
        issues.push(unsupported(source, 'filters'));
        return;
      }
      for (const item of value.items) {
        const text = scalarString(item as Node);
        if (text === null || !matchAnyFilter(text)) {
          issues.push(unsupported(source, 'filters'));
          return;
        }
      }
      return;
    }
    issues.push(unsupported(source, 'filters'));
    return;
  }
  issues.push(unsupported(source, 'filters'));
}

interface FieldContext {
  readonly source: string;
  readonly formulas: Set<string>;
  readonly issues: CoverageIssue[];
}

function validateOrder(node: Node, context: FieldContext, at: string): void {
  if (!isSeq(node)) {
    context.issues.push(unsupported(context.source, at));
    return;
  }
  if (!node.items.length) {
    context.issues.push(unsupported(context.source, at));
    return;
  }
  for (const item of node.items) {
    const text = scalarString(item as Node);
    if (text === null || !allowedOrderProperty(text, context.formulas)) {
      context.issues.push(unsupported(context.source, at));
      return;
    }
  }
}

function allowedOrderProperty(name: string, formulas: Set<string>): boolean {
  if (FILE_PROPERTIES.has(name)) return true;
  if (name.startsWith('formula.')) return formulas.has(name.slice('formula.'.length));
  return false;
}

function validateProperties(node: Node, context: FieldContext): void {
  if (!isMap(node)) {
    context.issues.push(unsupported(context.source, 'properties'));
    return;
  }
  for (const pair of node.items) {
    const name = scalarString(pair.key as Node);
    const value = pair.value as Node;
    if (name === null || !allowedOrderProperty(name, context.formulas)) {
      context.issues.push(unsupported(context.source, 'properties'));
      return;
    }
    if (!isMap(value)) {
      context.issues.push(unsupported(context.source, fieldPath('properties', name)));
      return;
    }
    for (const entry of value.items) {
      const key = scalarString(entry.key as Node);
      if (key === null || !PROPERTY_KEYS.has(key)) {
        context.issues.push(unsupported(context.source, fieldPath('properties', name)));
        return;
      }
      const display = entry.value as Node;
      if (!isScalar(display) || typeof display.value !== 'string') {
        context.issues.push(unsupported(context.source, fieldPath('properties', name)));
        return;
      }
    }
  }
}

function validateViews(node: Node, context: FieldContext): void {
  if (!isSeq(node) || !node.items.length) {
    context.issues.push(unsupported(context.source, 'views'));
    return;
  }
  for (const [index, item] of node.items.entries()) {
    const at = `views.${index}`;
    if (!isMap(item as Node)) {
      context.issues.push(unsupported(context.source, at));
      continue;
    }
    const fields = new Map<string, Node>();
    for (const pair of (item as { items: Pair[] }).items) {
      const name = scalarString(pair.key as Node);
      if (name === null || !VIEW_KEYS.has(name)) {
        context.issues.push(unsupported(context.source, at));
        continue;
      }
      fields.set(name, pair.value as Node);
    }
    const type = scalarString(fields.get('type'));
    if (type !== 'table') {
      context.issues.push(unsupported(context.source, at));
      continue;
    }
    const name = scalarString(fields.get('name'));
    if (name === null || !name.trim()) {
      context.issues.push(unsupported(context.source, at));
      continue;
    }
    const limit = fields.get('limit');
    if (limit !== undefined) {
      if (!isScalar(limit) || typeof limit.value !== 'number' || !Number.isInteger(limit.value) || limit.value <= 0) {
        context.issues.push(unsupported(context.source, at));
        continue;
      }
    }
    const order = fields.get('order');
    if (order === undefined) {
      // Default columns depend on host behavior that this version has not verified.
      context.issues.push(unsupported(context.source, at));
      continue;
    }
    validateOrder(order, context, at);
  }
}

interface FormulaEntry {
  readonly name: string;
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

function readFormulas(
  node: Node,
  source: string,
  issues: CoverageIssue[],
  formulas: Set<string>,
): FormulaEntry[] {
  const entries: FormulaEntry[] = [];
  if (!isMap(node)) {
    issues.push(unsupported(source, 'formulas'));
    return entries;
  }
  for (const pair of node.items) {
    const name = scalarString(pair.key as Node);
    const at = fieldPath('formulas', name ?? '?');
    if (name === null || !FORMULA_NAME.test(name)) {
      issues.push(unsupported(source, 'formulas'));
      continue;
    }
    formulas.add(name);
    const value = pair.value as Node | null;
    const expression = scalarString(value);
    if (expression === null) {
      issues.push(dynamic(source, at));
      continue;
    }
    const path = matchStaticImage(expression);
    if (path === null) {
      issues.push(dynamic(source, at));
      continue;
    }
    const range = (value as { range?: [number, number, number] }).range;
    if (!range) {
      issues.push(unsupported(source, at));
      continue;
    }
    entries.push({ name, path, start: range[0], end: range[1] });
  }
  return entries;
}

/** Candidate static path rule for a `.base` image formula. */
export function isValidBasePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('./') || path.startsWith('../')) return false;
  if (/[#?|]/.test(path)) return false;
  if (/^[a-z][\w+.-]*:/i.test(path)) return false;
  try {
    return vaultPath(path) === path;
  } catch {
    return false;
  }
}

/**
 * Parse one `.base` YAML document with the restricted contract from the 0.1.9 requirements.
 * Returns references (fixed image formulas), protective hints (the whole original text), and every
 * global coverage issue found. Unsupported input never authorizes cleanup.
 */
export function analyzeBase(text: string, source: string): BaseAnalysis {
  const hints = [text];
  const issues: CoverageIssue[] = [];
  const references: Reference[] = [];
  if (!text.trim()) {
    issues.push(invalid(source, 'Reference source is empty.'));
    return { references, hints, issues };
  }
  const docs = parseAllDocuments(text, { uniqueKeys: true, strict: true, prettyErrors: true });
  if (docs.length !== 1) {
    issues.push(invalid(source, 'Multiple YAML documents are not supported.'));
    return { references, hints, issues };
  }
  const document = docs[0]!;
  if (document.errors.length) {
    issues.push(invalid(source, document.errors[0]!.message));
    return { references, hints, issues };
  }
  if (document.warnings.length) {
    issues.push(invalid(source, document.warnings[0]!.message));
    return { references, hints, issues };
  }
  if (document.directives.docStart || document.directives.docEnd) {
    issues.push(invalid(source, 'YAML directives are not supported.'));
    return { references, hints, issues };
  }
  const forbidden = walkForbidden(document.contents);
  if (forbidden) {
    issues.push(invalid(source, forbidden));
    return { references, hints, issues };
  }
  const contents = document.contents;
  if (!isMap(contents)) {
    issues.push(unsupported(source, 'root'));
    return { references, hints, issues };
  }
  const root = new Map<string, Node>();
  for (const pair of contents.items as Pair[]) {
    const name = scalarString(pair.key as Node);
    if (name === null || !ROOT_KEYS.has(name)) {
      issues.push(unsupported(source, name ?? 'root'));
      continue;
    }
    root.set(name, pair.value as Node);
  }
  const formulas = new Set<string>();
  const formulaEntries = root.has('formulas')
    ? readFormulas(root.get('formulas')!, source, issues, formulas)
    : [];
  const context: FieldContext = { source, formulas, issues };
  if (root.has('filters')) validateFilters(root.get('filters')!, source, issues);
  if (root.has('views')) validateViews(root.get('views')!, context);
  if (root.has('properties')) validateProperties(root.get('properties')!, context);
  const recognizedRanges: [number, number][] = [];
  for (const entry of formulaEntries) {
    if (!isValidBasePath(entry.path)) {
      issues.push(unsupported(source, fieldPath('formulas', entry.name)));
      continue;
    }
    recognizedRanges.push([entry.start, entry.end]);
    references.push({
      source,
      sourceKind: SOURCE_KIND,
      style: 'base-literal',
      readOnly: true,
      raw: text.slice(entry.start, entry.end),
      linkpath: entry.path,
      target: '',
      start: entry.start,
      end: entry.end,
      fieldPath: fieldPath('formulas', entry.name),
    } satisfies BaseReference);
  }
  if (issues.length) return { references, hints, issues };
  // Subtract only the reliably recognized formula scalars; keep every other fragment (including
  // comments and display names) as independent protective hints without joining fragments.
  hints.length = 0;
  let cursor = 0;
  for (const [start, end] of recognizedRanges.sort((a, b) => a[0] - b[0])) {
    if (start > cursor) hints.push(text.slice(cursor, start));
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) hints.push(text.slice(cursor));
  return { references, hints: hints.filter((fragment) => fragment.length > 0), issues };
}
