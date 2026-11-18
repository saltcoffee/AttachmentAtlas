import { describe, expect, it, vi } from 'vitest';
import { FileSystemAdapter, MarkdownView, TFile, type App } from 'obsidian';
import { ObsidianVault } from '../src/infrastructure/obsidian-vault';

vi.mock('obsidian', () => {
  class FileView {}
  class TextFileView extends FileView {}
  return {
    FileSystemAdapter: class {},
    FileView,
    TextFileView,
    MarkdownView: class extends TextFileView {},
    TFile: class {},
  };
});
vi.mock('node:fs/promises', () => ({
  lstat: async () => ({ isSymbolicLink: () => false }),
}));

function fixture() {
  const file = Object.assign(new TFile(), { path: 'note.md' });
  let text = '![[copy.png]]',
    editorText = text;
  const editor = { getValue: () => editorText };
  const view = Object.assign(new MarkdownView({} as never), { file, editor });
  const modify = new Set<(file: TFile) => void>();
  const editors = new Set<(editor: object, info: { file: TFile }) => void>();
  const emitModify = () => modify.forEach((fn) => fn(file));
  const hostProcess = vi.fn(async (_file: TFile, transform: (text: string) => string) => {
    text = transform(text);
    emitModify();
  });
  const app = {
    vault: {
      adapter: Object.assign(new FileSystemAdapter(), { getBasePath: () => '/fixture-vault' }),
      getAbstractFileByPath: () => file,
      getFiles: () => [file],
      read: async () => text,
      process: hostProcess,
      on: (event: string, fn: (file: TFile) => void) => {
        if (event === 'modify') modify.add(fn);
        return { event, fn };
      },
      offref: ({ fn }: { fn: (file: TFile) => void }) => modify.delete(fn),
    },
    workspace: {
      getLeavesOfType: () => [{ view }],
      on: (event: string, fn: (editor: object, info: { file: TFile }) => void) => {
        if (event === 'editor-change') editors.add(fn);
        return { event, fn };
      },
      offref: ({ fn }: { fn: (editor: object, info: { file: TFile }) => void }) =>
        editors.delete(fn),
    },
  } as unknown as App;
  return {
    vault: new ObsidianVault(app),
    hostProcess,
    emitModify,
    editorChange(value: string) {
      editorText = value;
      editors.forEach((fn) => fn(editor, { file }));
    },
  };
}

describe('attributing native source-write notifications', () => {
  it('allows the own write and delayed exact editor sync, but observes later disk and editor edits', async () => {
    const f = fixture(),
      changed = vi.fn();
    const stop = f.vault.watchSourceChanges(changed);
    await f.vault.process('note.md', () => '![[keep.png]]');
    f.editorChange('![[keep.png]]');
    expect(changed).not.toHaveBeenCalled();
    f.editorChange('![[copy.png]]');
    f.emitModify();
    expect(changed.mock.calls).toEqual([['note.md'], ['note.md']]);
    stop();
  });

  it('observes an additional modification during the same host process call', async () => {
    const f = fixture(),
      changed = vi.fn();
    const stop = f.vault.watchSourceChanges(changed);
    f.hostProcess.mockImplementationOnce(async (_file, transform) => {
      transform('![[copy.png]]');
      f.emitModify();
      f.emitModify();
    });
    await f.vault.process('note.md', () => '![[keep.png]]');
    expect(changed.mock.calls).toEqual([['note.md']]);
    stop();
  });

  it('observes changes before the transform and after a failed write', async () => {
    const f = fixture(),
      changed = vi.fn();
    const stop = f.vault.watchSourceChanges(changed);
    f.hostProcess.mockImplementationOnce(async (_file, transform) => {
      f.emitModify();
      transform('![[copy.png]]');
      throw new Error('Host write failed');
    });
    await expect(f.vault.process('note.md', () => '![[keep.png]]')).rejects.toThrow(
      'Host write failed',
    );
    f.emitModify();
    expect(changed.mock.calls).toEqual([['note.md'], ['note.md']]);
    stop();
  });

  it('attributes one own notification independently for each subscriber and releases them', async () => {
    const f = fixture(),
      first = vi.fn(),
      second = vi.fn();
    const stopFirst = f.vault.watchSourceChanges(first),
      stopSecond = f.vault.watchSourceChanges(second);
    await f.vault.process('note.md', () => '![[keep.png]]');
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    stopFirst();
    f.emitModify();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith('note.md');
    stopSecond();
    f.emitModify();
    expect(second).toHaveBeenCalledOnce();
  });

  it('does not reuse an old editor-write exemption in a later operation', async () => {
    const f = fixture();
    const stop = f.vault.watchSourceChanges(() => {});
    await f.vault.process('note.md', () => '![[keep.png]]');
    stop();
    const changed = vi.fn();
    const stopNext = f.vault.watchSourceChanges(changed);
    f.editorChange('![[keep.png]]');
    expect(changed).toHaveBeenCalledExactlyOnceWith('note.md');
    stopNext();
  });
});
