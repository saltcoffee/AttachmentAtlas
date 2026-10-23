import { RECOVERY_ROOT, assert, type Plan } from './model';
import type { Text } from './messages';

// This check bounds paths; persisted UUID semantics are validated separately at the DTO boundary.
export function recoveryDirectory(id: string): string {
  assert(
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id),
    'Invalid recovery operation ID.',
  );
  return `${RECOVERY_ROOT}/${id}`;
}
export function cleanupMarkerPath(id: string): string {
  recoveryDirectory(id);
  return `${RECOVERY_ROOT}/.cleanup-${id}.json`;
}

export const FINISHED_RECOVERY_STATES = ['completed', 'restored', 'rolledBack'] as const;
export type FinishedRecoveryState = (typeof FINISHED_RECOVERY_STATES)[number];

export interface HistoryEntry {
  storageBytes?: number;
  id: string;
  createdAt?: number;
  kind?: Plan['kind'];
  imageCount?: number;
  documentCount?: number;
  state: string;
  error?: Text;
}

export function finishedRecoveryState(state: string): state is FinishedRecoveryState {
  return (FINISHED_RECOVERY_STATES as readonly string[]).includes(state);
}

export function canCleanRecovery(entry: HistoryEntry): boolean {
  return (
    !entry.error &&
    entry.storageBytes !== undefined &&
    (finishedRecoveryState(entry.state) || entry.state === 'cleanupPending')
  );
}

export interface CleanupFile {
  readonly path: string;
  readonly size: number;
  readonly digest: string;
}

export interface RecoveryCleanupRecord {
  readonly id: string;
  readonly createdAt: number;
  readonly kind: Plan['kind'];
  readonly state: FinishedRecoveryState;
  readonly files: readonly CleanupFile[];
}

export interface CleanupSelection {
  readonly record: RecoveryCleanupRecord;
  readonly remainingFiles: readonly CleanupFile[];
  readonly resuming: boolean;
  readonly markerDigest?: string;
  readonly markerSize?: number;
}

export interface CleanupPreview {
  readonly selections: readonly CleanupSelection[];
  readonly fingerprint: string;
  readonly totalBytes: number;
}

export interface CleanupResult {
  readonly removedRecords: number;
  readonly releasedBytes: number;
}
