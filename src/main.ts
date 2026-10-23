import { t, problem } from './ui/i18n';
import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, type Plan, type Settings, type Snapshot } from './domain/model';
import { scan } from './application/scan';
import { buildPlan } from './application/plan';
import { OperationService } from './application/execute';
import { ObsidianVault } from './infrastructure/obsidian-vault';
import { HashClient } from './infrastructure/hash-client';
import { loadState, settingsFrom } from './infrastructure/settings';
import { OrganizerView, VIEW_TYPE } from './ui/organizer-view';
import { AtlasSettingsTab } from './ui/settings-tab';
import { ConfirmPlanModal } from './ui/modals';
import { errorDetail, type Text } from './domain/messages';
export default class AttachmentAtlas extends Plugin {
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  snapshot: Snapshot | null = null;
  status: Text = 'Ready to scan. All processing stays inside this vault.';
  lastError: Text = '';
  busy = false;
  private revision = 0;
  private controller: AbortController | null = null;
  private hashes = new HashClient();
  private vaultPort!: ObsidianVault;
  private operations!: OperationService;
  private refreshTimer: number | null = null;
  async onload(): Promise<void> {
    const loaded = loadState(await this.loadData());
    this.settings = loaded.settings;
    if (loaded.reset)
      new Notice(
        t('Attachment Atlas reset invalid settings. Review your image scope and protected paths.'),
      );
    this.vaultPort = new ObsidianVault(this.app);
    this.operations = new OperationService(this.vaultPort, this.hashes.hash);
    this.registerView(VIEW_TYPE, (leaf) => new OrganizerView(leaf, this));
    this.addSettingTab(new AtlasSettingsTab(this.app, this));
    this.addRibbonIcon('images', t('Open Attachment Atlas'), () => {
      void this.open();
    });
    this.addCommand({
      id: 'open-organizer',
      name: t('Open image organizer'),
      callback: () => {
        void this.open();
      },
    });
    this.addCommand({
      id: 'scan-vault',
      name: t('Scan vault images'),
      callback: () => {
        void this.open().then(() => this.scanVault());
      },
    });
    this.addCommand({
      id: 'scan-attachment-folder',
      name: t('Scan current attachment folder'),
      callback: () => {
        const source = this.app.workspace.getActiveFile();
        const folder = this.vaultPort.attachmentFolder(source?.path ?? '');
        void this.open().then(() => this.scanVault(folder));
      },
    });
    this.registerEvent(this.app.vault.on('create', () => this.invalidate()));
    this.registerEvent(this.app.vault.on('modify', () => this.invalidate()));
    this.registerEvent(this.app.vault.on('delete', () => this.invalidate()));
    this.registerEvent(this.app.vault.on('rename', () => this.invalidate()));
  }
  onunload(): void {
    this.cancel();
    this.hashes.dispose();
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }
  private invalidate(): void {
    this.revision++;
    if (!this.busy && this.snapshot) {
      this.snapshot = null;
      this.status = 'Vault changed. Scan again before planning changes.';
      this.refresh();
    }
  }
  async open(): Promise<OrganizerView> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view as OrganizerView;
  }
  private refresh(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE))
      if (leaf.view instanceof OrganizerView) leaf.view.render();
  }
  private progress(message: Text): void {
    this.status = message;
    if (this.refreshTimer === null)
      this.refreshTimer = window.setTimeout(() => {
        this.refreshTimer = null;
        this.refresh();
      }, 200);
  }
  private fail(error: unknown): void {
    this.lastError = errorDetail(error);
    this.status = 'Stopped. Review the error and scan again.';
    new Notice(problem(this.lastError), 8000);
    this.refresh();
  }
  async scanVault(scope?: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.lastError = '';
    this.snapshot = null;
    this.controller = new AbortController();
    this.refresh();
    const revision = this.revision;
    try {
      const result = await scan(this.vaultPort, this.hashes.hash, {
        revision,
        settings: scope === undefined ? this.settings : { ...this.settings, scope },
        signal: this.controller.signal,
        progress: (message) => this.progress(message),
      });
      if (revision !== this.revision) throw new Error('Vault changed during scanning. Scan again.');
      this.snapshot = result;
      this.status = 'Scan complete.';
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
      this.controller = null;
      this.refresh();
    }
  }
  cancel(): void {
    this.controller?.abort();
  }
  preview(paths: string[], keep?: string): void {
    try {
      if (!this.snapshot || this.busy) return;
      const snapshot = this.snapshot,
        plan = buildPlan(snapshot, paths, keep);
      new ConfirmPlanModal(this.app, plan, () => this.execute(plan, snapshot)).open();
    } catch (error) {
      this.fail(error);
    }
  }
  private async execute(plan: Plan, snapshot: Snapshot): Promise<void> {
    if (this.busy) return;
    if (plan.revision !== this.revision) {
      this.fail(new Error('Vault changed after preview. Scan again.'));
      return;
    }
    this.busy = true;
    this.lastError = '';
    this.controller = new AbortController();
    this.refresh();
    try {
      await this.operations.execute(plan, snapshot, this.controller.signal, (message) =>
        this.progress(message),
      );
      this.status = 'Completed. Images were deleted according to Obsidian’s deleted-file setting.';
    } catch (error) {
      this.fail(error);
      this.status = 'Cleanup stopped. Applied changes are kept. Scan again before continuing.';
    } finally {
      this.snapshot = null;
      this.busy = false;
      this.controller = null;
      this.refresh();
    }
  }
  private saveState(): Promise<void> {
    return this.saveData({ version: 1, settings: this.settings });
  }
  async updateSettings(value: unknown): Promise<void> {
    if (this.busy) throw new Error('Wait for the running task to finish.');
    this.settings = settingsFrom(value);
    await this.saveState();
    this.invalidate();
  }
}
