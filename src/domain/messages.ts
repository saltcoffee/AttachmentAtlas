export type Text = string | Message;
export interface Message {
  readonly template: string;
  readonly values: Readonly<Record<string, string | number | Message>>;
}

/** Keep user paths and nested diagnostics separate from translatable templates. */
export function message(template: string, values: Message['values']): Message {
  return { template, values };
}
export function asMessage(text: Text): Message {
  return typeof text === 'string' ? message(text, {}) : text;
}
export function renderMessage(
  text: Text,
  translate: (template: string) => string = (text) => text,
): string {
  const template = typeof text === 'string' ? text : text.template;
  const values = typeof text === 'string' ? {} : text.values;
  return translate(template).replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    if (!Object.hasOwn(values, name)) return placeholder;
    const value = values[name];
    if (value === undefined) return placeholder;
    return typeof value === 'object' ? renderMessage(value, translate) : String(value);
  });
}
export class AtlasError extends Error {
  constructor(readonly detail: Text) {
    super(renderMessage(detail));
    this.name = 'AtlasError';
  }
}
export function errorDetail(error: unknown): Text {
  return error instanceof AtlasError
    ? error.detail
    : error instanceof Error
      ? error.message
      : String(error);
}
