import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, PluginManifest, WorkspaceLeaf } from 'obsidian';
import AttachmentAtlas from '../src/main';
import { OrganizerView } from '../src/ui/organizer-view';
import type { PlanRequest } from '../src/application/plan';
import type { Plan, Snapshot } from '../src/domain/model';
import * as scans from '../src/application/scan';
import { MemoryVault, PNG, recyclePlan, snapshot } from './helpers';
import { UiElement } from './ui-elements';

const host = vi.hoisted(() => ({
  build: vi.fn(),
  cancel: vi.fn(),
  execute: vi.fn(),
  modals: [] as { contentEl: UiElement; close(): void }[],
}));
vi.mock('../src/infrastructure/plan-client', () => ({
  PlanClient: class {
    build = host.build;
    cancel = host.cancel;
  },
}));
vi.mock('../src/application/execute', () => ({
  OperationService: class {
    execute = host.execute;
  },
}));
// Session tests exercise the real plugin and modal lifecycle without a native Obsidian window.
vi.mock('obsidian', async () => {
  const { UiElement } = await import('./ui-elements');
  return {
    getLanguage: () => 'en',
    Notice: class {},
    Plugin: class {
      constructor(readonly app: App) {}
      async loadData() {
        return null;
      }
      registerView() {}
      addSettingTab() {}
      addRibbonIcon() {}
      addCommand() {}
      registerEvent() {}
    },
    Modal: class {
      contentEl = new UiElement();
      constructor() {
        host.modals.push(this);
      }
      onOpen() {}
      onClose() {}
      open() {
        this.onOpen();
      }
      close() {
        this.onClose();
      }
    },
    ItemView: class {
      contentEl = new UiElement();
      constructor(readonly leaf: WorkspaceLeaf) {}
    },
    PluginSettingTab: class {},
    Setting: class {},
    FileSystemAdapter: class {},
    MarkdownView: class {},
    TFile: class {},
  };
});

