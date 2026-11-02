import { t, problem } from './i18n';
import { duplicateGroupKey, selectedMergeGroups } from '../application/organizer-selection';
import {
  checkedByteTotal,
  MAX_MERGE_RETIRE_BYTES,
  MAX_RETIRE_COUNT,
} from '../domain/operation-limits';
import { errorDetail } from '../domain/messages';
import { exactBytes } from './modals';
import type { Snapshot } from '../domain/model';
import { sortGroups, matchesQuery } from './organizer-query';
import type { OrganizerResultContext } from './organizer-result-context';
import { clampPage } from './organizer-state';
import { OrganizerGroupCard } from './organizer-group-card';
import { reconcileElements } from './reconcile-elements';

const GROUP_PAGE_SIZE = 25;

export class OrganizerDuplicateResults {
  private list!: HTMLElement;
  private pages!: HTMLElement;
  private empty!: HTMLElement;
  private selected!: HTMLButtonElement;
  private summary!: HTMLElement;
  private budget!: HTMLElement;
  private preview!: HTMLButtonElement;
  private clear!: HTMLButtonElement;
  private cards = new Map<string, OrganizerGroupCard>();
  constructor(private context: OrganizerResultContext) {}

  render(parent: HTMLElement, snapshot: Snapshot): void {
    this.cards.clear();
    const toolbar = parent.createDiv({ cls: 'atlas-actions' });
    const matching = toolbar.createEl('button', {
      text: t('Matching groups'),
      attr: { 'aria-pressed': String(this.context.state.duplicateMode === 'matching') },
    });
    matching.dataset.focusKey = 'groups:matching';
    matching.onclick = () => this.changeMode('matching');
    this.selected = toolbar.createEl('button', {
      attr: { 'aria-pressed': String(this.context.state.duplicateMode === 'selected') },
    });
    this.selected.dataset.focusKey = 'groups:selected';
    this.selected.onclick = () => this.changeMode('selected');
    this.summary = parent.createEl('p', { attr: { role: 'status' } });
    this.budget = parent.createEl('p', { cls: 'atlas-error' });
    const actions = parent.createDiv({ cls: 'atlas-actions' });
    this.clear = actions.createEl('button', { text: t('Clear all merge selections') });
    this.clear.dataset.focusKey = 'merge:clear';
    this.clear.onclick = () => this.context.plugin.selection.clearMergeSelection();
    this.preview = actions.createEl('button', {
      text: t('Preview selected groups'),
      cls: 'mod-cta',
    });
    this.preview.dataset.focusKey = 'preview:merge';
    this.preview.onclick = () =>
      this.context.onPreview({
        kind: 'merge-exact',
        groups: selectedMergeGroups(this.context.plugin.selection.state),
      });
    this.empty = parent.createEl('p');
    this.list = parent.createDiv();
    this.pages = parent.createDiv();
    this.updateSelection(snapshot);
  }

