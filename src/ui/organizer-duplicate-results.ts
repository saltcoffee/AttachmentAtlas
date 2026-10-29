import { t } from './i18n';
import { duplicateGroupKey } from '../application/organizer-selection';
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
