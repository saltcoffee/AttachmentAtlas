import { build, context } from 'esbuild';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { notices } from './scripts/notices.mjs';
import { buildWorker } from './scripts/build-worker.mjs';
const production = process.argv.includes('production');
const worker = await buildWorker('src/workers/hash-worker.ts', production);
const planWorker = await buildWorker('src/workers/plan-worker.ts', production);
const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['obsidian', 'node:fs/promises', 'node:path'],
  define: {
    __ATLAS_WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text),
    __ATLAS_PLAN_WORKER_SOURCE__: JSON.stringify(planWorker.outputFiles[0].text),
  },
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
  const licenses = await notices({ ...result.metafile.inputs, ...planWorker.metafile.inputs });
  await appendFile('main.js', `\n/*\n${licenses.replaceAll('*/', '* /')}\n*/\n`);
} else {
  const development = await context(options);
  await development.watch();
  console.log('Watching plugin sources. Restart dev after changing worker sources.');
}
