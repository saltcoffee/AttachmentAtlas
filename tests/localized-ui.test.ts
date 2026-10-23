import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, PluginManifest, WorkspaceLeaf } from 'obsidian';
import AttachmentAtlas from '../src/main';
import { ConfirmPlanModal, RestoreModal } from '../src/ui/modals';
import { CleanupModal } from '../src/ui/cleanup-modal';
import { OrganizerView } from '../src/ui/organizer-view';
import { AtlasSettingsTab } from '../src/ui/settings-tab';
import { HistorySection } from '../src/ui/history-section';
import { operationName, stateName, t } from '../src/ui/i18n';
import { buildPlan } from '../src/application/plan';
import { MemoryVault, PNG, snapshot } from './helpers';
import { UiElement } from './ui-elements';
import { drawing } from './excalidraw-fixtures';

const host = vi.hoisted(() => ({
  language: 'en',
  commands: [] as { id: string; name: string }[],
  ribbon: '',
}));
vi.mock('obsidian', async () => {
  const { UiElement } = await import('./ui-elements');
  class Modal {
    contentEl = new UiElement();
    close() {}
  }
  class ItemView {
    contentEl = new UiElement();
    app: App;
    constructor(leaf: { app: App }) {
      this.app = leaf.app;
    }
  }
  class PluginSettingTab {
    containerEl = new UiElement();
  }
  class Setting {
    constructor(private el: UiElement) {}
    setName(text: string) {
      this.el.createEl('label', { text });
      return this;
    }
    setDesc(text: string) {
      this.el.createEl('p', { text });
      return this;
    }
    addText() {
      return this;
    }
    addTextArea() {
      return this;
    }
    addButton(callback: (button: object) => void) {
      const element = this.el.createEl('button');
      const button = {
        setButtonText(text: string) {
          element.text = text;
          return button;
        },
        setCta() {
          return button;
        },
        onClick() {
          return button;
        },
      };
      callback(button);
      return this;
    }
  }
  class Plugin {
    constructor(readonly app: App) {}
    async loadData() {
      return null;
    }
    registerView() {}
    addSettingTab() {}
    addRibbonIcon(_icon: string, title: string) {
      host.ribbon = title;
    }
    addCommand(command: { id: string; name: string }) {
      host.commands.push(command);
    }
    registerEvent() {}
  }
  return {
    Modal,
    ItemView,
    PluginSettingTab,
    Setting,
    Plugin,
    Notice: class {},
    FileSystemAdapter: class {},
    MarkdownView: class {},
    TFile: class {},
    getLanguage: () => host.language,
  };
});

function elements(element: HTMLElement): UiElement {
  return element as unknown as UiElement;
}
const app = {
  vault: { adapter: { getResourcePath: (path: string) => path }, on: () => ({}) },
  workspace: { onLayoutReady: () => undefined },
} as unknown as App;

