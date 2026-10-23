import type { ZodType } from 'zod';
import { assert } from '../domain/model';
import { AtlasError } from '../domain/messages';

/** Normalize persisted-data failures before they reach history or presentation. */
export function validateRecovery<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  assert(
    result.success,
    'Recovery data is invalid. Preserve the recovery files for manual review.',
  );
  return result.data;
}
export function parseRecoveryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AtlasError(
      'Recovery JSON is invalid. Preserve the recovery files for manual review.',
    );
  }
}
