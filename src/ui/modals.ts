import { t, errorText } from './i18n';
import { App, Modal, Notice } from 'obsidian';
import type { Plan } from '../domain/model';
export function bytes(size: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unit = 0,
    value = size;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
}
export class ConfirmPlanModal extends Modal {
  constructor(
    app: App,
    private plan: Plan,
    private confirm: () => Promise<void>,
  ) {
    super(app);
  }
  onOpen(): void {
    const el = this.contentEl;
    el.empty();
    el.createEl('h2', {
      text:
        this.plan.kind === 'merge-exact'
          ? t('Review duplicate merge')
          : t('Review unreferenced image recycling'),
    });
    el.createEl('p', {
      text: t(
        'The listed images will be kept in .attachment-atlas-recovery/. Their original paths are removed only after recovery copies and reference changes are verified. They continue to use recovery storage until restored or permanently cleared. Pause edits on other devices during maintenance.',
      ),
    });
    if (this.plan.keep[0])
      el.createEl('p', { text: t('Retain: {path}', { path: this.plan.keep[0].path }) });
    el.createEl('p', {
      text: t('{count} images · {size} active-image reduction · {documents} documents to update', {
        count: this.plan.retire.length,
        size: bytes(this.plan.retire.reduce((total, image) => total + image.size, 0)),
        documents: this.plan.documents.length,
      }),
    });
    const list = el.createEl('ul');
    this.plan.retire.forEach((image) =>
      list.createEl('li', { text: `${image.path} (${bytes(image.size)})` }),
    );
    for (const doc of this.plan.documents) {
      const detail = el.createEl('details');
      detail.createEl('summary', { text: doc.path });
      detail.createEl('h4', { text: t('Before') });
      detail.createEl('pre', { text: doc.before, cls: 'atlas-diff' });
      detail.createEl('h4', { text: t('After') });
      detail.createEl('pre', { text: doc.after, cls: 'atlas-diff' });
    }
    const label = el.createEl('label', { cls: 'atlas-consent' });
    const consent = label.createEl('input', { type: 'checkbox' });
    label.createSpan({ text: t('I reviewed the exact paths and recovery storage.') });
    const actions = el.createDiv({ cls: 'atlas-actions' });
    const cancel = actions.createEl('button', { text: t('Cancel') });
    cancel.onclick = () => this.close();
    const button = actions.createEl('button', {
      text: t('Recycle {count} images', { count: this.plan.retire.length }),
      cls: 'mod-warning',
    });
    button.disabled = true;
    consent.onchange = () => {
      button.disabled = !consent.checked;
    };
    button.onclick = () => {
      if (!consent.checked || button.disabled) return;
      button.disabled = true;
      this.close();
      void this.confirm().catch((error) => new Notice(errorText(error)));
    };
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
export class RestoreModal extends Modal {
  constructor(
    app: App,
    private plan: Plan,
    private restore: () => Promise<void>,
  ) {
    super(app);
  }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: t('Review recovery') });
    this.contentEl.createEl('p', {
      text: t(
        'Original images are restored before references. Any later document edits or conflicting paths stop recovery without overwriting them.',
      ),
    });
    this.contentEl.createEl('p', {
      text: t(
        'After all images and references are restored and verified, this operation’s recovery copies and history are permanently removed. Conflicts or incomplete restoration keep the recovery data.',
      ),
    });
    const list = this.contentEl.createEl('ul');
    this.plan.retire.forEach((image) =>
      list.createEl('li', { text: t('Restore image: {path}', { path: image.path }) }),
    );
    this.plan.documents.forEach((doc) =>
      list.createEl('li', { text: t('Restore references: {path}', { path: doc.path }) }),
    );
    const cancel = this.contentEl.createEl('button', { text: t('Cancel') });
    cancel.onclick = () => this.close();
    const button = this.contentEl.createEl('button', { text: t('Check conflicts and restore') });
    button.onclick = () => {
      this.close();
      void this.restore().catch((error) => new Notice(errorText(error)));
    };
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
