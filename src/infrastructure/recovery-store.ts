import { z } from 'zod';
import {
  RECOVERY_ROOT,
  assert,
  digest,
  textBytes,
  type Plan,
  type VaultPort,
} from '../domain/model';
import { active, vaultPath } from '../domain/paths';
import { errorDetail, message } from '../domain/messages';
import { parseRecoveryJson, validateRecovery } from './recovery-validation';
import {
  finishedRecoveryState,
  cleanupMarkerPath,
  recoveryDirectory,
  type HistoryEntry,
  type CleanupSelection,
  type RecoveryCleanupRecord,
  type CleanupFile,
} from '../domain/recovery';
import {
  markerId,
  parseCleanupRecord,
  serializeCleanupRecord,
  validateCleanupRecord,
} from './cleanup-record';
export interface RecoveryDisk {
  removeFile(path: string): Promise<void>;
  removeEmptyFolder(path: string): Promise<void>;
  size(path: string): Promise<number>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  writeNew(path: string, content: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinaryNew(path: string, data: ArrayBuffer): Promise<void>;
  exists(path: string): Promise<boolean>;
}
const pathSchema = z
  .string()
  .max(4096)
  .refine((value) => {
    try {
      return active(value) && vaultPath(value) === value;
    } catch {
      return false;
    }
  });
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const planSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.number(),
    revision: z.number().int().nonnegative(),
    kind: z.enum(['merge-exact', 'recycle-unreferenced']),
    retire: z
      .array(
        z.object({
          path: pathSchema,
          digest: hashSchema,
          size: z
            .number()
            .int()
            .min(0)
            .max(64 * 1024 * 1024),
        }),
      )
      .min(1)
      .max(100),
    keep: z.array(z.object({ path: pathSchema, digest: hashSchema })).max(1),
    documents: z
      .array(
        z.object({
          path: pathSchema,
          before: z.string().max(4 * 1024 * 1024),
          after: z.string().max(4 * 1024 * 1024),
        }),
      )
      .max(1000),
    baseline: z.array(z.object({ path: pathSchema, digest: hashSchema })).max(100_000),
  })
  .strict();
const envelopeSchema = z
  .object({ version: z.literal(1), payload: z.string().max(40 * 1024 * 1024), digest: hashSchema })
  .strict();
const eventSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    state: z.string().max(500),
    at: z.number(),
  })
  .strict();
