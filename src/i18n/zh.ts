import { diagnostics } from './zh-diagnostics';
/** English templates are the canonical fallback; Chinese covers every plugin-owned message. */
export const zh = {
  ...diagnostics,
  'Operation failed: {detail}': '操作失败：{detail}',
  'Attachment Atlas': 'Attachment Atlas',
  'Open Attachment Atlas': '打开 Attachment Atlas',
  'Open image organizer': '打开图片管理器',
  'Open operation history': '打开操作历史',
  'Scan current attachment folder': '扫描当前附件文件夹',
  'Scan vault images': '扫描库内图片',
  'Attachment Atlas reset invalid settings. Review your image scope and protected paths.':
    'Attachment Atlas 已重置无效设置，请检查图片扫描范围和受保护路径。',
  'Ready to scan. All processing stays inside this vault.': '准备就绪，所有处理均在当前库内完成。',
  'Vault changed. Scan again before planning changes.': '库内容已变化，请重新扫描后再预览操作。',
  'Stopped. Review the error and operation history.': '操作已停止，请查看错误信息和操作历史。',
  'Scan complete.': '扫描完成。',
  'Completed. Recycled images are retained in .attachment-atlas-recovery/ until restored or permanently cleared.':
    '操作完成。回收的图片保存在 .attachment-atlas-recovery/，直到恢复或永久清空。',
  'Restoring images and references…': '正在恢复图片和引用…',
  'Images and references restored. Recovery data cleanup did not finish; review History to continue.':
    '图片和引用已恢复，恢复数据尚未清理完成，请在操作历史中继续。',
  'Recovery completed. The restored operation’s recovery data has been removed.':
    '恢复完成，该操作的恢复数据已移除。',
  'Attachment Atlas has unfinished recovery or cleanup records. Review History before new write operations.':
    'Attachment Atlas 有未完成的恢复或清理记录，请先查看操作历史，再进行新的写入操作。',
  'Recovery cleanup preview ready.': '恢复数据清理预览已就绪。',
  'Permanently cleared {count} records from .attachment-atlas-recovery/ ({bytes} bytes).':
    '已从 .attachment-atlas-recovery/ 永久清除 {count} 条记录（{bytes} 字节）。',
  'Checking {current}/{total}: {path}': '正在检查 {current}/{total}：{path}',
  'Fingerprinting image {current}: {path}': '正在计算第 {current} 张图片的指纹：{path}',
  'Updating references: {path}': '正在更新引用：{path}',
  'References updated: {path}': '引用已更新：{path}',
  'Keeping image in recovery storage: {path}': '正在将图片保存在恢复区：{path}',
  'Image recycled: {path}': '图片已回收：{path}',
  'Checking recovery record {current}/{total}': '正在检查恢复记录 {current}/{total}',
  'Deleting recovery file: {path}': '正在删除恢复文件：{path}',
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
  Unreferenced: '未引用',
  'Potentially unreferenced': '疑似未引用',
  'Large images': '大图片',
  'Needs review': '待检查',
  History: '操作历史',
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
  'Resolve unfinished recovery operations in History before merging or recycling.':
    '请先在“操作历史”中处理未完成的恢复操作，再合并或回收。',
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
  Unsupported: '不支持',
  '{format}{dimensions} · {size} · {count} references':
    '{format}{dimensions} · {size} · {count} 处引用',
  'Reference locations': '引用位置',
  Previous: '上一页',
  Next: '下一页',
  'Page {page} of {total}': '第 {page} 页，共 {total} 页',
  'Review duplicate merge': '确认重复图片合并',
  'Review unreferenced image recycling': '确认未引用图片回收',
  'The listed images will be kept in .attachment-atlas-recovery/. Their original paths are removed only after recovery copies and reference changes are verified. They continue to use recovery storage until restored or permanently cleared. Pause edits on other devices during maintenance.':
    '以下图片将保存在 .attachment-atlas-recovery/。只有恢复副本和引用修改校验通过后，才会移除原路径。恢复或永久清空前，图片仍占用恢复区空间。维护期间请暂停其他设备的编辑。',
  'Retain: {path}': '保留：{path}',
  '{count} images · {size} active-image reduction · {documents} documents to update':
    '{count} 张图片 · 活动图片减少 {size} · 需更新 {documents} 份文档',
  Before: '修改前',
  After: '修改后',
  'I reviewed the exact paths and recovery storage.': '我已核对具体路径和恢复区占用情况。',
  Cancel: '取消',
  'Recycle {count} images': '回收 {count} 张图片',
  'Review recovery': '确认恢复',
  'Original images are restored before references. Any later document edits or conflicting paths stop recovery without overwriting them.':
    '将先恢复原图，再恢复引用。如有后续文档编辑或路径冲突，恢复会停止并保留现有内容。',
  'After all images and references are restored and verified, this operation’s recovery copies and history are permanently removed. Conflicts or incomplete restoration keep the recovery data.':
    '所有图片和引用恢复并校验通过后，该操作的恢复副本和历史记录会被永久移除。如有冲突或未完成恢复，恢复数据会继续保留。',
  'Restore image: {path}': '恢复图片：{path}',
  'Restore references: {path}': '恢复引用：{path}',
  'Check conflicts and restore': '检查冲突并恢复',
  'Permanently delete recovery data': '永久删除恢复数据',
  'This deletes recovery images, note snapshots, and operation history for the selected records. You will no longer be able to restore them through Attachment Atlas.':
    '将删除所选记录中的图片恢复副本、笔记快照和操作历史，之后无法通过 Attachment Atlas 恢复这些操作。',
  'This clears only the listed contents of .attachment-atlas-recovery/. Current notes and attachments are not included. Unrestored records are never deleted on a timer.':
    '仅清理 .attachment-atlas-recovery/ 中列出的内容，不包含当前笔记和附件。尚未恢复的记录不会按时间自动删除。',
  'Check the operation results and pause edits on other devices before continuing. Export recovery materials first if you want to keep a separate backup.':
    '继续前请检查操作结果，并暂停其他设备的编辑。如需保留独立备份，请先导出恢复材料。',
  '{count} records · {size} to release': '{count} 条记录 · 预计释放 {size}',
  ' · continue interrupted cleanup': ' · 继续中断的清理',
  'Remove the empty operation folder after its listed files: {path}/':
    '列出的文件删除完成后，将移除空操作目录：{path}/',
  '{path} (cleanup state, removed last)': '{path}（清理状态标记，最后移除）',
  'If stopped or interrupted, remaining cleanup stays in History for you to review and continue. Deleted files cannot be recovered by cancelling.':
    '如停止或中断，剩余清理任务会保留在操作历史中，供你检查并继续。取消操作无法恢复已删除的文件。',
  'I understand this permanently removes recovery data for the listed records.':
    '我理解这会永久移除所列记录的恢复数据。',
  'Permanently delete {count} recovery records': '永久删除 {count} 条恢复记录',
  'Recovery storage: {size}': '恢复区占用：{size}',
  ' + {count} unverified records': '，另有 {count} 条未验证的记录',
  'Recycled images are held in .attachment-atlas-recovery/. Restore an operation or permanently clear its recovery data here. Successful restoration removes that operation’s data automatically. Unfinished and damaged records are protected.':
    '回收的图片保存在 .attachment-atlas-recovery/。你可以在此恢复操作或永久清理恢复数据。恢复成功后，该操作的数据会自动移除；未完成和损坏的记录受到保护。',
  'No local operation history or recovery data.': '暂无本地操作历史或恢复数据。',
  'Select eligible (up to 100)': '选择可清理记录（最多 100 条）',
  'Select older than 30 days': '选择超过 30 天的记录',
  'Clear selection': '取消选择',
  'Preview recovery cleanup': '预览恢复数据清理',
  'Empty recovery area': '清空恢复区',
  'Resolve protected records before emptying the entire recovery area. Eligible records can still be cleared individually.':
    '清空整个恢复区前，请先处理受保护的记录。符合条件的记录仍可单独清理。',
  'Clear records in batches of up to 100 before emptying the recovery area.':
    '请先按每批最多 100 条清理记录，再清空恢复区。',
  '{count} selected · {size} to release': '已选 {count} 条 · 预计释放 {size}',
  'Preview recovery cleanup ({count})': '预览恢复数据清理（{count}）',
  'Select recovery data for {id}': '选择操作 {id} 的恢复数据',
  unknown: '未知',
  'Cleanup unavailable: resolve unfinished work or damaged recovery data first.':
    '暂不能清理，请先处理未完成的操作或损坏的恢复数据。',
  'Copy recovery folder path': '复制恢复目录路径',
  'Also preserve the matching .cleanup marker in the recovery root. Removed files cannot be exported.':
    '还需保留恢复区根目录中对应的 .cleanup 标记。已移除的文件无法导出。',
  'Copy the complete folder to export its recovery materials.':
    '复制整个文件夹即可导出该操作的恢复材料。',
  'Could not access clipboard. Copy the displayed path manually.':
    '无法访问剪贴板，请手动复制显示的路径。',
  'Preview recovery': '预览恢复',
  'Continue cleanup': '继续清理',
  'Clean recovery data': '清理恢复数据',
  'Older than 30 days. Data remains retained until you confirm cleanup.':
    '记录已超过 30 天，确认清理前数据会继续保留。',
  'Previous records': '上一页记录',
  'Next records': '下一页记录',
  'Exact duplicate merge': '完全重复图片合并',
  'Unreferenced image recycling': '未引用图片回收',
  'Unknown operation': '未知操作',
  'Preparing recovery data': '正在准备恢复数据',
  'Recovery data prepared': '恢复数据已就绪',
  Completed: '已完成',
  Restored: '已恢复',
  'Rolled back': '已回滚',
  'Recovery required': '需要恢复',
  'Cleanup pending': '清理未完成',
  'Unknown state: {state}': '未知状态：{state}',
} as const;
