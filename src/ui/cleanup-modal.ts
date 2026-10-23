import { t, errorText, formatDate, operationName } from './i18n';
import { App, Modal, Notice } from 'obsidian';
import { cleanupMarkerPath, recoveryDirectory, type CleanupPreview } from '../domain/recovery';
import { bytes } from './modals';

interface CleanupDialogRecord {
  id: string;
  createdAt: number;
  kind: string;
  resuming: boolean;
  folder: string;
  marker: string;
  size: number;
  paths: { path: string; size: number }[];
}
export interface CleanupDialogData {
  records: CleanupDialogRecord[];
  totalBytes: number;
}

/** Project verified domain data into a view model; hashes and storage DTOs never reach the dialog. */
export function cleanupDialogData(preview: CleanupPreview): CleanupDialogData {
  return {
    totalBytes: preview.totalBytes,
    records: preview.selections.map((selection) => ({
      id: selection.record.id,
      createdAt: selection.record.createdAt,
      kind: selection.record.kind,
      resuming: selection.resuming,
      folder: recoveryDirectory(selection.record.id),
      marker: cleanupMarkerPath(selection.record.id),
      size: selection.remainingFiles.reduce(
        (sum, file) => sum + file.size,
        selection.markerSize ?? 0,
      ),
      paths: selection.remainingFiles.map((file) => ({ path: file.path, size: file.size })),
    })),
  };
}

export class CleanupModal extends Modal {
  constructor(
    app: App,
    private data: CleanupDialogData,
    private confirm: () => Promise<void>,
  ) {
    super(app);
  }
  onOpen(): void {
    const el = this.contentEl;
    el.empty();
    el.createEl('h2', { text: t('Permanently delete recovery data') });
    el.createEl('p', {
      text: t(
        'This deletes recovery images, note snapshots, and operation history for the selected records. You will no longer be able to restore them through Attachment Atlas.',
      ),
      cls: 'atlas-error',
    });
    el.createEl('p', {
      text: t(
        'This clears only the listed contents of .attachment-atlas-recovery/. Current notes and attachments are not included. Unrestored records are never deleted on a timer.',
      ),
    });
    el.createEl('p', {
      text: t(
        'Check the operation results and pause edits on other devices before continuing. Export recovery materials first if you want to keep a separate backup.',
      ),
    });
    el.createEl('p', {
      text: t('{count} records · {size} to release', {
        count: this.data.records.length,
        size: bytes(this.data.totalBytes),
      }),
    });
    for (const record of this.data.records) {
      const detail = el.createEl('details');
      detail.createEl('summary', {
        text: `${formatDate(record.createdAt)} · ${operationName(record.kind)} · ${bytes(record.size)}${record.resuming ? t(' · continue interrupted cleanup') : ''}`,
      });
      let populated = false;
      detail.ontoggle = () => {
        if (!detail.open || populated) return;
        populated = true;
        detail.createEl('p', {
          text: t('Remove the empty operation folder after its listed files: {path}/', {
            path: record.folder,
          }),
        });
        const list = detail.createEl('ul', { cls: 'atlas-cleanup-files' });
        record.paths.forEach((file) =>
          list.createEl('li', { text: `${file.path} (${bytes(file.size)})` }),
        );
        list.createEl('li', {
          text: t('{path} (cleanup state, removed last)', { path: record.marker }),
        });
      };
    }
    el.createEl('p', {
      text: t(
        'If stopped or interrupted, remaining cleanup stays in History for you to review and continue. Deleted files cannot be recovered by cancelling.',
      ),
    });
    const label = el.createEl('label', { cls: 'atlas-consent' });
    const consent = label.createEl('input', { type: 'checkbox' });
    label.createSpan({
      text: t('I understand this permanently removes recovery data for the listed records.'),
    });
    const actions = el.createDiv({ cls: 'atlas-actions' });
    const cancel = actions.createEl('button', { text: t('Cancel') });
    cancel.onclick = () => this.close();
    const remove = actions.createEl('button', {
      text: t('Permanently delete {count} recovery records', { count: this.data.records.length }),
      cls: 'mod-warning',
    });
    remove.disabled = true;
    consent.onchange = () => {
      remove.disabled = !consent.checked;
    };
    remove.onclick = () => {
      if (!consent.checked || remove.disabled) return;
      remove.disabled = true;
      this.close();
      void this.confirm().catch((error) => new Notice(errorText(error)));
    };
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
