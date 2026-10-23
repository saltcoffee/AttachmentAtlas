import { assert, digest, textBytes } from '../domain/model';
import type { CleanupPreview, CleanupResult, CleanupSelection } from '../domain/recovery';
import { RecoveryStore } from '../infrastructure/recovery-store';
import { WriteLock } from './write-lock';
import { message, type Text } from '../domain/messages';

function totalBytes(selections: readonly CleanupSelection[]): number {
  return selections.reduce(
    (total, selection) =>
      total +
      (selection.markerSize ?? 0) +
      selection.remainingFiles.reduce((sum, file) => sum + file.size, 0),
    0,
  );
}

export class RecoveryCleanupService {
  constructor(
    private store: RecoveryStore,
    private lock = new WriteLock(),
  ) {}

  private async inspect(
    ids: readonly string[],
    signal?: AbortSignal,
    progress?: (message: Text) => void,
  ): Promise<CleanupPreview> {
    assert(
      ids.length > 0 && ids.length <= 100 && new Set(ids).size === ids.length,
      'Select 1–100 distinct recovery records.',
    );
    const selections: CleanupSelection[] = [];
    let files = 0;
    for (const [index, id] of ids.entries()) {
      assert(!signal?.aborted, 'Cleanup cancelled.');
      progress?.(
        message('Checking recovery record {current}/{total}', {
          current: index + 1,
          total: ids.length,
        }),
      );
      const selection = await this.store.inspectCleanup(id);
      files += selection.remainingFiles.length;
      assert(!signal?.aborted, 'Cleanup cancelled.');
      assert(files <= 10_000, 'Cleanup file limit exceeded. Select fewer records.');
      selections.push(selection);
    }
    const fingerprint = await digest(textBytes(JSON.stringify(selections)));
    assert(!signal?.aborted, 'Cleanup cancelled.');
    return { selections, totalBytes: totalBytes(selections), fingerprint };
  }

  async preview(
    ids: readonly string[],
    signal?: AbortSignal,
    progress?: (message: Text) => void,
  ): Promise<CleanupPreview> {
    const release = this.lock.acquire();
    try {
      return await this.inspect([...ids], signal, progress);
    } finally {
      release();
    }
  }

  async execute(
    preview: CleanupPreview,
    signal?: AbortSignal,
    progress?: (message: Text) => void,
  ): Promise<CleanupResult> {
    const release = this.lock.acquire();
    try {
      const fresh = await this.inspect(
        preview.selections.map((item) => item.record.id),
        signal,
        progress,
      );
      assert(
        fresh.fingerprint === preview.fingerprint,
        'Recovery data changed after preview. Preview cleanup again.',
      );
      return await this.remove(fresh, signal, progress);
    } finally {
      release();
    }
  }

  /** Restore confirmation authorizes disposal only after all original content is verified. */
  async discardRestored(
    id: string,
    signal?: AbortSignal,
    progress?: (message: Text) => void,
  ): Promise<void> {
    const release = this.lock.acquire();
    try {
      const preview = await this.inspect([id], signal, progress);
      assert(
        preview.selections[0]!.record.state === 'restored',
        'Only verified restored data can be discarded automatically.',
      );
      await this.remove(preview, signal, progress);
    } finally {
      release();
    }
  }

  private async remove(
    fresh: CleanupPreview,
    signal?: AbortSignal,
    progress?: (message: Text) => void,
  ): Promise<CleanupResult> {
    const markers = new Map<string, string>();
    // Persist every selected manifest before deleting the first file. No recursive deletion is used.
    for (const selection of fresh.selections) {
      assert(!signal?.aborted, 'Cleanup cancelled.');
      markers.set(selection.record.id, await this.store.beginCleanup(selection));
    }
    let removedRecords = 0;
    for (const selection of fresh.selections) {
      const id = selection.record.id,
        marker = markers.get(id)!;
      // Keep the original plan until all image objects and numbered logs have been removed.
      const files = [...selection.remainingFiles].sort(
        (a, b) =>
          Number(a.path.endsWith('/plan.json')) - Number(b.path.endsWith('/plan.json')) ||
          a.path.localeCompare(b.path),
      );
      for (const file of files) {
        assert(!signal?.aborted, 'Cleanup stopped. Continue it from History.');
        progress?.(message('Deleting recovery file: {path}', { path: file.path }));
        await this.store.removeCleanupFile(id, file, marker);
      }
      assert(!signal?.aborted, 'Cleanup stopped. Continue it from History.');
      await this.store.finishCleanup(id, marker);
      removedRecords++;
    }
    return { removedRecords, releasedBytes: fresh.totalBytes };
  }
}
