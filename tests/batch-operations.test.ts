import { describe, expect, it } from 'vitest';
import { buildPlan, type MergeGroupSelection } from '../src/application/plan';
import { OperationService } from '../src/application/execute';
import { scan } from '../src/application/scan';
import { DEFAULT_SETTINGS, digest, textBytes } from '../src/domain/model';
import { renderMessage } from '../src/domain/messages';
import { MemoryVault, PNG, snapshot } from './helpers';

function variant(index: number): ArrayBuffer {
  const original = new Uint8Array(PNG),
    at = original.length - 12;
  const chunk = new Uint8Array(24),
    view = new DataView(chunk.buffer);
  view.setUint32(0, 12);
  chunk.set(new TextEncoder().encode('tEXt'), 4);
  chunk.set(new TextEncoder().encode(`id\0${String(index).padStart(8, '0')}\0`), 8);
  let crc = 0xffffffff;
  for (const value of chunk.subarray(4, 20)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(20, (crc ^ 0xffffffff) >>> 0);
  const output = new Uint8Array(original.length + chunk.length);
  output.set(original.subarray(0, at));
  output.set(chunk, at);
  output.set(original.subarray(at), at + chunk.length);
  return output.buffer;
}

async function fixture(count = 2, shared = true) {
  const entries: Record<string, string | ArrayBuffer> = {};
  for (let index = 0; index < count; index++) {
    const prefix = String.fromCharCode(97 + index);
    entries[`${prefix}-keep.png`] = variant(index);
    entries[`${prefix}-copy.png`] = variant(index);
  }
  if (shared) {
    const text = Array.from(
      { length: count },
      (_, index) => `![[${String.fromCharCode(97 + index)}-copy.png|300]]`,
    ).join(' ');
    entries['shared.md'] = `${text}\r\n[shared][x] [again][x]\r\n\r\n[x]: a-copy.png "title"`;
    entries['shared.canvas'] = JSON.stringify({
      nodes: [
        { id: 'text', type: 'text', text },
        { id: 'file', type: 'file', file: 'b-copy.png', subpath: '#part' },
      ],
      custom: { preserve: true },
    });
  }
  const vault = new MemoryVault(entries),
    state = await snapshot(vault);
  const groups: MergeGroupSelection[] = state.duplicates.map((group) => {
    const keep = group.find((image) => image.path.includes('-keep'))!;
    return {
      groupKey: `${keep.size}:${keep.digest}`,
      keepPath: keep.path,
      retirePaths: group.filter((image) => image !== keep).map((image) => image.path),
    };
  });
  const plan = buildPlan(state, { kind: 'merge-exact', groups });
  return { vault, state, groups, plan, service: new OperationService(vault, digest) };
}

describe('0.1.7 multi-group plans and shared reference writes', () => {
  it('rewrites every group in shared Markdown and one Canvas string, writing each document once', async () => {
    const { vault, state, plan, service } = await fixture();
    const writes: string[] = [];
    vault.onProcess = (path) => writes.push(path);
    vault.onRemove = () => {
      for (const doc of plan.documents)
        expect(vault.files.get(doc.path)).toEqual(textBytes(doc.after));
    };
    expect(plan.kind).toBe('merge-exact');
    if (plan.kind !== 'merge-exact') throw new Error('Wrong plan kind.');
    expect(plan.groups).toHaveLength(2);
    const canvas = plan.documents.find((doc) => doc.path.endsWith('.canvas'))!;
    expect(canvas.edits).toHaveLength(3);
    expect(canvas.patches).toHaveLength(2);
    const result = await service.execute(plan, state);
    expect(result.outcome).toBe('completed');
    expect(result.finalVerification).toBe('passed');
    expect(writes).toEqual(['shared.canvas', 'shared.md']);
    expect(await vault.readText('shared.md')).toContain(
      '![[a-keep.png|300]] ![[b-keep.png|300]]\r\n',
    );
    expect(await vault.readText('shared.md')).toContain('[x]: /a-keep.png "title"');
    expect(JSON.parse(await vault.readText('shared.canvas')).custom).toEqual({ preserve: true });
    expect(result.groups.map((group) => group.state)).toEqual(['completed', 'completed']);
    expect(result.groups.map((group) => group.documentPaths)).toEqual([
      ['shared.canvas', 'shared.md'],
      ['shared.canvas', 'shared.md'],
    ]);
    expect(result.documents).toHaveLength(2);
    expect(result.groups.reduce((sum, group) => sum + group.verifiedEdits, 0)).toBe(6);
  });

  it('merges ten distinct groups with one plan and twenty explicit copies', async () => {
    const entries: Record<string, string | ArrayBuffer> = {};
    for (let group = 0; group < 10; group++)
      for (let member = 0; member < 3; member++)
        entries[`g${group}/${member}.png`] = variant(group);
    const vault = new MemoryVault(entries),
      state = await snapshot(vault);
    const groups = state.duplicates.map((group) => ({
      groupKey: `${group[0]!.size}:${group[0]!.digest}`,
      keepPath: group[0]!.path,
      retirePaths: group.slice(1).map((image) => image.path),
    }));
    const result = await new OperationService(vault, digest).execute(
      buildPlan(state, { kind: 'merge-exact', groups }),
      state,
    );
    expect(result.outcome).toBe('completed');
    expect(vault.removed).toHaveLength(20);
    expect(result.groups).toHaveLength(10);
    expect([...vault.files.keys()]).toHaveLength(10);
  });

  it.each(['duplicate-group', 'duplicate-copy', 'keep-conflict', 'cross-group', 'empty-group'])(
    'rejects %s before any writes',
    async (invalid) => {
      const { vault, state, groups } = await fixture();
      const request = structuredClone(groups),
        first = request[0]!,
        second = request[1]!;
      if (invalid === 'duplicate-group') request.push(structuredClone(first));
      if (invalid === 'duplicate-copy')
        request[0] = { ...first, retirePaths: [...first.retirePaths, ...first.retirePaths] };
      if (invalid === 'keep-conflict') request[1] = { ...second, keepPath: first.retirePaths[0]! };
      if (invalid === 'cross-group')
        request[0] = { ...first, retirePaths: [...second.retirePaths] };
      if (invalid === 'empty-group') request[0] = { ...first, retirePaths: [] };
      expect(() => buildPlan(state, { kind: 'merge-exact', groups: request })).toThrow();
      expect(vault.removed).toEqual([]);
    },
  );

  it('rejects a plan with unrelated body changes even when patches and link targets are internally consistent', async () => {
    const { vault, state, plan, service } = await fixture();
    const document = plan.documents[0]!;
    const corrupted = {
      ...plan,
      documents: [
        {
          ...document,
          after: document.after + '\nUnapproved edit',
          patches: [
            { start: 0, end: document.before.length, value: document.after + '\nUnapproved edit' },
          ],
        },
        ...plan.documents.slice(1),
      ],
    };
    const result = await service.execute(corrupted, state);
    expect(result.outcome).toBe('failed');
    expect(result.stoppedAt).toBe('validate-plan');
    expect(await vault.readText(document.path)).toBe(document.before);
    expect(vault.removed).toEqual([]);
  });

  it('keeps all documents untouched if the second retained image changed', async () => {
    const { vault, state, plan, service } = await fixture();
    vault.files.set('b-keep.png', variant(99));
    const result = await service.execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(result.documents.every((action) => action.state === 'not-started')).toBe(true);
    expect(vault.removed).toEqual([]);
  });

  it('checks the captured retained bytes against the plan before any reference write', async () => {
    const { vault, state, plan, service } = await fixture();
    const read = vault.readBinary.bind(vault);
    let keepReads = 0;
    vault.readBinary = async (path) => {
      if (path === 'a-keep.png' && ++keepReads === 2) {
        vault.files.set('a-keep.png', variant(99));
        vault.files.set('a-copy.png', variant(99));
      }
      const bytes = await read(path);
      if (path === 'a-copy.png' && keepReads === 2) vault.files.set('a-keep.png', variant(0));
      return bytes;
    };
    const result = await service.execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(result.stoppedAt).toBe('prove-groups');
    expect(result.documents.every((doc) => doc.state === 'not-started')).toBe(true);
    expect(vault.removed).toEqual([]);
  });

  it('rechecks every retained group between shared document writes', async () => {
    const { vault, state, plan, service } = await fixture();
    vault.onProcess = () => vault.files.set('b-keep.png', variant(99));
    const result = await service.execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(result.stoppedAt).toBe('rewrite');
    expect(result.documents.map((doc) => doc.state)).toEqual(['verified', 'not-started']);
    expect(result.groups.map((group) => group.state)).toEqual(['partial', 'partial']);
    expect(vault.removed).toEqual([]);
  });
});

describe('0.1.7 evidence, cancellation and failure precedence', () => {
  it('reports completed, unconfirmed, partial and unprocessed groups independently', async () => {
    const { vault, state, groups, service } = await fixture(4, false);
    vault.files.set('shared.md', textBytes('![[a-copy.png]] ![[b-copy.png]] ![[c-copy.png]]'));
    const fresh = await snapshot(vault);
    const plan = buildPlan(fresh, { kind: 'merge-exact', groups });
    vault.onRemove = (path) => {
      if (path === 'b-copy.png') throw new Error('Trash failed');
    };
    const result = await service.execute(plan, fresh);
    expect(result.outcome).toBe('failed');
    expect(result.groups.map((group) => group.state)).toEqual([
      'completed',
      'unconfirmed',
      'partial',
      'unprocessed',
    ]);
    expect(result.images.map((image) => image.state)).toEqual([
      'verified',
      'unconfirmed',
      'not-started',
      'not-started',
    ]);
    expect(state.sources).toEqual([]);
  });

  it.each(['write', 'remove', 'readback', 'exists'])(
    'keeps a real %s failure after cancellation as failed + requested',
    async (failure) => {
      const { vault, state, plan, service } = await fixture();
      const controller = new AbortController();
      if (failure === 'write')
        vault.onProcess = () => {
          controller.abort();
          throw new Error('Write failed');
        };
      if (failure === 'remove')
        vault.onRemove = () => {
          controller.abort();
          throw new Error('Remove failed');
        };
      if (failure === 'readback') {
        const process = vault.process.bind(vault),
          readText = vault.readText.bind(vault);
        let written = false;
        vault.process = async (path, transform) => {
          await process(path, transform);
          written = true;
          controller.abort();
        };
        vault.readText = async (path) => {
          if (written) throw new Error('Readback failed');
          return readText(path);
        };
      }
      if (failure === 'exists') {
        vault.onRemove = () => controller.abort();
        vault.exists = async () => {
          throw new Error('Exists failed');
        };
      }
      const result = await service.execute(plan, state, controller.signal);
      expect(result.outcome).toBe('failed');
      expect(result.cancellationRequested).toBe(true);
      expect(
        [...result.documents, ...result.images].some((action) => action.state === 'unconfirmed'),
      ).toBe(true);
      expect(result.issue).toBeDefined();
      expect(service.busy).toBe(false);
    },
  );

  it('confirms the current deletion before honouring cancellation', async () => {
    const { vault, state, plan, service } = await fixture();
    const controller = new AbortController();
    vault.onRemove = () => controller.abort();
    const result = await service.execute(plan, state, controller.signal);
    expect(result.outcome).toBe('cancelled');
    expect(result.cancellationRequested).toBe(true);
    expect(result.images.map((image) => image.state)).toEqual(['verified', 'not-started']);
    expect(result.finalVerification).toBe('not-run');
  });

  it('preserves a source-read failure when cancellation arrives during the initial scan', async () => {
    const { vault, state, plan, service } = await fixture();
    const controller = new AbortController();
    vault.readText = async () => {
      controller.abort();
      throw new Error('Source unavailable');
    };
    const result = await service.execute(plan, state, controller.signal);
    expect(result.outcome).toBe('failed');
    expect(result.cancellationRequested).toBe(true);
    expect(renderMessage(result.issue!.detail)).toContain('Source unavailable');
  });

  it('does not classify an ordinary error named AbortError as user cancellation', async () => {
    const { vault, state, plan, service } = await fixture();
    vault.onRemove = () => {
      const error = new Error('cancelled by another service');
      error.name = 'AbortError';
      throw error;
    };
    const result = await service.execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(result.cancellationRequested).toBe(false);
  });

  it('never reports success when final verification fails after all planned images disappeared', async () => {
    const { vault, state, plan, service } = await fixture();
    vault.onRemove = (path) => {
      if (path === 'b-copy.png') vault.files.set('late.md', textBytes('New source'));
    };
    const result = await service.execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(result.finalVerification).toBe('failed');
    expect(result.images.every((image) => image.state === 'verified')).toBe(true);
    expect(result.groups.every((group) => group.state === 'completed')).toBe(true);
  });

  it('stops a shared document failure before any deletion and marks every involved group unconfirmed', async () => {
    const { vault, state, plan, service } = await fixture();
    vault.process = async () => {
      throw new Error('Unknown write result');
    };
    const result = await service.execute(plan, state);
    expect(result.groups.map((group) => group.state)).toEqual(['unconfirmed', 'unconfirmed']);
    expect(vault.removed).toEqual([]);
  });

  it('proves bytes rather than trusting a colliding test hasher', async () => {
    const vault = new MemoryVault({ 'a.png': variant(0), 'b.png': variant(1) });
    const hash = async () => 'collision';
    const state = await scan(vault, hash, { revision: 1, settings: DEFAULT_SETTINGS });
    const plan = buildPlan(state, {
      kind: 'merge-exact',
      groups: [
        {
          groupKey: `${state.media[0]!.size}:collision`,
          keepPath: 'a.png',
          retirePaths: ['b.png'],
        },
      ],
    });
    const result = await new OperationService(vault, hash).execute(plan, state);
    expect(result.outcome).toBe('failed');
    expect(renderMessage(result.issue!.detail)).toContain('byte-identical');
    expect(vault.removed).toEqual([]);
  });
});
