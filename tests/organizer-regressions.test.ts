import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type AttachmentAtlas from '../src/main';
import type { Media, Plan, Snapshot } from '../src/domain/model';
import { OrganizerSelection, duplicateGroupKey } from '../src/application/organizer-selection';
import { OrganizerResults } from '../src/ui/organizer-results';
import { createOrganizerViewState } from '../src/ui/organizer-state';
import { ConfirmPlanModal } from '../src/ui/modals';
import * as preview from '../src/ui/plan-preview';
import { UiElement } from './ui-elements';

// This host mock is limited to interaction tests; localization has its own language-aware host.
vi.mock('obsidian', async () => {
  const { UiElement } = await import('./ui-elements');
  return {
    getLanguage: () => 'en',
    Modal: class {
      contentEl = new UiElement();
      onClose() {}
      close() {
        this.onClose();
      }
    },
    Notice: class {},
  };
});

function setup(groupSizes: number[], imageSize = 1024) {
  const groups = groupSizes.map((size, group) =>
    Array.from({ length: size }, (_, index): Media => ({
      path: `${String(group).padStart(2, '0')}/${String(index).padStart(3, '0')}.png`,
      size: imageSize,
      mtime: 0,
      format: 'PNG',
      digest: `group-${group}`,
      reasons: [],
      references: [],
    })),
  );
  const snapshot: Snapshot = {
    revision: 1,
    settings: { scope: '', protectedPaths: [], preferredFolder: '' },
    media: groups.flat(),
    files: groups.flat(),
    duplicates: groups,
    sources: [],
    blockers: [],
  };
  const selection = new OrganizerSelection();
  selection.acceptSnapshot(selection.beginScan(), snapshot);
  const plugin = {
    selection,
    snapshot,
    busy: false,
    app: { vault: { adapter: { getResourcePath: (path: string) => path } } },
  } as unknown as AttachmentAtlas;
  const state = createOrganizerViewState();
  state.sort = { key: 'path', direction: 'asc' };
  const root = new UiElement();
  const onPreview = vi.fn();
  const results = new OrganizerResults(plugin, state, 1, () => true, onPreview);
  const render = () => results.render(root as unknown as HTMLElement, snapshot);
  selection.subscribe(() => results.updateSelection(snapshot));
  render();
  const control = (key: string) => {
    const element = root.all().find((element) => element.dataset.focusKey === key);
    expect(element, `Missing ${key}`).toBeDefined();
    return element!;
  };
  const click = (key: string) => {
    const element = control(key);
    element.focus();
    element.onclick?.();
  };
  const deselect = (path: string) => {
    const element = control(`image:${path}`);
    element.focus();
    element.checked = false;
    element.onchange?.();
  };
  return { groups, snapshot, selection, state, root, render, control, click, deselect, onPreview };
}

