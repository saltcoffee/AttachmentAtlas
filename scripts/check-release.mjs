import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { releaseVersion } from './release-metadata.mjs';
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const manifest = await readJson('manifest.json'),
  pkg = await readJson('package.json'),
  versions = await readJson('versions.json');
assert.equal(manifest.id, 'attachment-atlas');
assert.equal(manifest.name, 'Attachment Atlas');
releaseVersion(manifest, pkg, versions, process.env.RELEASE_TAG);
assert.equal(manifest.isDesktopOnly, true);
assert(manifest.description.length <= 250 && manifest.description.endsWith('.'));
for (const file of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])
  assert((await stat(file)).size > 0, `Missing release file: ${file}`);
const code = await readFile('main.js', 'utf8');
assert(code.includes('Third-party notices'));
assert(code.includes('Fingerprint task stopped'));
assert(!/import\([^)]*https?:/.test(code));
const { inputs } = await readJson('build/metafile.json');
assert(
  !Object.keys(inputs).some((path) => /node_modules\/(?:vitest|eslint|obsidian)\//.test(path)),
  'Development dependency entered the bundle.',
);
console.log(
  `Release structure verified: ${manifest.version}; ${(await stat('main.js')).size} bytes. Real-app release sign-off remains manual.`,
);
