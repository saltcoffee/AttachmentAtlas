import { describe, expect, it, vi } from 'vitest';
import type { ExecutionResult } from '../src/application/execution-result';
import { OperationResultView } from '../src/ui/operation-result';
import { UiElement } from './ui-elements';

const host = vi.hoisted(() => ({ language: 'en' }));
vi.mock('obsidian', () => ({
  getLanguage: () => host.language,
  Modal: class {},
  Notice: class {},
}));

function report(): ExecutionResult {
  return {
    kind: 'merge-exact',
    outcome: 'failed',
    cancellationRequested: true,
    stoppedAt: 'final-verify',
    finalVerification: 'failed',
    documents: Array.from({ length: 51 }, (_, index) => ({
      path: `note-${index}.md`,
      state: 'verified',
    })),
    images: Array.from({ length: 100 }, (_, index) => ({
      path: `copy-${index}.png`,
      size: 1024,
      state: index === 0 ? 'verified' : index === 1 ? 'unconfirmed' : 'not-started',
    })),
    groups: Array.from({ length: 100 }, (_, index) => ({
      groupKey: `g${index}`,
      keepPath: `keep-${index}.png`,
      state: index === 0 ? 'completed' : index === 1 ? 'unconfirmed' : 'unprocessed',
      documentPaths: ['note-0.md'],
      retirePaths: [`copy-${index}.png`],
      plannedEdits: 1,
      verifiedEdits: 1,
    })),
    issue: {
      stage: 'final-verify',
      path: 'images/changed-{count}.png',
      detail: 'A late source appeared.',
    },
  };
}

describe('session result presentation', () => {
  it.each(['en', 'zh'])(
    'shows the actual failed outcome, cancellation and confirmed bytes in %s',
    (language) => {
      host.language = language;
      const root = new UiElement(),
        scan = vi.fn();
      new OperationResultView().render(root as unknown as HTMLElement, report(), false, scan);
      const text = root.contents();
      expect(text).toContain(language === 'zh' ? '清理失败' : 'Cleanup failed');
      expect(text).not.toContain(language === 'zh' ? '清理完成' : 'Cleanup completed');
      expect(text).toContain(language === 'zh' ? '已请求取消' : 'Cancellation was requested.');
      expect(text).toContain(
        language === 'zh' ? '已确认删除 1 / 100' : '1 of 100 images verified deleted',
      );
      expect(text).toContain('1024');
      expect(text).toContain(
        language === 'zh'
          ? '停止时的文件：images/changed-{count}.png'
          : 'Stopped at file: images/changed-{count}.png',
      );
      root
        .all()
        .find((element) => element.dataset.focusKey === 'result:scan')!
        .onclick?.();
      expect(scan).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds document, group and file rendering while keeping every result reachable', () => {
    host.language = 'en';
    const root = new UiElement();
    new OperationResultView().render(root as unknown as HTMLElement, report(), false, vi.fn());
    expect(root.contents()).not.toContain('copy-99.png:');
    expect(root.contents()).not.toContain('note-50.md:');
    const next = root.all().find((element) => element.dataset.focusKey === 'result:images:next')!;
    next.focus();
    next.onclick?.();
    expect(root.contents()).toContain('copy-99.png: Not processed');
    expect(root.ownerDocument.activeElement?.dataset.focusKey).toBe('result:images:previous');
    root
      .all()
      .find((element) => element.dataset.focusKey === 'result:documents:next')!
      .onclick?.();
    expect(root.contents()).toContain('note-50.md: Verified');
    expect(root.all().filter((element) => element.tag === 'strong')).toHaveLength(25);
  });

  it('keeps the last result read-only and disables rescanning while another task is busy', () => {
    host.language = 'en';
    const root = new UiElement(),
      result = report(),
      before = structuredClone(result);
    const view = new OperationResultView();
    view.render(root as unknown as HTMLElement, result, true, vi.fn());
    expect(root.all().find((element) => element.dataset.focusKey === 'result:scan')!.disabled).toBe(
      true,
    );
    expect(result).toEqual(before);
    expect(
      root
        .all()
        .filter((element) => element.tag === 'button')
        .map((element) => element.text)
        .join(' '),
    ).not.toMatch(/Resume|Retry deletion|Undo/);
  });
});