  updateSelection(snapshot: Snapshot): void {
    const selection = this.context.plugin.selection.state;
    this.selected.setText(
      t('View selected groups ({count})', {
        count: Object.values(selection.groups).filter((group) => group.retirePaths.length).length,
      }),
    );
    const groups = snapshot.duplicates.filter((group) =>
      this.context.state.duplicateMode === 'selected'
        ? !!selection.groups[duplicateGroupKey(group)]?.retirePaths.length
        : group.some((image) => matchesQuery(image, this.context.state.query)),
    );
    const ordered = sortGroups(
      groups,
      this.context.state.sort.key,
      this.context.state.sort.direction,
    );
    const page = clampPage(
      this.context.state.pageByTab.duplicates,
      ordered.length,
      GROUP_PAGE_SIZE,
    );
    this.context.state.pageByTab.duplicates = page;
    const visible = ordered.slice(page * GROUP_PAGE_SIZE, (page + 1) * GROUP_PAGE_SIZE);
    const choices = selectedMergeGroups(selection);
    const images = new Map(snapshot.media.map((image) => [image.path, image]));
    const selectedPaths = choices.flatMap((group) => group.retirePaths);
    let blocker =
      this.context.writeBlocker(snapshot) ||
      (!this.context.queryValid() ? t('Correct the size filter before previewing.') : '');
    try {
      const total = checkedByteTotal(
        selectedPaths.map((path) => {
          const image = images.get(path);
          if (!image)
            throw new Error(
              'Selection no longer matches this duplicate group. Clear the group or scan again.',
            );
          return image.size;
        }),
      );
      const filterHidden = selectedPaths.filter(
        (path) => !matchesQuery(images.get(path)!, this.context.state.query),
      ).length;
      const visibleKeys = new Set(visible.map(duplicateGroupKey));
      const pageHidden = choices
        .filter((group) => !visibleKeys.has(group.groupKey))
        .reduce((sum, group) => sum + group.retirePaths.length, 0);
      this.summary.setText(
        t(
          '{groups} selected groups · {count} copies · {size} · {filterHidden} outside filter · {pageHidden} outside group page',
          {
            groups: choices.length,
            count: selectedPaths.length,
            size: exactBytes(total),
            filterHidden,
            pageHidden,
          },
        ),
      );
      const issues: string[] = [];
      if (selectedPaths.length > MAX_RETIRE_COUNT)
        issues.push(
          t('Selection exceeds the operation limit by {count} images.', {
            count: selectedPaths.length - MAX_RETIRE_COUNT,
          }),
        );
      if (total > MAX_MERGE_RETIRE_BYTES)
        issues.push(
          t('Selection exceeds the byte limit by {bytes} bytes ({size}). Limit: {limit}.', {
            bytes: total - MAX_MERGE_RETIRE_BYTES,
            size: exactBytes(total - MAX_MERGE_RETIRE_BYTES),
            limit: exactBytes(MAX_MERGE_RETIRE_BYTES),
          }),
        );
      blocker ||=
        issues.join(' ') ||
        (!selectedPaths.length ? t('Select duplicate copies to preview the merge.') : '');
      this.budget.setText(issues.join(' ') || blocker);
    } catch (error) {
      blocker = problem(errorDetail(error));
      this.budget.setText(blocker);
    }
    this.preview.disabled = !!blocker;
    this.preview.title = blocker;
    this.clear.disabled = this.context.plugin.busy || !choices.length;
    const wanted = new Set(visible.map(duplicateGroupKey));
    for (const key of this.cards.keys()) if (!wanted.has(key)) this.cards.delete(key);
    reconcileElements(
      this.list,
      visible.map((group) => {
        const key = duplicateGroupKey(group);
        let card = this.cards.get(key);
        if (!card) {
          card = new OrganizerGroupCard(this.list, group, this.context);
          this.cards.set(key, card);
        }
        card.update(selection.groups[key] ?? { keepPath: group[0]!.path, retirePaths: [] });
        return card.element;
      }),
    );
    this.empty.hidden = ordered.length > 0;
    this.empty.setText(
      this.context.state.duplicateMode === 'selected'
        ? t('No duplicate groups have selected copies.')
        : t('No exact duplicate groups match the current filters.'),
    );
    this.pages.empty();
    this.context.pagination(
      this.pages,
      ordered.length,
      GROUP_PAGE_SIZE,
      page,
      (next) => {
        this.context.state.pageByTab.duplicates = next;
        this.context.rerender();
      },
      'groups',
    );
  }

  private changeMode(mode: 'matching' | 'selected'): void {
    if (this.context.state.duplicateMode !== mode) {
      this.context.state.memberModes = {};
      this.context.state.memberPages = {};
    }
    this.context.state.duplicateMode = mode;
    this.context.state.pageByTab.duplicates = 0;
    this.context.rerender();
  }
}
