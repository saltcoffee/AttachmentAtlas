import { z } from 'zod';
import { assert, digest, textBytes } from '../domain/model';
import { parseRecoveryJson, validateRecovery } from './recovery-validation';
import {
  FINISHED_RECOVERY_STATES,
  recoveryDirectory,
  type RecoveryCleanupRecord,
} from '../domain/recovery';

const fileSchema = z
  .object({
    path: z.string().max(4096),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(64 * 1024 * 1024),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const schema = z
  .object({
    id: z.uuid(),
    createdAt: z.number().finite(),
    kind: z.enum(['merge-exact', 'recycle-unreferenced']),
    state: z.enum(FINISHED_RECOVERY_STATES),
    files: z.array(fileSchema).min(1).max(10_000),
  })
  .strict();
const envelope = z
  .object({
    version: z.literal(1),
    payload: z.string().max(4 * 1024 * 1024),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export function markerId(path: string): string | null {
  const match = /^\.cleanup-(.+)\.json$/.exec(path.slice(path.lastIndexOf('/') + 1));
  return match && z.uuid().safeParse(match[1]).success ? match[1]! : null;
}
export function validateCleanupRecord(value: unknown): RecoveryCleanupRecord {
  const parsed = validateRecovery(schema, value),
    root = `${recoveryDirectory(parsed.id)}/`;
  const names = new Set<string>();
  for (const file of parsed.files) {
    assert(file.path.startsWith(root), 'Cleanup path escapes its operation directory.');
    const name = file.path.slice(root.length);
    assert(
      /^(?:plan\.json|\d{6}\.json|[a-f0-9]{64}\.bin)$/.test(name),
      'Unknown recovery file cannot be cleaned.',
    );
    assert(!names.has(name), 'Duplicate cleanup paths.');
    names.add(name);
  }
  assert(names.has('plan.json'), 'Cleanup record is missing its original plan.');
  return {
    id: parsed.id,
    createdAt: parsed.createdAt,
    kind: parsed.kind,
    state: parsed.state,
    files: parsed.files.map((file) => ({ path: file.path, size: file.size, digest: file.digest })),
  };
}
export async function serializeCleanupRecord(record: RecoveryCleanupRecord): Promise<string> {
  const payload = JSON.stringify(validateCleanupRecord(record));
  return JSON.stringify({ version: 1, payload, digest: await digest(textBytes(payload)) });
}
export async function parseCleanupRecord(text: string, id: string): Promise<RecoveryCleanupRecord> {
  assert(text.length <= 4 * 1024 * 1024, 'Cleanup marker is too large.');
  const value = validateRecovery(envelope, parseRecoveryJson(text));
  assert(
    (await digest(textBytes(value.payload))) === value.digest,
    'Cleanup marker checksum failed.',
  );
  const record = validateCleanupRecord(parseRecoveryJson(value.payload));
  assert(record.id === id, 'Cleanup marker identity mismatch.');
  return record;
}
