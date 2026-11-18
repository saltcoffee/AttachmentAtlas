import { problem, t } from './i18n';
import {
  coverageIssueNextStep,
  coverageIssueReason,
  type CoverageIssue,
} from '../domain/reference-coverage';

/**
 * Renders structured reference-coverage problems: category, specific detail, the effective next
 * step and an action to open the affected source. It never reads files or decides deletion.
 */
export function renderCoverageIssues(
  parent: HTMLElement,
  issues: readonly CoverageIssue[],
  openSource: (path: string) => void,
): void {
  for (const issue of issues) {
    const row = parent.createDiv({ cls: 'atlas-coverage-issue' });
    row.createEl('p', {
      text: problem(coverageIssueReason(issue.code)),
      cls: 'atlas-error',
      attr: { role: 'alert' },
    });
    if (issue.detail)
      row.createEl('p', { text: problem(issue.detail), cls: 'atlas-muted' });
    row.createEl('p', {
      text: problem(coverageIssueNextStep(issue.code)),
      cls: 'atlas-muted',
    });
    if (issue.source) {
      const open = row.createEl('button', {
        text: t('Open source: {path}', { path: issue.source }),
      });
      open.dataset.focusKey = `coverage:${issue.source}`;
      open.onclick = () => openSource(issue.source!);
    }
  }
}