export class RecoveryStore {
  constructor(private disk: RecoveryDisk) {}
  private root(id: string): string {
    return recoveryDirectory(id);
  }
  private async write(path: string, data: unknown): Promise<void> {
    const payload = JSON.stringify(data),
      record = JSON.stringify({ version: 1, payload, digest: await digest(textBytes(payload)) });
    await this.disk.writeNew(path, record);
    assert((await this.disk.read(path)) === record, 'Recovery record verification failed.');
  }
  private async read(path: string): Promise<unknown> {
    const text = await this.disk.read(path);
    assert(text.length <= 40 * 1024 * 1024, 'Recovery record too large.');
    const record = validateRecovery(envelopeSchema, parseRecoveryJson(text));
    assert(
      (await digest(textBytes(record.payload))) === record.digest,
      'Recovery record checksum failed.',
    );
    return parseRecoveryJson(record.payload);
  }
  async append(id: string, state: string): Promise<void> {
    assert(
      !(await this.disk.exists(cleanupMarkerPath(id))),
      'Recovery cleanup has started. Finish cleanup before other changes.',
    );
    const root = this.root(id),
      { files } = await this.disk.list(root);
    const indices = files
      .map((file) => /\/(\d{6})\.json$/.exec(file))
      .filter((match) => match !== null)
      .map((match) => Number(match[1]));
    const sequence = Math.max(-1, ...indices) + 1;
    assert(sequence < 999999, 'Recovery journal exhausted.');
    await this.write(`${root}/${String(sequence).padStart(6, '0')}.json`, {
      sequence,
      state,
      at: Date.now(),
    });
  }
  async prepare(plan: Plan, vault: VaultPort): Promise<void> {
    validateRecovery(planSchema, plan);
    assert(
      plan.documents.reduce(
        (total, doc) => total + textBytes(doc.before).byteLength + textBytes(doc.after).byteLength,
        0,
      ) <
        16 * 1024 * 1024,
      'Document recovery budget exceeded.',
    );
    await this.disk.mkdir(RECOVERY_ROOT);
    const root = this.root(plan.id);
    assert(!(await this.disk.exists(root)), 'Recovery operation already exists.');
    await this.disk.mkdir(root);
    try {
      await this.write(`${root}/plan.json`, plan);
      for (const image of plan.retire) {
        const data = await vault.readBinary(image.path);
        assert(
          data.byteLength === image.size && (await digest(data)) === image.digest,
          'Image changed while preparing recovery.',
        );
        const path = `${root}/${image.digest}.bin`;
        if (!(await this.disk.exists(path))) await this.disk.writeBinaryNew(path, data);
        assert(
          (await digest(await this.disk.readBinary(path))) === image.digest,
          'Recovery image checksum failed.',
        );
      }
      await this.append(plan.id, 'prepared');
    } catch (error) {
      // Only this newly-created, still-empty operation folder may be discarded.
      // Partial writes and unknown material must remain available for recovery.
      try {
        const listing = await this.disk.list(root);
        if (!listing.files.length && !listing.folders.length)
          await this.disk.removeEmptyFolder(root);
      } catch {
        // Preserve the preparation error even if storage also rejects empty-folder cleanup.
      }
      throw error;
    }
  }
  private async operation(id: string): Promise<{ plan: Plan; state: string; files: string[] }> {
    const root = this.root(id),
      plan = validateRecovery(planSchema, await this.read(`${root}/plan.json`));
    assert(plan.id === id, 'Recovery operation identity mismatch.');
    const listing = await this.disk.list(root);
    assert(!listing.folders.length, 'Unexpected nested recovery directory.');
    const records = listing.files.filter((path) => /\/\d{6}\.json$/.test(path)).sort();
    const known = new Set([
      `${root}/plan.json`,
      ...plan.retire.map((image) => `${root}/${image.digest}.bin`),
      ...records,
    ]);
    assert(
      new Set(listing.files).size === listing.files.length &&
        listing.files.every((path) => known.has(path)),
      'Unknown recovery files require manual review.',
    );
    let state = 'preparing';
    for (const [index, path] of records.entries()) {
      const record = validateRecovery(eventSchema, await this.read(path));
      assert(
        record.sequence === index && path === `${root}/${String(index).padStart(6, '0')}.json`,
        'Recovery journal sequence mismatch.',
      );
      state = record.state;
    }
    return { plan, state, files: listing.files.sort() };
  }
  async history(): Promise<HistoryEntry[]> {
    if (!(await this.disk.exists(RECOVERY_ROOT))) return [];
    const { folders, files } = await this.disk.list(RECOVERY_ROOT);
    assert(
      files.every((path) => markerId(path) !== null && path === cleanupMarkerPath(markerId(path)!)),
      'Unexpected recovery files require manual review.',
    );
    const result: HistoryEntry[] = [];
    const cleaning = new Set<string>();
    for (const path of files) {
      const id = markerId(path)!;
      cleaning.add(id);
      try {
        const selection = await this.inspectCleanup(id),
          record = selection.record;
        result.push({
          id,
          createdAt: record.createdAt,
          kind: record.kind,
          state: 'cleanupPending',
          storageBytes: selection.remainingFiles.reduce(
            (total, file) => total + file.size,
            selection.markerSize ?? 0,
          ),
        });
      } catch (error) {
        result.push({
          id,
          state: 'needsRecovery',
          error: errorDetail(error),
        });
      }
    }
    for (const folder of folders) {
      const id = folder.slice(folder.lastIndexOf('/') + 1);
      if (cleaning.has(id)) continue;
      try {
        const { plan, state, files: operationFiles } = await this.operation(id);
        const storageBytes = (
          await Promise.all(operationFiles.map((path) => this.disk.size(path)))
        ).reduce((total, size) => total + size, 0);
        result.push({
          id,
          createdAt: plan.createdAt,
          kind: plan.kind,
          imageCount: plan.retire.length,
          documentCount: plan.documents.length,
          state,
          storageBytes,
        });
      } catch (error) {
        result.push({
          id,
          state: 'needsRecovery',
          error: errorDetail(error),
        });
      }
    }
    return result.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }
  async loadPlan(id: string): Promise<Plan> {
    assert(
      !(await this.disk.exists(cleanupMarkerPath(id))),
      'Recovery data is being cleaned and can no longer be restored.',
    );
    const plan = validateRecovery(planSchema, await this.read(`${this.root(id)}/plan.json`));
    assert(plan.id === id, 'Recovery operation identity mismatch.');
    return plan;
  }
  async image(id: string, hash: string): Promise<ArrayBuffer> {
    assert(
      !(await this.disk.exists(cleanupMarkerPath(id))),
      'Recovery data is being cleaned and can no longer be restored.',
    );
    validateRecovery(hashSchema, hash);
    const data = await this.disk.readBinary(`${this.root(id)}/${hash}.bin`);
    assert((await digest(data)) === hash, 'Recovery object checksum failed.');
    return data;
  }
  private async verifyCleanupFiles(
    record: RecoveryCleanupRecord,
    allowMissing: boolean,
  ): Promise<CleanupFile[]> {
    const root = this.root(record.id);
    if (!(await this.disk.exists(root))) {
      assert(allowMissing, 'Recovery directory disappeared.');
      return [];
    }
    const listing = await this.disk.list(root);
    const expected = new Map(record.files.map((file) => [file.path, file]));
    assert(
      !listing.folders.length &&
        new Set(listing.files).size === listing.files.length &&
        listing.files.every((path) => expected.has(path)),
      'Recovery inventory changed or contains unknown files.',
    );
    if (!allowMissing)
      assert(listing.files.length === record.files.length, 'Recovery files disappeared.');
    const remaining: CleanupFile[] = [];
    for (const path of [...listing.files].sort()) {
      const file = expected.get(path)!;
      await this.verifyCleanupFile(file);
      remaining.push({ ...file });
    }
    const after = await this.disk.list(root);
    assert(
      !after.folders.length &&
        JSON.stringify(after.files.sort()) === JSON.stringify([...listing.files].sort()),
      'Recovery inventory changed during verification.',
    );
    return remaining;
  }
  private async verifyCleanupFile(file: CleanupFile): Promise<void> {
    assert((await this.disk.size(file.path)) === file.size, 'Recovery file size changed.');
    const data = await this.disk.readBinary(file.path);
    assert(
      data.byteLength === file.size && (await digest(data)) === file.digest,
      message('Recovery file checksum failed: {path}', { path: file.path }),
    );
  }
  async inspectCleanup(id: string): Promise<CleanupSelection> {
    const marker = cleanupMarkerPath(id);
    if (await this.disk.exists(marker)) {
      const text = await this.disk.read(marker),
        record = await parseCleanupRecord(text, id);
      const remainingFiles = await this.verifyCleanupFiles(record, true);
      return {
        record,
        remainingFiles,
        resuming: true,
        markerDigest: await digest(textBytes(text)),
        markerSize: textBytes(text).byteLength,
      };
    }
    const { plan, state, files } = await this.operation(id);
    assert(
      finishedRecoveryState(state),
      'Only completed, restored, or rolled-back records can be cleaned.',
    );
    assert(files.length <= 10_000, 'Cleanup file limit exceeded.');
    const root = this.root(id),
      expectedBlobs = new Set(plan.retire.map((image) => `${root}/${image.digest}.bin`));
    assert(
      [...expectedBlobs].every((path) => files.includes(path)),
      'Recovery image is missing.',
    );
    const objects: CleanupFile[] = [];
    for (const path of files) {
      const size = await this.disk.size(path);
      assert(size <= 64 * 1024 * 1024, 'Recovery file exceeds the processing budget.');
      const data = await this.disk.readBinary(path);
      assert(data.byteLength === size, 'Recovery file changed.');
      const hash = await digest(data);
      if (path.endsWith('.bin'))
        assert(
          path === `${root}/${hash}.bin` &&
            plan.retire
              .filter((image) => image.digest === hash)
              .every((image) => image.size === size),
          'Recovery image checksum or size failed.',
        );
      objects.push({ path, size, digest: hash });
    }
    const after = await this.operation(id);
    assert(
      after.state === state &&
        JSON.stringify(after.plan) === JSON.stringify(plan) &&
        JSON.stringify(after.files) === JSON.stringify(files),
      'Recovery record changed during verification.',
    );
    const record = validateCleanupRecord({
      id,
      createdAt: plan.createdAt,
      kind: plan.kind,
      state,
      files: objects,
    });
    return { record, remainingFiles: objects.map((file) => ({ ...file })), resuming: false };
  }
  async beginCleanup(selection: CleanupSelection): Promise<string> {
    const record = validateCleanupRecord(selection.record),
      marker = cleanupMarkerPath(record.id);
    if (selection.resuming) {
      const text = await this.disk.read(marker);
      await parseCleanupRecord(text, record.id);
      assert(
        (await digest(textBytes(text))) === selection.markerDigest,
        'Cleanup marker changed. Preview cleanup again.',
      );
      return selection.markerDigest;
    }
    assert(!(await this.disk.exists(marker)), 'Cleanup already started. Preview cleanup again.');
    const text = await serializeCleanupRecord(record);
    await this.disk.writeNew(marker, text);
    assert((await this.disk.read(marker)) === text, 'Cleanup marker write verification failed.');
    return digest(textBytes(text));
  }
  private async checkedMarker(id: string, expected: string): Promise<RecoveryCleanupRecord> {
    const text = await this.disk.read(cleanupMarkerPath(id));
    assert((await digest(textBytes(text))) === expected, 'Cleanup marker changed.');
    return parseCleanupRecord(text, id);
  }
  async removeCleanupFile(id: string, file: CleanupFile, markerDigest: string): Promise<void> {
    const record = await this.checkedMarker(id, markerDigest);
    assert(
      record.files.some(
        (item) => item.path === file.path && item.digest === file.digest && item.size === file.size,
      ),
      'File is not in the confirmed cleanup manifest.',
    );
    await this.verifyCleanupFile(file);
    await this.disk.removeFile(file.path);
    assert(!(await this.disk.exists(file.path)), 'Recovery file still exists after cleanup.');
  }
  async finishCleanup(id: string, markerDigest: string): Promise<void> {
    await this.checkedMarker(id, markerDigest);
    const root = this.root(id);
    if (await this.disk.exists(root)) {
      const listing = await this.disk.list(root);
      assert(!listing.files.length && !listing.folders.length, 'Recovery directory is not empty.');
      await this.disk.removeEmptyFolder(root);
    }
    assert(!(await this.disk.exists(root)), 'Recovery directory still exists.');
    await this.checkedMarker(id, markerDigest);
    await this.disk.removeFile(cleanupMarkerPath(id));
    assert(!(await this.disk.exists(cleanupMarkerPath(id))), 'Cleanup marker still exists.');
  }
}
