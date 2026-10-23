import { getLanguage } from 'obsidian';
import { errorDetail, type Text, type Message } from '../domain/messages';
import { translate, diagnostic } from '../i18n';

export function t(text: Text, values?: Message['values']): string {
  return translate(getLanguage(), text, values);
}
export function problem(text: Text): string {
  return diagnostic(getLanguage(), text);
}
export function errorText(error: unknown): string {
  return problem(errorDetail(error));
}
