import {
  assert,
  digest,
  type Hasher,
  type Plan,
  type Snapshot,
  type Source,
  type VaultPort,
} from '../domain/model';
import { active, sourcePath } from '../domain/paths';
import { parseSource, resolveReference } from '../references';
import { scan, unreferencedReasons } from './scan';
import { message, type Text } from '../domain/messages';

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
  ): Promise<void> {
    assert(!this.running, 'Another operation is running.');
    this.running = true;
    try {
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
      this.checkCancelled(signal);

      const completedDocuments = new Set<string>(),
        removedImages = new Set<string>();
      for (const doc of plan.documents) {
        this.checkCancelled(signal);
        await this.verifyBoundary(plan, snapshot, completedDocuments, removedImages);
        this.checkCancelled(signal);
        progress?.(message('Updating references: {path}', { path: doc.path }));
        await this.vault.process(doc.path, (text) => {
          assert(text === doc.before, message('Document changed: {path}', { path: doc.path }));
          return doc.after;
        });
        assert(
          (await this.vault.readText(doc.path)) === doc.after,
          'Document write verification failed.',
        );
        completedDocuments.add(doc.path);
      }

      for (const image of plan.retire) {
        this.checkCancelled(signal);
        await this.verifyBoundary(plan, snapshot, completedDocuments, removedImages);
        this.checkCancelled(signal);
        progress?.(message('Recycling image: {path}', { path: image.path }));
        assert(
          (await digest(await this.vault.readBinary(image.path))) === image.digest,
          'Image changed immediately before recycling.',
        );
        this.checkCancelled(signal);
        await this.vault.remove(image.path);
        assert(!(await this.vault.exists(image.path)), 'Image still exists after recycling.');
        removedImages.add(image.path);
      }
      await this.verifyBoundary(plan, snapshot, completedDocuments, removedImages);
    } finally {
      this.running = false;
    }
  }

  private checkCancelled(signal?: AbortSignal): void {
    assert(!signal?.aborted, 'Operation cancelled.');
  }

  private async verifyBoundary(
    plan: Plan,
    snapshot: Snapshot,
    completedDocuments: ReadonlySet<string>,
    removedImages: ReadonlySet<string>,
  ): Promise<void> {
    const files = this.vault.list().filter((file) => active(file.path)),
      currentPaths = files.map((file) => file.path).sort(),
      expectedPaths = snapshot.files
        .map((file) => file.path)
        .filter((path) => !removedImages.has(path))
        .sort();
    assert(same(currentPaths, expectedPaths), 'Active vault files changed during cleanup.');

    const names = currentPaths,
      baselineNames = snapshot.files.map((file) => file.path),
      currentSources = files.filter((file) => sourcePath(file.path));
    assert(
      currentSources.length === plan.baseline.length &&
        currentSources.every((file) => plan.baseline.some((base) => base.path === file.path)),
      'Reference source inventory changed.',
    );
    const replacements = new Map(plan.retire.map((item) => [item.path, plan.keep[0]?.path ?? '']));
    for (const file of currentSources) {
      const source = snapshot.sources.find((item) => item.path === file.path);
      assert(source, message('Reference source changed: {path}', { path: file.path }));
      const change = plan.documents.find((item) => item.path === file.path),
        expected = change
          ? completedDocuments.has(file.path)
            ? change.after
            : change.before
          : source.text,
        text = await this.vault.readText(file.path);
      assert(
        text === expected,
        message('Document changed during execution: {path}', { path: file.path }),
      );
      const parsed = this.parseExpectedSource(file.path, text),
        baselineRefs = source.references;
      assert(
        parsed.references.length === baselineRefs.length,
        message('Reference coverage changed in {path}.', { path: file.path }),
      );
      for (const [index, reference] of parsed.references.entries()) {
        const expectedReference = baselineRefs[index]!,
          baselineResolution = resolveReference(expectedReference, baselineNames),
          resolution = resolveReference(reference, names),
          target = completedDocuments.has(file.path)
            ? (replacements.get(baselineResolution.target) ?? baselineResolution.target)
            : baselineResolution.target;
        assert(
          !resolution.ambiguous &&
            resolution.external === baselineResolution.external &&
            resolution.target === target,
          message('Reference target changed unexpectedly: {path}', { path: file.path }),
        );
      }
    }
    for (const keep of plan.keep)
      assert(
        (await digest(await this.vault.readBinary(keep.path))) === keep.digest,
        'Retained image changed.',
      );
    for (const path of removedImages)
      assert(
        !names.includes(path),
        message('Image still exists after recycling: {path}', { path }),
      );
  }

  private parseExpectedSource(path: string, text: string): Source {
    const parsed = parseSource(path, text);
    return { path, text, digest: '', ...parsed };
  }
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
