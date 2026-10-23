import {
  assert,
  digest,
  textBytes,
  type Hasher,
  type Plan,
  type Snapshot,
  type VaultPort,
} from '../domain/model';
import { RecoveryStore } from '../infrastructure/recovery-store';
import { active, sourcePath } from '../domain/paths';
import { parseSource, resolveReference, verifyTargets } from '../references';
import { scan, unreferencedReasons } from './scan';
import { WriteLock } from './write-lock';
import { finishedRecoveryState } from '../domain/recovery';
import { RecoveryCleanupService } from './cleanup-recovery';
import { errorDetail, message, type Text } from '../domain/messages';

export interface RestoreResult {
  cleanupError?: Text;
}
export class OperationService {
  get busy(): boolean {
    return this.lock.busy;
  }
  constructor(
    private vault: VaultPort,
    private recovery: RecoveryStore,
    private hash: Hasher,
    private lock = new WriteLock(),
  ) {}
  async execute(
    plan: Plan,
    snapshot: Snapshot,
    signal?: AbortSignal,
    progress?: (message: Text) => void,
  ): Promise<void> {
    const release = this.lock.acquire();
    let prepared = false;
    try {
      assert(
        !(await this.recovery.history()).some((item) => !finishedRecoveryState(item.state)),
        'Resolve unfinished recovery operations first.',
      );
      assert(snapshot.revision === plan.revision, 'Scan changed. Preview a new plan.');
      const fresh = await scan(this.vault, this.hash, {
        revision: snapshot.revision,
        settings: snapshot.settings,
        signal,
      });
      assert(!fresh.blockers.length, 'Reference coverage changed.');
      assert(
        fresh.sources.length === plan.baseline.length &&
          fresh.sources.every((source) =>
            plan.baseline.some(
              (item) => item.path === source.path && item.digest === source.digest,
            ),
          ),
        'Reference sources changed. Scan again.',
      );
      for (const image of [...plan.retire, ...plan.keep]) {
        const current = fresh.media.find((item) => item.path === image.path);
        assert(
          current?.digest === image.digest &&
            (plan.keep.some((item) => item.path === image.path) || !current.reasons.length),
          message('Image changed or is protected: {path}', { path: image.path }),
        );
        if (!plan.keep.length)
          assert(
            !unreferencedReasons(current, fresh).length,
            message('Image is no longer recyclable: {path}', { path: image.path }),
          );
      }
      if (plan.keep[0]) {
        const retained = new Uint8Array(await this.vault.readBinary(plan.keep[0].path));
        for (const image of plan.retire) {
          const duplicate = new Uint8Array(await this.vault.readBinary(image.path));
          assert(
            duplicate.length === retained.length &&
              duplicate.every((value, index) => value === retained[index]),
            'Images are not byte-identical.',
          );
        }
      }
      assert(!signal?.aborted, 'Operation cancelled.');
      await this.recovery.prepare(plan, this.vault);
      prepared = true;
      for (const doc of plan.documents) {
        assert(!signal?.aborted, 'Operation cancelled.');
        progress?.(message('Updating references: {path}', { path: doc.path }));
        await this.recovery.append(plan.id, `writing:${doc.path}`);
        await this.vault.process(doc.path, (text) => {
          assert(text === doc.before, message('Document changed: {path}', { path: doc.path }));
          return doc.after;
        });
        assert(
          (await this.vault.readText(doc.path)) === doc.after,
          'Document write verification failed.',
        );
        await this.recovery.append(plan.id, `written:${doc.path}`);
      }
      for (const image of plan.retire) {
        assert(!signal?.aborted, 'Operation cancelled.');
        await this.verify(plan, snapshot);
        progress?.(message('Keeping image in recovery storage: {path}', { path: image.path }));
        await this.recovery.append(plan.id, `retiring:${image.path}`);
        const backup = await this.recovery.image(plan.id, image.digest);
        assert(backup.byteLength === image.size, 'Recovery image size changed before recycling.');
        assert(
          (await digest(await this.vault.readBinary(image.path))) === image.digest,
          'Image changed immediately before recycling.',
        );
        assert(!signal?.aborted, 'Operation cancelled.');
        await this.vault.remove(image.path);
        assert(!(await this.vault.exists(image.path)), 'Image still exists after recycling.');
        await this.recovery.append(plan.id, `retired:${image.path}`);
      }
      await this.verify(plan, snapshot);
      await this.recovery.append(plan.id, 'completed');
    } catch (error) {
      if (prepared) {
        try {
          await this.restoreFiles(plan);
          await this.recovery.append(plan.id, 'rolledBack');
        } catch {
          try {
            await this.recovery.append(plan.id, 'needsRecovery');
          } catch {
            /* Existing verified material must remain available. */
          }
        }
      }
      throw error;
    } finally {
      release();
    }
  }
  private async verify(plan: Plan, snapshot: Snapshot): Promise<void> {
    const files = this.vault.list().filter((file) => active(file.path));
    assert(
      !files.some((file) => /\.base$/i.test(file.path)),
      'Unsupported reference container appeared.',
    );
    const sources = files.filter((file) => sourcePath(file.path));
    assert(
      sources.length === plan.baseline.length &&
        sources.every((source) => plan.baseline.some((item) => item.path === source.path)),
      'Reference source inventory changed.',
    );
    const actual = [];
    for (const source of sources) {
      const text = await this.vault.readText(source.path),
        changed = plan.documents.find((doc) => doc.path === source.path);
      const expected = changed
        ? await digest(textBytes(changed.after))
        : plan.baseline.find((item) => item.path === source.path)!.digest;
      assert(
        (await digest(textBytes(text))) === expected,
        message('Document changed during execution: {path}', { path: source.path }),
      );
      actual.push({ path: source.path, text });
    }
    const replacements = new Map(
      plan.retire.map((image) => [image.path, plan.keep[0]?.path ?? '']),
    );
    const projected = files
      .map((file) => file.path)
      .filter((path) => !plan.retire.some((image) => image.path === path));
    verifyTargets(
      snapshot.sources,
      actual,
      snapshot.files.map((file) => file.path),
      projected,
      replacements,
    );
    for (const keep of plan.keep)
      assert(
        (await digest(await this.vault.readBinary(keep.path))) === keep.digest,
        'Retained image changed.',
      );
  }
  async restore(
    plan: Plan,
    signal?: AbortSignal,
    progress?: (message: Text) => void,
  ): Promise<RestoreResult> {
    const release = this.lock.acquire();
    let started = false;
    try {
      const saved = await this.recovery.loadPlan(plan.id);
      assert(
        JSON.stringify(saved) === JSON.stringify(plan),
        'Recovery plan changed. Preview recovery again.',
      );
      started = true;
      await this.restoreFiles(plan, signal);
      await this.recovery.append(plan.id, 'restored');
    } catch (error) {
      if (started) {
        try {
          await this.recovery.append(plan.id, 'needsRecovery');
        } catch {
          /* Preserve records on storage failure. */
        }
      }
      throw error;
    } finally {
      release();
    }
    // The restored state is durable before disposal starts. Disposal errors must never
    // turn a verified restoration into needsRecovery or recreate partially removed logs.
    try {
      await new RecoveryCleanupService(this.recovery, this.lock).discardRestored(
        plan.id,
        signal,
        progress,
      );
      return {};
    } catch (error) {
      return { cleanupError: errorDetail(error) };
    }
  }
  private async restoreFiles(plan: Plan, signal?: AbortSignal): Promise<void> {
    assert(!signal?.aborted, 'Recovery stopped. Recovery data was retained.');
    // Preserve later edits, but restore safe original images even when a document needs manual recovery.
    const documentConflicts: string[] = [];
    for (const doc of plan.documents) {
      const text = await this.vault.readText(doc.path);
      if (text !== doc.before && text !== doc.after) documentConflicts.push(doc.path);
    }
    for (const image of plan.retire) {
      if (await this.vault.exists(image.path))
        assert(
          (await digest(await this.vault.readBinary(image.path))) === image.digest,
          message('Recovery path conflict: {path}', { path: image.path }),
        );
      else await this.recovery.image(plan.id, image.digest);
    }
    // New references may safely use restored originals, but must not be redirected by a basename collision.
    const beforeNames = this.vault
      .list()
      .filter((file) => active(file.path))
      .map((file) => file.path);
    const afterNames = [...new Set([...beforeNames, ...plan.retire.map((image) => image.path)])];
    for (const file of this.vault
      .list()
      .filter((file) => active(file.path) && sourcePath(file.path))) {
      const text = await this.vault.readText(file.path);
      for (const ref of parseSource(file.path, text).references) {
        const before = resolveReference(ref, beforeNames),
          after = resolveReference(ref, afterNames);
        assert(
          !after.ambiguous && (!before.target || before.target === after.target),
          message('Restoring images would redirect a reference: {path}', { path: file.path }),
        );
      }
    }
    for (const image of plan.retire)
      if (!(await this.vault.exists(image.path))) {
        assert(!signal?.aborted, 'Recovery stopped. Recovery data was retained.');
        await this.vault.createBinary(image.path, await this.recovery.image(plan.id, image.digest));
        assert(
          (await digest(await this.vault.readBinary(image.path))) === image.digest,
          'Restored image verification failed.',
        );
      }
    assert(
      !documentConflicts.length,
      message('Recovery conflict: {path}', { path: documentConflicts.join(', ') }),
    );
    for (const doc of plan.documents) {
      assert(!signal?.aborted, 'Recovery stopped. Recovery data was retained.');
      await this.vault.process(doc.path, (text) => {
        assert(
          text === doc.before || text === doc.after,
          message('Recovery conflict: {path}', { path: doc.path }),
        );
        return doc.before;
      });
      assert(
        (await this.vault.readText(doc.path)) === doc.before,
        'Restored document verification failed.',
      );
    }
    // Check the whole result again before authorizing disposal, including images
    // restored earlier that another editor/plugin might have changed meanwhile.
    for (const image of plan.retire)
      assert(
        (await digest(await this.vault.readBinary(image.path))) === image.digest,
        'Restored image changed before final verification.',
      );
    for (const doc of plan.documents)
      assert(
        (await this.vault.readText(doc.path)) === doc.before,
        'Restored document changed before final verification.',
      );
    assert(!signal?.aborted, 'Recovery stopped. Recovery data was retained.');
  }
}
