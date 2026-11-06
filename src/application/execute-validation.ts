import { assert, digest, type Plan, type Snapshot, type VaultPort } from '../domain/model';
import { active, sourcePath } from '../domain/paths';
import { createReferenceResolver, parseSource } from '../references';
import { replacementTargets, retainedImages } from '../domain/operation-plan';
import { message } from '../domain/messages';
import { checkCancelled } from './cancellation';

/** Recycling reuses checked sources until a source change; merges verify their rewrites each time. */
export class ExecutionVerifier {
  private sourcesVerified = false;
  private changedSource = '';
  private stopWatching?: () => void;
  private readonly sources;
  private readonly changes;
  private readonly baselineNames;
  private readonly baselineResolution;
  private readonly replacements;
  constructor(
    private vault: VaultPort,
    private plan: Plan,
    snapshot: Snapshot,
  ) {
    this.sources = new Map(snapshot.sources.map((source) => [source.path, source]));
    this.changes = new Map(plan.documents.map((doc) => [doc.path, doc]));
    this.baselineNames = snapshot.files.map((file) => file.path);
    this.baselineResolution = createReferenceResolver(this.baselineNames);
    this.replacements = replacementTargets(plan);
    if (plan.kind === 'recycle-unreferenced')
      this.stopWatching = vault.watchSourceChanges((path) => {
        this.changedSource ||= path;
      });
  }

  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
  }

  private assertSourcesUnchanged(): void {
    assert(
      !this.changedSource,
      message('Document changed during execution: {path}', { path: this.changedSource }),
    );
  }

  /** Check the inventory and source-change notifications without yielding before a deletion. */
  assertUnchanged(removed: ReadonlySet<string>) {
    const files = this.vault.list().filter((file) => active(file.path));
    const names = files.map((file) => file.path).sort();
    const expected = this.baselineNames.filter((path) => !removed.has(path)).sort();
    assert(
      names.length === expected.length && names.every((path, i) => path === expected[i]),
      'Active vault files changed during cleanup.',
    );
    if (this.plan.kind === 'recycle-unreferenced') this.assertSourcesUnchanged();
    return files;
  }

  async verify(
    completed: ReadonlySet<string>,
    removed: ReadonlySet<string>,
    signal?: AbortSignal,
    finalReferences = false,
  ): Promise<void> {
    checkCancelled(signal);
    const files = this.assertUnchanged(removed);
    if (this.plan.kind === 'recycle-unreferenced' && this.sourcesVerified) return;
    const sources = files.filter((file) => sourcePath(file.path));
    assert(
      sources.length === this.sources.size && sources.every((file) => this.sources.has(file.path)),
      'Reference source inventory changed.',
    );
    const resolve = createReferenceResolver(files.map((file) => file.path));
    for (const file of sources) {
      checkCancelled(signal);
      const source = this.sources.get(file.path)!;
      const change = this.changes.get(file.path);
      const expectedText = change
        ? completed.has(file.path)
          ? change.after
          : change.before
        : source.text;
      const text = await this.vault.readText(file.path);
      assert(
        text === expectedText,
        message('Document changed during execution: {path}', { path: file.path }),
      );
      // Recycling changes no documents; matching source text preserves the scan's reference proof.
      if (this.plan.kind === 'recycle-unreferenced') {
        this.assertSourcesUnchanged();
        continue;
      }
      const parsed = parseSource(file.path, text);
      assert(
        parsed.references.length === source.references.length,
        message('Reference coverage changed in {path}.', { path: file.path }),
      );
      for (const [index, ref] of parsed.references.entries()) {
        const before = this.baselineResolution(source.references[index]!);
        const current = resolve(ref);
        const target = completed.has(file.path)
          ? (this.replacements.get(before.target) ?? before.target)
          : before.target;
        assert(
          !current.ambiguous && current.external === before.external && current.target === target,
          message('Reference target changed unexpectedly: {path}', { path: file.path }),
        );
        if (finalReferences)
          assert(
            !this.replacements.has(current.target),
            message('Reference target changed unexpectedly: {path}', { path: file.path }),
          );
      }
    }
    for (const image of retainedImages(this.plan)) {
      checkCancelled(signal);
      assert(
        (await digest(await this.vault.readBinary(image.path))) === image.digest,
        message('Retained image changed: {path}', { path: image.path }),
      );
    }
    checkCancelled(signal);
    this.sourcesVerified = true;
  }
}
