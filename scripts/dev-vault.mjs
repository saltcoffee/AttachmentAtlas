import { mkdir, writeFile, copyFile, readFile, stat } from 'node:fs/promises';
const root = 'dev-vault',
  plugin = `${root}/.obsidian/plugins/attachment-atlas`;
await mkdir(plugin, { recursive: true });
await mkdir(`${root}/images`, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css'])
  await copyFile(file, `${plugin}/${file}`);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64',
);
const fixtures = {
  'images/original.png': png,
  'images/duplicate.png': png,
  'images/unused.png': png,
  'Welcome.md':
    '# Attachment Atlas test vault\n\n![[images/duplicate.png|80]]\n\n![Original](images/original.png)\n\nThe unused image has no references. Scan, preview, and confirm to recycle it immediately.\n',
  'Example.canvas': JSON.stringify(
    {
      nodes: [
        {
          id: 'image',
          type: 'file',
          file: 'images/duplicate.png',
          x: 0,
          y: 0,
          width: 200,
          height: 200,
        },
      ],
      edges: [],
    },
    null,
    2,
  ),
};
for (const [name, data] of Object.entries(fixtures)) {
  try {
    await stat(`${root}/${name}`);
  } catch {
    await writeFile(`${root}/${name}`, data);
  }
}
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
console.log(
  `Prepared ${root} with ${manifest.name} ${manifest.version}. Open it as an Obsidian vault and enable the local plugin manually. Existing fixture edits were preserved.`,
);
