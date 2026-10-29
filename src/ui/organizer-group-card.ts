import { t, problem } from './i18n';
import { duplicateGroupKey, type GroupSelection } from '../application/organizer-selection';
import {
  MAX_MERGE_RETIRE_BYTES,
  MAX_RETIRE_COUNT,
  checkedByteTotal,
} from '../domain/operation-limits';
import type { Media } from '../domain/model';
import { errorDetail, type Text } from '../domain/messages';
import { bytes, exactBytes } from './modals';
import { matchesQuery, sortImages } from './organizer-query';
import type { OrganizerResultContext } from './organizer-result-context';
import { clampPage } from './organizer-state';
import { reconcileElements } from './reconcile-elements';

const MEMBER_PAGE_SIZE = 25;
interface MemberRow {
  element: HTMLElement;
  checkbox: HTMLInputElement;
  retained: HTMLElement;
}

export class OrganizerGroupCard {
  readonly element: HTMLElement;
  private key: string;
  private saved: GroupSelection | null = null;
  private initialized = false;
  private keep!: HTMLSelectElement;
  private recommended!: HTMLElement;
  private keepReasons!: HTMLElement;
  private summary!: HTMLElement;
  private errors!: HTMLElement;
  private actions!: HTMLElement;
  private members!: HTMLElement;
  private pages!: HTMLElement;
  private rows = new Map<string, MemberRow>();

  constructor(
    parent: HTMLElement,
    private group: Media[],
    private context: OrganizerResultContext,
  ) {
    this.key = duplicateGroupKey(group);
    this.element = parent.createDiv({ cls: 'atlas-card' });
    this.element.dataset.focusFallback = `keep:${this.key}`;
  }

  update(selection: GroupSelection): void {
    const previous = this.saved;
    if (
      previous?.keepPath === selection.keepPath &&
      previous.retirePaths.length === selection.retirePaths.length &&
      previous.retirePaths.every((path, index) => path === selection.retirePaths[index])
    )
      return;
    this.saved = selection;
    const images = new Map(this.group.map((image) => [image.path, image]));
    if (
      !images.has(selection.keepPath) ||
      selection.retirePaths.includes(selection.keepPath) ||
      selection.retirePaths.some((path) => !images.has(path))
    ) {
      this.showError(
        'Selection no longer matches this duplicate group. Clear the group or scan again.',
      );
      return;
    }
    try {
      const newlyInitialized = !this.initialized;
      if (newlyInitialized) this.initialize();
      const selected = selection.retirePaths.flatMap((path) => {
        const image = images.get(path);
        return image ? [image] : [];
      });
      const mode =
        this.context.state.memberModes[this.key] ??
        (this.context.state.duplicateMode === 'selected' ? 'selected' : 'matching');
      const displayed =
        mode === 'selected'
          ? selected
          : mode === 'all'
            ? this.group
            : this.group.filter((image) => matchesQuery(image, this.context.state.query));
      const ordered = sortImages(
        displayed,
        this.context.state.sort.key,
        this.context.state.sort.direction,
      );
      const page = clampPage(
        this.context.state.memberPages[this.key] ?? 0,
        ordered.length,
        MEMBER_PAGE_SIZE,
      );
      this.context.state.memberPages[this.key] = page;
      const pageMembers = ordered.slice(page * MEMBER_PAGE_SIZE, (page + 1) * MEMBER_PAGE_SIZE);
      const total = checkedByteTotal(selected.map((image) => image.size));
      this.keep.value = selection.keepPath;
      if (newlyInitialized || !previous || previous.keepPath !== selection.keepPath) {
        this.recommended.setText(
          ` · ${t('Recommended')}: ${this.group[0]!.path === selection.keepPath ? t('Yes') : t('No')}`,
        );
        this.keepReasons.empty();
        this.context.reasons(this.keepReasons, images.get(selection.keepPath)?.reasons ?? []);
      }
      this.summary.setText(
        t(
          '{count} selected · {size} · {filterHidden} outside filter · {pageHidden} outside current page',
          {
            count: selection.retirePaths.length,
            size: exactBytes(total),
            filterHidden: selected.filter((image) => !matchesQuery(image, this.context.state.query))
              .length,
            pageHidden: selected.filter(
              (image) => !pageMembers.some((visible) => visible.path === image.path),
            ).length,
          },
        ),
      );
      this.renderBudget(selection.retirePaths.length, total);
      this.renderActions(selection, total, mode, pageMembers);
      this.updateMembers(selection, this.context.expandedGroups.has(this.key) ? pageMembers : []);
      this.pages.empty();
      if (this.context.expandedGroups.has(this.key))
        this.context.pagination(
          this.pages,
          ordered.length,
          MEMBER_PAGE_SIZE,
          page,
          (next) => {
            this.context.state.memberPages[this.key] = next;
            this.context.rerender();
          },
          `members:${this.key}`,
        );
    } catch (error) {
      this.showError(errorDetail(error));
    }
  }

