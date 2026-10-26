import { t, errorText } from './i18n';
import { App, PluginSettingTab, Notice, Setting } from 'obsidian';
import type AttachmentAtlas from '../main';
export class AtlasSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: AttachmentAtlas,
  ) {
    super(app, plugin);
  }
  display(): void {
    const el = this.containerEl;
    el.empty();
    new Setting(el).setName(t('Attachment Atlas')).setHeading();
    for (const row of this.settingRows()) {
      const setting = new Setting(el).setName(row.name);
      if (row.desc) setting.setDesc(row.desc);
      row.render?.(setting);
    }
  }
  getSettingDefinitions() {
    return [{ type: 'group' as const, heading: t('Attachment Atlas'), items: this.settingRows() }];
  }
  // Both supported host APIs render the same controls and draft; no 1.13-only types are imported.
  private settingRows() {
    let scope = this.plugin.settings.scope,
      preferred = this.plugin.settings.preferredFolder,
      protectedText = this.plugin.settings.protectedPaths.join('\n');
    return [
      {
        name: '',
        desc: t(
          'Paths are vault-relative, without a leading slash. Reference checks always cover the whole vault. Images can be recycled immediately after reference checks and confirmation.',
        ),
        searchable: false,
      },
      {
        name: t('Image scope'),
        desc: t('Leave empty to inspect all supported images.'),
        render: (setting: Setting) => {
          setting.addText((input) =>
            input.setValue(scope).onChange((value) => {
              scope = value.trim();
            }),
          );
        },
      },
      {
        name: t('Preferred retained folder'),
        desc: t('Used to recommend a retained duplicate.'),
        render: (setting: Setting) => {
          setting.addText((input) =>
            input.setValue(preferred).onChange((value) => {
              preferred = value.trim();
            }),
          );
        },
      },
      {
        name: t('Protected paths'),
        desc: t('One file or folder per line. These images cannot be recycled.'),
        render: (setting: Setting) => {
          setting.addTextArea((input) =>
            input.setValue(protectedText).onChange((value) => {
              protectedText = value;
            }),
          );
        },
      },
      {
        name: t('Save settings'),
        render: (setting: Setting) => {
          setting.addButton((button) =>
            button
              .setButtonText(t('Save settings'))
              .setCta()
              .onClick(() => {
                void this.plugin
                  .updateSettings({
                    scope,
                    preferredFolder: preferred,
                    protectedPaths: protectedText
                      .split('\n')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                  .then(() => new Notice(t('Attachment Atlas settings saved.')))
                  .catch((error) => new Notice(errorText(error)));
              }),
          );
        },
      },
    ];
  }
}
