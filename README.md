# Attachment Atlas

Find duplicate images, clean up unused attachments, and keep your Obsidian image references intact.

[简体中文](README.zh-CN.md) · [Report an issue](https://github.com/saltcoffee/AttachmentAtlas/issues) · [Changelog](CHANGELOG.md)

## Features

- **Find exact duplicates.** Identify identical images with different names or locations, choose which copy to keep, and update supported links before recycling the others.
- **Clean up unreferenced images.** Review images with no detected references and keep selected files in the plugin's recovery area.
- **Inspect image references.** See image size, dimensions, and reference locations in Markdown notes, Canvas files, and Excalidraw drawings.
- **Preview every cleanup.** Review file paths and note changes before confirming. Limit cleanup to a folder and protect files you want to keep.
- **Recover previous operations.** Restore original images and references from History. Conflicting edits are preserved; a fully restored operation's recovery data is removed automatically.
- **Manage recovery storage.** Check backup sizes in History, then preview and permanently delete selected recovery records when you no longer need them.

Supported images: static **PNG, JPEG, and WebP**. Attachment Atlas runs on desktop and works entirely offline.

The interface follows Obsidian's language setting: Chinese language settings display Simplified Chinese; every other language displays English. Reload Obsidian after changing its language to refresh command names and open views.

## Installation

The current development build is installed manually and is not yet available in the community plugin directory.

1. With Node.js 22+ and npm installed, run these commands from the project folder:

   ```sh
   npm ci
   npm run package
   ```

2. Copy the generated `release/attachment-atlas/` folder into your vault's `.obsidian/plugins/` directory.
3. Reload Obsidian and enable **Attachment Atlas** in **Settings → Community plugins**.

To try it with generated sample images, run `node scripts/dev-vault.mjs`, open `dev-vault/` as an Obsidian vault, and enable the local plugin.

Once published, [GitHub Releases](https://github.com/saltcoffee/AttachmentAtlas/releases) also provide `attachment-atlas-<version>.zip`. Extract its `attachment-atlas/` folder and follow steps 2–3 above. Release pages include the version's update notes and the individual plugin files.

## Usage

Open Attachment Atlas using the ribbon icon or the **Attachment Atlas: Open image organizer** command, then select **Scan vault**.

### Merge duplicate images

1. Open **Exact duplicates** and review an image group.
2. Choose the image to retain, then select **Preview merge**.
3. Review the listed files and reference changes, and confirm the operation.

Only byte-identical images are grouped as duplicates. Recovery copies are verified and supported references are updated before redundant images are removed from their original paths. Recycled image bytes are kept in `.attachment-atlas-recovery/`.

Excalidraw references are indexed without editing drawing files. Images used by drawings must be retained; the organizer recommends retaining that copy so eligible duplicates can still be merged.

### Clean up unused images

1. Open **Unreferenced**.
2. Select the images you want to recycle, then select **Preview recycling**.
3. Review the exact paths and confirm.

There is no waiting period. After a successful reference scan, eligible images can be selected immediately. The plugin checks again before execution and keeps recovery copies. Protected images and items that need further reference checks cannot be selected.

If coverage is incomplete, this category is labeled **Potentially unreferenced**. Merging and recycling are disabled, with the reason shown beside the action. Select **View blocking issues** to inspect the affected sources, resolve them, then scan again.

### Restore a cleanup

Open **History**, find the operation, and select **Preview recovery**. Original images are restored before references. After every image and reference is restored and verified, that operation's recovery copies and history are permanently removed. If a file or note conflicts with later edits, recovery preserves the newer content and retains the recovery materials.

If restoration succeeds but removing its recovery data fails, History keeps the remaining data for you to clear. The restored images and references remain in place.

### Free recovery storage

1. Open **History** to check recovery storage usage.
2. Choose **Clean recovery data** on a record, select records and choose **Preview recovery cleanup**, or use **Empty recovery area** to preview all records. **Select older than 30 days** only selects old records.
3. Review the paths and size, acknowledge the permanent loss of recovery data, and confirm.

Only completed, restored, or rolled-back records can start cleanup. Unfinished or damaged records are protected. Cleanup permanently removes the selected image bytes, note snapshots, and history, so those operations can no longer be restored through the plugin. Current notes and images remain unchanged. If cleanup stops, use **Continue cleanup** in History to review and finish removing the remaining data. Unrestored records have no automatic expiry.

Emptying the recovery area requires all records to be eligible; protected records must be resolved first. Clear in batches of up to 100 records and 10,000 files. An empty `.attachment-atlas-recovery/` folder may remain.

## Settings

| Setting                   | Purpose                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Image scope               | Restrict image cleanup to a folder. Leave empty to include the whole vault.                                |
| Preferred retained folder | Prefer copies in this folder when recommending which duplicate to keep. Drawing-used copies take priority. |
| Protected paths           | Exclude selected files or folders from recycling, one path per line.                                       |

Paths are relative to the vault. Reference checks always cover all supported notes, Canvas files, and Excalidraw drawings, even when image cleanup is limited to one folder.

## Common questions

**Why is an image marked “Needs review”?**

An unreadable source, ambiguous link, or unsupported reference format can prevent cleanup. Markdown links, Wiki links, Canvas file nodes, Canvas backgrounds, and Markdown inside Canvas text nodes are supported. Excalidraw Markdown drawings (compressed or plain JSON) and standalone `.excalidraw` scenes are scanned in read-only mode; drawing-used images are protected individually. Unsupported or damaged drawings and Bases can still block coverage. References in YAML or HTML are not automatically rewritten; detected hints can protect the affected images. External application URLs such as `weread://` are recognized as external links.

**Why has cleanup not freed disk space?**

Recycled images are kept in `.attachment-atlas-recovery/` so they can be restored. Use **History → Clean recovery data** or **Empty recovery area** after checking the results to permanently remove them. Successful restoration removes the corresponding recovery data automatically. Sizes describe file bytes; filesystem metadata, sync history, and external backups are not included.

**Does Attachment Atlas use `.trash/`?**

No. This plugin uses only its own recovery area for recycled images. Earlier development builds may have left copies in Obsidian's shared `.trash/`; the plugin does not migrate or delete those existing files.

## Privacy and recovery data

Attachment Atlas requires no account and makes no network requests. There is no telemetry, and file access stays inside the vault.

Recycled image bytes and recovery records are stored together in `.attachment-atlas-recovery/`. They include original images and affected note content and are not additionally encrypted. Sync and backup behavior depends on your vault settings. Keep these materials until you restore the operation or confirm permanent cleanup.

## Support and contributing

Found a problem? [Open an issue](https://github.com/saltcoffee/AttachmentAtlas/issues) with reproduction steps and a small, non-private example. For sensitive reports, follow [SECURITY.md](SECURITY.md).

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development instructions.

## License

[MIT](LICENSE) © 2026 gua. Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
