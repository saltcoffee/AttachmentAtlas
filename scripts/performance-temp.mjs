import { mkdtemp, readdir, lstat, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Only used with a root created by this module. Remove explicit paths one at a time,
// never follow symlinks and never use recursive rm on a caller-supplied directory.
async function removeCreatedPath(path) {
  const entry = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!entry) return;
  if (entry.isDirectory() && !entry.isSymbolicLink()) {
    for (const name of await readdir(path)) await removeCreatedPath(join(path, name));
    await rmdir(path);
  } else await unlink(path);
}

export async function createPerformanceDirectory(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  return { root, dispose: () => removeCreatedPath(root) };
}