  private initialize(): void {
    this.element.empty();
    this.rows.clear();
    this.initialized = true;
    this.element.createEl('h3', {
      text: t('{hits} of {total} identical images match', {
        hits: this.group.filter((image) => matchesQuery(image, this.context.state.query)).length,
        total: this.group.length,
      }),
    });
    const row = this.element.createDiv({ cls: 'atlas-keep-row' });
    const id = `keep-${this.context.viewId}-${this.key}`;
    row.createEl('label', { text: t('Retain image: '), attr: { for: id } });
    this.keep = row.createEl('select', {
      attr: {
        id,
        'aria-label': t('Retained image for group'),
        'data-focus-key': `keep:${this.key}`,
      },
    });
    for (const image of this.group)
      this.keep.createEl('option', { text: image.path, value: image.path });
    this.keep.disabled = this.context.plugin.busy;
    this.keep.onchange = () => this.context.plugin.selection.setKeep(this.key, this.keep.value);
    this.recommended = row.createSpan({ cls: 'atlas-muted' });
    this.keepReasons = row.createSpan();
    const locate = row.createEl('button', { text: t('Locate retained image') });
    locate.dataset.focusKey = `locate:${this.key}`;
    locate.onclick = () => {
      this.context.state.memberModes[this.key] = 'all';
      const ordered = sortImages(
        this.group,
        this.context.state.sort.key,
        this.context.state.sort.direction,
      );
      const index = ordered.findIndex((image) => image.path === this.saved?.keepPath);
      this.context.state.memberPages[this.key] = Math.floor(Math.max(0, index) / MEMBER_PAGE_SIZE);
      this.context.expandedGroups.add(this.key);
      this.context.rerender();
    };
    this.summary = this.element.createEl('p', {
      cls: 'atlas-muted',
      attr: { 'aria-live': 'polite' },
    });
    this.errors = this.element.createDiv();
    this.actions = this.element.createDiv({ cls: 'atlas-actions' });
    this.members = this.element.createDiv();
    this.pages = this.element.createDiv();
  }

  private renderBudget(count: number, total: number): void {
    this.errors.empty();
    if (count > MAX_RETIRE_COUNT)
      this.errors.createEl('p', {
        text: t('Selection exceeds the operation limit by {count} images.', {
          count: count - MAX_RETIRE_COUNT,
        }),
        cls: 'atlas-error',
        attr: { role: 'alert' },
      });
    if (total > MAX_MERGE_RETIRE_BYTES)
      this.errors.createEl('p', {
        text: t('Selection exceeds the byte limit by {bytes} bytes ({size}). Limit: {limit}.', {
          bytes: total - MAX_MERGE_RETIRE_BYTES,
          size: bytes(total - MAX_MERGE_RETIRE_BYTES),
          limit: exactBytes(MAX_MERGE_RETIRE_BYTES),
        }),
        cls: 'atlas-error',
        attr: { role: 'alert' },
      });
  }

