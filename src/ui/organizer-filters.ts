import { t } from './i18n';
import type { SortKey } from './organizer-state';

export interface FilterDrafts {
  path: string;
  format: string;
  min: string;
  max: string;
  references: string;
  protection: string;
}
export interface FilterSort {
  key: SortKey;
  direction: 'asc' | 'desc';
}
type DraftKey = keyof FilterDrafts;
let nextFilterSet = 0;

export function renderOrganizerFilters(
  parent: HTMLElement,
  drafts: FilterDrafts,
  sort: FilterSort,
  error: string,
  onDraft: (key: DraftKey, value: string, redraw: boolean) => void,
  onSort: (key: 'key' | 'direction', value: string) => void,
  onReset: () => void,
): void {
  const filters = parent.createDiv({ cls: 'atlas-filters' }),
    prefix = `atlas-filter-set-${++nextFilterSet}`;
  input(filters, prefix, 'Filter by path', drafts.path, 'path', (value) =>
    onDraft('path', value, false),
  );
  select(
    filters,
    prefix,
    'Filter by detected format',
    drafts.format,
    [
      ['all', 'All formats'],
      ['png', 'PNG'],
      ['jpeg', 'JPEG'],
      ['webp', 'WebP'],
      ['unsupported', 'Unsupported'],
    ],
    (value) => onDraft('format', value, true),
  );
  const min = input(
      filters,
      prefix,
      'Minimum size in KiB',
      drafts.min,
      'min',
      (value) => onDraft('min', value, false),
      'text',
    ),
    max = input(
      filters,
      prefix,
      'Maximum size in KiB',
      drafts.max,
      'max',
      (value) => onDraft('max', value, false),
      'text',
    );
  select(
    filters,
    prefix,
    'Filter by detected references',
    drafts.references,
    [
      ['all', 'All reference states'],
      ['detected', 'References detected'],
      ['not-detected', 'No references detected'],
    ],
    (value) => onDraft('references', value, true),
  );
  select(
    filters,
    prefix,
    'Filter by image restrictions',
    drafts.protection,
    [
      ['all', 'All restrictions'],
      ['protected', 'Restricted'],
      ['unprotected', 'No image restriction'],
    ],
    (value) => onDraft('protection', value, true),
  );
  const sortKey = select(
    filters,
    prefix,
    'Sort images by',
    sort.key,
    [
      ['size', 'Size'],
      ['path', 'Path'],
      ['references', 'Reference count'],
    ],
    (value) => onSort('key', value),
  );
  sortKey.dataset.focusKey = 'sort-key';
  select(
    filters,
    prefix,
    'Sort direction',
    sort.direction,
    [
      ['desc', 'Descending'],
      ['asc', 'Ascending'],
    ],
    (value) => onSort('direction', value),
  );
  const reset = filters.createEl('button', { text: t('Reset filters') });
  reset.dataset.focusKey = 'reset-filter';
  reset.onclick = onReset;
  if (error) {
    const errorId = `${prefix}-error`;
    for (const field of [min, max]) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', errorId);
    }
    filters.createEl('p', {
      text: t(error),
      cls: 'atlas-error',
      attr: { role: 'alert', id: errorId },
    });
  }
}

function input(
  parent: HTMLElement,
  prefix: string,
  label: string,
  value: string,
  key: string,
  change: (value: string) => void,
  type: 'search' | 'text' = 'search',
): HTMLInputElement {
  const wrapper = parent.createDiv({ cls: 'atlas-filter' });
  const id = `${prefix}-${key}`;
  wrapper.createEl('label', { text: t(label), attr: { for: id } });
  const field = wrapper.createEl('input', {
    type,
    value,
    attr: { id, 'aria-label': t(label), 'data-focus-key': key },
  });
  if (key === 'min' || key === 'max') field.inputMode = 'numeric';
  field.oninput = () => change(field.value);
  return field;
}

function select(
  parent: HTMLElement,
  prefix: string,
  label: string,
  value: string,
  options: readonly (readonly [string, string])[],
  change: (value: string) => void,
): HTMLSelectElement {
  const wrapper = parent.createDiv({ cls: 'atlas-filter' }),
    id = `${prefix}-select-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  wrapper.createEl('label', { text: t(label), attr: { for: id } });
  const field = wrapper.createEl('select', {
    attr: { id, 'aria-label': t(label), 'data-focus-key': `filter:${label}` },
  });
  options.forEach(([key, text]) => field.createEl('option', { text: t(text), value: key }));
  field.value = value;
  field.onchange = () => change(field.value);
  return field;
}
