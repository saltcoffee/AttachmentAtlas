import { t, problem } from './i18n';
import type AttachmentAtlas from '../main';
import type { SelectionRequest } from '../application/plan';
import type { Media, Snapshot } from '../domain/model';
import type { Text } from '../domain/messages';
import { bytes } from './modals';
import type { OrganizerViewState } from './organizer-state';
import { OrganizerDuplicateResults } from './organizer-duplicate-results';
import { OrganizerImageResults } from './organizer-image-results';
import type { OrganizerResultContext } from './organizer-result-context';
import { captureFocus, restoreFocus } from './focus';
import { clampPage } from './organizer-state';

const REFERENCE_PAGE_SIZE = 50;

export class OrganizerResults {
  private expandedGroups = new Set<string>();
  private referencePages = new Map<string, number>();
  private parent: HTMLElement | null = null;
  private snapshot: Snapshot | null = null;
  private duplicateResults!: OrganizerDuplicateResults;
  private imageResults!: OrganizerImageResults;

  constructor(
    private plugin: AttachmentAtlas,
    private state: OrganizerViewState,
    viewId: number,
    queryValid: () => boolean,
    onPreview: (selection: SelectionRequest) => void,
  ) {
    const context: OrganizerResultContext = {
      plugin,
      state,
      viewId,
      queryValid,
      onPreview,
      expandedGroups: this.expandedGroups,
      imageDetails: (parent, image) => this.imageDetails(parent, image),
      writeBlocker: (snapshot) => this.writeBlocker(snapshot),
      reasons: (parent, reasons) => this.reasons(parent, reasons),
      pagination: (parent, total, size, page, setPage, focusKey) =>
        this.pagination(parent, total, size, page, setPage, focusKey),
      rerender: () => this.rerender(),
    };
    this.duplicateResults = new OrganizerDuplicateResults(context);
    this.imageResults = new OrganizerImageResults(context);
  }

  resetForScan(): void {
    this.expandedGroups.clear();
    this.referencePages.clear();
    this.parent = null;
    this.snapshot = null;
  }

  render(parent: HTMLElement, snapshot: Snapshot): void {
    const focus = captureFocus(parent);
    this.parent = parent;
    this.snapshot = snapshot;
    parent.empty();
    if (this.state.tab === 'duplicates')
      parent.dataset.focusFallback = `groups:${this.state.duplicateMode}`;
    else if (this.state.tab === 'unreferenced')
      parent.dataset.focusFallback = 'unreferenced:selected';
    else delete parent.dataset.focusFallback;
    if (this.state.tab === 'duplicates') this.duplicateResults.render(parent, snapshot);
    else this.imageResults.render(parent, snapshot);
    restoreFocus(parent, focus);
  }

  private rerender(): void {
    if (this.parent && this.snapshot) this.render(this.parent, this.snapshot);
  }

  updateSelection(snapshot: Snapshot): boolean {
    if (!this.parent || snapshot !== this.snapshot) return false;
    const focus = captureFocus(this.parent);
    if (this.state.tab === 'duplicates') this.duplicateResults.updateSelection(snapshot);
    else if (this.state.tab === 'unreferenced') this.imageResults.updateSelection(snapshot);
    restoreFocus(this.parent, focus);
    return true;
  }

