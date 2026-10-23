import {
  assert,
  digest,
  textBytes,
  type Hasher,
  type Plan,
  type Snapshot,
  type VaultPort,
} from '../domain/model';
import { active, sourcePath } from '../domain/paths';
import { verifyTargets } from '../references';
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
      assert(!signal?.aborted, 'Operation cancelled.');
      // Keep every original until all planned reference writes have been verified.
      // On failure, retain applied writes: they target the retained image, which still exists.
      for (const doc of plan.documents) {
        assert(!signal?.aborted, 'Operation cancelled.');
        progress?.(message('Updating references: {path}', { path: doc.path }));
        await this.vault.process(doc.path, (text) => {
          assert(text === doc.before, message('Document changed: {path}', { path: doc.path }));
          return doc.after;
        });
        assert(
          (await this.vault.readText(doc.path)) === doc.after,
          'Document write verification failed.',
        );
      }
      for (const image of plan.retire) {
        assert(!signal?.aborted, 'Operation cancelled.');
        await this.verify(plan, snapshot);
        progress?.(message('Recycling image: {path}', { path: image.path }));
        assert(
          (await digest(await this.vault.readBinary(image.path))) === image.digest,
          'Image changed immediately before recycling.',
        );
        assert(!signal?.aborted, 'Operation cancelled.');
        await this.vault.remove(image.path);
        assert(!(await this.vault.exists(image.path)), 'Image still exists after recycling.');
      }
      await this.verify(plan, snapshot);
    } finally {
      this.running = false;
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
}
