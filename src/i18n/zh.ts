import { diagnostics } from './zh-diagnostics';
/** English templates are the canonical fallback; Chinese covers every plugin-owned message. */
export const zh = {
  ...diagnostics,
  'Attachment Atlas': 'Attachment Atlas',
  'Open Attachment Atlas': '打开 Attachment Atlas',
  'Open image organizer': '打开图片管理器',
  'Scan current attachment folder': '扫描当前附件文件夹',
  'Scan vault images': '扫描库内图片',
  'Attachment Atlas reset invalid settings. Review your image scope and protected paths.':
    'Attachment Atlas 已重置无效设置，请检查图片扫描范围和受保护路径。',
  'Ready to scan. All processing stays inside this vault.': '准备就绪，所有处理均在当前库内完成。',
  'Vault changed. Scan again before planning changes.': '库内容已变化，请重新扫描后再预览操作。',
  'Scan complete.': '扫描完成。',
  'Checking {current}/{total}: {path}': '正在检查 {current}/{total}：{path}',
  'Fingerprinting image {current}: {path}': '正在计算第 {current} 张图片的指纹：{path}',
  'Updating references: {path}': '正在更新引用：{path}',
  'Paths are vault-relative, without a leading slash. Reference checks always cover the whole vault. Images can be recycled immediately after reference checks and confirmation.':
    '路径相对于当前库填写，不要以斜杠开头。引用检查始终覆盖全库。图片通过引用检查并经确认后即可回收，无需等待。',
  'Image scope': '图片扫描范围',
  'Leave empty to inspect all supported images.': '留空则检查所有支持的图片。',
  'Preferred retained folder': '优先保留文件夹',
  'Used to recommend a retained duplicate.': '用于推荐重复图片组中优先保留的图片。',
  'Protected paths': '受保护路径',
  'One file or folder per line. These images cannot be recycled.':
    '每行填写一个文件或文件夹，这些路径下的图片不能回收。',
  'Save settings': '保存设置',
  'Attachment Atlas settings saved.': 'Attachment Atlas 设置已保存。',
  'Scan again': '重新扫描',
  'Scan vault': '扫描当前库',
  'Stop task': '停止任务',
  'Retry scan': '重试扫描',
  'Exact duplicates': '完全重复',
  'Potentially unreferenced': '疑似未引用',
  'Large images': '大图片',
  'Needs review': '待检查',
  'Scan to inspect local images and their references. No notes or attachments change during scanning.':
    '扫描以查看库内图片及其引用。扫描过程不会修改笔记或附件。',
  '{status} · {count} images · {size} · Scope: {scope}':
    '{status} · {count} 张图片 · {size} · 范围：{scope}',
  'whole vault': '全库',
  'Incomplete reference coverage: {count} blockers. Merging and recycling are disabled.':
    '引用检查不完整，有 {count} 项阻塞问题，暂不能合并或回收。',
  'View blocking issues': '查看阻塞问题',
  'Open Needs review and resolve the blocking issues, then scan again.':
    '请在“待检查”中处理阻塞问题，然后重新扫描。',
  'No duplicate copies can be recycled with this retained image. Check the image restrictions or choose another retained image.':
    '当前保留方案下没有可回收的重复副本，请查看图片的限制说明，或选择其他保留图片。',
  'Select images to preview recycling.': '请选择图片以预览回收。',
  'No references detected yet; reference coverage is incomplete.':
    '暂未检测到引用，但引用检查尚不完整。',
  'Supported reference sources scanned. External apps and hidden configuration are outside coverage.':
    '已扫描所有支持的引用来源，外部应用和隐藏配置不在检查范围内。',
  'Filter by path': '按路径筛选',
  'Filter images by path': '按路径筛选图片',
  'No exact duplicate groups found in this scan.': '本次扫描未发现内容完全相同的图片组。',
  'Retain image: ': '保留图片：',
  'Showing 25 of {count} identical images. Each confirmed operation recycles at most 100 eligible images; rescan to continue.':
    '正在显示 {count} 张相同图片中的 25 张。每次确认最多回收 100 张符合条件的图片，完成后可重新扫描以继续。',
  'Preview merge': '预览合并',
  'Preview merge ({count})': '预览合并（{count}）',
  'Preview recycling ({count})': '预览回收（{count}）',
  'No images match this category and filter.': '此分类和筛选条件下没有图片。',
  'Select {path}': '选择 {path}',
  ' Select for recycling': ' 选择以回收',
  '{format}{dimensions} · {size} · {count} references':
    '{format}{dimensions} · {size} · {count} 处引用',
  'Reference locations': '引用位置',
  'Page {page} of {total}': '第 {page} 页，共 {total} 页',
  'Review duplicate merge': '确认重复图片合并',
  'Review unreferenced image recycling': '确认未引用图片回收',
  'Retain: {path}': '保留：{path}',
  '{count} images · {size} active-image reduction · {documents} documents to update':
    '{count} 张图片 · 活动图片减少 {size} · 需更新 {documents} 份文档',
  'Recycle {count} images': '回收 {count} 张图片',
  'Stopped. Review the error and scan again.': '任务已停止，请查看错误并重新扫描。',
  'Completed. Restore images from the system trash or the vault’s .trash/ folder.':
    '清理完成，需要时可从系统废纸篓或知识库的 .trash/ 文件夹找回图片。',
  'Cleanup stopped. Applied changes are kept. Scan again before continuing.':
    '清理已停止，已完成的改动会保留。请重新扫描后继续。',
  'Recycling image: {path}': '正在回收图片：{path}',
  'The listed images will be moved to the system trash. If system trash is unavailable, Obsidian uses the vault’s .trash/ folder. Updated references are not automatically restored. Pause edits on other devices during cleanup.':
    '这些图片将移入系统废纸篓；系统废纸篓不可用时，Obsidian 会使用知识库的 .trash/ 文件夹。已更新的引用不会自动还原。清理期间请暂停其他设备上的编辑。',
  'I reviewed the file paths and understand how deleted images can be restored.':
    '我已核对文件路径，并了解如何从回收站找回图片。',
  'Operation failed: {detail}': '操作失败：{detail}',
  Unreferenced: '未引用',
  Unsupported: '不支持',
  Previous: '上一页',
  Next: '下一页',
  Before: '修改前',
  After: '修改后',
  Cancel: '取消',
} as const;