  private imageDetails(parent: HTMLElement, image: Media): void {
    const row = parent.createDiv({ cls: 'atlas-image' });
    if (image.digest) {
      const img = row.createEl('img', {
        attr: {
          src: this.plugin.app.vault.adapter.getResourcePath(image.path),
          alt: image.path,
          loading: 'lazy',
        },
      });
      img.onerror = () => {
        img.remove();
        row.createEl('span', {
          text: t('Preview unavailable: {path}', { path: image.path }),
          cls: 'atlas-muted',
          attr: { role: 'status' },
        });
      };
    }
    const description = row.createDiv();
    description.createEl('strong', { text: image.path });
    description.createEl('p', {
      text: t('{format}{dimensions} · {size} · {count} references', {
        format: image.format === 'Unsupported' ? t('Unsupported') : image.format,
        dimensions: image.width && image.height ? ` · ${image.width}×${image.height}` : '',
        size: bytes(image.size),
        count: image.references.length,
      }),
      cls: 'atlas-muted',
    });
    const open = description.createEl('button', { text: t('View image') });
    open.dataset.focusKey = `open:${image.path}`;
    open.onclick = () => void this.plugin.app.workspace.openLinkText(image.path, '', false);
    image.reasons.forEach((reason) =>
      description.createEl('p', { text: problem(reason), cls: 'atlas-muted' }),
    );
    if (!image.references.length && this.plugin.snapshot?.blockers.length)
      description.createEl('p', {
        text: t('No references detected yet; reference coverage is incomplete.'),
        cls: 'atlas-muted',
      });
    if (image.references.length) this.renderReferences(description, image);
  }

  private renderReferences(parent: HTMLElement, image: Media): void {
    const details = parent.createEl('details');
    const summary = details.createEl('summary', {
      text: t('Reference locations ({count})', { count: image.references.length }),
    });
    summary.dataset.focusKey = `references:${image.path}`;
    const body = details.createDiv();
    body.dataset.focusFallback = summary.dataset.focusKey;
    details.ontoggle = () => {
      if (details.open && !body.dataset.loaded) {
        body.dataset.loaded = 'true';
        this.renderReferencePage(body, image);
      }
    };
  }

  private renderReferencePage(parent: HTMLElement, image: Media): void {
    const key = image.path,
      page = clampPage(
        this.referencePages.get(key) ?? 0,
        image.references.length,
        REFERENCE_PAGE_SIZE,
      ),
      start = page * REFERENCE_PAGE_SIZE;
    this.referencePages.set(key, page);
    image.references.slice(start, start + REFERENCE_PAGE_SIZE).forEach((ref) => {
      const button = parent.createEl('button', {
        text: `${ref.source}: ${ref.raw}`,
        cls: 'atlas-reference',
      });
      button.onclick = () => void this.plugin.app.workspace.openLinkText(ref.source, '', false);
    });
    this.pagination(
      parent,
      image.references.length,
      REFERENCE_PAGE_SIZE,
      page,
      (nextPage) => {
        const focus = captureFocus(parent);
        this.referencePages.set(key, nextPage);
        parent.empty();
        this.renderReferencePage(parent, image);
        restoreFocus(parent, focus);
      },
      `references:${key}`,
    );
  }

  private reasons(parent: HTMLElement, reasons: readonly Text[]): void {
    reasons.forEach((reason) =>
      parent.createEl('span', { text: ` · ${problem(reason)}`, cls: 'atlas-muted' }),
    );
  }

  private writeBlocker(snapshot: Snapshot): string {
    if (this.plugin.busy) return t('Wait for the running task to finish.');
    if (snapshot.blockers.length)
      return t('Open Needs review and resolve the blocking issues, then scan again.');
    return '';
  }

  private pagination(
    parent: HTMLElement,
    total: number,
    size: number,
    page: number,
    setPage: (page: number) => void,
    focusKey: string,
  ): void {
    if (total <= size) return;
    const pages = Math.ceil(total / size),
      controls = parent.createDiv({ cls: 'atlas-actions' }),
      previous = controls.createEl('button', { text: t('Previous') });
    previous.dataset.focusKey = `${focusKey}:previous`;
    previous.dataset.focusFallback = `${focusKey}:next`;
    previous.disabled = page === 0;
    previous.onclick = () => setPage(page - 1);
    controls.createSpan({ text: t('Page {page} of {total}', { page: page + 1, total: pages }) });
    const next = controls.createEl('button', { text: t('Next') });
    next.dataset.focusKey = `${focusKey}:next`;
    next.dataset.focusFallback = `${focusKey}:previous`;
    next.disabled = page + 1 >= pages;
    next.onclick = () => setPage(page + 1);
  }
}
