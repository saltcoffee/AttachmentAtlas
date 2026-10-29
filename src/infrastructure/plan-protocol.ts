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
const referenceDetails = {
  source: z.string(),
  raw: z.string(),
  linkpath: z.string(),
  target: z.string(),
  style: z.enum(['wiki', 'markdown', 'json']),
};
const reference = z.discriminatedUnion('readOnly', [
  z.object({ ...referenceDetails, readOnly: z.literal(true) }),
  z.object({
    ...referenceDetails,
    readOnly: z.literal(false),
    start: offset,
    end: offset,
    outer: z.object({ start: offset, end: offset, text: z.string() }).optional(),
  }),
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
      references: z.array(reference),
      hints: z.array(z.string()),
    }),
  ),
  blockers: z.array(textSchema),
  duplicates: z.array(z.array(media).min(2)),
});
const selectionSchema: z.ZodType<SelectionRequest> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('merge-exact'),
    groupKey: z.string(),
    keepPath: z.string(),
    retirePaths: z.array(z.string()),
  }),
  z.object({ kind: z.literal('recycle-unreferenced'), retirePaths: z.array(z.string()) }),
]);
export const planBuildInput = z.object({
  version: z.literal(1),
  id: offset.positive(),
  snapshot: snapshotSchema,
  selection: selectionSchema,
});
export const planSchema: z.ZodType<Plan> = z.object({
  revision: offset,
  kind: z.enum(['merge-exact', 'recycle-unreferenced']),
  retire: z.array(z.object({ path: z.string(), digest: z.string(), size: offset })),
  keep: z.array(z.object({ path: z.string(), digest: z.string() })),
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
});
export const planBuildOutput = z.discriminatedUnion('ok', [
  z.object({ version: z.literal(1), id: offset.positive(), ok: z.literal(true), plan: planSchema }),
  z.object({
    version: z.literal(1),
    id: offset.positive(),
    ok: z.literal(false),
    error: textSchema,
  }),
]);