describe('organizer interaction regressions', () => {
  it('updates a selected member without replacing images, reference details, or another group', () => {
    const ui = setup([3, 3]),
      group = ui.groups[0]!,
      key = duplicateGroupKey(group),
      otherKey = duplicateGroupKey(ui.groups[1]!);
    group[1]!.references = [
      {
        source: 'note.md',
        raw: group[1]!.path,
        linkpath: group[1]!.path,
        target: group[1]!.path,
        style: 'wiki',
        readOnly: false,
        start: 0,
        end: 1,
      },
    ];
    ui.click(`expand:${key}`);
    ui.click(`expand:${otherKey}`);
    const checkbox = ui.control(`image:${group[1]!.path}`),
      other = ui.control(`keep:${otherKey}`);
    const details = ui.control(`references:${group[1]!.path}`).parentElement!;
    details.open = true;
    details.ontoggle?.();
    const imageNodes = ui.root.all().filter((element) => element.tag === 'img');
    const empty = vi.spyOn(ui.root, 'empty');
    checkbox.focus();
    checkbox.checked = true;
    checkbox.onchange?.();
    expect(empty).not.toHaveBeenCalled();
    expect(ui.control(`image:${group[1]!.path}`)).toBe(checkbox);
    expect(ui.control(`keep:${otherKey}`)).toBe(other);
    expect(ui.root.all().filter((element) => element.tag === 'img')).toEqual(imageNodes);
    expect(ui.control(`references:${group[1]!.path}`).parentElement).toBe(details);
    expect(details.open).toBe(true);
  });

  it('shows a recoverable error for a stale group path instead of crashing or previewing', () => {
    const ui = setup([3]),
      group = ui.groups[0]!,
      key = duplicateGroupKey(group);
    ui.selection.setGroupSelected(key, [group[1]!.path], true);
    const state = ui.selection.state;
    const stale = vi.spyOn(ui.selection, 'state', 'get').mockReturnValue({
      ...state,
      groups: {
        ...state.groups,
        [key]: { keepPath: group[0]!.path, retirePaths: ['missing.png'] },
      },
    });
    expect(() => ui.render()).not.toThrow();
    expect(ui.root.contents()).toContain('Selection no longer matches this duplicate group.');
    expect(ui.onPreview).not.toHaveBeenCalled();
    stale.mockRestore();
    ui.click(`clear:${key}`);
    expect(ui.control(`preview:merge:${key}`).disabled).toBe(true);
    expect(ui.control(`keep:${key}`).value).toBe(group[0]!.path);
  });
  it('retains 101 selected copies and submits exactly the remaining 100 after deselection', () => {
    const ui = setup([120], 1024 * 1024),
      group = ui.groups[0]!,
      key = duplicateGroupKey(group);
    ui.selection.setGroupSelected(
      key,
      group.slice(1, 102).map((image) => image.path),
      true,
    );
    expect(ui.selection.state.groups[key]!.retirePaths).toHaveLength(101);
    expect(ui.control(`preview:merge:${key}`).disabled).toBe(true);
    expect(ui.root.contents()).toContain('Selection exceeds the operation limit by 1 images.');
    ui.click('groups:selected');
    ui.click(`expand:${key}`);
    ui.deselect(group[1]!.path);
    expect(ui.selection.state.groups[key]!.retirePaths).toHaveLength(100);
    expect(ui.control(`preview:merge:${key}`).disabled).toBe(false);
    ui.click(`preview:merge:${key}`);
    expect(ui.onPreview).toHaveBeenCalledExactlyOnceWith({
      kind: 'merge-exact',
      groupKey: key,
      keepPath: group[0]!.path,
      retirePaths: group.slice(2, 102).map((image) => image.path),
    });
  });
  it.each([0, 1])(
    'shows exact totals and excess bytes for the merge byte boundary +%i per image',
    (extra) => {
      const ui = setup([5], 48 * 1024 * 1024 + extra),
        group = ui.groups[0]!,
        key = duplicateGroupKey(group);
      ui.selection.setGroupSelected(
        key,
        group.slice(1).map((image) => image.path),
        true,
      );
      expect(ui.root.contents()).toContain(`${192 * 1024 * 1024 + extra * 4} bytes`);
      expect(ui.control(`preview:merge:${key}`).disabled).toBe(extra > 0);
      if (extra) {
        expect(ui.root.contents()).toContain('Selection exceeds the byte limit by 4 bytes');
        expect(ui.root.contents()).toContain('Limit: 192.0 MiB (201326592 bytes)');
      }
    },
  );
  it('returns to a valid image page and toolbar focus after deselecting the last row', () => {
    const ui = setup([51]);
    const images = ui.groups[0]!;
    ui.selection.setUnreferencedSelected(
      images.map((image) => image.path),
      true,
    );
    ui.state.tab = 'unreferenced';
    ui.state.unreferencedMode = 'selected';
    ui.state.pageByTab.unreferenced = 1;
    ui.render();
    ui.deselect(images[50]!.path);
    expect(ui.selection.state.unreferencedPaths).toHaveLength(50);
    expect(ui.state.pageByTab.unreferenced).toBe(0);
    expect(ui.root.all().filter((element) => element.tag === 'strong')).toHaveLength(50);
    expect(ui.root.ownerDocument.activeElement?.dataset.focusKey).toBe('unreferenced:selected');
    ui.click('unreferenced:clear');
    expect(ui.state.pageByTab.unreferenced).toBe(0);
    expect(ui.root.contents()).toContain('No unreferenced images are selected.');
  });

  it('clamps selected member pages and restores focus to the same group', () => {
    const ui = setup([27]);
    const group = ui.groups[0]!,
      key = duplicateGroupKey(group);
    ui.selection.setGroupSelected(
      key,
      group.slice(1).map((image) => image.path),
      true,
    );
    ui.click('groups:selected');
    ui.click(`expand:${key}`);
    ui.click(`members:${key}:next`);
    ui.deselect(group[26]!.path);
    expect(ui.selection.state.groups[key]!.retirePaths).toHaveLength(25);
    expect(ui.state.memberPages[key]).toBe(0);
    expect(ui.root.all().filter((element) => element.tag === 'strong')).toHaveLength(25);
    expect(ui.root.ownerDocument.activeElement?.dataset.focusKey).toBe(`keep:${key}`);
  });

  it('clamps the selected group page when its last group loses its selection', () => {
    const ui = setup(Array.from({ length: 26 }, () => 2));
    for (const group of ui.groups)
      ui.selection.setGroupSelected(duplicateGroupKey(group), [group[1]!.path], true);
    ui.click('groups:selected');
    ui.click('groups:next');
    ui.click(`clear:${duplicateGroupKey(ui.groups[25]!)}`);
    expect(ui.state.pageByTab.duplicates).toBe(0);
    expect(ui.root.all().filter((element) => element.tag === 'h3')).toHaveLength(25);
    expect(ui.root.ownerDocument.activeElement?.tag).toBe('button');
  });

  it('locates a filtered-out retained image from selected groups without changing the selection', () => {
    const ui = setup([52]);
    const group = ui.groups[0]!,
      key = duplicateGroupKey(group),
      keep = group[51]!;
    ui.selection.setKeep(key, keep.path);
    ui.selection.setGroupSelected(key, [group[1]!.path], true);
    ui.state.query = { ...ui.state.query, path: 'not-matching-any-image' };
    ui.render();
    ui.click('groups:selected');
    const before = ui.selection.state;
    ui.click(`locate:${key}`);
    expect(ui.state.duplicateMode).toBe('selected');
    expect(ui.state.memberPages[key]).toBe(2);
    expect(ui.control(`image:${keep.path}`).disabled).toBe(true);
    expect(ui.selection.state).toEqual(before);
    ui.click(`members:${key}:selected`);
    expect(ui.state.memberPages[key]).toBe(0);
    expect(
      ui.root
        .all()
        .filter((element) => element.tag === 'strong')
        .map((element) => element.text),
    ).toEqual([group[1]!.path]);
  });

  it('keeps navigation focus across expansion, mode changes and page boundaries', () => {
    const ui = setup([62]);
    const key = duplicateGroupKey(ui.groups[0]!);
    ui.click(`expand:${key}`);
    expect(ui.root.ownerDocument.activeElement?.dataset.focusKey).toBe(`expand:${key}`);
    ui.click(`members:${key}:all`);
    expect(ui.root.ownerDocument.activeElement?.dataset.focusKey).toBe(`members:${key}:all`);
    ui.click(`members:${key}:next`);
    expect(ui.root.ownerDocument.activeElement?.dataset.focusKey).toBe(`members:${key}:next`);
    ui.click(`members:${key}:next`);
    expect(ui.root.ownerDocument.activeElement?.dataset.focusKey).toBe(`members:${key}:previous`);
  });

  it('keeps focus during reference pagination', () => {
    const ui = setup([2]);
    const image = ui.groups[0]!,
      key = duplicateGroupKey(image);
    image[0]!.references = Array.from({ length: 51 }, (_, index) => ({
      source: `note-${index}.md`,
      raw: 'image',
      linkpath: image[0]!.path,
      target: image[0]!.path,
      style: 'wiki',
      readOnly: false,
      start: 0,
      end: 1,
    }));
    ui.click(`expand:${key}`);
    const detail = ui.control(`references:${image[0]!.path}`).parentElement!;
    detail.open = true;
    detail.ontoggle?.();
    ui.click(`references:${image[0]!.path}:next`);
    expect(ui.root.ownerDocument.activeElement?.dataset.focusKey).toBe(
      `references:${image[0]!.path}:previous`,
    );
    expect(
      detail.all().filter((element) => element.attrs.class === 'atlas-reference'),
    ).toHaveLength(1);
  });
});

