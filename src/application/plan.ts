import { assert, type Plan, type Snapshot } from '../domain/model';
import {
  checkedByteTotal,
  MAX_MERGE_RETIRE_BYTES,
  MAX_RETIRE_COUNT,
} from '../domain/operation-limits';
import { rewrite, verifyTargets } from '../references';
import { unreferencedReasons } from './scan';
import { asMessage, message } from '../domain/messages';
export type SelectionRequest =
  | {
      readonly kind: 'merge-exact';
      readonly groupKey: string;
      readonly keepPath: string;
      readonly retirePaths: readonly string[];
    }
  | { readonly kind: 'recycle-unreferenced'; readonly retirePaths: readonly string[] };
export interface PlanRequest {
  readonly scanId: number;
  readonly selectionRevision: number;
  readonly selection: SelectionRequest;
}

export function buildPlan(snapshot: Snapshot, request: SelectionRequest): Plan {
  assert(!snapshot.blockers.length, 'Reference coverage is incomplete.');
  const { retirePaths } = request;
  assert(
    retirePaths.length > 0 &&
      retirePaths.length <= MAX_RETIRE_COUNT &&
      new Set(retirePaths).size === retirePaths.length,
    'Select 1–100 distinct images.',
  );
  const keepPath = request.kind === 'merge-exact' ? request.keepPath : undefined;
  assert(!keepPath || !retirePaths.includes(keepPath), 'The retained image cannot be recycled.');
  const keep = keepPath ? snapshot.media.find((image) => image.path === keepPath) : undefined;
  if (keepPath) assert(keep?.digest, 'The retained image was not fully checked.');
  const group =
    request.kind === 'merge-exact'
      ? snapshot.duplicates.find(
          (items) => `${items[0]!.size}:${items[0]!.digest}` === request.groupKey,
        )
      : undefined;
  if (request.kind === 'merge-exact') {
    assert(group && group.some((item) => item.path === keepPath), 'Duplicate group changed.');
    assert(
      retirePaths.every((path) => group.some((item) => item.path === path)),
      'All duplicate copies must belong to one group.',
    );
  }
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
  if (keep) {
    const total = checkedByteTotal(retire.map((image) => image.size));
    assert(total <= MAX_MERGE_RETIRE_BYTES, 'Selected duplicate copies exceed 192 MiB.');
  }
  const replacements = new Map(retire.map((image) => [image.path, keep?.path ?? '']));
  const updated = snapshot.sources.map((source) => {
    const rewritten = keep ? rewrite(source, replacements) : null;
    return { path: source.path, rewrite: rewritten, text: rewritten?.text ?? source.text };
  });
  const beforeNames = snapshot.files.map((file) => file.path),
    afterNames = beforeNames.filter((path) => !retirePaths.includes(path));
  verifyTargets(snapshot.sources, updated, beforeNames, afterNames, replacements);
  return {
    revision: snapshot.revision,
    kind: request.kind,
    retire,
    keep: keep ? [{ path: keep.path, digest: keep.digest }] : [],
    documents: snapshot.sources.flatMap((source) => {
      const item = updated.find((entry) => entry.path === source.path)!;
      if (item.text === source.text) return [];
      assert(item.rewrite, 'Reference rewrite metadata is missing.');
      assert(
        item.rewrite.text === item.text,
        'Reference rewrite metadata does not match the plan.',
      );
      return [
        {
          path: source.path,
          before: source.text,
          after: item.text,
          patches: item.rewrite.patches,
          edits: item.rewrite.edits,
        },
      ];
    }),
    baseline: snapshot.sources.map((source) => ({ path: source.path, digest: source.digest })),
  };
}
