export type OrganizerTab = 'duplicates' | 'unreferenced' | 'large' | 'blocked';
export type SortKey = 'size' | 'path' | 'references';
export interface ImageQuery {
  readonly path: string;
  readonly format: 'all' | 'png' | 'jpeg' | 'webp' | 'unsupported';
  readonly minBytes?: number;
  readonly maxBytes?: number;
  readonly references: 'all' | 'detected' | 'not-detected';
  readonly protection: 'all' | 'protected' | 'unprotected';
}
export interface OrganizerViewState {
  tab: OrganizerTab;
  duplicateMode: 'matching' | 'selected';
  query: ImageQuery;
  sort: { key: SortKey; direction: 'asc' | 'desc' };
  pageByTab: Record<OrganizerTab, number>;
  memberPages: Record<string, number>;
  memberModes: Record<string, 'matching' | 'all' | 'selected'>;
  unreferencedMode: 'matching' | 'selected';
}
export const EMPTY_QUERY: ImageQuery = {
  path: '',
  format: 'all',
  references: 'all',
  protection: 'all',
};
export function createOrganizerViewState(): OrganizerViewState {
  return {
    tab: 'duplicates',
    duplicateMode: 'matching',
    query: { ...EMPTY_QUERY },
    sort: { key: 'size', direction: 'desc' },
    pageByTab: { duplicates: 0, unreferenced: 0, large: 0, blocked: 0 },
    memberPages: {},
    memberModes: {},
    unreferencedMode: 'matching',
  };
}

export function clampPage(page: number, total: number, size: number): number {
  return Math.max(0, Math.min(page, Math.ceil(total / size) - 1));
}

export function parseSizeQuery(
  min: string,
  max: string,
):
  | { valid: true; minBytes?: number; maxBytes?: number }
  | { valid: false; reason: 'invalid' | 'range' } {
  const parse = (raw: string): number | undefined | null => {
    if (!raw.trim()) return undefined;
    if (!/^\d+$/.test(raw.trim())) return null;
    const kib = Number(raw.trim()),
      bytes = kib * 1024;
    return Number.isSafeInteger(kib) && Number.isSafeInteger(bytes) ? bytes : null;
  };
  const minBytes = parse(min),
    maxBytes = parse(max);
  if (minBytes === null || maxBytes === null) return { valid: false, reason: 'invalid' };
  if (minBytes !== undefined && maxBytes !== undefined && minBytes > maxBytes)
    return { valid: false, reason: 'range' };
  return {
    valid: true,
    ...(minBytes === undefined ? {} : { minBytes }),
    ...(maxBytes === undefined ? {} : { maxBytes }),
  };
}
