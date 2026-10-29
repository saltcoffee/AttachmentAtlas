import { t, problem } from './i18n';
import { unreferencedReasons } from '../application/scan';
import { MAX_RETIRE_COUNT, checkedByteTotal } from '../domain/operation-limits';
import type { Media, Snapshot } from '../domain/model';
import { exactBytes } from './modals';
import { matchesQuery, sortImages } from './organizer-query';
import type { OrganizerResultContext } from './organizer-result-context';
import { clampPage } from './organizer-state';
import { reconcileElements } from './reconcile-elements';

const IMAGE_PAGE_SIZE = 50;

export class OrganizerImageResults {
  private toolbar!: HTMLElement;
  private list!: HTMLElement;
  private empty!: HTMLElement;
  private pages!: HTMLElement;
  private rows = new Map<string, { element: HTMLElement; checkbox?: HTMLInputElement }>();
  constructor(private context: OrganizerResultContext) {}

  render(parent: HTMLElement, snapshot: Snapshot): void {
    this.rows.clear();
    if (this.context.state.tab === 'blocked') {
      if (snapshot.blockers.length)
        snapshot.blockers.forEach((reason) =>
          parent.createEl('p', { text: problem(reason), cls: 'atlas-error' }),
        );
      else parent.createEl('p', { text: t('No reference blockers were found.') });
    }
    this.toolbar = parent.createDiv();
    this.empty = parent.createEl('p');
    this.list = parent.createDiv();
    this.pages = parent.createDiv();
    this.updateSelection(snapshot);
  }

  updateSelection(snapshot: Snapshot): void {
    const all = snapshot.media.filter((image) => {
      if (this.context.state.tab === 'unreferenced') return !image.references.length;
      if (this.context.state.tab === 'blocked')
        return (
          image.reasons.length > 0 || (!image.references.length && snapshot.blockers.length > 0)
        );
      return true;
    });
    const filtered = all.filter((image) => matchesQuery(image, this.context.state.query)),
      selection = this.context.plugin.selection.state,
      selectedPaths = this.context.state.tab === 'unreferenced' ? selection.unreferencedPaths : [],
      mode = this.context.state.unreferencedMode,
      visible =
        this.context.state.tab === 'unreferenced' && mode === 'selected'
          ? all.filter((image) => selectedPaths.includes(image.path))
          : filtered,
      images = sortImages(visible, this.context.state.sort.key, this.context.state.sort.direction),
      page = clampPage(
        this.context.state.pageByTab[this.context.state.tab],
        images.length,
        IMAGE_PAGE_SIZE,
      ),
      pageImages = images.slice(page * IMAGE_PAGE_SIZE, (page + 1) * IMAGE_PAGE_SIZE);
    this.context.state.pageByTab[this.context.state.tab] = page;

    this.toolbar.empty();
    if (this.context.state.tab === 'unreferenced')
      this.renderUnreferencedActions(this.toolbar, snapshot, pageImages, selectedPaths);
    this.empty.hidden = images.length > 0;
    this.empty.setText(
      this.context.state.tab === 'unreferenced' && mode === 'selected'
        ? t('No unreferenced images are selected.')
        : t('No images match this category and filter.'),
    );
    const wanted = new Set(pageImages.map((image) => image.path));
    for (const path of this.rows.keys()) if (!wanted.has(path)) this.rows.delete(path);
    reconcileElements(
      this.list,
      pageImages.map((image) => {
        let row = this.rows.get(image.path);
        if (!row) {
          const element = this.list.createDiv({ cls: 'atlas-card' });
          const checkbox =
            this.context.state.tab === 'unreferenced'
              ? this.renderUnreferencedCheckbox(element, image)
              : undefined;
          this.context.imageDetails(element, image);
          if (this.context.state.tab === 'unreferenced' || this.context.state.tab === 'blocked')
            unreferencedReasons(image, snapshot).forEach((reason) =>
              element.createEl('p', { text: problem(reason), cls: 'atlas-muted' }),
            );
          row = { element, checkbox };
          this.rows.set(image.path, row);
        }
        if (row.checkbox) row.checkbox.checked = selectedPaths.includes(image.path);
        return row.element;
      }),
    );
    this.pages.empty();
    this.context.pagination(
      this.pages,
      images.length,
      IMAGE_PAGE_SIZE,
      page,
      (nextPage) => {
        this.context.state.pageByTab[this.context.state.tab] = nextPage;
        this.context.rerender();
      },
      `images:${this.context.state.tab}`,
    );
  }