describe('lazy plan previews', () => {
  it('rejects an unsafe displayed byte sum before confirmation', () => {
    const plan: Plan = {
      revision: 1,
      kind: 'recycle-unreferenced',
      keep: [],
      documents: [],
      baseline: [],
      retire: ['a.png', 'b.png'].map((path) => ({
        path,
        size: Number.MAX_SAFE_INTEGER,
        digest: '',
      })),
    };
    const confirm = vi.fn();
    const modal = new ConfirmPlanModal({} as App, plan, confirm);
    expect(() => modal.onOpen()).toThrow('Selected image byte total is too large.');
    expect(confirm).not.toHaveBeenCalled();
    modal.onClose();
  });
  it.each(['plan-consent', 'plan-cancel', 'plan-confirm'])(
    'retains %s focus and consent through a full modal redraw',
    (focusKey) => {
      const confirm = vi.fn().mockResolvedValue(undefined);
      const plan: Plan = {
        revision: 1,
        kind: 'recycle-unreferenced',
        retire: Array.from({ length: 51 }, (_, index) => ({
          path: `${index}.png`,
          digest: '',
          size: 1,
        })),
        keep: [],
        documents: [],
        baseline: [],
      };
      const modal = new ConfirmPlanModal({} as App, plan, confirm);
      modal.onOpen();
      const root = modal.contentEl as unknown as UiElement;
      const control = (key: string) =>
        root.all().find((element) => element.dataset.focusKey === key)!;
      control('plan-consent').checked = true;
      control('plan-consent').onchange?.();
      control(focusKey).focus();
      control('retire-paths:next').onclick?.();
      expect(root.ownerDocument.activeElement).toBe(control(focusKey));
      expect(control('plan-consent').checked).toBe(true);
      expect(control('plan-confirm').disabled).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
      modal.onClose();
    },
  );
  it('loads only expanded documents, reuses cached segments and releases them when closed', () => {
    const segments = vi.spyOn(preview, 'documentSegments');
    const validation = vi.spyOn(preview, 'validatePatchOutput');
    const before = 'b'.repeat(24000),
      after = 'c'.repeat(24000);
    const plan: Plan = {
      revision: 1,
      kind: 'merge-exact',
      retire: [{ path: 'b.png', digest: '', size: 1 }],
      keep: [{ path: 'c.png', digest: '' }],
      baseline: [],
      documents: Array.from({ length: 11 }, (_, index) => ({
        path: `${index}.canvas`,
        before,
        after,
        patches: [{ start: 0, end: before.length, value: after }],
        edits: [],
      })),
    };
    const modal = new ConfirmPlanModal({} as App, plan, async () => undefined);
    const root = modal.contentEl as unknown as UiElement;
    const control = (key: string) =>
      root.all().find((element) => element.dataset.focusKey === key)!;
    const toggle = (key: string, open: boolean) => {
      const detail = control(key).parentElement!;
      detail.open = open;
      detail.ontoggle?.();
    };
    try {
      modal.onOpen();
      expect(validation).toHaveBeenCalledTimes(11);
      expect(segments).not.toHaveBeenCalled();
      expect(root.all().filter((element) => element.tag === 'pre')).toHaveLength(0);
      toggle('document:0.canvas', true);
      expect(segments).toHaveBeenCalledTimes(1);
      expect(root.all().filter((element) => element.tag === 'pre')).toHaveLength(20);
      control('segments:0.canvas:next').onclick?.();
      expect(segments).toHaveBeenCalledTimes(1);
      expect(root.all().filter((element) => element.tag === 'pre')).toHaveLength(4);
      control('documents:next').onclick?.();
      expect(segments).toHaveBeenCalledTimes(1);
      control('documents:previous').onclick?.();
      expect(segments).toHaveBeenCalledTimes(1);
      toggle('document:0.canvas', false);
      expect(root.all().filter((element) => element.tag === 'pre')).toHaveLength(0);
      toggle('document:0.canvas', true);
      expect(segments).toHaveBeenCalledTimes(1);
      expect(validation).toHaveBeenCalledTimes(11);
      modal.onClose();
      modal.onOpen();
      expect(segments).toHaveBeenCalledTimes(2);
    } finally {
      segments.mockRestore();
      validation.mockRestore();
    }
  });
});