  private renderActions(
    selection: GroupSelection,
    total: number,
    mode: string,
    pageMembers: Media[],
  ): void {
    this.actions.empty();
    for (const [key, label] of [
      ['matching', 'Matching members'],
      ['all', 'All group members'],
      ['selected', 'Selected members'],
    ] as const) {
      if (this.context.state.duplicateMode === 'selected' && key !== 'selected') continue;
      const button = this.actions.createEl('button', {
        text: t(label),
        attr: { 'aria-pressed': String(mode === key) },
      });
      button.dataset.focusKey = `members:${this.key}:${key}`;
      button.onclick = () => {
        this.context.state.memberModes[this.key] = key;
        this.context.state.memberPages[this.key] = 0;
        this.context.expandedGroups.add(this.key);
        this.context.rerender();
      };
    }
    const expanded = this.context.expandedGroups.has(this.key);
    const expand = this.actions.createEl('button', {
      text: expanded ? t('Hide members') : t('Show members'),
    });
    expand.dataset.focusKey = `expand:${this.key}`;
    expand.setAttribute('aria-expanded', String(expanded));
    expand.onclick = () => {
      if (expanded) this.context.expandedGroups.delete(this.key);
      else this.context.expandedGroups.add(this.key);
      this.context.rerender();
    };
    const choose = this.actions.createEl('button', {
      text: t('Select eligible copies on this page'),
    });
    choose.dataset.focusKey = `select-page:${this.key}`;
    choose.disabled = !!this.context.writeBlocker(this.context.plugin.snapshot!);
    choose.onclick = () =>
      this.context.plugin.selection.setGroupSelected(
        this.key,
        pageMembers
          .filter((image) => image.path !== selection.keepPath && !image.reasons.length)
          .map((image) => image.path),
        true,
      );
    const clear = this.actions.createEl('button', { text: t('Clear this group') });
    clear.dataset.focusKey = `clear:${this.key}`;
    clear.disabled = this.context.plugin.busy;
    clear.onclick = () => this.context.plugin.selection.clearGroup(this.key);
    const preview = this.actions.createEl('button', {
      text: t('Preview merge ({count})', { count: selection.retirePaths.length }),
      cls: 'mod-cta',
    });
    preview.dataset.focusKey = `preview:merge:${this.key}`;
    const blocker =
      this.context.writeBlocker(this.context.plugin.snapshot!) ||
      (!this.context.queryValid() ? t('Correct the size filter before previewing.') : '') ||
      (!selection.retirePaths.length ? t('Select duplicate copies to preview the merge.') : '') ||
      (selection.retirePaths.length > MAX_RETIRE_COUNT
        ? t('Selected images exceed the 100 image limit.')
        : '') ||
      (total > MAX_MERGE_RETIRE_BYTES ? t('Selected duplicate copies exceed 192 MiB.') : '');
    preview.disabled = !!blocker;
    preview.title = blocker;
    preview.onclick = () =>
      this.context.onPreview({
        kind: 'merge-exact',
        groupKey: this.key,
        keepPath: selection.keepPath,
        retirePaths: [...selection.retirePaths],
      });
    if (blocker)
      this.actions.createSpan({ text: blocker, cls: 'atlas-muted', attr: { role: 'status' } });
  }

  private updateMembers(selection: GroupSelection, images: Media[]): void {
    const wanted = new Set(images.map((image) => image.path));
    for (const path of this.rows.keys()) if (!wanted.has(path)) this.rows.delete(path);
    const elements = images.map((image) => {
      let row = this.rows.get(image.path);
      if (!row) {
        const element = this.members.createDiv({ cls: 'atlas-member' });
        const label = element.createEl('label');
        const checkbox = label.createEl('input', {
          type: 'checkbox',
          attr: {
            'aria-label': t('Select {path}', { path: image.path }),
            'data-focus-key': `image:${image.path}`,
          },
        });
        checkbox.onchange = () =>
          this.context.plugin.selection.setGroupSelected(this.key, [image.path], checkbox.checked);
        label.createSpan({ text: ` ${image.path}` });
        const retained = element.createSpan({ text: t('Retained'), cls: 'atlas-muted' });
        this.context.imageDetails(element, image);
        row = { element, checkbox, retained };
        this.rows.set(image.path, row);
      }
      row.checkbox.checked = selection.retirePaths.includes(image.path);
      row.checkbox.disabled =
        image.path === selection.keepPath ||
        !!image.reasons.length ||
        this.context.plugin.busy ||
        !!this.context.plugin.snapshot?.blockers.length;
      row.retained.hidden = image.path !== selection.keepPath;
      return row.element;
    });
    reconcileElements(this.members, elements);
  }

  private showError(reason: Text): void {
    this.initialized = false;
    this.rows.clear();
    this.element.empty();
    this.element.createEl('p', {
      text: problem(reason),
      cls: 'atlas-error',
      attr: { role: 'alert' },
    });
    const clear = this.element.createEl('button', { text: t('Clear this group') });
    clear.dataset.focusKey = `clear:${this.key}`;
    clear.disabled = this.context.plugin.busy;
    clear.onclick = () => this.context.plugin.selection.clearGroup(this.key);
  }
}
