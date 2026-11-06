import {
  assert,
  type ImageProof,
  type Media,
  type MergeGroupPlan,
  type Plan,
  type Snapshot,
} from '../domain/model';
import {
  checkedByteTotal,
  MAX_MERGE_RETIRE_BYTES,
  MAX_RETIRE_COUNT,
} from '../domain/operation-limits';
import { retiringImages, replacementTargets } from '../domain/operation-plan';
import { rewrite, verifyTargets } from '../references';
import { vaultPath } from '../domain/paths';
import { unreferencedReasons } from './scan';
import { asMessage, message } from '../domain/messages';

export interface MergeGroupSelection {
  readonly groupKey: string;
  readonly keepPath: string;
  readonly retirePaths: readonly string[];
}
export type SelectionRequest =
  | { readonly kind: 'merge-exact'; readonly groups: readonly MergeGroupSelection[] }
  | { readonly kind: 'recycle-unreferenced'; readonly retirePaths: readonly string[] };
export interface PlanRequest {
  readonly scanId: number;
  readonly selectionRevision: number;
  readonly selection: SelectionRequest;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function proof(image: Media): ImageProof {
  assert(image.digest, 'Image was not fully checked.');
  assert(vaultPath(image.path) === image.path, 'Non-canonical vault path.');
  checkedByteTotal([image.size]);
  return { path: image.path, digest: image.digest, size: image.size };
}

export function buildPlan(snapshot: Snapshot, request: SelectionRequest): Plan {
  assert(!snapshot.blockers.length, 'Reference coverage is incomplete.');
  const media = new Map(snapshot.media.map((image) => [image.path, image]));
  const find = (path: string) => {
    assert(vaultPath(path) === path, 'Non-canonical vault path.');
    const image = media.get(path);
    assert(image?.digest, 'Image was not fully checked.');
    return image;
  };
  const eligible = (image: Media) => {
    assert(
      !image.reasons.length,
      message('Image cannot be recycled: {path}. {reason}', {
        path: image.path,
        reason: asMessage(image.reasons[0] ?? ''),
      }),
    );
    return proof(image);
  };
  const base = {
    revision: snapshot.revision,
    documents: [],
    baseline: snapshot.sources.map((source) => ({ path: source.path, digest: source.digest })),
  };
  let plan: Plan;
  if (request.kind === 'merge-exact') {
    assert(request.groups.length > 0, 'Select duplicate copies to preview the merge.');
    const keys = new Set<string>(),
      keeps = new Set<string>(),
      copies = new Set<string>();
    const duplicateGroups = new Map(
      snapshot.duplicates.map((group) => [`${group[0]!.size}:${group[0]!.digest}`, group]),
    );
    const groups: MergeGroupPlan[] = request.groups
      .map((selection) => {
        assert(!keys.has(selection.groupKey), 'Duplicate group appears more than once.');
        keys.add(selection.groupKey);
        const members = duplicateGroups.get(selection.groupKey);
        assert(members, 'Duplicate group changed.');
        const paths = new Set(members.map((image) => image.path));
        assert(paths.has(selection.keepPath), 'Duplicate group changed.');
        assert(selection.retirePaths.length > 0, 'Select 1–100 distinct images.');
        const keep = proof(find(selection.keepPath));
        assert(!keeps.has(keep.path), 'Retained image appears in more than one group.');
        keeps.add(keep.path);
        const retire = selection.retirePaths
          .map((path) => {
            assert(!copies.has(path), 'Select 1–100 distinct images.');
            copies.add(path);
            assert(path !== keep.path, 'The retained image cannot be recycled.');
            assert(paths.has(path), 'All duplicate copies must belong to one group.');
            const image = find(path);
            assert(
              image.size === keep.size && image.digest === keep.digest,
              'Only byte-identical images can be merged.',
            );
            return eligible(image);
          })
          .sort((a, b) => compare(a.path, b.path));
        return { groupKey: selection.groupKey, keep, retire };
      })
      .sort((a, b) => compare(a.keep.path, b.keep.path));
    assert(
      [...keeps].every((path) => !copies.has(path)),
      'The retained image cannot be recycled.',
    );
    plan = { ...base, kind: 'merge-exact', groups };
  } else {
    assert(request.kind === 'recycle-unreferenced', 'Unknown operation type.');
    const retire = request.retirePaths
      .map((path) => {
        const image = find(path);
        assert(
          !unreferencedReasons(image, snapshot).length,
          'Image is referenced, protected, or has incomplete coverage.',
        );
        return eligible(image);
      })
      .sort((a, b) => compare(a.path, b.path));
    plan = { ...base, kind: 'recycle-unreferenced', retire };
  }
  const retire = retiringImages(plan),
    paths = new Set(retire.map((image) => image.path));
  assert(
    retire.length > 0 && retire.length <= MAX_RETIRE_COUNT && paths.size === retire.length,
    'Select 1–100 distinct images.',
  );
  if (plan.kind === 'merge-exact')
    assert(
      checkedByteTotal(retire.map((image) => image.size)) <= MAX_MERGE_RETIRE_BYTES,
      'Selected duplicate copies exceed 192 MiB.',
    );
  // Unreferenced images have no targets to rewrite or resolve again.
  if (plan.kind === 'recycle-unreferenced') return plan;
  const replacements = replacementTargets(plan);
  const updated = snapshot.sources.map((source) => ({
    source,
    rewrite: rewrite(source, replacements),
  }));
  const documents = updated
    .flatMap(({ source, rewrite: change }) =>
      change.text !== source.text
        ? [
            {
              path: source.path,
              before: source.text,
              after: change.text,
              patches: change.patches,
              edits: change.edits,
            },
          ]
        : [],
    )
    .sort((a, b) => compare(a.path, b.path));
  verifyTargets(
    snapshot.sources,
    updated.map(({ source, rewrite: change }) => ({
      path: source.path,
      text: change.text,
    })),
    snapshot.files.map((file) => file.path),
    snapshot.files.filter((file) => !paths.has(file.path)).map((file) => file.path),
    replacements,
  );
  return { ...plan, documents };
}

/** Rebuild from snapshot authority; consistent patches alone do not authorize extra body edits. */
export function validatePlan(snapshot: Snapshot, plan: Plan): void {
  const request: SelectionRequest =
    plan.kind === 'merge-exact'
      ? {
          kind: 'merge-exact',
          groups: plan.groups.map((group) => ({
            groupKey: group.groupKey,
            keepPath: group.keep.path,
            retirePaths: group.retire.map((image) => image.path),
          })),
        }
      : { kind: 'recycle-unreferenced', retirePaths: plan.retire.map((image) => image.path) };
  const expected = buildPlan(snapshot, request);
  const same = (left: unknown, right: unknown): boolean => {
    if (left === right) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left),
      other = Object.keys(right);
    return (
      keys.length === other.length &&
      keys.every(
        (key) =>
          Object.hasOwn(right, key) &&
          same((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
      )
    );
  };
  assert(same(expected, plan), 'Plan does not match the checked selection.');
}