describe('localized plugin surfaces', () => {
  beforeEach(() => {
    host.language = 'en';
    host.commands = [];
    host.ribbon = '';
  });
  it.each([
    [
      'zh',
      '扫描库内图片',
      '扫描当前库',
      '完全重复',
      '保存设置',
      '回收 1 张图片',
      '取消',
      '永久删除 1 条恢复记录',
    ],
    [
      'en',
      'Scan vault images',
      'Scan vault',
      'Exact duplicates',
      'Save settings',
      'Recycle 1 images',
      'Cancel',
      'Permanently delete 1 recovery records',
    ],
    [
      'fr',
      'Scan vault images',
      'Scan vault',
      'Exact duplicates',
      'Save settings',
      'Recycle 1 images',
      'Cancel',
      'Permanently delete 1 recovery records',
    ],
  ])(
    'renders commands, settings, organizer and confirmation dialogs for %s',
    async (language, command, scan, category, save, recycle, cancel, remove) => {
      host.language = language;
      const plugin = new AttachmentAtlas(app, {} as PluginManifest);
      await plugin.onload();
      expect(host.commands.find((item) => item.id === 'scan-vault')?.name).toBe(command);
      expect(host.commands.map((item) => item.id)).toEqual([
        'open-organizer',
        'scan-vault',
        'open-history',
        'scan-attachment-folder',
      ]);
      expect(host.ribbon).toBe(
        language === 'zh' ? '打开 Attachment Atlas' : 'Open Attachment Atlas',
      );
      const settings = new AtlasSettingsTab(app, plugin);
      settings.display();
      expect(elements(settings.containerEl).contents()).toContain(save);

      const vault = new MemoryVault({
        'Scan vault.png': PNG,
        'b.png': PNG,
        'note.md': '![[b.png]]',
      });
      const result = await snapshot(vault);
      const before = new Map(vault.files);
      const organizer = new OrganizerView({ app } as unknown as WorkspaceLeaf, plugin);
      organizer.render();
      expect(elements(organizer.contentEl).contents()).toContain(scan);
      plugin.snapshot = result;
      organizer.render();
      const content = elements(organizer.contentEl).contents();
      expect(content).toContain(language === 'zh' ? '重新扫描' : 'Scan again');
      expect(content).toContain(category);
      expect(content).toContain('Scan vault.png');

      const plan = buildPlan(result, ['b.png'], 'Scan vault.png');
      const history = new UiElement();
      new HistorySection().render(history as unknown as HTMLElement, {
        entries: [
          {
            id: plan.id,
            createdAt: plan.createdAt,
            kind: plan.kind,
            state: 'completed',
            storageBytes: 10,
          },
        ],
        busy: false,
        previewCleanup: vi.fn(),
        previewRestore: vi.fn(),
      });
      expect(history.contents()).toContain(
        language === 'zh' ? '清空恢复区' : 'Empty recovery area',
      );
      expect(history.contents()).toContain(language === 'zh' ? '已完成' : 'Completed');
      expect(history.contents()).not.toContain('merge-exact');
      const confirm = vi.fn().mockResolvedValue(undefined);
      const modal = new ConfirmPlanModal(app, plan, confirm);
      modal.onOpen();
      const nodes = elements(modal.contentEl).all();
      const button = nodes.find((node) => node.tag === 'button' && node.text === recycle)!;
      const consent = nodes.find((node) => node.attrs.type === 'checkbox')!;
      expect(button.disabled).toBe(true);
      button.onclick?.();
      expect(confirm).not.toHaveBeenCalled();
      consent.checked = true;
      consent.onchange?.();
      expect(button.disabled).toBe(false);
      button.onclick?.();
      expect(confirm).toHaveBeenCalledOnce();
      expect(nodes.some((node) => node.text === cancel)).toBe(true);

      const restore = new RestoreModal(app, plan, vi.fn().mockResolvedValue(undefined));
      restore.onOpen();
      expect(elements(restore.contentEl).contents()).toContain(
        language === 'zh' ? '检查冲突并恢复' : 'Check conflicts and restore',
      );
      const cleanup = new CleanupModal(
        app,
        {
          totalBytes: 10,
          records: [
            {
              id: plan.id,
              createdAt: plan.createdAt,
              kind: plan.kind,
              resuming: false,
              folder: 'recovery-folder',
              marker: 'marker',
              size: 10,
              paths: [],
            },
          ],
        },
        vi.fn(),
      );
      cleanup.onOpen();
      const cleanupButton = elements(cleanup.contentEl)
        .all()
        .find((node) => node.text === remove)!;
      expect(cleanupButton.disabled).toBe(true);
      expect(vault.files).toEqual(before);
      expect(vault.removed).toEqual([]);
      plugin.onunload();
    },
  );
  it('reads changes from Obsidian and translates states without changing stored state strings', () => {
    host.language = 'zh-TW';
    expect(t('History')).toBe('操作历史');
    expect(operationName('merge-exact')).toBe('完全重复图片合并');
    expect(stateName('writing:Scan vault.png')).toBe('正在更新引用：Scan vault.png');
    expect(stateName('completed')).toBe('已完成');
    host.language = 'de';
    expect(t('History')).toBe('History');
    expect(stateName('completed')).toBe('Completed');
    expect(stateName('unknown')).toBe('Unknown state: unknown');
  });
  it('explains incomplete coverage and links directly to the blocking issues', async () => {
    host.language = 'zh';
    const plugin = new AttachmentAtlas(app, {} as PluginManifest);
    plugin.snapshot = await snapshot(
      new MemoryVault({ 'a.png': PNG, 'b.png': PNG, 'map.base': 'filters: []' }),
    );
    const view = new OrganizerView({ app } as unknown as WorkspaceLeaf, plugin);
    view.render();
    const root = elements(view.contentEl);
    expect(root.contents()).toContain('疑似未引用');
    expect(root.contents()).toContain('请在“待检查”中处理阻塞问题');
    expect(root.all().find((node) => node.text === '预览合并（1）')?.disabled).toBe(true);
    root
      .all()
      .find((node) => node.text === '疑似未引用')
      ?.onclick?.();
    expect(root.contents()).toContain('暂未检测到引用，但引用检查尚不完整');
    expect(
      root
        .all()
        .filter((node) => node.attrs.type === 'checkbox')
        .every((node) => node.disabled),
    ).toBe(true);
    root
      .all()
      .find((node) => node.text === '查看阻塞问题')
      ?.onclick?.();
    expect(root.contents()).toContain('不支持的引用容器：map.base');
  });
  it('retains the drawing-used copy by default and explains a different blocked choice', async () => {
    host.language = 'zh';
    const plugin = new AttachmentAtlas(app, {} as PluginManifest);
    plugin.snapshot = await snapshot(
      new MemoryVault({
        'a.png': PNG,
        'used.png': PNG,
        'map.excalidraw.md': drawing([], '## Embedded Files\nfile1: [[used.png]]\n'),
      }),
    );
    const preview = vi.spyOn(plugin, 'preview').mockImplementation(() => undefined);
    const view = new OrganizerView({ app } as unknown as WorkspaceLeaf, plugin);
    view.render();
    const root = elements(view.contentEl);
    const select = root.all().find((node) => node.tag === 'select')!;
    const button = root.all().find((node) => node.text === '预览合并（1）')!;
    expect(select.value).toBe('used.png');
    expect(button.disabled).toBe(false);
    button.onclick?.();
    expect(preview).toHaveBeenCalledWith(['a.png'], 'used.png');
    select.value = 'a.png';
    select.onchange?.();
    expect(button.disabled).toBe(true);
    expect(root.contents()).toContain('当前保留方案下没有可回收的重复副本');
  });
  it('allows immediate selection and drops stale selections after a new scan', async () => {
    host.language = 'zh';
    const plugin = new AttachmentAtlas(app, {} as PluginManifest);
    const vault = new MemoryVault({ 'unused.png': PNG });
    plugin.snapshot = await snapshot(vault);
    const preview = vi.spyOn(plugin, 'preview').mockImplementation(() => undefined);
    const view = new OrganizerView({ app } as unknown as WorkspaceLeaf, plugin);
    view.render();
    const root = elements(view.contentEl);
    root
      .all()
      .find((node) => node.text === '未引用')
      ?.onclick?.();
    const checkbox = root.all().find((node) => node.attrs.type === 'checkbox')!;
    expect(checkbox.disabled).toBe(false);
    expect(root.contents()).not.toContain('24 小时');
    checkbox.checked = true;
    checkbox.onchange?.();
    const button = root.all().find((node) => node.text === '预览回收（1）')!;
    expect(button.disabled).toBe(false);
    button.onclick?.();
    expect(preview).toHaveBeenCalledWith(['unused.png']);
    vault.files.set('note.md', new TextEncoder().encode('![[unused.png]]').buffer);
    plugin.snapshot = await snapshot(vault);
    view.render();
    expect(root.all().find((node) => node.text === '预览回收（0）')?.disabled).toBe(true);
  });
  it('explains unfinished recovery records before offering another write operation', async () => {
    host.language = 'zh';
    const plugin = new AttachmentAtlas(app, {} as PluginManifest);
    plugin.snapshot = await snapshot(new MemoryVault({ 'a.png': PNG, 'b.png': PNG }));
    plugin.history = [{ id: crypto.randomUUID(), state: 'needsRecovery' }];
    const view = new OrganizerView({ app } as unknown as WorkspaceLeaf, plugin);
    view.render();
    const root = elements(view.contentEl);
    expect(root.contents()).toContain('请先在“操作历史”中处理未完成的恢复操作');
    expect(root.all().find((node) => node.text === '预览合并（1）')?.disabled).toBe(true);
  });
});
