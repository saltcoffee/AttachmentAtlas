# Attachment Atlas

查找重复图片、清理闲置图片，让 Obsidian 笔记继续引用正确的文件。

[English](README.md) · [更新记录](CHANGELOG.md)

- **合并重复图片**：保留一份内容完全一致的图片，更新受支持的引用后回收其余副本。
- **清理闲置图片**：查看未检测到引用的图片，自行选择需要回收的文件。
- **查看大图片**：按文件大小浏览图片，查看尺寸与引用位置。

所有改动先预览、再确认。全部处理在当前知识库内完成，无需账户，不发送网络请求或收集遥测。

**支持范围**：Obsidian 桌面端 1.13.0+，静态 PNG、JPEG、WebP 图片。界面支持简体中文和英文。

## 安装

在 Obsidian 中打开 **设置 → 第三方插件 → 浏览**，搜索 **Attachment Atlas**，安装后启用。如果暂时搜索不到，可使用下方的 GitHub Releases 安装方式。

<details>
<summary>从 GitHub Releases 手动安装</summary>

1. 从同一个 [Release](https://github.com/saltcoffee/AttachmentAtlas/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 在知识库中创建 `.obsidian/plugins/attachment-atlas/` 文件夹，将三个文件放入其中。
3. 重新加载 Obsidian，在 **设置 → 第三方插件** 中启用 **Attachment Atlas**。

安装无需 Node.js 或 npm。GitHub 自动生成的源码 ZIP 和 tarball 不是可安装的插件包。

</details>

## 快速开始

1. 点击侧边栏的 **Attachment Atlas** 图片图标，或在命令面板运行 **Attachment Atlas: 打开图片管理器**。
2. 点击 **扫描当前库**。扫描不会修改笔记或图片。
3. 在 **完全重复** 中选择要保留的副本，或在 **未引用** 中勾选闲置图片。
4. 预览文件路径和具体改动，确认后执行。

如需限定图片扫描范围或保护指定目录，打开 **设置 → Attachment Atlas**。

## 回收说明

- **引用检查**：合并时可更新受支持的 Markdown 和 Canvas 引用；Excalidraw 绘图只读扫描，其引用的图片会受到保护。引用检查不完整时会禁用合并和回收，请先查看 **待检查**。
- **删除与找回**：图片遵循 **设置 → 文件与链接 → 删除文件** 的选项：系统废纸篓、知识库的 `.trash/` 文件夹或永久删除。如需之后找回图片，请选择废纸篓或回收站；永久删除的图片无法从回收站恢复。合并时已更新的引用不会自动还原。

## 支持开发

Attachment Atlas 免费使用。欢迎自愿打赏，支持后续开发与维护。

请使用对应的支付应用扫描二维码。

|                                       微信支付 · WeChat Pay                                        |                                        支付宝 · Alipay                                         |
| :------------------------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------------: |
| <img src="assets/donations/wechat-pay.jpg" alt="微信支付打赏二维码（请使用微信扫码）" width="180"> | <img src="assets/donations/alipay.jpg" alt="支付宝打赏二维码（请使用支付宝扫码）" width="180"> |

[查看微信支付二维码](assets/donations/wechat-pay.jpg) · [查看支付宝二维码](assets/donations/alipay.jpg)

## 反馈与参与

遇到问题或有功能建议，欢迎[提交 Issue](https://github.com/saltcoffee/AttachmentAtlas/issues)，附上复现步骤和不含隐私的小样本。敏感问题请按 [SECURITY.md](SECURITY.md) 处理，开发说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © 2026 gua。另见[第三方依赖许可证](THIRD_PARTY_NOTICES.md)。
