import { t, errorText } from './i18n';
import { App, Modal, Notice } from 'obsidian';
import type { DocumentChange, Plan } from '../domain/model';
import {
  documentSegments,
  textChunks,
  validatePatchOutput,
  type PreviewSegment,
} from './plan-preview';
import { captureFocus, restoreFocus } from './focus';
import { checkedByteTotal } from '../domain/operation-limits';

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

export function exactBytes(size: number): string {
  return t('{size} ({bytes} bytes)', { size: bytes(size), bytes: size });
}

export class ConfirmPlanModal extends Modal {
  private pathPage = 0;
  private documentPage = 0;
  private segmentPages = new Map<string, number>();
  private editPages = new Map<string, number>();
  private originalPage = new Map<string, number>();
  private openDocuments = new Set<string>();
  private openOriginal = new Set<string>();
  private consent!: HTMLInputElement;
  private readonly valid: boolean;
  private segments = new Map<string, readonly PreviewSegment[]>();
  private originals = new Map<string, { before: string[]; after: string[] }>();
  private closed = false;
  private confirmed = false;

  constructor(
    app: App,
    private plan: Plan,
    private confirm: () => Promise<void>,
    private onDismiss: (confirmed: boolean) => void = () => undefined,
  ) {
    super(app);
    this.valid = plan.documents.every((document) =>
      validatePatchOutput(document.before, document.after, document.patches),
    );
  }

  onOpen(): void {
    this.closed = false;
    this.confirmed = false;
    this.render();
  }

  onClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.contentEl.empty();
    this.segments.clear();
    this.originals.clear();
    this.onDismiss(this.confirmed);
  }

  private render(): void {
    const checked = this.consent?.checked ?? false,
      focus = captureFocus(this.contentEl),
      el = this.contentEl;
    el.empty();
    el.createEl('h2', {
      text:
        this.plan.kind === 'merge-exact'
          ? t('Review duplicate merge')
          : t('Review unreferenced image recycling'),
    });
    const valid = this.valid;
    if (!valid)
      el.createEl('p', {
        text: t('Preview metadata does not match the planned document changes.'),
        cls: 'atlas-error',
        attr: { role: 'alert' },
      });
    el.createEl('p', {
      text: t(
        'Images will be deleted according to Obsidian’s “Deleted files” setting: system trash, vault trash, or permanent deletion. Permanently deleted images cannot be restored. Updated references are not automatically restored. Pause edits on other devices during cleanup.',
      ),
    });
    if (this.plan.keep[0])
      el.createEl('p', { text: t('Retain: {path}', { path: this.plan.keep[0].path }) });
    const totalBytes = checkedByteTotal(this.plan.retire.map((image) => image.size)),
      editCount = this.plan.documents.reduce((sum, document) => sum + document.edits.length, 0);
    el.createEl('p', {
      text: t(
        '{count} images · {size} active-image reduction · {documents} documents · {edits} rewritten targets',
        {
          count: this.plan.retire.length,
          size: exactBytes(totalBytes),
          documents: this.plan.documents.length,
          edits: editCount,
        },
      ),
    });
    this.renderRetirePaths(el);
    this.renderDocuments(el);
    const label = el.createEl('label', { cls: 'atlas-consent' });
    this.consent = label.createEl('input', { type: 'checkbox' });
    this.consent.dataset.focusKey = 'plan-consent';
    this.consent.checked = checked;
    label.createSpan({
      text: t(
        'I reviewed the file paths and understand that Obsidian’s setting may permanently delete these images.',
      ),
    });
    const actions = el.createDiv({ cls: 'atlas-actions' });
    const cancel = actions.createEl('button', { text: t('Cancel') });
    cancel.dataset.focusKey = 'plan-cancel';
    cancel.onclick = () => this.close();
    const button = actions.createEl('button', {
      text: t('Delete {count} images', { count: this.plan.retire.length }),
      cls: 'mod-warning',
    });
    button.dataset.focusKey = 'plan-confirm';
    button.dataset.focusFallback = 'plan-consent';
    button.disabled = !valid || !checked;
    this.consent.onchange = () => {
      button.disabled = !valid || !this.consent.checked;
    };
    button.onclick = () => {
      if (this.closed || this.confirmed || !this.consent.checked || button.disabled) return;
      this.confirmed = true;
      button.disabled = true;
      this.close();
      void this.confirm().catch((error) => new Notice(errorText(error)));
    };
    restoreFocus(el, focus);
  }

  private renderRetirePaths(el: HTMLElement): void {
    el.createEl('h3', {
      text: t('Images selected for recycling ({count})', { count: this.plan.retire.length }),
    });
    const pageSize = 50,
      start = this.pathPage * pageSize,
      page = this.plan.retire.slice(start, start + pageSize),
      list = el.createEl('ul');
    page.forEach((image) =>
      list.createEl('li', { text: `${image.path} (${exactBytes(image.size)})` }),
    );
    if (this.plan.retire.length > pageSize)
      this.pagination(
        el,
        this.pathPage,
        this.plan.retire.length,
        pageSize,
        (page) => {
          this.pathPage = page;
          this.render();
        },
        `retire-paths`,
      );
  }

  private renderDocuments(el: HTMLElement): void {
    el.createEl('h3', {
      text: t('Reference changes ({count})', { count: this.plan.documents.length }),
    });
    if (!this.plan.documents.length) {
      el.createEl('p', { text: t('No reference documents change in this operation.') });
      return;
    }
    const pageSize = 10,
      start = this.documentPage * pageSize,
      page = this.plan.documents.slice(start, start + pageSize);
    for (const document of page) this.renderDocument(el, document);
    if (this.plan.documents.length > pageSize)
      this.pagination(
        el,
        this.documentPage,
        this.plan.documents.length,
        pageSize,
        (page) => {
          this.documentPage = page;
          this.render();
        },
        `documents`,
      );
  }

  private renderDocument(parent: HTMLElement, document: DocumentChange): void {
    const detail = parent.createEl('details'),
      pathKey = document.path;
    detail.open = this.openDocuments.has(pathKey);
    const summary = detail.createEl('summary', {
      text: t('{path} · {edits} rewritten targets · {patches} source patches', {
        path: document.path,
        edits: document.edits.length,
        patches: document.patches.length,
      }),
    });
    summary.dataset.focusKey = `document:${pathKey}`;
    const content = detail.createDiv({ cls: 'atlas-preview-document' });
    const load = () => {
      if (!detail.open) {
        this.openDocuments.delete(pathKey);
        content.empty();
        delete content.dataset.loaded;
        return;
      }
      this.openDocuments.add(pathKey);
      if (content.dataset.loaded) return;
      content.dataset.loaded = 'true';
      this.renderDocumentContent(content, document);
    };
    detail.ontoggle = load;
    if (detail.open) load();
  }

  private renderDocumentContent(content: HTMLElement, document: DocumentChange): void {
    const pathKey = document.path,
      segments = this.segments.get(pathKey) ?? documentSegments(document);
    this.segments.set(pathKey, segments);
    const edits = content.createDiv();
    edits.createEl('h4', { text: t('Changed reference targets') });
    this.renderEdits(edits, document);
    const diffs = content.createDiv();
    diffs.createEl('h4', { text: t('Changed source context') });
    const segmentPage = this.segmentPages.get(pathKey) ?? 0,
      visibleSegments = segments.slice(segmentPage * 10, segmentPage * 10 + 10);
    visibleSegments.forEach((segment, index) => {
      const section = diffs.createDiv({ cls: 'atlas-preview-segment' });
      section.createEl('p', {
        text: t('Change segment {current} of {total}', {
          current: segmentPage * 10 + index + 1,
          total: segments.length,
        }),
        cls: 'atlas-muted',
      });
      section.createEl('strong', { text: t('Before') });
      section.createEl('pre', { text: segment.before, cls: 'atlas-diff' });
      section.createEl('strong', { text: t('After') });
      section.createEl('pre', { text: segment.after, cls: 'atlas-diff' });
    });
    if (segments.length > 10)
      this.pagination(
        diffs,
        segmentPage,
        segments.length,
        10,
        (page) => {
          this.segmentPages.set(pathKey, page);
          this.render();
        },
        `segments:${pathKey}`,
      );
    this.renderOriginalSource(content, document);
  }

  private renderEdits(parent: HTMLElement, document: DocumentChange): void {
    if (!document.edits.length) {
      parent.createEl('p', { text: t('No reference targets changed.') });
      return;
    }
    const pageSize = 50,
      page = this.editPages.get(document.path) ?? 0,
      start = page * pageSize,
      list = parent.createEl('ul');
    document.edits
      .slice(start, start + pageSize)
      .forEach((edit) =>
        list.createEl('li', { text: `${edit.beforeTarget} → ${edit.afterTarget}` }),
      );
    if (document.edits.length > pageSize)
      this.pagination(
        parent,
        page,
        document.edits.length,
        pageSize,
        (next) => {
          this.editPages.set(document.path, next);
          this.render();
        },
        `edits:${document.path}`,
      );
  }

  private renderOriginalSource(parent: HTMLElement, document: DocumentChange): void {
    const detail = parent.createEl('details');
    detail.open = this.openOriginal.has(document.path);
    const summary = detail.createEl('summary', { text: t('Show complete original source') });
    summary.dataset.focusKey = `original:${document.path}`;
    const body = detail.createDiv();
    const loadOriginal = () => {
      if (!detail.open) {
        this.openOriginal.delete(document.path);
        body.empty();
        delete detail.dataset.loaded;
        return;
      }
      this.openOriginal.add(document.path);
      if (detail.dataset.loaded) return;
      detail.dataset.loaded = 'true';
      this.renderOriginalChunks(body, document);
    };
    detail.ontoggle = loadOriginal;
    if (detail.open) loadOriginal();
  }

  private renderOriginalChunks(parent: HTMLElement, document: DocumentChange): void {
    const original = this.originals.get(document.path) ?? {
      before: textChunks(document.before),
      after: textChunks(document.after),
    };
    this.originals.set(document.path, original);
    const { before, after } = original,
      chunks = Math.max(before.length, after.length),
      pageSize = 10,
      page = this.originalPage.get(document.path) ?? 0;
    parent.createEl('p', {
      text: t('Original source segment {current} of {total}', {
        current: page + 1,
        total: Math.max(1, Math.ceil(chunks / pageSize)),
      }),
      cls: 'atlas-muted',
    });
    const start = page * pageSize;
    for (let index = start; index < Math.min(chunks, start + pageSize); index++) {
      parent.createEl('strong', { text: t('Before') });
      parent.createEl('pre', { text: before[index] ?? '', cls: 'atlas-diff' });
      parent.createEl('strong', { text: t('After') });
      parent.createEl('pre', { text: after[index] ?? '', cls: 'atlas-diff' });
    }
    if (chunks > pageSize)
      this.pagination(
        parent,
        page,
        chunks,
        pageSize,
        (next) => {
          const focus = captureFocus(parent);
          this.originalPage.set(document.path, next);
          parent.empty();
          this.renderOriginalChunks(parent, document);
          restoreFocus(parent, focus);
        },
        `original:${document.path}`,
      );
  }

  private pagination(
    parent: HTMLElement,
    page: number,
    total: number,
    size: number,
    change: (page: number) => void,
    focusKey: string,
  ): void {
    const pages = Math.ceil(total / size),
      controls = parent.createDiv({ cls: 'atlas-actions' }),
      previous = controls.createEl('button', { text: t('Previous') });
    previous.dataset.focusKey = `${focusKey}:previous`;
    previous.dataset.focusFallback = `${focusKey}:next`;
    previous.disabled = page === 0;
    previous.onclick = () => change(page - 1);
    const shown = Math.min(total, (page + 1) * size);
    controls.createSpan({
      text: `${t('Page {page} of {total}', { page: page + 1, total: pages })} · ${t(
        'Showing {shown} of {totalItems}; {remaining} remaining',
        {
          shown,
          totalItems: total,
          remaining: total - shown,
        },
      )}`,
    });
    const next = controls.createEl('button', { text: t('Next') });
    next.dataset.focusKey = `${focusKey}:next`;
    next.dataset.focusFallback = `${focusKey}:previous`;
    next.disabled = page + 1 >= pages;
    next.onclick = () => change(page + 1);
  }
}
