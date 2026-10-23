import { AtlasError, type Text } from './messages';
export interface FileEntry {
  path: string;
  size: number;
  mtime: number;
}
export interface Settings {
  scope: string;
  protectedPaths: string[];
  preferredFolder: string;
}
export const DEFAULT_SETTINGS: Settings = { scope: '', protectedPaths: [], preferredFolder: '' };
export const MAX_IMAGE = 64 * 1024 * 1024;
export const MAX_SOURCE = 4 * 1024 * 1024;
export interface Media extends FileEntry {
  width?: number;
  height?: number;
  digest: string;
  format: string;
  reasons: Text[];
  references: Reference[];
}
interface ReferenceDetails {
  source: string;
  /** Original path spelling for display and source patches, never target resolution. */
  raw: string;
  /** Syntax-decoded path; Markdown URI escapes are decoded only during resolution. */
  linkpath: string;
  target: string;
  style: 'wiki' | 'markdown' | 'json';
}
export interface EditableReference extends ReferenceDetails {
  readOnly: false;
  start: number;
  end: number;
  outer?: { start: number; end: number; text: string };
}
export type Reference = EditableReference | (ReferenceDetails & { readOnly: true });
export interface Source {
  path: string;
  text: string;
  digest: string;
  references: Reference[];
  hints: string[];
}
export interface Snapshot {
  revision: number;
  settings: Settings;
  files: FileEntry[];
  media: Media[];
  sources: Source[];
  blockers: Text[];
  duplicates: Media[][];
}
export interface DocumentChange {
  path: string;
  before: string;
  after: string;
}
export interface Plan {
  revision: number;
  kind: 'merge-exact' | 'recycle-unreferenced';
  retire: { path: string; digest: string; size: number }[];
  keep: { path: string; digest: string }[];
  documents: DocumentChange[];
  baseline: { path: string; digest: string }[];
}
export interface VaultPort {
  resolve?(reference: Reference): string | null;
  list(): FileEntry[];
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  process(path: string, transform: (text: string) => string): Promise<void>;
  /** Recycle one active attachment via system trash, with Obsidian's local-trash fallback. */
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}
export type Hasher = (data: ArrayBuffer) => Promise<string>;
export function textBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}
export async function digest(data: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export function assert(condition: unknown, message: Text): asserts condition {
  if (!condition) throw new AtlasError(message);
}