function deferred() {
  let resolve!: (plan: Plan) => void, reject!: (error: Error) => void;
  const promise = new Promise<Plan>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function setup() {
  const callbacks = new Map<string, () => void>();
  const leaves: { view: OrganizerView }[] = [];
  const app = {
    vault: {
      on: (name: string, callback: () => void) => {
        callbacks.set(name, callback);
        return {};
      },
      adapter: { getResourcePath: (path: string) => path },
    },
    workspace: { getLeavesOfType: () => leaves },
  } as unknown as App;
  const plugin = new AttachmentAtlas(app, {} as PluginManifest);
  await plugin.onload();
  const result = await snapshot(new MemoryVault({ 'unused.png': PNG }));
  result.revision = 0;
  const scanId = plugin.selection.beginScan();
  plugin.snapshot = result;
  plugin.selection.acceptSnapshot(scanId, result);
  plugin.selection.setUnreferencedSelected(['unused.png'], true);
  const view = new OrganizerView({ app } as unknown as WorkspaceLeaf, plugin);
  leaves.push({ view });
  await view.onOpen();
  const request = (): PlanRequest => ({
    scanId: plugin.selection.state.scanId,
    selectionRevision: plugin.selection.state.selectionRevision,
    selection: { kind: 'recycle-unreferenced', retirePaths: ['unused.png'] },
  });
  const plan = recyclePlan(result, ['unused.png']);
  const root = view.contentEl as unknown as UiElement;
  return { plugin, view, root, callbacks, request, plan, leaves };
}
function consent(modal: { contentEl: UiElement }) {
  const field = modal.contentEl.all().find((element) => element.attrs.type === 'checkbox')!;
  field.checked = true;
  field.onchange?.();
  return modal.contentEl.all().find((element) => element.text === 'Delete 1 images')!;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });
  host.build.mockReset();
  host.cancel.mockReset();
  host.execute.mockReset().mockResolvedValue(undefined);
  host.modals = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('preview session boundaries', () => {
  it('preserves both views and their scroll positions while synchronizing selection', async () => {
    const ui = await setup();
    ui.root
      .all()
      .find((element) => element.dataset.focusKey === 'tab:unreferenced')!
      .onclick?.();
    const otherView = new OrganizerView(
      { app: ui.plugin.app } as unknown as WorkspaceLeaf,
      ui.plugin,
    );
    const other = otherView.contentEl as unknown as UiElement;
    other.ownerDocument = ui.root.ownerDocument;
    ui.leaves.push({ view: otherView });
    await otherView.onOpen();
    other
      .all()
      .find((element) => element.dataset.focusKey === 'tab:unreferenced')!
      .onclick?.();
    const key = 'image:unused.png';
    const checkbox = ui.root.all().find((element) => element.dataset.focusKey === key)!;
    const secondCheckbox = other.all().find((element) => element.dataset.focusKey === key)!;
    const search = ui.root.all().find((element) => element.dataset.focusKey === 'path');
    const empty = vi.spyOn(ui.root, 'empty'),
      otherEmpty = vi.spyOn(other, 'empty');
    ui.root.scrollTop = 640;
    other.scrollTop = 320;
    checkbox.focus();
    checkbox.checked = false;
    checkbox.onchange?.();
    expect(empty).not.toHaveBeenCalled();
    expect(otherEmpty).not.toHaveBeenCalled();
    expect(ui.root.scrollTop).toBe(640);
    expect(other.scrollTop).toBe(320);
    expect(ui.root.all().find((element) => element.dataset.focusKey === 'path')).toBe(search);
    expect(ui.root.all().find((element) => element.dataset.focusKey === key)).toBe(checkbox);
    expect(other.all().find((element) => element.dataset.focusKey === key)).toBe(secondCheckbox);
    expect(secondCheckbox.checked).toBe(false);
    expect(ui.root.ownerDocument.activeElement).toBe(checkbox);
    await otherView.onClose();
  });

  it('keeps invalid size input inline and does not expose a failed-build retry', async () => {
    const ui = await setup(),
      before = ui.plugin.selection.state;
    const field = ui.root.all().find((element) => element.dataset.focusKey === 'min')!;
    field.value = '-1';
    field.oninput?.();
    await ui.plugin.preview(ui.view, ui.request(), false);
    expect(field.attrs['aria-invalid']).toBe('true');
    expect(ui.root.contents()).toContain('Enter non-negative whole KiB values.');
    expect(ui.plugin.previewError).toBe('');
    expect(ui.plugin.canRetryPreview(ui.view)).toBe(false);
    expect(ui.root.all().some((element) => element.dataset.focusKey === 'retry-preview')).toBe(
      false,
    );
    expect(host.build).not.toHaveBeenCalled();
    expect(host.modals).toHaveLength(0);
    expect(ui.plugin.selection.state).toEqual(before);
  });

  it('reports a defensive snapshot rejection instead of leaving a progress status', async () => {
    const ui = await setup(),
      result = structuredClone(ui.plugin.snapshot!);
    const scan = vi.spyOn(scans, 'scan').mockResolvedValue(result);
    const accept = vi.spyOn(ui.plugin.selection, 'acceptSnapshot').mockReturnValue(false);
    try {
      await ui.plugin.scanVault();
      expect(ui.plugin.busy).toBe(false);
      expect(ui.plugin.snapshot).toBeNull();
      expect(ui.plugin.lastError).toBe('Scan results expired. Scan again.');
      expect(ui.plugin.status).toBe('Stopped. Review the error and scan again.');
    } finally {
      scan.mockRestore();
      accept.mockRestore();
    }
  });
  it('retains category focus and moves the disappearing blockers link to the review category', async () => {
    const ui = await setup();
    for (const tab of ['unreferenced', 'large', 'duplicates', 'blocked']) {
      const key = `tab:${tab}`;
      const button = ui.root.all().find((element) => element.dataset.focusKey === key)!;
      button.focus();
      button.onclick?.();
      expect(ui.root.ownerDocument.activeElement?.dataset.focusKey).toBe(key);
      expect(ui.root.ownerDocument.activeElement?.attrs['aria-pressed']).toBe('true');
    }
    ui.plugin.snapshot!.blockers.push('Reference coverage is incomplete.');
    ui.root
      .all()
      .find((element) => element.dataset.focusKey === 'tab:duplicates')!
      .onclick?.();
    const review = ui.root
      .all()
      .find((element) => element.dataset.focusKey === 'view-blocking-issues')!;
    review.focus();
    review.onclick?.();
    expect(ui.root.ownerDocument.activeElement?.dataset.focusKey).toBe('tab:blocked');
  });

  it('clears selection immediately when rescanning unchanged content at the same vault revision', async () => {
    const ui = await setup(),
      unchanged = structuredClone(ui.plugin.snapshot!);
    const old = ui.plugin.selection.state;
    let finish!: (result: Snapshot) => void;
    const result = new Promise<Snapshot>((resolve) => {
      finish = resolve;
    });
    const scan = vi.spyOn(scans, 'scan').mockReturnValue(result);
    try {
      const pending = ui.plugin.scanVault();
      expect(ui.plugin.busy).toBe(true);
      expect(ui.plugin.snapshot).toBeNull();
      expect(ui.plugin.selection.state.scanId).toBeGreaterThan(old.scanId);
      expect(ui.plugin.selection.state.unreferencedPaths).toEqual([]);
      expect(ui.plugin.selection.state.groups).toEqual({});
      expect(scan.mock.calls[0]![2].revision).toBe(unchanged.revision);
      finish(unchanged);
      await pending;
      expect(ui.plugin.snapshot).toEqual(unchanged);
      expect(ui.plugin.selection.state.unreferencedPaths).toEqual([]);
      expect(ui.plugin.busy).toBe(false);
    } finally {
      scan.mockRestore();
    }
  });
  it('revokes the token and ignores both cached button and confirmation callbacks after cancel', async () => {
    const ui = await setup(),
      build = deferred();
    host.build.mockReturnValue(build.promise);
    const pending = ui.plugin.preview(ui.view, ui.request());
    await vi.advanceTimersByTimeAsync(1);
    build.resolve(ui.plan);
    await pending;
    const modal = host.modals[0]!,
      button = consent(modal),
      click = button.onclick!;
    const confirm = (modal as unknown as { confirm(): Promise<void> }).confirm;
    const before = ui.plugin.selection.state;
    modal.close();
    click();
    await confirm();
    expect(host.execute).not.toHaveBeenCalled();
    expect(ui.plugin.selection.state).toEqual(before);
    expect(ui.plugin.lastError).toBe('');
  });

  it('accepts a genuine confirmation once, without treating its close event as cancellation', async () => {
    const ui = await setup();
    host.build.mockResolvedValue(ui.plan);
    const pending = ui.plugin.preview(ui.view, ui.request());
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    const modal = host.modals[0]!,
      button = consent(modal);
    button.onclick?.();
    button.onclick?.();
    await Promise.resolve();
    expect(host.execute).toHaveBeenCalledTimes(1);
    expect(host.execute.mock.calls[0]![0]).toEqual(ui.plan);
  });

  it('paints construction feedback before starting work and cancels without losing selection', async () => {
    const ui = await setup(),
      build = deferred();
    host.build.mockReturnValue(build.promise);
    const before = ui.plugin.selection.state,
      pending = ui.plugin.preview(ui.view, ui.request());
    expect(ui.root.contents()).toContain('Building preview.');
    expect(host.build).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    ui.root
      .all()
      .find((element) => element.dataset.focusKey === 'cancel-preview-build')!
      .onclick?.();
    build.resolve(ui.plan);
    await pending;
    expect(host.modals).toHaveLength(0);
    expect(ui.plugin.previewing).toBe(false);
    expect(ui.plugin.selection.state).toEqual(before);
  });

  it.each(['selection', 'vault', 'scan', 'view', 'filter'] as const)(
    'drops a result after %s invalidation',
    async (change) => {
      const ui = await setup(),
        build = deferred();
      host.build.mockReturnValue(build.promise);
      const pending = ui.plugin.preview(ui.view, ui.request());
      await vi.advanceTimersByTimeAsync(1);
      if (change === 'selection') ui.plugin.selection.clearUnreferenced();
      if (change === 'vault') ui.callbacks.get('modify')!();
      if (change === 'scan') {
        ui.plugin.snapshot = null;
        ui.plugin.selection.beginScan();
      }
      if (change === 'view') {
        await ui.view.onClose();
        ui.leaves.length = 0;
      }
      if (change === 'filter') {
        const field = ui.root.all().find((element) => element.dataset.focusKey === 'min')!;
        field.value = '-1';
        field.oninput?.();
      }
      build.resolve(ui.plan);
      await pending;
      expect(host.modals).toHaveLength(0);
      expect(ui.plugin.previewing).toBe(false);
      expect(ui.plugin.previewError).toBe('');
      expect(host.cancel).toHaveBeenCalled();
    },
  );

  it('keeps the newer preview when an older request fails late', async () => {
    const ui = await setup(),
      older = deferred(),
      newer = deferred();
    host.build.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = ui.plugin.preview(ui.view, ui.request());
    await vi.advanceTimersByTimeAsync(1);
    const second = ui.plugin.preview(ui.view, ui.request());
    await vi.advanceTimersByTimeAsync(1);
    newer.resolve(ui.plan);
    await second;
    older.reject(new Error('Old failure'));
    await first;
    expect(host.modals).toHaveLength(1);
    expect(ui.plugin.previewError).toBe('');
    consent(host.modals[0]!).onclick?.();
    await Promise.resolve();
    expect(host.execute).toHaveBeenCalledTimes(1);
  });

  it('leaves an accepted build running when another request is rejected before construction', async () => {
    const ui = await setup(),
      build = deferred();
    host.build.mockReturnValue(build.promise);
    const pending = ui.plugin.preview(ui.view, ui.request());
    await vi.advanceTimersByTimeAsync(1);
    await ui.plugin.preview(ui.view, ui.request(), false);
    expect(ui.plugin.previewing).toBe(true);
    expect(ui.plugin.previewError).toBe('');
    build.resolve(ui.plan);
    await pending;
    expect(host.modals).toHaveLength(1);
  });

  it('retries a failed build with the retained selection', async () => {
    const ui = await setup();
    host.build.mockRejectedValueOnce(new Error('Worker failed')).mockResolvedValueOnce(ui.plan);
    const before = ui.plugin.selection.state,
      pending = ui.plugin.preview(ui.view, ui.request());
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(ui.plugin.previewError).toBe('Worker failed');
    expect(ui.plugin.selection.state).toEqual(before);
    ui.root
      .all()
      .find((element) => element.dataset.focusKey === 'retry-preview')!
      .onclick?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(host.modals).toHaveLength(1);
    expect(ui.plugin.previewError).toBe('');
  });

  it('retains Stop task focus through progress redraws and still dispatches cancellation', async () => {
    const ui = await setup(),
      cancel = vi.spyOn(ui.plugin, 'cancel');
    ui.plugin.busy = true;
    ui.plugin.snapshot = null;
    ui.view.render();
    ui.root
      .all()
      .find((element) => element.dataset.focusKey === 'stop-task')!
      .focus();
    for (let i = 0; i < 3; i++) {
      ui.plugin.status = `Progress ${i}`;
      ui.view.render();
      expect(ui.root.ownerDocument.activeElement?.dataset.focusKey).toBe('stop-task');
    }
    ui.root.ownerDocument.activeElement!.onclick?.();
    expect(cancel).toHaveBeenCalledTimes(1);
    ui.plugin.busy = false;
    ui.view.render();
    expect(ui.root.ownerDocument.activeElement?.dataset.focusKey).toBe('scan');
  });
});
