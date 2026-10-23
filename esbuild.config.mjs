import { build, context } from 'esbuild';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { notices } from './scripts/notices.mjs';
const production = process.argv.includes('production');
const worker = await build({
  entryPoints: ['src/workers/hash-worker.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: production,
});
const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['obsidian', 'node:fs/promises', 'node:path'],
  define: { __ATLAS_WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) },
  sourcemap: production ? false : 'inline',
  minify: production,
  metafile: true,
  banner: {
    js: '/* Attachment Atlas — generated bundle. Source: https://github.com/saltcoffee/AttachmentAtlas */',
  },
};
if (production) {
  const result = await build(options);
  await mkdir('build', { recursive: true });
  await writeFile('build/metafile.json', JSON.stringify(result.metafile));
  const licenses = await notices(result.metafile.inputs);
  await appendFile('main.js', `\n/*\n${licenses.replaceAll('*/', '* /')}\n*/\n`);
} else {
  const development = await context(options);
  await development.watch();
  console.log('Watching plugin sources. Restart dev after changing hash-worker.ts.');
}
