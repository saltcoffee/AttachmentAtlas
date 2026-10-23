import { t, problem } from './i18n';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import type AttachmentAtlas from '../main';
import { unreferencedReasons } from '../application/scan';
import { type Media, type Snapshot } from '../domain/model';
import { finishedRecoveryState } from '../domain/recovery';
import { bytes } from './modals';
import { HistorySection } from './history-section';
export const VIEW_TYPE = 'attachment-atlas-organizer';
export class OrganizerView extends ItemView {
  private tab: 'duplicates' | 'unreferenced' | 'large' | 'blocked' | 'history' = 'duplicates';
  private filter = '';
  private page = 0;
  private selected = new Set<string>();
  private historySection = new HistorySection();
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: AttachmentAtlas,
  ) {
    super(leaf);
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
    this.render();
  }
  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
  showHistory(): void {
    this.tab = 'history';
    this.render();
  }
  render(): void {
    const el = this.contentEl;
    el.empty();
    el.addClass('atlas-view');
    el.createEl('h2', { text: t('Attachment Atlas') });
    const controls = el.createDiv({ cls: 'atlas-actions' });
    const scan = controls.createEl('button', {
      text: this.plugin.snapshot ? t('Scan again') : t('Scan vault'),
      cls: 'mod-cta',
    });
    scan.disabled = this.plugin.busy;
    scan.onclick = () => {
      this.selected.clear();
      void this.plugin.scanVault();
    };
    if (this.plugin.busy) {
      const cancel = controls.createEl('button', { text: t('Stop task') });
      cancel.onclick = () => this.plugin.cancel();
    }
    const status = el.createEl('p', {
      text: t(this.plugin.status),
      cls: 'atlas-status',
      attr: { role: 'status', 'aria-live': 'polite' },
    });
    if (this.plugin.lastError) {
      const error = el.createDiv({ cls: 'atlas-error', attr: { role: 'alert' } });
      error.createEl('p', { text: problem(this.plugin.lastError) });
      const retry = error.createEl('button', { text: t('Retry scan') });
      retry.disabled = this.plugin.busy;
      retry.onclick = () => void this.plugin.scanVault();
    }
    const nav = el.createDiv({ cls: 'atlas-tabs' });
    for (const [key, label] of [
      ['duplicates', 'Exact duplicates'],
      [
        'unreferenced',
        this.plugin.snapshot?.blockers.length ? 'Potentially unreferenced' : 'Unreferenced',
      ],
      ['large', 'Large images'],
      ['blocked', 'Needs review'],
      ['history', 'History'],
    ] as const) {
      const button = nav.createEl('button', {
        text: t(label),
        attr: { 'aria-pressed': String(this.tab === key) },
      });
      button.onclick = () => {
        this.tab = key;
        this.page = 0;
        this.selected.clear();
        this.render();
      };
    }
    if (this.tab === 'history') {
      this.historySection.render(el.createDiv(), {
        entries: this.plugin.history,
        busy: this.plugin.busy,
        previewCleanup: (ids) => void this.plugin.previewCleanup(ids),
        previewRestore: (id) => this.plugin.previewRestore(id),
      });
      return;
    }
    const snapshot = this.plugin.snapshot;
    if (!snapshot) {
      el.createEl('p', {
        text: t(
          'Scan to inspect local images and their references. No notes or attachments change during scanning.',
        ),
      });
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
    el.createEl('p', {
      text: snapshot.blockers.length
        ? t(
            'Incomplete reference coverage: {count} blockers. Merging and recycling are disabled.',
            {
              count: snapshot.blockers.length,
            },
          )
        : t(
            'Supported reference sources scanned. External apps and hidden configuration are outside coverage.',
          ),
    });
    if (snapshot.blockers.length && this.tab !== 'blocked') {
      const review = el.createEl('button', { text: t('View blocking issues') });
      review.onclick = () => {
        this.tab = 'blocked';
        this.page = 0;
        this.selected.clear();
        this.render();
      };
    }
    if (this.tab === 'blocked') {
      snapshot.blockers.forEach((reason) =>
        el.createEl('p', { text: problem(reason), cls: 'atlas-error' }),
      );
    }
    const input = el.createEl('input', {
      type: 'search',
      placeholder: t('Filter by path'),
      value: this.filter,
      attr: { 'aria-label': t('Filter images by path') },
    });
    const results = el.createDiv();
    input.oninput = () => {
      this.filter = input.value;
      this.page = 0;
      this.renderResults(results);
    };
    this.renderResults(results);
  }
  private renderResults(el: HTMLElement): void {
    el.empty();
    const snapshot = this.plugin.snapshot;
    if (!snapshot) return;
    const eligible = new Set(
      snapshot.media
        .filter((image) => !unreferencedReasons(image, snapshot).length)
        .map((image) => image.path),
    );
    this.selected = new Set([...this.selected].filter((path) => eligible.has(path)));
    const match = (image: Media) => image.path.toLowerCase().includes(this.filter.toLowerCase());
    if (this.tab === 'duplicates') {
      const groups = snapshot.duplicates.filter((group) => group.some(match));
      if (!groups.length)
        el.createEl('p', { text: t('No exact duplicate groups found in this scan.') });
      for (const group of groups.slice(this.page * 25, (this.page + 1) * 25)) {
        const card = el.createDiv({ cls: 'atlas-card' });
        let kept = group[0]!.path;
        const label = card.createEl('label', { text: t('Retain image: ') });
        const select = label.createEl('select');
        group.forEach((image) =>
          select.createEl('option', { text: image.path, value: image.path }),
        );
        select.value = kept;
        select.onchange = () => {
          kept = select.value;
          updateAction();
        };
        group.slice(0, 25).forEach((image) => this.imageRow(card, image));
        if (group.length > 25)
          card.createEl('p', {
            text: t(
              'Showing 25 of {count} identical images. Each confirmed operation recycles at most 100 eligible images; rescan to continue.',
              { count: group.length },
            ),
            cls: 'atlas-muted',
          });
        const candidates = () => {
          const chosen: Media[] = [];
          let total = 0;
          for (const image of group)
            if (
              image.path !== kept &&
              !image.reasons.length &&
              chosen.length < 100 &&
              total + image.size <= 192 * 1024 * 1024
            ) {
              chosen.push(image);
              total += image.size;
            }
          return chosen;
        };
        const button = card.createEl('button', { text: t('Preview merge') });
        const explanation = card.createEl('p', { cls: 'atlas-muted', attr: { role: 'status' } });
        const updateAction = () => {
          const count = candidates().length;
          const reason =
            this.writeBlocker(snapshot) ||
            (!count
              ? t(
                  'No duplicate copies can be recycled with this retained image. Check the image restrictions or choose another retained image.',
                )
              : '');
          button.disabled = !!reason;
          button.title = reason;
          explanation.setText(reason);
          explanation.hidden = !reason;
          button.setText(t('Preview merge ({count})', { count }));
        };
        updateAction();
        button.onclick = () =>
          this.plugin.preview(
            candidates().map((image) => image.path),
            kept,
          );
      }
      this.pagination(el, groups.length, 25);
      return;
    }
    let images = [...snapshot.media].filter(match);
    if (this.tab === 'unreferenced') images = images.filter((image) => !image.references.length);
    if (this.tab === 'blocked')
      images = images.filter(
        (image) =>
          image.reasons.length ||
          (!image.references.length && unreferencedReasons(image, snapshot).length),
      );
    images.sort((a, b) => b.size - a.size);
    if (this.tab === 'unreferenced') {
      const action = el.createEl('button', {
        text: t('Preview recycling ({count})', { count: this.selected.size }),
      });
      const reason =
        this.writeBlocker(snapshot) ||
        (!this.selected.size ? t('Select images to preview recycling.') : '');
      action.disabled = !!reason;
      action.title = reason;
      if (reason) el.createEl('p', { text: reason, cls: 'atlas-muted', attr: { role: 'status' } });
      action.onclick = () => this.plugin.preview([...this.selected]);
    }
    if (!images.length) el.createEl('p', { text: t('No images match this category and filter.') });
    for (const image of images.slice(this.page * 50, (this.page + 1) * 50)) {
      const card = el.createDiv({ cls: 'atlas-card' });
      if (this.tab === 'unreferenced') {
        const label = card.createEl('label');
        const checkbox = label.createEl('input', {
          type: 'checkbox',
          attr: { 'aria-label': t('Select {path}', { path: image.path }), 'data-path': image.path },
        });
        checkbox.checked = this.selected.has(image.path);
        checkbox.disabled =
          !!this.writeBlocker(snapshot) || !!unreferencedReasons(image, snapshot).length;
        checkbox.onchange = () => {
          if (checkbox.checked) this.selected.add(image.path);
          else this.selected.delete(image.path);
          this.renderResults(el);
          Array.from(el.querySelectorAll<HTMLInputElement>('input[data-path]'))
            .find((input) => input.dataset.path === image.path)
            ?.focus();
        };
        label.createSpan({ text: t(' Select for recycling') });
      }
      this.imageRow(card, image);
      if (this.tab === 'unreferenced' || this.tab === 'blocked')
        unreferencedReasons(image, snapshot).forEach((reason) =>
          card.createEl('p', { text: problem(reason), cls: 'atlas-muted' }),
        );
    }
    this.pagination(el, images.length, 50);
  }
  private writeBlocker(snapshot: Snapshot): string {
    if (this.plugin.busy) return t('Wait for the running task to finish.');
    if (snapshot.blockers.length)
      return t('Open Needs review and resolve the blocking issues, then scan again.');
    if (this.plugin.history.some((entry) => !finishedRecoveryState(entry.state)))
      return t('Resolve unfinished recovery operations in History before merging or recycling.');
    return '';
  }
  private imageRow(el: HTMLElement, image: Media): void {
    const row = el.createDiv({ cls: 'atlas-image' });
    if (image.digest) {
      const img = row.createEl('img', {
        attr: {
          src: this.app.vault.adapter.getResourcePath(image.path),
          alt: image.path,
          loading: 'lazy',
        },
      });
      img.onerror = () => {
        img.remove();
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
    if (!image.references.length && this.plugin.snapshot?.blockers.length)
      description.createEl('p', {
        text: t('No references detected yet; reference coverage is incomplete.'),
        cls: 'atlas-muted',
      });
    image.reasons.forEach((reason) =>
      description.createEl('p', { text: problem(reason), cls: 'atlas-muted' }),
    );
    if (image.references.length) {
      const details = description.createEl('details');
      details.createEl('summary', { text: t('Reference locations') });
      for (const ref of image.references) {
        const button = details.createEl('button', {
          text: `${ref.source}: ${ref.raw}`,
          cls: 'atlas-reference',
        });
        button.onclick = () => void this.app.workspace.openLinkText(ref.source, '', false);
      }
    }
  }
  private pagination(el: HTMLElement, total: number, size: number): void {
    if (total <= size) return;
    const controls = el.createDiv({ cls: 'atlas-actions' });
    const previous = controls.createEl('button', { text: t('Previous') });
    previous.disabled = this.page === 0;
    previous.onclick = () => {
      this.page--;
      this.render();
    };
    controls.createSpan({
      text: t('Page {page} of {total}', { page: this.page + 1, total: Math.ceil(total / size) }),
    });
    const next = controls.createEl('button', { text: t('Next') });
    next.disabled = (this.page + 1) * size >= total;
    next.onclick = () => {
      this.page++;
      this.render();
    };
  }
}
