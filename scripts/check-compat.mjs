import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const json = (name) => JSON.parse(readFileSync(name, 'utf8'));
const manifest = json('manifest.json');
const baseline = json('node_modules/obsidian-min-api/package.json');
assert.equal(baseline.name, 'obsidian');
assert.equal(
  baseline.version,
  manifest.minAppVersion,
  'Update the minimum API package with minAppVersion.',
);

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
assert(!config.error, 'Cannot read tsconfig.json.');
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const sources = parsed.fileNames.filter((file) =>
  file.startsWith(path.join(root, 'src') + path.sep),
);
const host = ts.createCompilerHost(parsed.options);
const original = host.getSourceFile.bind(host);
const apiPath = path.join(root, 'node_modules/obsidian/obsidian.d.ts');
const api = readFileSync(path.join(root, 'node_modules/obsidian-min-api', baseline.types), 'utf8');
// Keep the module's resolution location so its peer types use the normal project dependencies.
let baselineLoaded = false;
host.getSourceFile = (fileName, languageVersion, onError, createNew) => {
  if (path.resolve(fileName) !== apiPath)
    return original(fileName, languageVersion, onError, createNew);
  baselineLoaded = true;
  return ts.createSourceFile(fileName, api, languageVersion, true);
};
const program = ts.createProgram(sources, parsed.options, host);
assert(baselineLoaded, 'The minimum API definitions were not loaded.');
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  process.stderr.write(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Plugin source type-checks against Obsidian ${baseline.version}; real-app acceptance remains manual.`,
  );
}
