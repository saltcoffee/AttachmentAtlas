import { t, problem, formatNumber } from './ui/i18n';
import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, type Plan, type Settings, type Snapshot } from './domain/model';
import { scan } from './application/scan';
import { buildPlan } from './application/plan';
import { OperationService } from './application/execute';
import { ObsidianVault } from './infrastructure/obsidian-vault';
import { HashClient } from './infrastructure/hash-client';
import { RecoveryStore } from './infrastructure/recovery-store';
import { finishedRecoveryState, type HistoryEntry, type CleanupPreview } from './domain/recovery';
import { WriteLock } from './application/write-lock';
import { RecoveryCleanupService } from './application/cleanup-recovery';
import { CleanupModal, cleanupDialogData } from './ui/cleanup-modal';
import { loadState, settingsFrom } from './infrastructure/settings';
import { OrganizerView, VIEW_TYPE } from './ui/organizer-view';
import { AtlasSettingsTab } from './ui/settings-tab';
import { ConfirmPlanModal, RestoreModal } from './ui/modals';
import { errorDetail, message, type Text } from './domain/messages';
export default class AttachmentAtlas extends Plugin {
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  snapshot: Snapshot | null = null;
  history: HistoryEntry[] = [];
  status: Text = 'Ready to scan. All processing stays inside this vault.';
  lastError: Text = '';
  busy = false;
  private revision = 0;
  private controller: AbortController | null = null;
  private hashes = new HashClient();
  private vaultPort!: ObsidianVault;
  private recovery!: RecoveryStore;
  private operations!: OperationService;
  private cleanup!: RecoveryCleanupService;
  private cleanupModal: CleanupModal | null = null;
  private unloaded = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  async onload(): Promise<void> {
    this.unloaded = false;
    const loaded = loadState(await this.loadData());
    this.settings = loaded.settings;
    if (loaded.reset)
      new Notice(
        t('Attachment Atlas reset invalid settings. Review your image scope and protected paths.'),
      );
    this.vaultPort = new ObsidianVault(this.app);
    this.recovery = new RecoveryStore(this.vaultPort.disk());
    const writes = new WriteLock();
    this.operations = new OperationService(this.vaultPort, this.recovery, this.hashes.hash, writes);
    this.cleanup = new RecoveryCleanupService(this.recovery, writes);
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
      id: 'open-history',
      name: t('Open operation history'),
      callback: () => {
        void this.open().then((view) => view.showHistory());
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
    this.app.workspace.onLayoutReady(() => {
      void this.refreshHistory().catch((error) => this.fail(error));
    });
  }
  onunload(): void {
    this.unloaded = true;
    this.cancel();
    this.cleanupModal?.close();
    this.cleanupModal = null;
    this.hashes.dispose();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
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
    if (!this.refreshTimer)
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.refresh();
      }, 200);
  }
  private fail(error: unknown): void {
    this.lastError = errorDetail(error);
    this.status = 'Stopped. Review the error and operation history.';
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
      await this.refreshHistory();
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
      this.status =
        'Completed. Recycled images are retained in .attachment-atlas-recovery/ until restored or permanently cleared.';
    } catch (error) {
      this.fail(error);
    } finally {
      this.snapshot = null;
      this.busy = false;
      this.controller = null;
      await this.refreshHistory();
      this.refresh();
    }
  }
  previewRestore(id: string): void {
    void this.recovery
      .loadPlan(id)
      .then((plan) => this.showRestore(plan))
      .catch((error) => this.fail(error));
  }
  private showRestore(plan: Plan): void {
    new RestoreModal(this.app, plan, async () => {
      if (this.busy) return;
      this.busy = true;
      this.lastError = '';
      this.status = 'Restoring images and references…';
      this.controller = new AbortController();
      this.refresh();
      try {
        const result = await this.operations.restore(plan, this.controller.signal, (message) =>
          this.progress(message),
        );
        this.status = result.cleanupError
          ? 'Images and references restored. Recovery data cleanup did not finish; review History to continue.'
          : 'Recovery completed. The restored operation’s recovery data has been removed.';
        if (result.cleanupError) {
          this.lastError = result.cleanupError;
          new Notice(t(this.status), 8000);
        }
      } catch (error) {
        this.fail(error);
      } finally {
        this.snapshot = null;
        this.busy = false;
        this.controller = null;
        await this.refreshHistory();
        this.refresh();
      }
    }).open();
  }
  private async refreshHistory(): Promise<void> {
    this.history = await this.recovery.history();
    if (this.history.some((entry) => !finishedRecoveryState(entry.state)))
      new Notice(
        t(
          'Attachment Atlas has unfinished recovery or cleanup records. Review History before new write operations.',
        ),
        10000,
      );
    this.refresh();
  }
  async previewCleanup(ids: readonly string[]): Promise<void> {
    if (this.busy || this.unloaded) return;
    this.busy = true;
    this.lastError = '';
    this.controller = new AbortController();
    this.refresh();
    let preview: CleanupPreview | undefined;
    try {
      preview = await this.cleanup.preview(ids, this.controller.signal, (message) =>
        this.progress(message),
      );
      this.status = 'Recovery cleanup preview ready.';
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
      this.controller = null;
      this.refresh();
    }
    if (preview && !this.unloaded) {
      const confirmed = preview;
      this.cleanupModal?.close();
      this.cleanupModal = new CleanupModal(this.app, cleanupDialogData(confirmed), () =>
        this.cleanRecovery(confirmed),
      );
      this.cleanupModal.open();
    }
  }
  private async cleanRecovery(preview: CleanupPreview): Promise<void> {
    if (this.busy || this.unloaded) return;
    this.busy = true;
    this.lastError = '';
    this.controller = new AbortController();
    this.refresh();
    try {
      const result = await this.cleanup.execute(preview, this.controller.signal, (message) =>
        this.progress(message),
      );
      this.status = message(
        'Permanently cleared {count} records from .attachment-atlas-recovery/ ({bytes} bytes).',
        { count: result.removedRecords, bytes: formatNumber(result.releasedBytes) },
      );
      new Notice(t(this.status));
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
      this.controller = null;
      try {
        await this.refreshHistory();
      } catch (error) {
        this.fail(error);
      }
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
