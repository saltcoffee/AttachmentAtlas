# Changelog

Notable user-facing changes are recorded here. Version entries are used as release notes when their matching Git tags are published.

## [Unreleased]

## [0.1.4] - 2026-10-25

### Changed

- Lowers the minimum Obsidian desktop version to 1.8.7. The settings page shares its controls and save validation across the older renderer and native declarative settings on 1.13.0+, preserving settings search on newer versions.
- Checks plugin source against the pinned minimum Obsidian API as part of CI, alongside the current API types.

## [0.1.3] - 2026-10-23

### Fixed

- Uses `FileManager.trashFile()` without disabling the required review rule. Image deletion now follows Obsidian's deleted-file setting, including permanent deletion when selected. Confirmation dialogs and documentation explain that permanently deleted images cannot be restored from trash.

## [0.1.2] - 2026-10-23

### Changed

- Image cleanup sends images to system trash without creating plugin backups. Obsidian falls back to the vault's `.trash/` folder if system trash is unavailable. Restore images from the trash; rewritten references are not automatically restored.
- Removes plugin-managed recovery storage, operation history, restore dialogs, and recovery-data cleanup. Existing recovery folders are left untouched.
- Keeps previews, reference verification, and per-image checks. Interrupted operations retain applied changes and stop remaining deletions; scan again to continue.
- Simplifies the English and Chinese READMEs around installation, core workflows, and recycling behavior.

### Fixed

- Recycling always uses trash even when Obsidian's deleted-file setting is permanent deletion. A failed trash operation stops cleanup without permanently deleting the image.

## [0.1.1]

### Changed

- Requires Obsidian desktop 1.13.0 or later. Settings use the declarative API for native headings and settings search, while retaining explicit saving and path validation.
- Image recycling follows Obsidian's deletion preference through `FileManager.trashFile()` after verifying the plugin recovery copy. Trash copies are managed separately by Obsidian or the operating system.
- GitHub Releases contain only `main.js`, `manifest.json`, and `styles.css`, with build provenance attestations for all three. Manual installation ZIPs remain available through local packaging.

### Fixed

- Uses window timers for UI and hashing timeouts, and the Worker scope for fingerprint messages.
- Removes redundant type assertions and deprecated Zod finite-number checks; non-finite recovery timestamps remain invalid.
- Adds lint checks for the automated review's source rules and documents the purpose of filesystem checks, vault enumeration, and clipboard writes.

## [0.1.0]

### Added

- Automatic interface language selection from Obsidian settings: Simplified Chinese for Chinese locales and English for all other languages, including commands, settings, progress, recovery dialogs, and plugin diagnostics.
- 0.1.0 desktop development build with image inventory, size/dimension display, and SHA-256 duplicate groups.
- Exact-duplicate reference rewriting, unreferenced-image recycling without a waiting period, and explicit previews with execution-time rechecks.
- Read-only reference indexing for compressed/uncompressed Excalidraw Markdown drawings and standalone scenes; drawing-used images are protected individually and recommended as retained copies.
- Visible reasons for disabled cleanup actions, a shortcut to blocking issues, and a “Potentially unreferenced” category when reference coverage is incomplete.
- Checksummed recovery records, compensation, conflict-safe restore, and local operation history.
- Historical behavior, removed in 0.1.2: a single `.attachment-atlas-recovery/` area for recycled images, note snapshots, and journals; no use of Obsidian trash. Successful verified restoration removes the operation's recovery data automatically.
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
