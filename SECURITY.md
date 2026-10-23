# Security and data-integrity reports

Attachment Atlas currently has a 0.1.0 development build. No stable release is supported yet. Use the repository's private vulnerability reporting channel when available; maintainers must enable it before the first public plugin release.

## Reporting sensitive issues

For vulnerabilities, unintended file access, or a reproducible risk of data loss, use the repository's **Security → Report a vulnerability** entry if it is available. Repository owners must enable private vulnerability reporting before the first public plugin release.

If no private reporting entry is available, open a public issue requesting a private contact channel without publishing sensitive reproduction details. No email address or external reporting service is established yet.

Include a minimal synthetic reproduction, affected version, Obsidian version, operating system, expected behavior, and the observed result. Do not upload a private vault, real note content, authentication data, or a full backup.

## Suspected data loss

Stop new Attachment Atlas write operations. Preserve the vault and relevant trash/backup data before further cleanup. Image deletion follows Obsidian's **Deleted files** setting: system trash, the vault's `.trash/` folder, or permanent deletion. Restore images from the configured trash location if available; permanently deleted images cannot be recovered from trash. The plugin does not retain image backups, note snapshots, or operation history, and does not undo reference edits.

A failed or interrupted operation can leave some reference updates or image deletions applied. Preserve the current files, review the error, and scan again before continuing. The plugin cannot provide cross-device locking or recover files that are no longer available in trash or external backups.

## Scope

The plugin enumerates vault file paths for complete reference checks. Its only direct Node.js filesystem operation is `lstat()` on the vault root and accessed path components to reject symbolic links; file contents are accessed through Obsidian APIs. Deleting an active attachment uses `FileManager.trashFile()` after verifying references and the image content, following the user's deletion preference. The plugin never empties either trash location or adds a deletion fallback if the operation fails.

Relevant reports include unauthorized deletion, reference misdirection, silent overwrites, path traversal, access outside the vault, unsafe image decoding, and unexpected network access. Ordinary feature requests belong in the feature template.

Maintainers should acknowledge reports when practical, prioritize data integrity, and coordinate a fix and disclosure with the reporter. No response-time guarantee or bounty program is currently offered.
