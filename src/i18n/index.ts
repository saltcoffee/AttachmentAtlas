import { renderMessage, type Text, type Message } from '../domain/messages';
import { zh } from './zh';

export function localeFor(language: string): 'zh-CN' | 'en-US' {
  return /^zh(?:-|$)/i.test(language.trim().replaceAll('_', '-')) ? 'zh-CN' : 'en-US';
}
function chineseText(template: string): string | undefined {
  return Object.hasOwn(zh, template) ? zh[template as keyof typeof zh] : undefined;
}
export function translate(language: string, text: Text, values?: Message['values']): string {
  const input = typeof text === 'string' && values ? { template: text, values } : text;
  const chinese = localeFor(language) === 'zh-CN';
  return renderMessage(input, (template) =>
    chinese ? (chineseText(template) ?? template) : template,
  );
}
export function diagnostic(language: string, text: Text): string {
  const chinese = localeFor(language) === 'zh-CN';
  return renderMessage(text, (template) => {
    if (!chinese) return template;
    return (
      chineseText(template) ??
      translate(language, 'Operation failed: {detail}', { detail: template })
    );
  });
}
export function dateText(language: string, timestamp: number): string {
  return new Date(timestamp).toLocaleString(localeFor(language));
}
export function numberText(language: string, value: number): string {
  return value.toLocaleString(localeFor(language));
}
