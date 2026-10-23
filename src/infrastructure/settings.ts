import { z } from 'zod';
import { assert, DEFAULT_SETTINGS, type Settings } from '../domain/model';
import { active, vaultPath } from '../domain/paths';
const folder = z
  .string()
  .max(4096)
  .refine((value) => {
    try {
      return value === '' || (active(value) && vaultPath(value) === value);
    } catch {
      return false;
    }
  });
const schema = z.object({
  scope: folder,
  protectedPaths: z
    .array(folder)
    .max(100)
    .refine((paths) => !paths.includes('')),
  preferredFolder: folder,
});
export function settingsFrom(value: unknown): Settings {
  const result = schema.safeParse(value);
  assert(
    result.success,
    'Invalid settings. Use vault-relative paths and at most 100 protected paths.',
  );
  return result.data;
}
export function loadState(value: unknown): {
  settings: Settings;
  reset: boolean;
} {
  const data = z.object({ version: z.literal(1), settings: schema }).safeParse(value);
  if (data.success) return { settings: data.data.settings, reset: false };
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    reset: value !== null && value !== undefined,
  };
}
