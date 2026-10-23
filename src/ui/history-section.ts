import { t, problem, formatDate, operationName, stateName } from './i18n';
import { Notice } from 'obsidian';
import { DAY, RECOVERY_ROOT } from '../domain/model';
import { canCleanRecovery, type HistoryEntry } from '../domain/recovery';
import { bytes } from './modals';

interface HistoryProps {
  entries: readonly HistoryEntry[];
  busy: boolean;
  previewCleanup: (ids: readonly string[]) => void;
  previewRestore: (id: string) => void;
}

export class HistorySection {
  private selected = new Set<string>();
  private page = 0;
  render(el: HTMLElement, props: HistoryProps): void {
    el.empty();
    const eligible = props.entries.filter(canCleanRecovery),
      eligibleIds = new Set(eligible.map((entry) => entry.id));
    for (const id of this.selected) if (!eligibleIds.has(id)) this.selected.delete(id);
    const knownBytes = props.entries.reduce((sum, entry) => sum + (entry.storageBytes ?? 0), 0);
    const unknown = props.entries.filter((entry) => entry.storageBytes === undefined).length;
    el.createEl('p', {
      text:
        t('Recovery storage: {size}', { size: bytes(knownBytes) }) +
        (unknown ? t(' + {count} unverified records', { count: unknown }) : ''),
    });
    el.createEl('p', {
      text: t(
        'Recycled images are held in .attachment-atlas-recovery/. Restore an operation or permanently clear its recovery data here. Successful restoration removes that operation’s data automatically. Unfinished and damaged records are protected.',
      ),
    });
    if (!props.entries.length) {
      el.createEl('p', { text: t('No local operation history or recovery data.') });
      return;
    }
    const actions = el.createDiv({ cls: 'atlas-actions' });
    const select = actions.createEl('button', { text: t('Select eligible (up to 100)') });
    const older = actions.createEl('button', { text: t('Select older than 30 days') });
    const clear = actions.createEl('button', { text: t('Clear selection') });
    const preview = actions.createEl('button', { text: t('Preview recovery cleanup') });
    const empty = actions.createEl('button', { text: t('Empty recovery area') });
    empty.disabled =
      props.busy || eligible.length !== props.entries.length || props.entries.length > 100;
    empty.onclick = () => {
      if (!empty.disabled) props.previewCleanup(eligible.map((entry) => entry.id));
    };
    if (eligible.length !== props.entries.length)
      el.createEl('p', {
        text: t(
          'Resolve protected records before emptying the entire recovery area. Eligible records can still be cleared individually.',
        ),
        cls: 'atlas-muted',
      });
    if (props.entries.length > 100)
      el.createEl('p', {
        text: t('Clear records in batches of up to 100 before emptying the recovery area.'),
        cls: 'atlas-muted',
      });
    const summary = el.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
    const update = () => {
      const chosen = eligible.filter((entry) => this.selected.has(entry.id));
      summary.setText(
        t('{count} selected · {size} to release', {
          count: chosen.length,
          size: bytes(chosen.reduce((sum, entry) => sum + (entry.storageBytes ?? 0), 0)),
        }),
      );
      preview.setText(t('Preview recovery cleanup ({count})', { count: chosen.length }));
      preview.disabled = props.busy || !chosen.length || chosen.length > 100;
      select.disabled = props.busy || !eligible.length;
      older.disabled =
        props.busy ||
        !eligible.some(
          (entry) => entry.createdAt !== undefined && Date.now() - entry.createdAt > 30 * DAY,
        );
      clear.disabled = props.busy || !chosen.length;
      for (const input of Array.from(el.querySelectorAll<HTMLInputElement>('input[data-record]')))
        input.checked = this.selected.has(input.dataset.record!);
    };
    select.onclick = () => {
      this.selected = new Set(eligible.slice(0, 100).map((entry) => entry.id));
      update();
    };
    older.onclick = () => {
      this.selected = new Set(
        eligible
          .filter(
            (entry) => entry.createdAt !== undefined && Date.now() - entry.createdAt > 30 * DAY,
          )
          .slice(0, 100)
          .map((entry) => entry.id),
      );
      update();
    };
    clear.onclick = () => {
      this.selected.clear();
      update();
    };
    preview.onclick = () => props.previewCleanup([...this.selected]);
    const pageSize = 25;
    this.page = Math.min(this.page, Math.max(0, Math.ceil(props.entries.length / pageSize) - 1));
    for (const entry of props.entries.slice(this.page * pageSize, (this.page + 1) * pageSize)) {
      const card = el.createDiv({ cls: 'atlas-card' }),
        allowed = canCleanRecovery(entry);
      const label = card.createEl('label', { cls: 'atlas-consent' });
      const input = label.createEl('input', {
        type: 'checkbox',
        attr: {
          'data-record': entry.id,
          'aria-label': t('Select recovery data for {id}', { id: entry.id }),
        },
      });
      input.disabled = props.busy || !allowed;
      input.checked = this.selected.has(entry.id);
      input.onchange = () => {
        if (input.checked) this.selected.add(entry.id);
        else this.selected.delete(entry.id);
        update();
      };
      label.createSpan({
        text:
          entry.createdAt !== undefined
            ? `${formatDate(entry.createdAt)} · ${operationName(entry.kind)}`
            : entry.id,
      });
      card.createEl('p', {
        text: `${stateName(entry.state)}${entry.error ? `: ${problem(entry.error)}` : ''}`,
      });
      card.createEl('p', {
        text: t('Recovery storage: {size}', {
          size: entry.storageBytes === undefined ? t('unknown') : bytes(entry.storageBytes),
        }),
        cls: 'atlas-muted',
      });
      if (!allowed)
        card.createEl('p', {
          text: t('Cleanup unavailable: resolve unfinished work or damaged recovery data first.'),
          cls: 'atlas-muted',
        });
      // Damaged directory names must remain visible; only the domain validates paths used for I/O.
      const path = `${RECOVERY_ROOT}/${entry.id}`;
      card.createEl('code', { text: `${path}/` });
      const buttons = card.createDiv({ cls: 'atlas-actions' });
      const copy = buttons.createEl('button', { text: t('Copy recovery folder path') });
      copy.onclick = () => {
        void navigator.clipboard
          .writeText(`${path}/`)
          .then(
            () =>
              new Notice(
                entry.state === 'cleanupPending'
                  ? t(
                      'Also preserve the matching .cleanup marker in the recovery root. Removed files cannot be exported.',
                    )
                  : t('Copy the complete folder to export its recovery materials.'),
              ),
          )
          .catch(
            () => new Notice(t('Could not access clipboard. Copy the displayed path manually.')),
          );
      };
      if (
        entry.kind &&
        !entry.error &&
        entry.state !== 'cleanupPending' &&
        !['restored', 'rolledBack'].includes(entry.state)
      ) {
        const restore = buttons.createEl('button', { text: t('Preview recovery') });
        restore.disabled = props.busy;
        restore.onclick = () => props.previewRestore(entry.id);
      }
      if (allowed) {
        const clean = buttons.createEl('button', {
          text: entry.state === 'cleanupPending' ? t('Continue cleanup') : t('Clean recovery data'),
        });
        clean.disabled = props.busy;
        clean.onclick = () => props.previewCleanup([entry.id]);
      }
      if (entry.createdAt !== undefined && Date.now() - entry.createdAt > 30 * DAY)
        card.createEl('p', {
          text: t('Older than 30 days. Data remains retained until you confirm cleanup.'),
          cls: 'atlas-muted',
        });
    }
    if (props.entries.length > pageSize) {
      const navigation = el.createDiv({ cls: 'atlas-actions' });
      const previous = navigation.createEl('button', { text: t('Previous records') });
      previous.disabled = this.page === 0;
      previous.onclick = () => {
        this.page--;
        this.render(el, props);
      };
      navigation.createSpan({
        text: t('Page {page} of {total}', {
          page: this.page + 1,
          total: Math.ceil(props.entries.length / pageSize),
        }),
      });
      const next = navigation.createEl('button', { text: t('Next records') });
      next.disabled = (this.page + 1) * pageSize >= props.entries.length;
      next.onclick = () => {
        this.page++;
        this.render(el, props);
      };
    }
    update();
  }
}
