import { assert, type Plan, type Snapshot } from '../domain/model';
import { rewrite, verifyTargets } from '../references';
import { unreferencedReasons } from './scan';
import { asMessage, message } from '../domain/messages';
export function buildPlan(snapshot: Snapshot, retirePaths: string[], keepPath?: string): Plan {
  assert(!snapshot.blockers.length, 'Reference coverage is incomplete.');
  assert(
    retirePaths.length &&
      retirePaths.length <= 100 &&
      new Set(retirePaths).size === retirePaths.length,
    'Select 1–100 distinct images.',
  );
  assert(!keepPath || !retirePaths.includes(keepPath), 'The retained image cannot be recycled.');
  const keep = keepPath ? snapshot.media.find((image) => image.path === keepPath) : undefined;
  if (keepPath) assert(keep?.digest, 'The retained image was not fully checked.');
  const retire = retirePaths.map((path) => {
    const image = snapshot.media.find((item) => item.path === path);
    assert(image?.digest, 'Image was not fully checked.');
    const reason = image.reasons[0] ?? '';
    assert(
      !image.reasons.length,
      message('Image cannot be recycled: {path}. {reason}', {
        path,
        reason: asMessage(reason),
      }),
    );
    if (keep)
      assert(
        image.size === keep.size && image.digest === keep.digest,
        'Only byte-identical images can be merged.',
      );
    else
      assert(
        !unreferencedReasons(image, snapshot).length,
        'Image is referenced, protected, or has incomplete coverage.',
      );
    return { path, digest: image.digest, size: image.size };
  });
  const replacements = new Map(retire.map((image) => [image.path, keep?.path ?? '']));
  const updated = snapshot.sources.map((source) => ({
    path: source.path,
    text: keep ? rewrite(source, replacements) : source.text,
  }));
  const beforeNames = snapshot.files.map((file) => file.path),
    afterNames = beforeNames.filter((path) => !retirePaths.includes(path));
  verifyTargets(snapshot.sources, updated, beforeNames, afterNames, replacements);
  return {
    revision: snapshot.revision,
    kind: keep ? 'merge-exact' : 'recycle-unreferenced',
    retire,
    keep: keep ? [{ path: keep.path, digest: keep.digest }] : [],
    documents: snapshot.sources.flatMap((source) => {
      const after = updated.find((item) => item.path === source.path)!.text;
      return after === source.text ? [] : [{ path: source.path, before: source.text, after }];
    }),
    baseline: snapshot.sources.map((source) => ({ path: source.path, digest: source.digest })),
  };
}
