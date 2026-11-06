import { describe, expect, it, vi } from 'vitest';
import { OperationService } from '../src/application/execute';
import { digest, textBytes } from '../src/domain/model';
import { renderMessage } from '../src/domain/messages';
import * as references from '../src/references';
import { MemoryVault, PNG, recyclePlan, snapshot } from './helpers';

describe('recycling from the scan result', () => {
  it.each([1, 10, 100])(
    'reads each reference document only once when recycling %i images',
    async (count) => {
      const images = Array.from({ length: count }, (_, index) => `unused-${index}.png`),
        notes = Array.from({ length: 50 }, (_, index) => `note-${index}.md`),
        vault = new MemoryVault({
          ...Object.fromEntries(images.map((path) => [path, PNG])),
          ...Object.fromEntries(notes.map((path) => [path, 'No images.'])),
        }),
        state = await snapshot(vault),
        read = vi.spyOn(vault, 'readText');
      const result = await new OperationService(vault, digest).execute(
        recyclePlan(state, images),
        state,
      );
      expect(result.outcome).toBe('completed');
      expect(vault.removed).toHaveLength(count);
      expect(read).toHaveBeenCalledTimes(notes.length);
      expect(read.mock.calls.map(([path]) => path).sort()).toEqual(notes.sort());
    },
  );

  it('reads only the selected image once and never fingerprints unrelated images', async () => {
    const vault = new MemoryVault({
      'unused.png': PNG,
      'other.png': PNG,
      'note.md': '![[other.png]]',
    });
    const state = await snapshot(vault),
      read = vi.spyOn(vault, 'readBinary'),
      hash = vi.fn(digest),
      parse = vi.spyOn(references, 'parseSource');
    try {
      const result = await new OperationService(vault, hash).execute(
        recyclePlan(state, ['unused.png']),
        state,
      );
      expect(result.outcome).toBe('completed');
      expect(result.finalVerification).toBe('passed');
      expect(vault.removed).toEqual(['unused.png']);
      expect(read.mock.calls.filter(([path]) => path.endsWith('.png'))).toEqual([['unused.png']]);
      expect(hash).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it('rejects a new reference even when the document size and mtime stay the same', async () => {
    const vault = new MemoryVault({
      'unused.png': PNG,
      'note.md': 'x'.repeat('![[unused.png]]'.length),
    });
    const state = await snapshot(vault),
      plan = recyclePlan(state, ['unused.png']);
    vault.files.set('note.md', textBytes('![[unused.png]]'));
    const result = await new OperationService(vault, digest).execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(renderMessage(result.issue!.detail)).toContain('Document changed');
    expect(vault.removed).toEqual([]);
  });

  it('rejects files added after scanning before removing the selected image', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG });
    const state = await snapshot(vault),
      plan = recyclePlan(state, ['unused.png']);
    vault.files.set('new.md', textBytes('![[unused.png]]'));
    const result = await new OperationService(vault, digest).execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(renderMessage(result.issue!.detail)).toContain('Active vault files changed');
    expect(vault.removed).toEqual([]);
  });

  it('rejects a changed selected image even when its size stays the same', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG });
    const state = await snapshot(vault),
      plan = recyclePlan(state, ['unused.png']),
      changed = PNG.slice(0);
    new Uint8Array(changed)[40] = 10;
    vault.files.set('unused.png', changed);
    const result = await new OperationService(vault, digest).execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(renderMessage(result.issue!.detail)).toContain('Image changed immediately');
    expect(vault.removed).toEqual([]);
  });

  it('stops remaining deletions when a new reference is added during recycling', async () => {
    const vault = new MemoryVault({ 'a.png': PNG, 'b.png': PNG, 'note.md': 'No images.' });
    const state = await snapshot(vault),
      plan = recyclePlan(state, ['a.png', 'b.png']);
    vault.onRemove = () => vault.files.set('note.md', textBytes('![[b.png]]'));
    const result = await new OperationService(vault, digest).execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(vault.removed).toEqual(['a.png']);
    expect(await vault.exists('b.png')).toBe(true);
  });

  it('rejects a source edit while the selected image is being read', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG, 'note.md': 'No images.' }),
      state = await snapshot(vault),
      plan = recyclePlan(state, ['unused.png']),
      read = vault.readBinary.bind(vault);
    vault.readBinary = async (path) => {
      const data = await read(path);
      if (path === 'unused.png') vault.files.set('note.md', textBytes('![[unused.png]]'));
      return data;
    };
    const result = await new OperationService(vault, digest).execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(vault.removed).toEqual([]);
  });

  it('rejects a source edited after it was checked while other sources are still being read', async () => {
    const vault = new MemoryVault({
        'unused.png': PNG,
        'a.md': 'No images.',
        'b.md': 'No images.',
      }),
      state = await snapshot(vault),
      plan = recyclePlan(state, ['unused.png']),
      read = vault.readText.bind(vault);
    vault.readText = async (path) => {
      const text = await read(path);
      if (path === 'b.md') vault.files.set('a.md', textBytes('![[unused.png]]'));
      return text;
    };
    const result = await new OperationService(vault, digest).execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(vault.removed).toEqual([]);
  });

  it('checks inventory changes during the selected image read before deleting it', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG }),
      state = await snapshot(vault),
      plan = recyclePlan(state, ['unused.png']),
      read = vault.readBinary.bind(vault);
    vault.readBinary = async (path) => {
      const data = await read(path);
      vault.files.set('new.base', textBytes('filters: []'));
      return data;
    };
    const result = await new OperationService(vault, digest).execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(vault.removed).toEqual([]);
  });

  it('checks source invalidation after reporting progress and before deleting', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG, 'note.md': 'No images.' }),
      state = await snapshot(vault),
      plan = recyclePlan(state, ['unused.png']);
    const result = await new OperationService(vault, digest).execute(
      plan,
      state,
      undefined,
      (progress) => {
        if (renderMessage(progress).startsWith('Recycling image:'))
          vault.files.set('note.md', textBytes('![[unused.png]]'));
      },
    );
    expect(result.outcome).toBe('failed');
    expect(vault.removed).toEqual([]);
  });

  it('invalidates checked sources on an unsaved editor change between deletions', async () => {
    const vault = new MemoryVault({ 'a.png': PNG, 'b.png': PNG, 'note.md': 'No images.' }),
      state = await snapshot(vault),
      plan = recyclePlan(state, ['a.png', 'b.png']);
    let changed!: (path: string) => void;
    vi.spyOn(vault, 'watchSourceChanges').mockImplementation((onChange) => {
      changed = onChange;
      return () => undefined;
    });
    vault.onRemove = () => changed('note.md');
    const result = await new OperationService(vault, digest).execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(renderMessage(result.issue!.detail)).toContain('note.md');
    expect(vault.removed).toEqual(['a.png']);
  });

  it('reports a source change after the last deletion without rereading all documents', async () => {
    const vault = new MemoryVault({ 'unused.png': PNG, 'note.md': 'No images.' }),
      state = await snapshot(vault),
      read = vi.spyOn(vault, 'readText');
    vault.onRemove = () => vault.files.set('note.md', textBytes('A later edit.'));
    const result = await new OperationService(vault, digest).execute(
      recyclePlan(state, ['unused.png']),
      state,
    );
    expect(result.outcome).toBe('failed');
    expect(result.finalVerification).toBe('failed');
    expect(result.images[0]?.state).toBe('verified');
    expect(read).toHaveBeenCalledOnce();
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'releases source listeners after a %s operation',
    async (outcome) => {
      const vault = new MemoryVault({ 'unused.png': PNG }),
        state = await snapshot(vault),
        controller = new AbortController(),
        stop = vi.fn();
      vi.spyOn(vault, 'watchSourceChanges').mockReturnValue(stop);
      vault.onRemove = () => {
        if (outcome === 'failed') throw new Error('Trash unavailable.');
        if (outcome === 'cancelled') controller.abort();
      };
      const result = await new OperationService(vault, digest).execute(
        recyclePlan(state, ['unused.png']),
        state,
        controller.signal,
      );
      expect(result.outcome).toBe(outcome);
      expect(stop).toHaveBeenCalledOnce();
    },
  );
});
