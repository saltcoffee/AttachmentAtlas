import type { Media, Snapshot } from '../domain/model';
import { unreferencedReasons } from './scan';

export interface GroupSelection {
  readonly keepPath: string;
  readonly retirePaths: readonly string[];
}
export interface OrganizerSelectionState {
  readonly scanId: number;
  readonly selectionRevision: number;
  readonly groups: Readonly<Record<string, GroupSelection>>;
  readonly unreferencedPaths: readonly string[];
}
export function duplicateGroupKey(group: readonly Media[]): string {
  const image = group[0];
  return image ? `${image.size}:${image.digest}` : '';
}

/** Owns only the shared, session-scoped choices. View filters remain local to each view. */
export class OrganizerSelection {
  private scanId = 0;
  private selectionRevision = 0;
  private groups: Record<string, { keepPath: string; retirePaths: string[] }> = {};
  private unreferencedPaths: string[] = [];
  private snapshot: Snapshot | null = null;
  private listeners = new Set<(state: OrganizerSelectionState) => void>();

  get state(): OrganizerSelectionState {
    return {
      scanId: this.scanId,
      selectionRevision: this.selectionRevision,
      groups: Object.fromEntries(
        Object.entries(this.groups).map(([key, value]) => [
          key,
          { keepPath: value.keepPath, retirePaths: [...value.retirePaths] },
        ]),
      ),
      unreferencedPaths: [...this.unreferencedPaths],
    };
  }

  subscribe(listener: (state: OrganizerSelectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  beginScan(): number {
    this.scanId++;
    this.reset();
    return this.scanId;
  }

  invalidate(): void {
    this.scanId++;
    this.reset();
  }

  acceptSnapshot(scanId: number, snapshot: Snapshot): boolean {
    if (scanId !== this.scanId) return false;
    this.snapshot = snapshot;
    this.groups = Object.fromEntries(
      snapshot.duplicates.map((group) => [
        duplicateGroupKey(group),
        { keepPath: group[0]!.path, retirePaths: [] },
      ]),
    );
    this.unreferencedPaths = [];
    this.selectionRevision++;
    this.publish();
    return true;
  }

  setKeep(groupKey: string, path: string): void {
    const group = this.findGroup(groupKey),
      image = group?.find((item) => item.path === path),
      current = this.groups[groupKey];
    if (!group || !image?.digest || !current || current.keepPath === path) return;
    this.groups[groupKey] = {
      keepPath: path,
      retirePaths: current.retirePaths.filter((item) => item !== path),
    };
    this.changed();
  }

  setGroupSelected(groupKey: string, paths: readonly string[], selected: boolean): void {
    const group = this.findGroup(groupKey),
      current = this.groups[groupKey];
    if (!group || !current) return;
    const eligible = new Set(
      group
        .filter((image) => image.path !== current.keepPath && !image.reasons.length)
        .map((i) => i.path),
    );
    if (paths.some((path) => !eligible.has(path))) return;
    const next = new Set(current.retirePaths);
    for (const path of paths) {
      if (selected) next.add(path);
      else next.delete(path);
    }
    if (!same(current.retirePaths, [...next])) {
      this.groups[groupKey] = { ...current, retirePaths: [...next] };
      this.changed();
    }
  }

  clearGroup(groupKey: string): void {
    const current = this.groups[groupKey];
    if (current?.retirePaths.length) {
      this.groups[groupKey] = { ...current, retirePaths: [] };
      this.changed();
    }
  }

  setUnreferencedSelected(paths: readonly string[], selected: boolean): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const eligible = new Set(
      snapshot.media
        .filter((image) => !unreferencedReasons(image, snapshot).length)
        .map((image) => image.path),
    );
    if (paths.some((path) => !eligible.has(path))) return;
    const next = new Set(this.unreferencedPaths);
    for (const path of paths) {
      if (selected) next.add(path);
      else next.delete(path);
    }
    if (!same(this.unreferencedPaths, [...next])) {
      this.unreferencedPaths = [...next];
      this.changed();
    }
  }

  clearUnreferenced(): void {
    if (this.unreferencedPaths.length) {
      this.unreferencedPaths = [];
      this.changed();
    }
  }

  private findGroup(groupKey: string): readonly Media[] | undefined {
    return this.snapshot?.duplicates.find((group) => duplicateGroupKey(group) === groupKey);
  }

  private reset(): void {
    this.snapshot = null;
    this.groups = {};
    this.unreferencedPaths = [];
    this.selectionRevision++;
    this.publish();
  }

  private changed(): void {
    this.selectionRevision++;
    this.publish();
  }

  private publish(): void {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}
