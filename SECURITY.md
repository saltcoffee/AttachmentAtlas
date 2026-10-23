# Security and data-integrity reports

Attachment Atlas currently has a 0.1.0 development build. No stable release is supported yet. Use the repository's private vulnerability reporting channel when available; maintainers must enable it before the first public plugin release.

## Reporting sensitive issues

For vulnerabilities, unintended file access, or a reproducible risk of data loss, use the repository's **Security → Report a vulnerability** entry if it is available. Repository owners must enable private vulnerability reporting before the first public plugin release.

If no private reporting entry is available, open a public issue requesting a private contact channel without publishing sensitive reproduction details. No email address or external reporting service is established yet.

Include a minimal synthetic reproduction, affected version, Obsidian version, operating system, expected behavior, and the observed result. Do not upload a private vault, real note content, authentication data, or a full recovery archive.

## Suspected data loss

Stop new Attachment Atlas write operations. Preserve the vault, `.attachment-atlas-recovery/`, and relevant trash/backup data before further cleanup. Recovery records may contain complete notes and original image bytes; treat them as private data. Do not permanently clear them while investigating.

Recovery checks content before restoring and reports conflicts instead of overwriting later edits. A fully verified restoration automatically removes that operation's recovery data, so preserve a separate copy first when investigating an incident. The plugin cannot provide cross-device locking or recover from missing/corrupted copies without sufficient surviving data.

## Scope

The plugin enumerates vault file paths for complete reference checks. Its only direct Node.js filesystem operation is `lstat()` on the vault root and accessed path components to reject symbolic links; file contents are accessed through Obsidian APIs. Removing an active attachment uses `FileManager.trashFile()` after verifying the recovery copy, honoring the user's deletion preference. Recovery cleanup removes explicit plugin-owned files individually and only removes empty operation directories.

Clipboard access is write-only and requires clicking **Copy recovery folder path** in History. The copied text contains only the displayed vault-relative recovery folder path. The plugin never reads the clipboard or sends the path over the network.

Relevant reports include unauthorized deletion, reference misdirection, silent overwrites, path traversal, access outside the vault, unsafe image decoding, and unexpected network access. Ordinary feature requests belong in the feature template.

Maintainers should acknowledge reports when practical, prioritize data integrity, and coordinate a fix and disclosure with the reporter. No response-time guarantee or bounty program is currently offered.
