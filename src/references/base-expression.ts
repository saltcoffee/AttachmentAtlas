/**
 * A tiny, complete-match lexer for the three Bases expressions this version supports. It never
 * executes an expression and never evaluates a formula: it only decodes one JSON-compatible string.
 */

function skip(text: string, index: number): number {
  let i = index;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return i;
}

function jsonString(text: string, index: number): { value: string; end: number } | null {
  const start = skip(text, index);
  if (text[start] !== '"') return null;
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '"') {
      const raw = text.slice(start, i + 1);
      try {
        const value: unknown = JSON.parse(raw);
        return typeof value === 'string' ? { value, end: i + 1 } : null;
      } catch {
        return null;
      }
    }
    i++;
  }
  return null;
}

function literal(text: string, index: number, token: string): number | null {
  const start = skip(text, index);
  if (!text.startsWith(token, start)) return null;
  return start + token.length;
}

/** `image("fixed/vault/path.png")` — the only static image formula this version registers. */
export function matchStaticImage(expression: string): string | null {
  const open = literal(expression, 0, 'image(');
  if (open === null) return null;
  const value = jsonString(expression, open);
  if (!value) return null;
  const close = skip(expression, value.end);
  if (expression[close] !== ')') return null;
  const end = skip(expression, close + 1);
  return end === expression.length ? value.value : null;
}

/** `file.ext == "md"` — the only allowed Markdown filter condition. */
export function matchMarkdownFilter(expression: string): boolean {
  const name = literal(expression, 0, 'file.ext');
  if (name === null) return false;
  const afterName = skip(expression, name);
  if (afterName === name) return false;
  const equals = literal(expression, afterName, '==');
  if (equals === null) return false;
  const value = jsonString(expression, equals);
  if (!value || value.value !== 'md') return false;
  return skip(expression, value.end) === expression.length;
}

/** `file.inFolder("Notes")` — the only allowed folder filter condition. */
export function matchFolderFilter(expression: string): string | null {
  const name = literal(expression, 0, 'file.inFolder');
  if (name === null) return null;
  const open = skip(expression, name);
  if (expression[open] !== '(') return null;
  const value = jsonString(expression, open + 1);
  if (!value) return null;
  const close = skip(expression, value.end);
  if (expression[close] !== ')') return null;
  const end = skip(expression, close + 1);
  return end === expression.length ? value.value : null;
}

export function matchAnyFilter(expression: string): boolean {
  return matchMarkdownFilter(expression) || matchFolderFilter(expression) !== null;
}

