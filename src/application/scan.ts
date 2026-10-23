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
import { active, basename, imagePath, sourcePath, within } from '../domain/paths';
import { imageFormat, imageDimensions } from '../domain/image';
import { parseSource, resolveReference } from '../references';
import { asMessage, errorDetail, message, type Text } from '../domain/messages';
export interface ScanOptions {
  revision: number;
  settings: Settings;
  signal?: AbortSignal;
  progress?: (message: Text) => void;
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
    blockers: Text[] = [];
  let sourceBytes = 0;
  const check = () => {
    assert(!options.signal?.aborted, 'Scan cancelled.');
  };
  for (const [index, file] of files.entries()) {
    check();
    options.progress?.(
      message('Checking {current}/{total}: {path}', {
        current: index + 1,
        total: files.length,
        path: file.path,
      }),
    );
    if (/\.base$/i.test(file.path))
      blockers.push(message('Unsupported reference container: {path}', { path: file.path }));
    if (!sourcePath(file.path)) continue;
    try {
      sourceBytes += file.size;
      assert(
        file.size <= MAX_SOURCE && sourceBytes <= 64 * 1024 * 1024,
        'Reference source budget exceeded.',
      );
      const text = await vault.readText(file.path),
        parsed = parseSource(file.path, text);
      for (const reference of parsed.references) {
        const result = resolveReference(reference, fileNames);
        reference.target = result.target;
        if (result.ambiguous)
          blockers.push(
            message('Ambiguous reference in {path}: {reference}', {
              path: file.path,
              reference: reference.raw,
            }),
          );
        if (
          result.target &&
          reference.style !== 'json' &&
          vault.resolve &&
          vault.resolve(reference) !== result.target
        )
          blockers.push(
            message('Obsidian target resolution differs in {path}: {reference}', {
              path: file.path,
              reference: reference.raw,
            }),
          );
        if (!result.target && !result.external)
          parsed.hints.push(reference.raw, reference.linkpath);
      }
      sources.push({ path: file.path, text, digest: await digest(textBytes(text)), ...parsed });
    } catch (error) {
      blockers.push(
        message('{path}: {reason}', { path: file.path, reason: asMessage(errorDetail(error)) }),
      );
    }
  }
  for (const [index, file] of files.filter((file) => imagePath(file.path)).entries()) {
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
      reasons.push(errorDetail(error));
    }
    if (!within(file.path, options.settings.scope))
      reasons.push('Outside the selected image scope.');
    if (options.settings.protectedPaths.some((folder) => within(file.path, folder)))
      reasons.push('Protected path.');
    if (
      sources.some((source) =>
        source.hints.some(
          (hint) =>
            hint.includes(file.path) ||
            hint.includes(basename(file.path)) ||
            hint.includes(encodeURI(file.path)) ||
            hint.includes(encodeURIComponent(basename(file.path))),
        ),
      )
    )
      reasons.push('Possible reference in unsupported syntax or plain text.');
    const references = sources.flatMap((source) =>
      source.references.filter((reference) => reference.target === file.path),
    );
    if (references.some((reference) => reference.readOnly))
      reasons.push(
        'Referenced by an Excalidraw drawing. Retain this image; drawing references are read-only.',
      );
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
    blockers,
    duplicates,
  };
}
export function unreferencedReasons(image: Media, snapshot: Snapshot): Text[] {
  const reasons = [...image.reasons];
  if (snapshot.blockers.length) reasons.push('Reference coverage is incomplete.');
  if (image.references.length) reasons.push('Image is referenced.');
  return reasons;
}
