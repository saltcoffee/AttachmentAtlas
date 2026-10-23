import { t, errorText } from './i18n';
import { App, PluginSettingTab, Notice, type SettingDefinitionItem } from 'obsidian';
import type AttachmentAtlas from '../main';
export class AtlasSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: AttachmentAtlas,
  ) {
    super(app, plugin);
  }
  getSettingDefinitions(): SettingDefinitionItem[] {
    let scope = this.plugin.settings.scope,
      preferred = this.plugin.settings.preferredFolder,
      protectedText = this.plugin.settings.protectedPaths.join('\n');
    return [
      {
        type: 'group',
        heading: t('Attachment Atlas'),
        items: [
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
            render: (setting) => {
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
            render: (setting) => {
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
            render: (setting) => {
              setting.addTextArea((input) =>
                input.setValue(protectedText).onChange((value) => {
                  protectedText = value;
                }),
              );
            },
          },
          {
            name: t('Save settings'),
            render: (setting) => {
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
        ],
      },
    ];
  }
}
