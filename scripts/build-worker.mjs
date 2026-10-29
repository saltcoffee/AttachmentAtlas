import { build } from 'esbuild';

export function buildWorker(entryPoint, production) {
  return build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    // Parser dependencies provide a DOM-free entry under this export condition.
    conditions: ['worker'],
    target: 'es2022',
    minify: production,
    metafile: true,
  });
}
