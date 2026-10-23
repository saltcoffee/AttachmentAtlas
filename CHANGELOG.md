# Changelog

Notable user-facing changes are recorded here. Version entries are used as release notes when their matching Git tags are published.

## [Unreleased]

## [0.1.0]

### Added

- Automatic interface language selection from Obsidian settings: Simplified Chinese for Chinese locales and English for all other languages, including commands, settings, progress, recovery dialogs, and plugin diagnostics.
- 0.1.0 desktop development build with image inventory, size/dimension display, and SHA-256 duplicate groups.
- Exact-duplicate reference rewriting, unreferenced-image recycling without a waiting period, and explicit previews with execution-time rechecks.
- Read-only reference indexing for compressed/uncompressed Excalidraw Markdown drawings and standalone scenes; drawing-used images are protected individually and recommended as retained copies.
- Visible reasons for disabled cleanup actions, a shortcut to blocking issues, and a “Potentially unreferenced” category when reference coverage is incomplete.
- Checksummed recovery records, compensation, conflict-safe restore, and local operation history.
- A single `.attachment-atlas-recovery/` area for recycled images, note snapshots, and journals; no use of Obsidian trash. Successful verified restoration removes the operation's recovery data automatically.
- Recovery storage totals, per-record and selected-record cleanup, an empty-area preview, explicit permanent-deletion consent, and resumable interrupted cleanup. Unfinished or damaged records are protected.
- Native organizer view, protected paths, whole-vault reference coverage, and inline fingerprint Worker.
- TypeScript, lint, fault-injection tests, production bundling, third-party notices, local install packaging, and CI.
- Synthetic test vault generator and manual acceptance guide.
- Automated tag releases with standard plugin assets, an installation ZIP, and version-specific changelog notes.

- Attachment Atlas branding, the `attachment-atlas` plugin ID, and bilingual README.
- MIT license, contribution and security guidance, issue/PR templates, and documentation CI.

### Fixed

- Removed the unnecessary category-bar hover tooltip in the organizer.
- External application links such as `weread://bestbookmark` no longer block vault reference checks.
- Unrelated images remain eligible when supported Excalidraw drawings are present; damaged or unsupported drawing data still requires review.
- Images nested inside Markdown links are included in reference analysis and duplicate-merge updates, including Canvas text nodes.
- Markdown destinations with named or numeric character references resolve correctly; merging preserves query strings and fragments.
- A failed initial recovery-plan write removes its newly created empty operation directory so the operation can be retried. Partial or unknown recovery material remains protected.
- The current-attachment-folder command follows Obsidian attachment preferences and handles vault-root scopes correctly.
