import {
  assert,
  digest,
  type Hasher,
  type Plan,
  type Snapshot,
  type VaultPort,
} from '../domain/model';
import { retiringImages, retainedImages } from '../domain/operation-plan';
import { scan, unreferencedReasons } from './scan';
import { AtlasError, asMessage, errorDetail, message, type Text } from '../domain/messages';
import { OperationCancelled, checkCancelled, yieldToHost } from './cancellation';
import { validatePlan } from './plan';
import { ExecutionRecorder, type ExecutionResult } from './execution-result';
import { ExecutionVerifier } from './execute-validation';

export class OperationService {
  private running = false;
  get busy(): boolean {
    return this.running;
  }
  constructor(
    private vault: VaultPort,
    private hash: Hasher,
  ) {}

  async execute(
    plan: Plan,
    snapshot: Snapshot,
    signal?: AbortSignal,
    progress?: (message: Text) => void,
  ): Promise<ExecutionResult> {
    assert(!this.running, 'Another operation is running.');
    const record = new ExecutionRecorder(plan);
    this.running = true;
    const completed = new Set<string>(),
      removed = new Set<string>();
    const report = (text: Text) => {
      // A renderer cannot turn a completed file action into a failed or repeated operation.
      try {
        progress?.(
          message('{step} · {documents}/{documentTotal} documents · {images}/{imageTotal} images', {
            step: asMessage(text),
            documents: completed.size,
            documentTotal: record.documents.size,
            images: removed.size,
            imageTotal: record.images.size,
          }),
        );
      } catch {
        /* File evidence remains authoritative. */
      }
    };
    try {
      checkCancelled(signal);
      assert(snapshot.revision === plan.revision, 'Scan changed. Preview a new plan.');
      validatePlan(snapshot, plan);
      record.stage = 'preflight';
      report('Rechecking all images and reference sources.');
      const fresh = await scan(this.vault, this.hash, {
        revision: snapshot.revision,
        settings: snapshot.settings,
        signal,
        progress: report,
      });
      assert(!fresh.blockers.length, 'Reference coverage changed.');
      const baselines = new Map(plan.baseline.map((source) => [source.path, source.digest]));
      assert(
        fresh.sources.length === baselines.size &&
          fresh.sources.every((source) => baselines.get(source.path) === source.digest),
        'Reference sources changed. Scan again.',
      );
      const originalPaths = new Set(snapshot.files.map((file) => file.path));
      assert(
        fresh.files.length === originalPaths.size &&
          fresh.files.every((file) => originalPaths.has(file.path)),
        'Active vault files changed during cleanup.',
      );
      const originalSources = new Map(snapshot.sources.map((source) => [source.path, source.text]));
      assert(
        fresh.sources.every((source) => originalSources.get(source.path) === source.text),
        'Reference sources changed. Scan again.',
      );
      const current = new Map(fresh.media.map((image) => [image.path, image]));
      const keeps = new Set(retainedImages(plan).map((image) => image.path));
      for (const image of [...retiringImages(plan), ...retainedImages(plan)]) {
        const item = current.get(image.path);
        assert(
          item?.digest === image.digest &&
            item.size === image.size &&
            (keeps.has(image.path) || !item.reasons.length),
          message('Image changed or is protected: {path}', { path: image.path }),
        );
        if (plan.kind === 'recycle-unreferenced')
          assert(
            !unreferencedReasons(item, fresh).length,
            message('Image is no longer recyclable: {path}', { path: image.path }),
          );
      }
      const verifier = new ExecutionVerifier(this.vault, plan, snapshot);
      record.stage = 'prove-groups';
      if (plan.kind === 'merge-exact')
        for (const group of plan.groups) {
          checkCancelled(signal);
          record.path = group.keep.path;
          const retainedBuffer = await this.vault.readBinary(group.keep.path);
          const retained = new Uint8Array(retainedBuffer);
          assert(retained.length === group.keep.size, 'Images are not byte-identical.');
          for (const image of group.retire) {
            checkCancelled(signal);
            const duplicate = new Uint8Array(await this.vault.readBinary(image.path));
            assert(duplicate.length === retained.length, 'Images are not byte-identical.');
            const chunk = 1024 * 1024;
            for (let start = 0; start < duplicate.length; start += chunk) {
              checkCancelled(signal);
              assert(
                duplicate
                  .subarray(start, start + chunk)
                  .every((value, index) => value === retained[start + index]),
                'Images are not byte-identical.',
              );
              if (start + chunk < duplicate.length) await yieldToHost();
            }
          }
          assert(
            (await digest(retainedBuffer)) === group.keep.digest,
            message('Retained image changed: {path}', { path: group.keep.path }),
          );
        }
      record.stage = 'rewrite';
      for (const doc of plan.documents) {
        record.path = doc.path;
        checkCancelled(signal);
        await verifier.verify(completed, removed, signal);
        checkCancelled(signal);
        report(message('Updating references: {path}', { path: doc.path }));
        record.documents.set(doc.path, 'unconfirmed');
        await this.vault.process(doc.path, (text) => {
          assert(text === doc.before, message('Document changed: {path}', { path: doc.path }));
          return doc.after;
        });
        // Do not honour cancellation between a host call and its evidence check.
        assert(
          (await this.vault.readText(doc.path)) === doc.after,
          'Document write verification failed.',
        );
        record.documents.set(doc.path, 'verified');
        completed.add(doc.path);
        report(message('File verified: {path}', { path: doc.path }));
      }
      checkCancelled(signal);
      record.path = undefined;
      record.stage = 'verify-references';
      await verifier.verify(completed, removed, signal, true);
      record.stage = 'remove';
      for (const image of retiringImages(plan)) {
        record.path = image.path;
        checkCancelled(signal);
        await verifier.verify(completed, removed, signal, true);
        const data = await this.vault.readBinary(image.path);
        assert(
          data.byteLength === image.size && (await digest(data)) === image.digest,
          'Image changed immediately before recycling.',
        );
        checkCancelled(signal);
        report(message('Recycling image: {path}', { path: image.path }));
        record.images.set(image.path, 'unconfirmed');
        await this.vault.remove(image.path);
        assert(!(await this.vault.exists(image.path)), 'Image still exists after recycling.');
        record.images.set(image.path, 'verified');
        removed.add(image.path);
        report(message('File verified: {path}', { path: image.path }));
      }
      checkCancelled(signal);
      record.path = undefined;
      record.stage = 'final-verify';
      await verifier.verify(completed, removed, signal, true);
      record.finalVerification = 'passed';
      checkCancelled(signal);
      return record.finish('completed', false);
    } catch (error) {
      const cancelled = error instanceof OperationCancelled;
      if (record.stage === 'final-verify' && record.finalVerification !== 'passed')
        record.finalVerification = cancelled ? 'cancelled' : 'failed';
      if (
        error instanceof AtlasError &&
        typeof error.detail !== 'string' &&
        typeof error.detail.values.path === 'string'
      )
        record.path = error.detail.values.path;
      return record.finish(
        cancelled ? 'cancelled' : 'failed',
        !!signal?.aborted,
        errorDetail(error),
      );
    } finally {
      this.running = false;
    }
  }
}
