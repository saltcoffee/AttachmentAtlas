import {
  MAX_IMAGE,
  MAX_SOURCE,
  assert,
  digest,
  textBytes,
  type Hasher,
  type Media,
  type Settings,
  type Snapshot,
  type Source,
  type VaultPort,
} from '../domain/model';
import { active, imagePath, sourcePath, within } from '../domain/paths';
import { imageFormat, imageDimensions } from '../domain/image';
import { parseSource, createReferenceResolver, sourceKindOf } from '../references';
import {
  AtlasError,
  SourceStateError,
  asMessage,
  errorDetail,
  message,
  type Text,
} from '../domain/messages';
import {
  coverageIssueReason,
  makeIssue,
  readOnlyReason,
  type CoverageIssue,
  type SourceKind,
} from '../domain/reference-coverage';
import { checkCancelled } from './cancellation';
import { protectedImagePaths, type ReferenceIndexStats } from './reference-index';

const BASE_SOURCE_LIMIT = 256 * 1024;
const TOTAL_SOURCE_LIMIT = 64 * 1024 * 1024;

export interface ScanOptions {
  revision: number;
  settings: Settings;
  signal?: AbortSignal;
  progress?: (message: Text) => void;
  referenceIndexStats?: (stats: Readonly<ReferenceIndexStats>) => void;
}

function kindFromPath(path: string): SourceKind {
  if (/\.base$/i.test(path)) return 'base';
  if (/\.excalidraw$/i.test(path) || /\.canvas$/i.test(path)) {
    return path.toLowerCase().endsWith('.canvas') ? 'canvas' : 'excalidraw';
  }
  return 'markdown';
}

