import { describe, expect, it } from 'vitest';
import { buildPlan, type SelectionRequest } from '../src/application/plan';
import { OrganizerSelection, duplicateGroupKey } from '../src/application/organizer-selection';
import { OperationService } from '../src/application/execute';
import { scan } from '../src/application/scan';
import { DEFAULT_SETTINGS, digest } from '../src/domain/model';
import { parseSource } from '../src/references';
import { MemoryVault, PNG, oneMiBPng, snapshot } from './helpers';

describe('T16-07 / T16-08 explicit selection count boundaries', () => {
  it.each([
    ['merge-exact', 100],
    ['merge-exact', 101],
    ['recycle-unreferenced', 100],
    ['recycle-unreferenced', 101],
  ] as const)(
    '%s accepts exactly 100 and rejects 101 without side effects (%i)',
    async (kind, count) => {
      const paths = Array.from(
        { length: 102 },
        (_, index) => `images/${String(index).padStart(3, '0')}.png`,
      );
      const vault = new MemoryVault(Object.fromEntries(paths.map((path) => [path, PNG])));
      const result = await snapshot(vault),
        originals = new Map(vault.files);
      const retirePaths = paths.slice(1, count + 1);
      const request: SelectionRequest =
        kind === 'merge-exact'
          ? {
              kind,
              groupKey: duplicateGroupKey(result.duplicates[0]!),
              keepPath: paths[0]!,
              retirePaths,
            }
          : { kind, retirePaths };
      if (count === 101)
        expect(() => buildPlan(result, request)).toThrow('Select 1–100 distinct images.');
      else {
        const plan = buildPlan(result, request);
        expect(plan.retire.map((image) => image.path)).toEqual(retirePaths);
        expect(plan.retire).toHaveLength(100);
        expect(plan.keep.map((image) => image.path)).toEqual(
          kind === 'merge-exact' ? [paths[0]] : [],
        );
      }
      expect(vault.files).toEqual(originals);
      expect(vault.removed).toEqual([]);
    },
  );

  it('merges the confirmed 100 of 120 one-MiB images and preserves the retained image and 19 unselected copies', async () => {
    const paths = Array.from(
      { length: 120 },
      (_, index) => `images/${String(index).padStart(3, '0')}.png`,
    );
    const note = paths
      .slice(1)
      .map((path) => `![[${path}]]`)
      .join('\n');
    const data = oneMiBPng();
    const vault = new MemoryVault({
      ...Object.fromEntries(paths.map((path) => [path, data])),
      'note.md': note,
    });
    const originals = new Map(vault.files),
      result = await snapshot(vault);
    expect(result.blockers).toEqual([]);
    expect(result.media).toHaveLength(120);
    expect(
      result.media.every(
        (image) => image.size === 1024 * 1024 && image.digest && !image.reasons.length,
      ),
    ).toBe(true);
    const selection = new OrganizerSelection(),
      key = duplicateGroupKey(result.duplicates[0]!);
    selection.acceptSnapshot(selection.beginScan(), result);
    selection.setKeep(key, paths[0]!);
    selection.setGroupSelected(key, paths.slice(1, 102), true);
    const request = (): SelectionRequest => ({
      kind: 'merge-exact',
      groupKey: key,
      keepPath: selection.state.groups[key]!.keepPath,
      retirePaths: [...selection.state.groups[key]!.retirePaths],
    });
    expect(selection.state.groups[key]!.retirePaths).toHaveLength(101);
    expect(() => buildPlan(result, request())).toThrow('Select 1–100 distinct images.');
    expect(vault.removed).toEqual([]);
    expect(await vault.readText('note.md')).toBe(note);
    selection.setGroupSelected(key, [paths[101]!], false);
    const accepted = request(),
      plan = buildPlan(result, accepted),
      expectedRetire = paths.slice(1, 101);
    expect(accepted.retirePaths).toEqual(expectedRetire);
    expect(plan.retire.map((image) => image.path)).toEqual(expectedRetire);
    expect(plan.retire.reduce((sum, image) => sum + image.size, 0)).toBe(100 * 1024 * 1024);
    await new OperationService(vault, digest).execute(plan, result);
    expect(vault.removed).toEqual(expectedRetire);
    const remaining = [paths[0]!, ...paths.slice(101)];
    expect([...vault.files.keys()].filter((path) => path.endsWith('.png'))).toEqual(remaining);
    for (const path of remaining) expect(vault.files.get(path)).toBe(originals.get(path));
    const links = parseSource('note.md', await vault.readText('note.md')).references.map(
      (reference) => reference.linkpath,
    );
    expect(links.filter((path) => path === paths[0])).toHaveLength(100);
    expect(links.filter((path) => path !== paths[0])).toEqual(paths.slice(101));
  }, 15000);
});

async function unchangedVault() {
  const vault = new MemoryVault({ 'a.png': PNG, 'b.png': PNG, 'c.png': PNG });
  const files = vault.list();
  vault.list = () => files.map((file) => ({ ...file }));
  const options = { revision: 7, settings: DEFAULT_SETTINGS };
  const result = await scan(vault, digest, options),
    selection = new OrganizerSelection();
  const group = result.duplicates[0]!,
    key = duplicateGroupKey(group);
  selection.acceptSnapshot(selection.beginScan(), result);
  selection.setKeep(key, group[1]!.path);
  selection.setGroupSelected(key, [group[0]!.path], true);
  selection.setUnreferencedSelected([group[2]!.path], true);
  return { vault, options, result, selection, group, key };
}

describe('AC16-14 rescanning unchanged vault content', () => {
  it('immediately clears drafts and rejects the old scan, even when the new snapshot is identical', async () => {
    const { vault, options, result, selection, group, key } = await unchangedVault();
    const old = selection.state,
      scanId = selection.beginScan();
    expect(scanId).toBeGreaterThan(old.scanId);
    expect(selection.state.selectionRevision).toBeGreaterThan(old.selectionRevision);
    expect(selection.state.groups).toEqual({});
    expect(selection.state.unreferencedPaths).toEqual([]);
    expect(selection.acceptSnapshot(old.scanId, result)).toBe(false);
    selection.setGroupSelected(key, [group[0]!.path], true);
    selection.setUnreferencedSelected([group[2]!.path], true);
    expect(selection.state.groups).toEqual({});
    expect(selection.state.unreferencedPaths).toEqual([]);
    const fresh = await scan(vault, digest, options);
    expect(fresh).toEqual(result);
    expect(selection.acceptSnapshot(scanId, fresh)).toBe(true);
    expect(selection.state.groups[key]).toEqual({ keepPath: group[0]!.path, retirePaths: [] });
    expect(selection.state.unreferencedPaths).toEqual([]);
  });

  it('does not restore old drafts after cancelling an unchanged rescan', async () => {
    const { vault, options, result, selection } = await unchangedVault();
    const oldId = selection.state.scanId;
    selection.beginScan();
    const controller = new AbortController();
    controller.abort();
    await expect(scan(vault, digest, { ...options, signal: controller.signal })).rejects.toThrow(
      'cancelled',
    );
    expect(selection.state.groups).toEqual({});
    expect(selection.state.unreferencedPaths).toEqual([]);
    expect(selection.acceptSnapshot(oldId, result)).toBe(false);
  });
});
