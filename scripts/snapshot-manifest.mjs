import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function assertEmptyCoverage(snapshot, implementation) {
  if (implementation === 'baseline') {
    assert(
      Array.isArray(snapshot?.blockers),
      'Baseline snapshot must include a blockers array.',
    );
    assert.equal(snapshot.blockers.length, 0, 'Fixture reference coverage is incomplete.');
    return;
  }
  assert(
    Array.isArray(snapshot?.coverageIssues),
    'Current snapshot must include a coverageIssues array.',
  );
  assert.equal(snapshot.coverageIssues.length, 0, 'Fixture reference coverage is incomplete.');
}

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry !== undefined) out[key] = normalizeValue(entry);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeValue(value), null, 2);
}

function normalizeReference(ref) {
  const normalized = {
    source: ref.source,
    raw: ref.raw,
    linkpath: ref.linkpath,
    target: ref.target,
    style: ref.style,
    sourceKind: ref.sourceKind,
    readOnly: ref.readOnly,
  };
  if (ref.start !== undefined) normalized.start = ref.start;
  if (ref.end !== undefined) normalized.end = ref.end;
  if (ref.outer !== undefined) normalized.outer = ref.outer;
  if (ref.fieldPath !== undefined) normalized.fieldPath = ref.fieldPath;
  return normalized;
}

export function buildSnapshotManifest(snapshot) {
  const coverageIssues = snapshot.coverageIssues ?? [];
  const sources = {};
  for (const source of snapshot.sources) {
    sources[source.path] = {
      kind: source.kind,
      digest: source.digest,
      hints: [...source.hints],
      references: source.references.map(normalizeReference),
    };
  }
  const media = {};
  for (const image of snapshot.media) {
    media[image.path] = {
      digest: image.digest,
      format: image.format,
      width: image.width ?? null,
      height: image.height ?? null,
      size: image.size,
      references: image.references.map(normalizeReference),
      reasons: [...image.reasons],
    };
  }
  const unreferencedViewCandidates = snapshot.media
    .filter((image) => !image.references.length)
    .map((image) => image.path);
  const recyclableCandidates = snapshot.media
    .filter((image) => !image.references.length && !image.reasons.length && !coverageIssues.length)
    .map((image) => image.path);
  const duplicates = snapshot.duplicates.map((group) => ({
    keepPath: group[0]?.path ?? null,
    paths: group.map((image) => image.path),
  }));
  return normalizeValue({
    sources,
    media,
    unreferencedViewCandidates,
    recyclableCandidates,
    duplicates,
    coverageIssues,
  });
}

export function manifestDigest(manifest) {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

export function firstDiff(baseline, candidate, path = '$') {
  if (Object.is(baseline, candidate)) return null;
  if (
    baseline === null ||
    candidate === null ||
    typeof baseline !== typeof candidate ||
    typeof baseline !== 'object'
  ) {
    return { path, baseline, candidate };
  }
  if (Array.isArray(baseline) || Array.isArray(candidate)) {
    if (!Array.isArray(baseline) || !Array.isArray(candidate)) {
      return { path, baseline, candidate };
    }
    const max = Math.max(baseline.length, candidate.length);
    for (let i = 0; i < max; i++) {
      if (i >= baseline.length) return { path: `${path}[${i}]`, baseline: undefined, candidate: candidate[i] };
      if (i >= candidate.length) return { path: `${path}[${i}]`, baseline: baseline[i], candidate: undefined };
      const diff = firstDiff(baseline[i], candidate[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].sort();
  for (const key of keys) {
    const childPath = `${path}.${key}`;
    if (!Object.hasOwn(baseline, key)) return { path: childPath, baseline: undefined, candidate: candidate[key] };
    if (!Object.hasOwn(candidate, key)) return { path: childPath, baseline: baseline[key], candidate: undefined };
    const diff = firstDiff(baseline[key], candidate[key], childPath);
    if (diff) return diff;
  }
  return null;
}
