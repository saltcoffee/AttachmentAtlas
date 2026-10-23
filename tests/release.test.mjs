import { describe, expect, it } from 'vitest';
import { extractReleaseNotes } from '../scripts/release-notes.mjs';
import { releaseVersion } from '../scripts/release-metadata.mjs';

const manifest = { version: '0.1.0', minAppVersion: '1.8.7' };
const pkg = { version: '0.1.0' };
const versions = { '0.1.0': '1.8.7' };

describe('release metadata', () => {
  it('accepts consistent versions for local builds and an exact release tag', () => {
    expect(releaseVersion(manifest, pkg, versions)).toBe('0.1.0');
    expect(releaseVersion(manifest, pkg, versions, '0.1.0')).toBe('0.1.0');
  });

  it.each(['v0.1.0', '0.2.0', '0.1.0-beta', '0.1.0; echo bad', ''])(
    'rejects a nonmatching tag: %s',
    (tag) => {
      expect(() => releaseVersion(manifest, pkg, versions, tag)).toThrow('Release tag must equal');
    },
  );

  it.each(['01.0.0', '1.0', '1.0.0-beta', 'v1.0.0'])(
    'rejects an invalid plugin version: %s',
    (version) => {
      expect(() => releaseVersion({ ...manifest, version }, { version }, versions)).toThrow(
        'Plugin version',
      );
    },
  );

  it('rejects package versions and minimum-app mappings that do not match', () => {
    expect(() => releaseVersion(manifest, { version: '0.2.0' }, versions)).toThrow('package.json');
    expect(() => releaseVersion(manifest, pkg, {})).toThrow('versions.json');
    expect(() => releaseVersion(manifest, pkg, { '0.1.0': '1.9.0' })).toThrow('versions.json');
    expect(() => releaseVersion({ version: '0.1.0' }, pkg, {})).toThrow('minAppVersion');
  });
});

describe('version-specific release notes', () => {
  it('extracts only the selected version, excluding unreleased and adjacent changes', () => {
    const changelog =
      '# Changelog\n\n## Unreleased\n\n- Future change\n\n## [0.1.0]\n\n### Added\n\n- Initial images\n\n## [0.0.1]\n\n- Old change\n';
    expect(extractReleaseNotes(changelog, '0.1.0')).toBe('### Added\n\n- Initial images\n');
  });

  it('supports dated headings, plain versions, CRLF and non-ASCII notes', () => {
    expect(
      extractReleaseNotes('## [0.1.0] - 2026-10-22\r\n\r\n- 新增资源恢复。\r\n', '0.1.0'),
    ).toBe('- 新增资源恢复。\n');
    expect(extractReleaseNotes('## 0.1.0\n\n- Initial release\n', '0.1.0')).toBe(
      '- Initial release\n',
    );
  });

  it('preserves fenced examples without treating their headings as release boundaries', () => {
    const changelog =
      '## [0.1.0]\n\n- Example\n\n```md\n## [0.1.0]\n## [0.0.1]\n```\n\n## [0.0.1]\n\n- Old change\n';
    expect(extractReleaseNotes(changelog, '0.1.0')).toBe(
      '- Example\n\n```md\n## [0.1.0]\n## [0.0.1]\n```\n',
    );
  });

  it('rejects missing or duplicate version entries instead of using Unreleased', () => {
    expect(() => extractReleaseNotes('## Unreleased\n\n- New feature\n', '0.1.0')).toThrow(
      'found 0',
    );
    expect(() =>
      extractReleaseNotes('## [0.1.0]\n- First\n## [0.1.0]\n- Second\n', '0.1.0'),
    ).toThrow('found 2');
  });

  it.each([
    '',
    '\n\n',
    '\n### Added\n',
    '\n<!-- Release notes go here -->\n',
    '\n### Added\n<!-- Private draft -->\n',
  ])('rejects a release section with no visible notes: %j', (body) => {
    expect(() =>
      extractReleaseNotes(`## [0.1.0]\n${body}\n## Unreleased\n- Future\n`, '0.1.0'),
    ).toThrow('must contain release notes');
  });

  it('rejects unclosed fences that could swallow later version sections', () => {
    expect(() =>
      extractReleaseNotes('## [0.1.0]\n- New\n~~~md\n## Unreleased\n- Future\n', '0.1.0'),
    ).toThrow('unclosed code fence');
  });
});