  private renderUnreferencedActions(
    parent: HTMLElement,
    snapshot: Snapshot,
    pageImages: Media[],
    selectedPaths: readonly string[],
  ): void {
    const selected = selectedPaths
        .map((path) => snapshot.media.find((image) => image.path === path))
        .filter((image): image is Media => !!image),
      size = checkedByteTotal(selected.map((image) => image.size)),
      visible = new Set(pageImages.map((image) => image.path)),
      hiddenByFilter = selected.filter(
        (image) => !matchesQuery(image, this.context.state.query),
      ).length,
      hiddenByPage = selected.filter((image) => !visible.has(image.path)).length,
      toolbar = parent.createDiv({ cls: 'atlas-actions' });
    toolbar.createEl('p', {
      text: t(
        '{count} selected · {size} · {filterHidden} outside filter · {pageHidden} outside current page',
        {
          count: selected.length,
          size: exactBytes(size),
          filterHidden: hiddenByFilter,
          pageHidden: hiddenByPage,
        },
      ),
      cls: 'atlas-muted',
      attr: { 'aria-live': 'polite' },
    });
    const matching = toolbar.createEl('button', {
      text: t('Matching images'),
      attr: { 'aria-pressed': String(this.context.state.unreferencedMode === 'matching') },
    });
    matching.dataset.focusKey = 'unreferenced:matching';
    matching.onclick = () => {
      this.context.state.unreferencedMode = 'matching';
      this.context.state.pageByTab.unreferenced = 0;
      this.context.rerender();
    };
    const viewSelected = toolbar.createEl('button', {
      text: t('View selected images ({count})', { count: selected.length }),
      attr: { 'aria-pressed': String(this.context.state.unreferencedMode === 'selected') },
    });
    viewSelected.dataset.focusKey = 'unreferenced:selected';
    viewSelected.onclick = () => {
      this.context.state.unreferencedMode = 'selected';
      this.context.state.pageByTab.unreferenced = 0;
      this.context.rerender();
    };
    const selectPage = toolbar.createEl('button', {
      text: t('Select eligible images on this page'),
    });
    selectPage.dataset.focusKey = 'unreferenced:select-page';
    selectPage.disabled = !!this.context.writeBlocker(snapshot);
    selectPage.onclick = () =>
      this.context.plugin.selection.setUnreferencedSelected(
        pageImages
          .filter((image) => !unreferencedReasons(image, snapshot).length)
          .map((image) => image.path),
        true,
      );
    const clear = toolbar.createEl('button', { text: t('Clear all unreferenced selections') });
    clear.dataset.focusKey = 'unreferenced:clear';
    clear.disabled = this.context.plugin.busy;
    clear.onclick = () => this.context.plugin.selection.clearUnreferenced();
    const preview = toolbar.createEl('button', {
      text: t('Preview recycling ({count})', { count: selected.length }),
      cls: 'mod-cta',
    });
    preview.dataset.focusKey = 'preview:unreferenced';
    const blocker =
      this.context.writeBlocker(snapshot) ||
      (!this.context.queryValid() ? t('Correct the size filter before previewing.') : '') ||
      (!selected.length ? t('Select images to preview recycling.') : '') ||
      (selected.length > MAX_RETIRE_COUNT ? t('Selected images exceed the 100 image limit.') : '');
    preview.disabled = !!blocker;
    preview.title = blocker;
    preview.onclick = () =>
      this.context.onPreview({
        kind: 'recycle-unreferenced',
        retirePaths: [...selectedPaths],
      });
    if (blocker)
      toolbar.createEl('span', { text: blocker, cls: 'atlas-muted', attr: { role: 'status' } });
    if (selected.length > MAX_RETIRE_COUNT)
      toolbar.createEl('p', {
        text: t('Selection exceeds the operation limit by {count} images.', {
          count: selected.length - MAX_RETIRE_COUNT,
        }),
        cls: 'atlas-error',
        attr: { role: 'alert' },
      });
  }

  private renderUnreferencedCheckbox(parent: HTMLElement, image: Media): HTMLInputElement {
    const label = parent.createEl('label'),
      checkbox = label.createEl('input', {
        type: 'checkbox',
        attr: {
          'aria-label': t('Select {path}', { path: image.path }),
          'data-focus-key': `image:${image.path}`,
          'data-focus-fallback': 'unreferenced:selected',
        },
      });
    checkbox.disabled =
      this.context.plugin.busy ||
      !!this.context.plugin.snapshot?.blockers.length ||
      !!unreferencedReasons(image, this.context.plugin.snapshot!).length;
    checkbox.onchange = () =>
      this.context.plugin.selection.setUnreferencedSelected([image.path], checkbox.checked);
    label.createSpan({ text: t(' Select for recycling') });
    return checkbox;
  }
}
