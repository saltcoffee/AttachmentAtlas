import {
  assert,
  digest,
  type FileEntry,
  type Plan,
  type Snapshot,
  type Source,
  type VaultFileChange,
  type VaultPort,
} from '../domain/model';
import { active, sourcePath } from '../domain/paths';
import { createReferenceResolver, parseSource } from '../references';
import { replacementTargets, retainedImages, retiringImages } from '../domain/operation-plan';
import { BaseReviewAccount, type BaseReviewBudget } from '../domain/operation-limits';
import { message } from '../domain/messages';
import { checkCancelled } from './cancellation';

const UTF8 = new TextEncoder();

/**
 * Recycles reuse checked sources until a source change; merges verify their rewrites each time.
 * Every deletion boundary rereads each `.base` source and re-checks participating images.
 */
export class ExecutionVerifier {
  private sourcesVerified = false;
  private changedSource = '';
  private changedImage = '';
  private expectedRemoval = '';
  private stopWatching?: () => void;
  private stopWatchingImages?: () => void;
  private readonly sources: Map<string, Source>;
  private readonly changes: Map<string, Plan['documents'][number]>;
  private readonly baselineNames: string[];
  private readonly baselineResolution: ReturnType<typeof createReferenceResolver>;
  private readonly replacements: Map<string, string>;
  private readonly account?: BaseReviewAccount;
  private readonly basePaths: string[];
  private readonly expectedTexts: Map<string, string>;
  constructor(
    private vault: VaultPort,
    private plan: Plan,
    snapshot: Snapshot,
    budget?: BaseReviewBudget,
  ) {
    this.sources = new Map(snapshot.sources.map((source) => [source.path, source]));
    this.expectedTexts = new Map(snapshot.sources.map((source) => [source.path, source.text]));
    this.changes = new Map(plan.documents.map((doc) => [doc.path, doc]));
    this.baselineNames = snapshot.files.map((file) => file.path);
    this.baselineResolution = createReferenceResolver(this.baselineNames);
    this.replacements = replacementTargets(plan);
    this.account = budget ? new BaseReviewAccount(budget) : undefined;
    this.basePaths = snapshot.sources.filter((source) => source.kind === 'base').map((source) => source.path);
    // The adapter attributes its own exact write notifications. Every other source change,
    // including a later edit to a document already rewritten by this plan, invalidates the proof.
    this.stopWatching = vault.watchSourceChanges((path) => {
      this.changedSource ||= path;
    });
    const participating = [...retiringImages(plan), ...retainedImages(plan)].map(
      (image) => image.path,
    );
    if (participating.length)
      this.stopWatchingImages = vault.watchFileChanges(participating, (change) =>
        this.onParticipantChange(change),
      );
  }

  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.stopWatchingImages?.();
    this.stopWatchingImages = undefined;
  }

  private onParticipantChange(change: VaultFileChange): void {
    // The plugin's own single-path host removal is expected; anything else invalidates the proof.
    if (change.kind === 'delete' && change.path === this.expectedRemoval) return;
    this.changedImage ||= change.path;
  }

  private assertSourcesUnchanged(): void {
    assert(
      !this.changedSource,
      message('Document changed during execution: {path}', { path: this.changedSource }),
    );
  }

  /** Synchronous assertion used immediately before a host deletion is started. */
  assertParticipantProof(): void {
    assert(
      !this.changedImage,
      message('Participating image changed: {path}', { path: this.changedImage }),
    );
    this.assertSourcesUnchanged();
    this.vault.assertSourceContents(this.expectedTexts);
    this.vault.assertBaseContextsClosed(this.basePaths);
  }

  confirmRewrite(path: string): void {
    this.expectedTexts.set(path, this.changes.get(path)!.after);
  }

  /** Register the single expected host removal after all synchronous checks passed. */
  beforeHostRemove(path: string): void {
    this.assertParticipantProof();
    this.expectedRemoval = path;
  }

  clearExpectedRemoval(): void {
    this.expectedRemoval = '';
  }

  /** Check the inventory and source-change notifications without yielding before a deletion. */
  assertUnchanged(removed: ReadonlySet<string>): FileEntry[] {
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

  private async verifyBaseSources(files: FileEntry[], signal?: AbortSignal): Promise<void> {
    const resolve = createReferenceResolver(files.map((file) => file.path));
    for (const file of files) {
      if (!sourcePath(file.path)) continue;
      const source = this.sources.get(file.path);
      if (!source || source.kind !== 'base') continue;
      checkCancelled(signal);
      this.account?.reserve(UTF8.encode(source.text).byteLength);
      const text = await this.vault.readText(file.path);
      assert(
        text === source.text,
        message('Document changed during execution: {path}', { path: file.path }),
      );
      const parsed = parseSource(file.path, text);
      assert(
        parsed.issues.length === 0,
        message('Reference coverage changed in {path}.', { path: file.path }),
      );
      assert(
        parsed.references.length === source.references.length,
        message('Reference coverage changed in {path}.', { path: file.path }),
      );
      for (const [index, ref] of parsed.references.entries()) {
        const before = this.baselineResolution(source.references[index]!);
        const current = resolve(ref);
        assert(
          !current.ambiguous && current.external === before.external && current.target === before.target,
          message('Reference target changed unexpectedly: {path}', { path: file.path }),
        );
      }
    }
  }

  async verify(
    completed: ReadonlySet<string>,
    removed: ReadonlySet<string>,
    signal?: AbortSignal,
    finalReferences = false,
  ): Promise<void> {
    checkCancelled(signal);
    this.assertSourcesUnchanged();
    this.vault.assertBaseContextsClosed(this.basePaths);
    const files = this.assertUnchanged(removed);
    const sources = files.filter((file) => sourcePath(file.path));
    assert(
      sources.length === this.sources.size && sources.every((file) => this.sources.has(file.path)),
      'Reference source inventory changed.',
    );
    await this.verifyBaseSources(files, signal);
    if (this.plan.kind === 'recycle-unreferenced' && this.sourcesVerified) {
      this.assertParticipantProof();
      return;
    }
    const resolve = createReferenceResolver(files.map((file) => file.path));
    for (const file of sources) {
      checkCancelled(signal);
      const source = this.sources.get(file.path)!;
      if (source.kind === 'base') continue;
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
    this.assertParticipantProof();
    this.sourcesVerified = true;
  }
}
