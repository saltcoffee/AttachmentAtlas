import type { Media } from '../domain/model';
import type { ImageQuery, SortKey } from './organizer-state';
import { duplicateGroupKey } from '../application/organizer-selection';

export function matchesQuery(image: Media, query: ImageQuery): boolean {
  const path = query.path.trim().toLowerCase();
  if (path && !image.path.toLowerCase().includes(path)) return false;
  if (query.format !== 'all') {
    const format = image.format.toLowerCase();
    if (query.format === 'unsupported' ? format !== 'unsupported' : format !== query.format)
      return false;
  }
  if (query.minBytes !== undefined && image.size < query.minBytes) return false;
  if (query.maxBytes !== undefined && image.size > query.maxBytes) return false;
  if (query.references === 'detected' && image.references.length === 0) return false;
  if (query.references === 'not-detected' && image.references.length !== 0) return false;
  if (query.protection === 'protected' && image.reasons.length === 0) return false;
  if (query.protection === 'unprotected' && image.reasons.length !== 0) return false;
  return true;
}

export function sortImages(
  images: readonly Media[],
  key: SortKey,
  direction: 'asc' | 'desc',
): Media[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...images].sort((a, b) => {
    const primary =
      key === 'path'
        ? comparePath(a.path, b.path)
        : key === 'size'
          ? compareNumber(a.size, b.size)
          : compareNumber(a.references.length, b.references.length);
    return primary * sign || comparePath(a.path, b.path);
  });
}

export function sortGroups(
  groups: readonly (readonly Media[])[],
  key: SortKey,
  direction: 'asc' | 'desc',
): Media[][] {
  const sign = direction === 'asc' ? 1 : -1;
  return groups
    .map((group) => [...group])
    .sort((a, b) => {
      const aPath = [...a].map((item) => item.path).sort(comparePath)[0] ?? '';
      const bPath = [...b].map((item) => item.path).sort(comparePath)[0] ?? '';
      const primary =
        key === 'path'
          ? comparePath(aPath, bPath)
          : key === 'size'
            ? compareNumber(a[0]?.size ?? 0, b[0]?.size ?? 0)
            : compareNumber(
                a.reduce((sum, image) => sum + image.references.length, 0),
                b.reduce((sum, image) => sum + image.references.length, 0),
              );
      return (
        primary * sign ||
        comparePath(aPath, bPath) ||
        comparePath(duplicateGroupKey(a), duplicateGroupKey(b))
      );
    });
}

export function comparePath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareNumber(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
