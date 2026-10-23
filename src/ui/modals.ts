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
        'The listed images will be moved to the system trash. If system trash is unavailable, Obsidian uses the vault’s .trash/ folder. Updated references are not automatically restored. Pause edits on other devices during cleanup.',
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
    label.createSpan({
      text: t('I reviewed the file paths and understand how deleted images can be restored.'),
    });
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
