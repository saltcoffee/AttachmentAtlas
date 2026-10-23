import { assert } from './model';
export function vaultPath(value: string): string {
  assert(
    value.length > 0 &&
      value.length <= 4096 &&
      !value.includes('\\') &&
      ![...value].some((character) => character.charCodeAt(0) < 32),
    'Invalid vault path.',
  );
  assert(
    !value.startsWith('/') && !/^[a-z][\w+.-]*:/i.test(value),
    'Absolute paths are not allowed.',
  );
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      assert(parts.length, 'Path escapes the vault.');
      parts.pop();
    } else parts.push(part);
  }
  assert(parts.length, 'Empty vault path.');
  return parts.join('/');
}
export function dirname(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}
export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
export function within(path: string, folder: string): boolean {
  return !folder || path === folder || path.startsWith(`${folder}/`);
}
export function active(path: string): boolean {
  return !path.split('/').some((part) => part.startsWith('.'));
}
export function imagePath(path: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(path);
}
export function sourcePath(path: string): boolean {
  return /\.(md|canvas|excalidraw)$/i.test(path);
}
