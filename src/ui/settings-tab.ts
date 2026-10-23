import { t, errorText } from './i18n';
import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
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
    el.createEl('h2', { text: t('Attachment Atlas') });
    el.createEl('p', {
      text: t(
        'Paths are vault-relative, without a leading slash. Reference checks always cover the whole vault. Images can be recycled immediately after reference checks and confirmation.',
      ),
    });
    let scope = this.plugin.settings.scope,
      preferred = this.plugin.settings.preferredFolder,
      protectedText = this.plugin.settings.protectedPaths.join('\n');
    new Setting(el)
      .setName(t('Image scope'))
      .setDesc(t('Leave empty to inspect all supported images.'))
      .addText((input) =>
        input.setValue(scope).onChange((value) => {
          scope = value.trim();
        }),
      );
    new Setting(el)
      .setName(t('Preferred retained folder'))
      .setDesc(t('Used to recommend a retained duplicate.'))
      .addText((input) =>
        input.setValue(preferred).onChange((value) => {
          preferred = value.trim();
        }),
      );
    new Setting(el)
      .setName(t('Protected paths'))
      .setDesc(t('One file or folder per line. These images cannot be recycled.'))
      .addTextArea((input) =>
        input.setValue(protectedText).onChange((value) => {
          protectedText = value;
        }),
      );
    new Setting(el).addButton((button) =>
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
  }
}
