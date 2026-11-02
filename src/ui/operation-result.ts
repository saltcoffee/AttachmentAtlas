import type { ExecutionResult, GroupState, ActionState } from '../application/execution-result';
import { checkedByteTotal } from '../domain/operation-limits';
import { t, problem } from './i18n';
import { exactBytes } from './modals';
import { captureFocus, restoreFocus } from './focus';

const groupLabels: Record<GroupState, string> = {
  completed: 'Completed',
  partial: 'Partially completed',
  unprocessed: 'Not processed',
  unconfirmed: 'Result unconfirmed',
};
const actionLabels: Record<ActionState, string> = {
  'not-started': 'Not processed',
  verified: 'Verified',
  unconfirmed: 'Result unconfirmed',
};
const outcomeLabels = {
  completed: 'Cleanup completed',
  cancelled: 'Cleanup cancelled',
  failed: 'Cleanup failed',
};
const stageLabels = {
  'validate-plan': 'Validating plan',
  preflight: 'Rechecking vault',
  'prove-groups': 'Comparing duplicate bytes',
  rewrite: 'Updating references',
  'verify-references': 'Verifying all reference changes',
  remove: 'Deleting images',
  'final-verify': 'Final verification',
};

/** A read-only projection of the most recent session result; never retains a plan or source text. */
export class OperationResultView {
  private result: ExecutionResult | null = null;
  private groupPage = 0;
  private imagePage = 0;
  private documentPage = 0;
  private open = false;
  render(parent: HTMLElement, result: ExecutionResult, busy: boolean, scan: () => void): void {
    if (this.result !== result) {
      this.result = result;
      this.groupPage = this.imagePage = this.documentPage = 0;
      this.open = true;
    }
    const root = parent.createDiv({ cls: 'atlas-operation-result' });
    root.dataset.focusFallback = 'result:scan';
    const draw = () => {
      const focus = captureFocus(root);
      root.empty();
      root.createEl('h3', { text: t('Last cleanup result') });
      root.createEl('p', { text: t(outcomeLabels[result.outcome]), attr: { role: 'status' } });
      root.createEl('p', {
        text: t('Stopped at: {stage}', { stage: t(stageLabels[result.stoppedAt]) }),
      });
      if (result.cancellationRequested)
        root.createEl('p', { text: t('Cancellation was requested.') });
      if (result.issue)
        root.createEl('p', { text: problem(result.issue.detail), cls: 'atlas-error' });
      if (result.issue?.path)
        root.createEl('p', {
          text: t('Stopped at file: {path}', { path: result.issue.path }),
          cls: 'atlas-error',
        });
      const verified = result.images.filter((image) => image.state === 'verified');
      root.createEl('p', {
        text: t('{confirmed} of {total} images verified deleted · {size} active-image reduction', {
          confirmed: verified.length,
          total: result.images.length,
          size: exactBytes(checkedByteTotal(verified.map((image) => image.size))),
        }),
      });
      for (const state of ['completed', 'partial', 'unprocessed', 'unconfirmed'] as const)
        if (result.groups.length)
          root.createEl('span', {
            text: t('{state}: {count} groups · ', {
              state: t(groupLabels[state]),
              count: result.groups.filter((group) => group.state === state).length,
            }),
          });
      root.createEl('p', {
        text: t(
          'This is the last task’s observed result. Scan again to check the current vault. Updated references are not automatically restored.',
        ),
      });
      const rescan = root.createEl('button', { text: t('Scan again') });
      rescan.dataset.focusKey = 'result:scan';
      rescan.disabled = busy;
      rescan.onclick = scan;
      const details = root.createEl('details');
      details.open = this.open;
      details.createEl('summary', { text: t('Show group and file results') });
      const body = details.createDiv();
      let loaded = false;
      const load = () => {
        this.open = details.open;
        if (!details.open) {
          body.empty();
          loaded = false;
          return;
        }
        if (loaded) return;
        loaded = true;
        for (const group of result.groups.slice(this.groupPage * 25, (this.groupPage + 1) * 25)) {
          const row = body.createDiv({ cls: 'atlas-card' });
          row.createEl('strong', { text: t(groupLabels[group.state]) });
          row.createEl('p', { text: t('Retain: {path}', { path: group.keepPath }) });
          row.createEl('p', {
            text: t('{confirmed} of {total} reference targets verified', {
              confirmed: group.verifiedEdits,
              total: group.plannedEdits,
            }),
          });
          row.createEl('p', {
            text: t(
              '{confirmed} of {total} images verified deleted · {size} active-image reduction',
              {
                confirmed: verified.filter((image) => group.retirePaths.includes(image.path))
                  .length,
                total: group.retirePaths.length,
                size: exactBytes(
                  checkedByteTotal(
                    verified
                      .filter((image) => group.retirePaths.includes(image.path))
                      .map((image) => image.size),
                  ),
                ),
              },
            ),
          });
        }
        this.pages(body, this.groupPage, result.groups.length, 25, 'result:groups', (page) => {
          this.groupPage = page;
          draw();
        });
        body.createEl('h4', { text: t('Document results') });
        for (const doc of result.documents.slice(
          this.documentPage * 50,
          (this.documentPage + 1) * 50,
        ))
          body.createEl('p', {
            text: t('{path}: {state}', { path: doc.path, state: t(actionLabels[doc.state]) }),
          });
        this.pages(
          body,
          this.documentPage,
          result.documents.length,
          50,
          'result:documents',
          (page) => {
            this.documentPage = page;
            draw();
          },
        );
        body.createEl('h4', { text: t('Image results') });
        for (const image of result.images.slice(this.imagePage * 50, (this.imagePage + 1) * 50)) {
          const group = result.groups.find((group) => group.retirePaths.includes(image.path));
          body.createEl('p', {
            text: t('{path}: {state}', { path: image.path, state: t(actionLabels[image.state]) }),
          });
          if (group) body.createEl('p', { text: t('Retain: {path}', { path: group.keepPath }) });
        }
        this.pages(body, this.imagePage, result.images.length, 50, 'result:images', (page) => {
          this.imagePage = page;
          draw();
        });
      };
      details.ontoggle = load;
      load();
      restoreFocus(root, focus);
    };
    draw();
  }
  private pages(
    parent: HTMLElement,
    page: number,
    total: number,
    size: number,
    key: string,
    change: (page: number) => void,
  ): void {
    if (total <= size) return;
    const row = parent.createDiv({ cls: 'atlas-actions' });
    const previous = row.createEl('button', { text: t('Previous') });
    previous.dataset.focusKey = `${key}:previous`;
    previous.dataset.focusFallback = `${key}:next`;
    previous.disabled = page === 0;
    previous.onclick = () => change(page - 1);
    row.createSpan({
      text: t('Page {page} of {total}', { page: page + 1, total: Math.ceil(total / size) }),
    });
    const next = row.createEl('button', { text: t('Next') });
    next.dataset.focusKey = `${key}:next`;
    next.dataset.focusFallback = `${key}:previous`;
    next.disabled = (page + 1) * size >= total;
    next.onclick = () => change(page + 1);
  }
}
