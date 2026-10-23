import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export async function notices(inputs) {
  const packages = new Set();
  for (const input of Object.keys(inputs)) {
    if (!input.startsWith('node_modules/')) continue;
    let directory = dirname(input);
    while (directory !== 'node_modules') {
      try {
        const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        if (metadata.name) {
          packages.add(directory);
          break;
        }
        directory = dirname(directory);
      } catch {
        directory = dirname(directory);
      }
    }
  }
  const sections = [
    '# Third-party notices\n\nGenerated from the production bundle. Development-only dependencies are excluded.\n',
  ];
  for (const directory of [...packages].sort()) {
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    const licenses = (await readdir(directory)).filter((name) =>
      /^(?:license|licence|copying)(?:\.|$)/i.test(name),
    );
    if (!licenses.length) throw new Error(`Missing license text: ${metadata.name}`);
    const text = await Promise.all(licenses.map((name) => readFile(join(directory, name), 'utf8')));
    sections.push(
      `## ${metadata.name} ${metadata.version}\n\nLicense: ${metadata.license ?? 'See text below'}.\n\n${text.join('\n')}\n`,
    );
  }
  const content = sections
    .join('\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
  await writeFile('THIRD_PARTY_NOTICES.md', content);
  return content;
}
