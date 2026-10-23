import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { RELEASE_VERSION, releaseVersion } from './release-metadata.mjs';

export function extractReleaseNotes(changelog, version) {
  assert(RELEASE_VERSION.test(version), 'Invalid release version.');
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const matches = [];
  let section = null,
    fence = '',
    fenceLength = 0;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) {
        fence = marker[1][0];
        fenceLength = marker[1].length;
      } else if (marker[1][0] === fence && marker[1].length >= fenceLength && !marker[2].trim())
        fence = '';
      continue;
    }
    if (fence) continue;
    const heading = /^##[ \t]+(.+?)\s*$/.exec(line);
    if (!heading) continue;
    if (section) {
      section.end = index;
      section = null;
    }
    const entry = /^(?:\[([^\]]+)\]|(\S+))(?:[ \t]+-[ \t]+\d{4}-\d{2}-\d{2})?$/.exec(heading[1]);
    if (entry && (entry[1] ?? entry[2]) === version) {
      section = { start: index + 1, end: lines.length };
      matches.push(section);
    }
  }
  assert(!fence, 'CHANGELOG.md has an unclosed code fence.');
  assert(
    matches.length === 1,
    `CHANGELOG.md must contain exactly one ## [${version}] section; found ${matches.length}.`,
  );
  const body = lines.slice(matches[0].start, matches[0].end).join('\n').trim();
  const visible = body.replace(/<!--[\s\S]*?-->/g, '').trim();
  assert(
    visible.split('\n').some((line) => line.trim() && !/^#{1,6}[ \t]/.test(line.trim())),
    `CHANGELOG.md section ${version} must contain release notes, not just headings or comments.`,
  );
  return `${body}\n`;
}

async function main() {
  assert(process.env.RELEASE_TAG, 'Set RELEASE_TAG to the version being prepared.');
  const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
  const [manifest, pkg, versions, changelog] = await Promise.all([
    readJson('manifest.json'),
    readJson('package.json'),
    readJson('versions.json'),
    readFile('CHANGELOG.md', 'utf8'),
  ]);
  const version = releaseVersion(manifest, pkg, versions, process.env.RELEASE_TAG);
  const notes = extractReleaseNotes(changelog, version);
  await mkdir('build', { recursive: true });
  await writeFile('build/release-notes.md', notes, 'utf8');
  process.stdout.write(`Prepared release notes for ${version}: build/release-notes.md\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
