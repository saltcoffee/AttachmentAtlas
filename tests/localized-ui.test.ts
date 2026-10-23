import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Setting,
  type App,
  type PluginManifest,
  type SettingGroup,
  type WorkspaceLeaf,
} from 'obsidian';
import AttachmentAtlas from '../src/main';
import { ConfirmPlanModal } from '../src/ui/modals';
import { OrganizerView } from '../src/ui/organizer-view';
import { AtlasSettingsTab } from '../src/ui/settings-tab';
import { t } from '../src/ui/i18n';
import { buildPlan } from '../src/application/plan';
import { MemoryVault, PNG, snapshot } from './helpers';
import { UiElement } from './ui-elements';
import { drawing } from './excalidraw-fixtures';
import { settingsFrom } from '../src/infrastructure/settings';

const host = vi.hoisted(() => ({
  language: 'en',
  commands: [] as { id: string; name: string }[],
  ribbon: '',
  notices: [] as string[],
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
    addText(callback: (input: object) => void) {
      this.addInput('input', callback);
      return this;
    }
    addTextArea(callback: (input: object) => void) {
      this.addInput('textarea', callback);
      return this;
    }
    private addInput(tag: string, callback: (input: object) => void) {
      const element = this.el.createEl(tag);
      const input = {
        setValue(value: string) {
          element.value = value;
          return input;
        },
        onChange(onChange: (value: string) => void) {
          element.onchange = () => onChange(element.value);
          return input;
        },
      };
      callback(input);
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
        onClick(onClick: () => void) {
          element.onclick = onClick;
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
    Notice: class {
      constructor(text: string) {
        host.notices.push(text);
      }
    },
    FileSystemAdapter: class {},
    MarkdownView: class {},
    TFile: class {},
    getLanguage: () => host.language,
  };
});

function elements(element: HTMLElement): UiElement {
  return element as unknown as UiElement;
}
function renderSettings(tab: AtlasSettingsTab): UiElement {
  const container = elements(tab.containerEl);
  for (const definition of tab.getSettingDefinitions()) {
    if (!('type' in definition) || definition.type !== 'group') continue;
    for (const item of definition.items ?? []) {
      if ('type' in item) continue;
      const setting = new Setting(container as unknown as HTMLElement).setName(item.name);
      if (typeof item.desc === 'string') setting.setDesc(item.desc);
      if ('render' in item) item.render?.(setting, {} as SettingGroup);
    }
  }
  return container;
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
    host.notices = [];
  });
  it.each([
    ['zh', '扫描库内图片', '扫描当前库', '完全重复', '保存设置', '删除 1 张图片', '取消'],
    [
      'en',
      'Scan vault images',
      'Scan vault',
      'Exact duplicates',
      'Save settings',
      'Delete 1 images',
      'Cancel',
    ],
    [
      'fr',
      'Scan vault images',
      'Scan vault',
      'Exact duplicates',
      'Save settings',
      'Delete 1 images',
      'Cancel',
    ],
  ])(
    'renders commands, settings, organizer and confirmation dialogs for %s',
    async (language, command, scan, category, save, recycle, cancel) => {
      host.language = language;
      const plugin = new AttachmentAtlas(app, {} as PluginManifest);
      await plugin.onload();
      expect(host.commands.find((item) => item.id === 'scan-vault')?.name).toBe(command);
      expect(host.commands.map((item) => item.id)).toEqual([
        'open-organizer',
        'scan-vault',
        'scan-attachment-folder',
      ]);
      expect(host.ribbon).toBe(
        language === 'zh' ? '打开 Attachment Atlas' : 'Open Attachment Atlas',
      );
      const settings = new AtlasSettingsTab(app, plugin);
      expect(renderSettings(settings).contents()).toContain(save);

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
      expect(content).not.toContain(language === 'zh' ? '操作历史' : 'History');
      expect(content).toContain('Scan vault.png');

      const plan = buildPlan(result, ['b.png'], 'Scan vault.png');
      const confirm = vi.fn().mockResolvedValue(undefined);
      const modal = new ConfirmPlanModal(app, plan, confirm);
      modal.onOpen();
      const nodes = elements(modal.contentEl).all();
      const confirmationText = elements(modal.contentEl).contents();
      expect(confirmationText).toContain(language === 'zh' ? '废纸篓' : 'system trash');
      expect(confirmationText).toContain(
        language === 'zh'
          ? '永久删除的图片无法找回'
          : 'Permanently deleted images cannot be restored',
      );
      expect(confirmationText).toContain(
        language === 'zh'
          ? '我已核对文件路径，并了解 Obsidian 的设置可能导致这些图片被永久删除。'
          : 'I reviewed the file paths and understand that Obsidian’s setting may permanently delete these images.',
      );
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

      expect(vault.files).toEqual(before);
      expect(vault.removed).toEqual([]);
      plugin.onunload();
    },
  );

  it('indexes settings without side effects and saves a normalized draft only on confirmation', async () => {
    const saved = settingsFrom({ scope: '', preferredFolder: '', protectedPaths: [] });
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const plugin = { settings: saved, updateSettings } as unknown as AttachmentAtlas;
    const tab = new AtlasSettingsTab(app, plugin);
    const definitions = tab.getSettingDefinitions();
    const group = definitions[0];
    expect(
      group && 'type' in group && group.type === 'group' && group.items?.map((item) => item.name),
    ).toEqual(['', 'Image scope', 'Preferred retained folder', 'Protected paths', 'Save settings']);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(elements(tab.containerEl).all()).toHaveLength(1);

    const container = renderSettings(tab);
    const inputs = container.all().filter((element) => ['input', 'textarea'].includes(element.tag));
    for (const [index, value] of [
      ' images ',
      ' images/retained ',
      ' important \n\n notes ',
    ].entries()) {
      inputs[index]!.value = value;
      inputs[index]!.onchange?.();
    }
    expect(plugin.settings).toEqual(saved);
    expect(updateSettings).not.toHaveBeenCalled();
    container
      .all()
      .find((element) => element.tag === 'button')!
      .onclick?.();
    await vi.waitFor(() => expect(host.notices).toContain('Attachment Atlas settings saved.'));
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      scope: 'images',
      preferredFolder: 'images/retained',
      protectedPaths: ['important', 'notes'],
    });
  });

  it('reports invalid drafts without changing persisted settings', async () => {
    const saved = settingsFrom({ scope: '', preferredFolder: '', protectedPaths: [] });
    const updateSettings = vi.fn(async (value: unknown) => {
      settingsFrom(value);
    });
    const plugin = { settings: saved, updateSettings } as unknown as AttachmentAtlas;
    const container = renderSettings(new AtlasSettingsTab(app, plugin));
    const input = container.all().find((element) => element.tag === 'input')!;
    input.value = '../outside-vault';
    input.onchange?.();
    container
      .all()
      .find((element) => element.tag === 'button')!
      .onclick?.();
    await vi.waitFor(() => expect(host.notices.join('\n')).toContain('Invalid settings.'));
    expect(plugin.settings).toEqual(saved);
    expect(host.notices).not.toContain('Attachment Atlas settings saved.');
  });
  it('reads language changes from Obsidian', () => {
    host.language = 'zh-TW';
    expect(t('Scan vault')).toBe('扫描当前库');
    host.language = 'de';
    expect(t('Scan vault')).toBe('Scan vault');
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
});
