import assert from 'node:assert/strict';

export const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Shared by release-note preparation and validation of the built installation assets. */
export function releaseVersion(manifest, pkg, versions, tag) {
  assert(
    typeof manifest.version === 'string' && RELEASE_VERSION.test(manifest.version),
    'Plugin version must be x.y.z, without v, leading zeroes, or prerelease suffixes.',
  );
  assert.equal(
    pkg.version,
    manifest.version,
    'package.json and manifest.json versions must match.',
  );
  assert(
    typeof manifest.minAppVersion === 'string' && RELEASE_VERSION.test(manifest.minAppVersion),
    'manifest.minAppVersion must be x.y.z.',
  );
  assert.equal(
    versions[manifest.version],
    manifest.minAppVersion,
    'versions.json must map the release version to manifest.minAppVersion.',
  );
  if (tag !== undefined)
    assert.equal(tag, manifest.version, 'Release tag must equal manifest version, without v.');
  return manifest.version;
}
