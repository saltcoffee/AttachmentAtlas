import { t, problem } from './i18n';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import type AttachmentAtlas from '../main';
import type { SelectionRequest } from '../application/plan';
import { OrganizerResults } from './organizer-results';
import type { Snapshot } from '../domain/model';
import { bytes } from './modals';
import { captureFocus, restoreFocus } from './focus';
import { renderOrganizerFilters, type FilterDrafts } from './organizer-filters';
import {
  createOrganizerViewState,
  EMPTY_QUERY,
  parseSizeQuery,
  type ImageQuery,
  type OrganizerViewState,
} from './organizer-state';

export const VIEW_TYPE = 'attachment-atlas-organizer';

export class OrganizerView extends ItemView {
  private static nextViewId = 1;
  private readonly viewId = OrganizerView.nextViewId++;
  private state: OrganizerViewState = createOrganizerViewState();
  private drafts: FilterDrafts = {
    path: '',
    format: 'all',
    min: '',
    max: '',
    references: 'all',
    protection: 'all',
  };
  private queryValid = true;
  private sizeError = '';
  private unsubscribe: (() => void) | null = null;
  private lastScanId = 0;
  private results!: OrganizerResults;
  private previewControls: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: AttachmentAtlas,
  ) {
    super(leaf);
    this.results = new OrganizerResults(
      plugin,
      this.state,
      this.viewId,
      () => this.queryValid,
      (request) => this.requestPreview(request),
    );
  }
  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return 'Attachment Atlas';
  }
  getIcon(): string {
    return 'images';
  }
  async onOpen(): Promise<void> {
    this.lastScanId = this.plugin.selection.state.scanId;
    this.unsubscribe = this.plugin.selection.subscribe((selection) => {
      if (selection.scanId !== this.lastScanId) {
        this.lastScanId = selection.scanId;
        this.state.pageByTab = { duplicates: 0, unreferenced: 0, large: 0, blocked: 0 };
        this.state.memberPages = {};
        this.state.memberModes = {};
        this.state.duplicateMode = 'matching';
        this.state.unreferencedMode = 'matching';
        this.results.resetForScan();
        this.render();
        return;
      }
      this.updateSelection();
    });
    this.render();
  }
  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.plugin.previewViewClosed(this);
    this.contentEl.empty();
  }

  render(): void {
    const el = this.contentEl,
      focus = captureFocus(el);
    el.empty();
    el.addClass('atlas-view');
    el.createEl('h2', { text: t('Attachment Atlas') });
    const controls = el.createDiv({ cls: 'atlas-actions' });
    const scan = controls.createEl('button', {
      text: this.plugin.snapshot ? t('Scan again') : t('Scan vault'),
      cls: 'mod-cta',
    });
    scan.disabled = this.plugin.busy;
    scan.dataset.focusKey = 'scan';
    scan.dataset.focusFallback = 'stop-task';
    scan.onclick = () => void this.plugin.scanVault();
    if (this.plugin.busy) {
      const cancel = controls.createEl('button', { text: t('Stop task') });
      cancel.dataset.focusKey = 'stop-task';
      cancel.dataset.focusFallback = 'scan';
      cancel.onclick = () => this.plugin.cancel();
    }
    this.previewControls = controls.createDiv({ cls: 'atlas-actions' });
    this.renderPreviewFeedback();
    const status = el.createEl('p', {
      text: t(this.plugin.status),
      cls: 'atlas-status',
      attr: { role: 'status', 'aria-live': 'polite' },
    });
    if (this.plugin.lastError) {
      const error = el.createDiv({ cls: 'atlas-error', attr: { role: 'alert' } });
      error.createEl('p', { text: problem(this.plugin.lastError) });
      const retry = error.createEl('button', { text: t('Retry scan') });
      retry.dataset.focusKey = 'retry-scan';
      retry.dataset.focusFallback = 'stop-task';
      retry.disabled = this.plugin.busy;
      retry.onclick = () => void this.plugin.scanVault();
    }
    this.renderTabs(el);
    const snapshot = this.plugin.snapshot;
    if (!snapshot) {
      el.createEl('p', {
        text: t(
          'Scan to inspect local images and their references. No notes or attachments change during scanning.',
        ),
      });
      restoreFocus(el, focus);
      return;
    }
    status.setText(
      t('{status} · {count} images · {size} · Scope: {scope}', {
        status: t(this.plugin.status),
        count: snapshot.media.length,
        size: bytes(snapshot.media.reduce((sum, image) => sum + image.size, 0)),
        scope: snapshot.settings.scope || t('whole vault'),
      }),
    );
    this.renderCoverage(el, snapshot);
    renderOrganizerFilters(
      el,
      this.drafts,
      this.state.sort,
      this.sizeError,
      (key, value, redraw) => {
        this.drafts[key] = value;
        this.commitDrafts();
        if (redraw) this.render();
        else this.renderResultsOnly();
      },
      (key, value) => {
        if (key === 'key') this.state.sort.key = value as OrganizerViewState['sort']['key'];
        else this.state.sort.direction = value as 'asc' | 'desc';
        this.resetPages();
        this.render();
      },
      () => {
        this.drafts = {
          path: '',
          format: 'all',
          min: '',
          max: '',
          references: 'all',
          protection: 'all',
        };
        this.state.query = { ...EMPTY_QUERY };
        this.state.sort = { key: 'size', direction: 'desc' };
        this.queryValid = true;
        this.sizeError = '';
        this.resetPages();
        this.render();
      },
    );
    const results = el.createDiv();
    results.dataset.role = 'results';
    this.results.render(results, snapshot);
    restoreFocus(el, focus);
  }

  private renderPreviewFeedback(): void {
    const parent = this.previewControls;
    if (!parent) return;
    parent.empty();
    if (this.plugin.previewing) {
      parent.createSpan({
        text: t('Building preview. You can keep reviewing your selection.'),
        attr: { role: 'status' },
      });
      const cancel = parent.createEl('button', { text: t('Cancel preview construction') });
      cancel.dataset.focusKey = 'cancel-preview-build';
      cancel.onclick = () => this.plugin.cancelPreview();
    }
    if (this.plugin.previewError) {
      parent.createEl('p', {
        text: problem(this.plugin.previewError),
        cls: 'atlas-error',
        attr: { role: 'alert' },
      });
      if (this.plugin.canRetryPreview(this)) {
        const retry = parent.createEl('button', { text: t('Retry preview') });
        retry.dataset.focusKey = 'retry-preview';
        retry.disabled = !this.queryValid || this.plugin.busy;
        retry.onclick = () => this.plugin.retryPreview(this);
      }
    }
  }

  private updateSelection(): void {
    const snapshot = this.plugin.snapshot;
    if (!snapshot) {
      this.render();
      return;
    }
    const el = this.contentEl,
      focus = captureFocus(el),
      top = el.scrollTop,
      left = el.scrollLeft;
    if (!this.results.updateSelection(snapshot)) {
      this.render();
      return;
    }
    this.renderPreviewFeedback();
    restoreFocus(el, focus);
    el.scrollTop = top;
    el.scrollLeft = left;
  }

  private renderTabs(parent: HTMLElement): void {
    const nav = parent.createDiv({ cls: 'atlas-tabs' }),
      blockerLabel = this.plugin.snapshot?.blockers.length
        ? 'Potentially unreferenced'
        : 'Unreferenced';
    for (const [key, label] of [
      ['duplicates', 'Exact duplicates'],
      ['unreferenced', blockerLabel],
      ['large', 'Large images'],
      ['blocked', 'Needs review'],
    ] as const) {
      const button = nav.createEl('button', {
        text: t(label),
        attr: { 'aria-pressed': String(this.state.tab === key) },
      });
      button.dataset.focusKey = `tab:${key}`;
      button.onclick = () => {
        this.state.tab = key;
        this.render();
      };
    }
  }

  private renderCoverage(parent: HTMLElement, snapshot: Snapshot): void {
    parent.createEl('p', {
      text: snapshot.blockers.length
        ? t(
            'Incomplete reference coverage: {count} blockers. Merging and recycling are disabled.',
            { count: snapshot.blockers.length },
          )
        : t(
            'Supported reference sources scanned. External apps and hidden configuration are outside coverage.',
          ),
      cls: snapshot.blockers.length ? 'atlas-error' : 'atlas-muted',
      attr: { role: snapshot.blockers.length ? 'alert' : 'status' },
    });
    if (snapshot.blockers.length && this.state.tab !== 'blocked') {
      const review = parent.createEl('button', { text: t('View blocking issues') });
      review.dataset.focusKey = 'view-blocking-issues';
      review.dataset.focusFallback = 'tab:blocked';
      review.onclick = () => {
        this.state.tab = 'blocked';
        this.render();
      };
    }
  }

  private commitDrafts(): void {
    const sizes = parseSizeQuery(this.drafts.min, this.drafts.max);
    if (!sizes.valid) {
      this.queryValid = false;
      this.sizeError =
        sizes.reason === 'range'
          ? 'Minimum size must not exceed maximum size.'
          : 'Enter non-negative whole KiB values.';
      this.plugin.previewQueryChanged(this);
      return;
    }
    this.queryValid = true;
    this.sizeError = '';
    const next: ImageQuery = {
      path: this.drafts.path.trim(),
      format: this.drafts.format as ImageQuery['format'],
      references: this.drafts.references as ImageQuery['references'],
      protection: this.drafts.protection as ImageQuery['protection'],
      ...sizes,
    };
    if (JSON.stringify(next) !== JSON.stringify(this.state.query)) this.resetPages();
    this.state.query = next;
  }

  private renderResultsOnly(): void {
    const root = this.contentEl.querySelector<HTMLElement>('[data-role="results"]');
    if (root && this.plugin.snapshot) this.results.render(root, this.plugin.snapshot);
    let error = this.contentEl.querySelector<HTMLElement>('.atlas-filters [role="alert"]');
    if (this.sizeError) {
      if (error) error.setText(t(this.sizeError));
      else {
        const filters = this.contentEl.querySelector('.atlas-filters');
        if (filters)
          error = filters.createEl('p', {
            text: t(this.sizeError),
            cls: 'atlas-error',
            attr: { role: 'alert', id: `atlas-size-error-${this.viewId}`, 'aria-live': 'polite' },
          });
      }
    } else error?.remove();
    for (const key of ['min', 'max']) {
      const field = Array.from(
        this.contentEl.querySelectorAll<HTMLInputElement>('[data-focus-key]'),
      ).find((input) => input.dataset.focusKey === key);
      if (this.sizeError && error && field) {
        if (!error.id) error.id = `atlas-size-error-${this.viewId}`;
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', error.id);
      } else {
        field?.removeAttribute('aria-invalid');
        field?.removeAttribute('aria-describedby');
      }
    }
  }

  private requestPreview(selection: SelectionRequest): void {
    const state = this.plugin.selection.state;
    void this.plugin.preview(
      this,
      {
        scanId: state.scanId,
        selectionRevision: state.selectionRevision,
        selection,
      },
      this.queryValid,
    );
  }

  focusPreview(selection: SelectionRequest): void {
    const key =
      selection.kind === 'merge-exact'
        ? `preview:merge:${selection.groupKey}`
        : 'preview:unreferenced';
    restoreFocus(this.contentEl, { keys: [key, 'scan'] });
  }

  canPreview(): boolean {
    return this.queryValid;
  }

  private resetPages(): void {
    this.state.pageByTab = { duplicates: 0, unreferenced: 0, large: 0, blocked: 0 };
    this.state.memberPages = {};
  }
}
