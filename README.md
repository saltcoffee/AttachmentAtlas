# Attachment Atlas

Find duplicate images, clean up unused images, and keep your Obsidian notes linked to the right files.

[简体中文](README.zh-CN.md) · [Changelog](CHANGELOG.md)

- **Merge exact duplicates:** retain one copy and update supported references before recycling the extras.
- **Clean up unused images:** review images with no detected references and choose which to recycle.
- **Inspect large images:** browse by file size and check dimensions and reference locations.

Preview changes before applying them. Everything runs locally inside your vault, with no account, network requests, or telemetry.

**Supported:** Obsidian desktop 1.13.0+; static PNG, JPEG, and WebP images. Interface: English and Simplified Chinese.

## Installation

Open **Settings → Community plugins → Browse**, search for **Attachment Atlas**, then install and enable it. If it is not listed yet, install from GitHub Releases below.

<details>
<summary>Install from GitHub Releases</summary>

1. Download `main.js`, `manifest.json`, and `styles.css` from the same [release](https://github.com/saltcoffee/AttachmentAtlas/releases).
2. Place all three files in your vault's `.obsidian/plugins/attachment-atlas/` folder, creating it if needed.
3. Reload Obsidian and enable **Attachment Atlas** in **Settings → Community plugins**.

No Node.js or npm is needed. GitHub's source ZIP and tarball are not installable plugin bundles.

</details>

## Quick start

1. Click the **Attachment Atlas** images icon in the ribbon, or run **Attachment Atlas: Open image organizer** from the command palette.
2. Select **Scan vault**. Scanning does not change notes or images.
3. Open **Exact duplicates** to choose copies to retain, or **Unreferenced** to select unused images.
4. Preview the file paths and proposed changes, then confirm.

To limit image scanning or protect folders, open **Settings → Attachment Atlas**.

## Recycling

- **Reference coverage:** supported Markdown and Canvas references can be updated during merges. Excalidraw drawings are scanned without modification, and their images are protected. Incomplete reference checks block merging and recycling; inspect **Needs review**.
- **Deletion and restoration:** images follow **Settings → Files and links → Deleted files**: system trash, the vault’s `.trash/` folder, or permanent deletion. Choose a trash option if you want to restore images later; permanently deleted images cannot be recovered from trash. Reference changes made during a merge are not automatically undone.

## Support development

Attachment Atlas is free to use. Optional donations support development and maintenance.

<details>
<summary>Donate with WeChat Pay or Alipay</summary>

Use the QR code for your payment app.

|                                             WeChat Pay · 微信支付                                              |                                           Alipay · 支付宝                                            |
| :------------------------------------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------------------: |
| <img src="assets/donations/wechat-pay.jpg" alt="WeChat Pay donation QR code — 微信支付打赏二维码" width="180"> | <img src="assets/donations/alipay.jpg" alt="Alipay donation QR code — 支付宝打赏二维码" width="180"> |

[Open WeChat Pay QR code](assets/donations/wechat-pay.jpg) · [Open Alipay QR code](assets/donations/alipay.jpg)

</details>

## Feedback and contributing

[Report a bug or request a feature](https://github.com/saltcoffee/AttachmentAtlas/issues) with reproduction steps and a small, non-private example. For sensitive reports, follow [SECURITY.md](SECURITY.md). Development instructions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 gua. See [third-party licenses](THIRD_PARTY_NOTICES.md).
