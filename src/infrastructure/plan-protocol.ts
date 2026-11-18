import { z } from 'zod';
import type { Message, Text } from '../domain/messages';
import type { Plan, Snapshot } from '../domain/model';
import type { SelectionRequest } from '../application/plan';

const messageSchema: z.ZodType<Message> = z.lazy(() =>
  z.object({
    template: z.string(),
    values: z.record(z.string(), z.union([z.string(), z.number(), messageSchema])),
  }),
);
export const textSchema: z.ZodType<Text> = z.union([z.string(), messageSchema]);
const offset = z.number().int().nonnegative();
const sourceKind = z.enum(['markdown', 'canvas', 'excalidraw', 'base']);
const referenceDetails = {
  source: z.string(),
  raw: z.string(),
  linkpath: z.string(),
  target: z.string(),
  style: z.enum(['wiki', 'markdown', 'json', 'base-literal']),
  sourceKind,
};
const reference = z.union([
  z
    .object({
      ...referenceDetails,
      style: z.enum(['wiki', 'markdown', 'json']),
      readOnly: z.literal(false),
      start: offset,
      end: offset,
      outer: z.object({ start: offset, end: offset, text: z.string() }).optional(),
    })
    .strict(),
  z
    .object({
      ...referenceDetails,
      style: z.literal('base-literal'),
      readOnly: z.literal(true),
      start: offset,
      end: offset,
      fieldPath: z.string(),
    })
    .strict(),
  z
    .object({
      ...referenceDetails,
      style: z.enum(['wiki', 'markdown', 'json']),
      readOnly: z.literal(true),
    })
    .strict(),
]);
const file = z.object({ path: z.string(), size: offset, mtime: z.number() });
const media = file.extend({
  width: offset.optional(),
  height: offset.optional(),
  digest: z.string(),
  format: z.string(),
  reasons: z.array(textSchema),
  references: z.array(reference),
});
const coverageIssue = z
  .object({
    code: z.enum([
      'unsupported-base-structure',
      'dynamic-base-expression',
      'invalid-base-yaml',
      'unsupported-inline-base',
      'source-read-failed',
      'source-budget-exceeded',
      'unsaved-source',
      'source-state-unverifiable',
      'base-state-capability-unsupported',
      'unresolved-base-target',
      'ambiguous-target',
      'host-resolution-mismatch',
      'source-analysis-failed',
    ]),
    source: z.string().optional(),
    sourceKind: sourceKind.optional(),
    location: z
      .object({ start: offset, end: offset, fieldPath: z.string().optional() })
      .optional(),
    detail: textSchema.optional(),
  })
  .strict();
const snapshotSchema: z.ZodType<Snapshot> = z.object({
  revision: offset,
  settings: z.object({
    scope: z.string(),
    protectedPaths: z.array(z.string()),
    preferredFolder: z.string(),
  }),
  files: z.array(file),
  media: z.array(media),
  sources: z.array(
    z.object({
      path: z.string(),
      text: z.string(),
      digest: z.string(),
      kind: sourceKind,
      references: z.array(reference),
      hints: z.array(z.string()),
    }),
  ),
  coverageIssues: z.array(coverageIssue),
  duplicates: z.array(z.array(media).min(2)),
});
const selectionSchema: z.ZodType<SelectionRequest> = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('merge-exact'),
      groups: z.array(
        z
          .object({ groupKey: z.string(), keepPath: z.string(), retirePaths: z.array(z.string()) })
          .strict(),
      ),
    })
    .strict(),
  z.object({ kind: z.literal('recycle-unreferenced'), retirePaths: z.array(z.string()) }).strict(),
]);
export const planBuildInput = z.object({
  version: z.literal(3),
  id: offset.positive(),
  snapshot: snapshotSchema,
  selection: selectionSchema,
});
const imageProof = z.object({ path: z.string(), digest: z.string(), size: offset }).strict();
const planBase = {
  revision: offset,
  baseline: z.array(z.object({ path: z.string(), digest: z.string() })),
  documents: z.array(
    z.object({
      path: z.string(),
      before: z.string(),
      after: z.string(),
      patches: z.array(z.object({ start: offset, end: offset, value: z.string() })),
      edits: z.array(
        z.object({
          beforeTarget: z.string(),
          afterTarget: z.string(),
          location: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('source'), start: offset, end: offset }),
            z.object({
              kind: z.literal('canvas-text'),
              outerStart: offset,
              outerEnd: offset,
              start: offset,
              end: offset,
            }),
          ]),
        }),
      ),
    }),
  ),
};
export const planSchema: z.ZodType<Plan> = z.discriminatedUnion('kind', [
  z
    .object({
      ...planBase,
      kind: z.literal('merge-exact'),
      groups: z.array(
        z
          .object({
            groupKey: z.string(),
            keep: imageProof,
            retire: z.array(imageProof),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({ ...planBase, kind: z.literal('recycle-unreferenced'), retire: z.array(imageProof) })
    .strict(),
]);
export const planBuildOutput = z.discriminatedUnion('ok', [
  z.object({ version: z.literal(3), id: offset.positive(), ok: z.literal(true), plan: planSchema }),
  z.object({
    version: z.literal(3),
    id: offset.positive(),
    ok: z.literal(false),
    error: textSchema,
  }),
]);
