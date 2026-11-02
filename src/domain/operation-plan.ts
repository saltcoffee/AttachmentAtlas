import type { ImageProof, MergeGroupPlan, Plan } from './model';

export function retiringImages(plan: Plan): readonly ImageProof[] {
  return plan.kind === 'merge-exact' ? plan.groups.flatMap((group) => group.retire) : plan.retire;
}

export function retainedImages(plan: Plan): readonly ImageProof[] {
  return plan.kind === 'merge-exact' ? plan.groups.map((group) => group.keep) : [];
}

export function replacementTargets(plan: Plan): Map<string, string> {
  return new Map(
    plan.kind === 'merge-exact'
      ? plan.groups.flatMap((group) =>
          group.retire.map((image) => [image.path, group.keep.path] as const),
        )
      : [],
  );
}

export function groupChanges(plan: Plan, group: MergeGroupPlan) {
  const paths = new Set(group.retire.map((image) => image.path));
  return plan.documents.flatMap((document) => {
    const edits = document.edits.filter((edit) => paths.has(edit.beforeTarget));
    return edits.length ? [{ path: document.path, edits: edits.length }] : [];
  });
}
