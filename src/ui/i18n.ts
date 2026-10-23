import { getLanguage } from 'obsidian';
import { errorDetail, type Text, type Message } from '../domain/messages';
import { translate, diagnostic, dateText, numberText } from '../i18n';

export function t(text: Text, values?: Message['values']): string {
  return translate(getLanguage(), text, values);
}
export function problem(text: Text): string {
  return diagnostic(getLanguage(), text);
}
export function errorText(error: unknown): string {
  return problem(errorDetail(error));
}
export function formatDate(timestamp: number): string {
  return dateText(getLanguage(), timestamp);
}
export function formatNumber(value: number): string {
  return numberText(getLanguage(), value);
}
export function operationName(kind?: string): string {
  return t(
    kind === 'merge-exact'
      ? 'Exact duplicate merge'
      : kind === 'recycle-unreferenced'
        ? 'Unreferenced image recycling'
        : 'Unknown operation',
  );
}
export function stateName(state: string): string {
  const names: Record<string, string> = {
    preparing: 'Preparing recovery data',
    prepared: 'Recovery data prepared',
    completed: 'Completed',
    restored: 'Restored',
    rolledBack: 'Rolled back',
    needsRecovery: 'Recovery required',
    cleanupPending: 'Cleanup pending',
  };
  if (Object.hasOwn(names, state)) return t(names[state]!);
  for (const [prefix, template] of [
    ['writing:', 'Updating references: {path}'],
    ['written:', 'References updated: {path}'],
    ['retiring:', 'Keeping image in recovery storage: {path}'],
    ['retired:', 'Image recycled: {path}'],
  ] as const)
    if (state.startsWith(prefix)) return t(template, { path: state.slice(prefix.length) });
  return t('Unknown state: {state}', { state });
}
