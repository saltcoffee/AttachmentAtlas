import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['scripts/check-release.mjs'], { stdio: 'inherit' });
const { version } = JSON.parse(await readFile('manifest.json', 'utf8'));
const target = 'release/attachment-atlas';
await mkdir(target, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])
  await copyFile(file, `${target}/${file}`);
// Archive creation uses a fixed file list; it never removes existing files or folders.
execFileSync(
  'zip',
  [
    '-q',
    `attachment-atlas-${version}.zip`,
    'attachment-atlas/main.js',
    'attachment-atlas/manifest.json',
    'attachment-atlas/styles.css',
    'attachment-atlas/LICENSE',
    'attachment-atlas/THIRD_PARTY_NOTICES.md',
  ],
  { cwd: 'release', stdio: 'inherit' },
);
console.log(`Manual install folder: ${target}; archive: attachment-atlas-${version}.zip`);