export async function scan(
  vault: VaultPort,
  hash: Hasher,
  options: ScanOptions,
): Promise<Snapshot> {
  const files = vault
    .list()
    .filter((file) => active(file.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  const fileNames = files.map((file) => file.path),
    sources: Source[] = [],
    media: Media[] = [],
    coverageIssues: CoverageIssue[] = [];
  let sourceBytes = 0;
  const check = () => {
    if (options.signal?.aborted && coverageIssues.length) {
      const issue = coverageIssues[0]!;
      throw new AtlasError(issue.detail ?? coverageIssueReason(issue.code));
    }
    checkCancelled(options.signal);
  };
  const resolve = createReferenceResolver(fileNames);
  let baseContextError: Error | undefined;
  try {
    vault.assertBaseContextsClosed(fileNames.filter((path) => /\.base$/i.test(path)));
  } catch (error) {
    baseContextError = error instanceof Error ? error : new AtlasError(errorDetail(error));
  }
  for (const [index, file] of files.entries()) {
    check();
    options.progress?.(
      message('Checking {current}/{total}: {path}', {
        current: index + 1,
        total: files.length,
        path: file.path,
      }),
    );
    if (!sourcePath(file.path)) continue;
    const kindGuess = kindFromPath(file.path);
    const limit = /\.base$/i.test(file.path) ? BASE_SOURCE_LIMIT : MAX_SOURCE;
    if (file.size > limit || sourceBytes + file.size > TOTAL_SOURCE_LIMIT) {
      sourceBytes += file.size;
      coverageIssues.push(
        makeIssue('source-budget-exceeded', file.path, kindGuess, 'Reference source budget exceeded.'),
      );
      continue;
    }
    sourceBytes += file.size;
    let text: string;
    try {
      if (kindGuess === 'base' && baseContextError) throw baseContextError;
      text = await vault.readText(file.path);
    } catch (error) {
      if (error instanceof SourceStateError)
        coverageIssues.push(
          makeIssue(error.code, file.path, kindGuess, error.detail),
        );
      else
        coverageIssues.push(
          makeIssue(
            'source-read-failed',
            file.path,
            kindGuess,
            message('{path}: {reason}', {
              path: file.path,
              reason: asMessage(errorDetail(error)),
            }),
          ),
        );
      continue;
    }
    // The listed metadata size can be stale; check the actual decoded UTF-8 bytes before parsing.
    const encoded = textBytes(text);
    const actualBytes = encoded.byteLength;
    sourceBytes += actualBytes - file.size;
    if (actualBytes > limit || sourceBytes > TOTAL_SOURCE_LIMIT) {
      coverageIssues.push(
        makeIssue('source-budget-exceeded', file.path, kindGuess, 'Reference source budget exceeded.'),
      );
      continue;
    }
    const kind = sourceKindOf(file.path, text);
    let parsed: { references: Source['references']; hints: string[]; issues: CoverageIssue[] };
    try {
      parsed = parseSource(file.path, text);
    } catch (error) {
      coverageIssues.push(
        makeIssue(
          'source-analysis-failed',
          file.path,
          kind,
          message('{path}: {reason}', {
            path: file.path,
            reason: asMessage(errorDetail(error)),
          }),
        ),
      );
      continue;
    }
    for (const issue of parsed.issues) coverageIssues.push(issue);
    for (const reference of parsed.references) {
      const result = resolve(reference);
      reference.target = result.target;
      if (result.ambiguous)
        coverageIssues.push(
          makeIssue(
            'ambiguous-target',
            file.path,
            reference.sourceKind,
            message('Ambiguous reference in {path}: {reference}', {
              path: file.path,
              reference: reference.raw,
            }),
          ),
        );
      if (
        result.target &&
        reference.style !== 'json' &&
        vault.resolve &&
        vault.resolve(reference) !== result.target
      )
        coverageIssues.push(
          makeIssue(
            'host-resolution-mismatch',
            file.path,
            reference.sourceKind,
            message('Obsidian target resolution differs in {path}: {reference}', {
              path: file.path,
              reference: reference.raw,
            }),
          ),
        );
      if (!result.target && !result.external) {
        if (reference.style === 'base-literal')
          coverageIssues.push(
            makeIssue(
              'unresolved-base-target',
              file.path,
              'base',
              message('Unresolved Bases image path in {path}: {reference}', {
                path: file.path,
                reference: reference.raw,
              }),
            ),
          );
        else parsed.hints.push(reference.raw, reference.linkpath);
      }
    }
    sources.push({
      path: file.path,
      text,
      digest: await digest(encoded),
      kind,
      references: parsed.references,
      hints: parsed.hints,
    });
  }
  const incoming = new Map<string, Source['references']>();
  const hints = sources.flatMap((source) => source.hints);
  const images = files.filter((file) => imagePath(file.path));
  let protectedPaths: ReadonlySet<string>;
  try {
    options.progress?.('Building reference protection index.');
    protectedPaths = await protectedImagePaths(
      images.map((file) => file.path),
      hints,
      options.signal,
      options.referenceIndexStats,
    );
  } catch (error) {
    check();
    throw error;
  }
  for (const source of sources)
    for (const reference of source.references) {
      const list = incoming.get(reference.target) ?? [];
      list.push(reference);
      incoming.set(reference.target, list);
    }
  for (const [index, file] of images.entries()) {
    check();
    options.progress?.(
      message('Fingerprinting image {current}: {path}', { current: index + 1, path: file.path }),
    );
    const reasons: Text[] = [];
    let dimensions: { width: number; height: number } | null = null;
    let fingerprint = '',
      format = 'Unsupported';
    try {
      assert(file.size <= MAX_IMAGE, 'Image exceeds 64 MiB processing limit.');
      const data = await vault.readBinary(file.path);
      const detected = imageFormat(data, file.path);
      assert(detected, 'Unsupported, animated, damaged, or mismatched image format.');
      format = detected;
      dimensions = imageDimensions(data, format);
      assert(
        dimensions &&
          dimensions.width > 0 &&
          dimensions.height > 0 &&
          dimensions.width * dimensions.height <= 24_000_000,
        'Image dimensions are unknown or exceed 24 megapixels.',
      );
      fingerprint = await hash(data);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      reasons.push(errorDetail(error));
    }
    if (!within(file.path, options.settings.scope))
      reasons.push('Outside the selected image scope.');
    if (options.settings.protectedPaths.some((folder) => within(file.path, folder)))
      reasons.push('Protected path.');
    if (protectedPaths.has(file.path))
      reasons.push('Possible reference in unsupported syntax or plain text.');
    const references = incoming.get(file.path) ?? [];
    const readOnlyKinds = [...new Set(references.filter((ref) => ref.readOnly).map((ref) => ref.sourceKind))].sort();
    for (const kind of readOnlyKinds) reasons.push(readOnlyReason(kind));
    media.push({ ...file, ...dimensions, format, digest: fingerprint, reasons, references });
  }
  const groups = new Map<string, Media[]>();
  for (const image of media) {
    if (!image.digest) continue;
    const key = `${image.size}:${image.digest}`,
      group = groups.get(key) ?? [];
    group.push(image);
    groups.set(key, group);
  }
  const duplicates = [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) =>
      group.sort((a, b) => {
        const drawing =
          Number(b.references.some((ref) => ref.readOnly)) -
          Number(a.references.some((ref) => ref.readOnly));
        const preferred =
          Number(within(b.path, options.settings.preferredFolder)) -
          Number(within(a.path, options.settings.preferredFolder));
        return (
          drawing ||
          preferred ||
          b.references.length - a.references.length ||
          a.path.length - b.path.length ||
          a.path.localeCompare(b.path)
        );
      }),
    );
  check();
  return {
    revision: options.revision,
    settings: structuredClone(options.settings),
    files,
    media,
    sources,
    coverageIssues,
    duplicates,
  };
}
export function unreferencedReasons(image: Media, snapshot: Snapshot): Text[] {
  const reasons = [...image.reasons];
  if (snapshot.coverageIssues.length) reasons.push('Reference coverage is incomplete.');
  if (image.references.length) reasons.push('Image is referenced.');
  return reasons;
}
