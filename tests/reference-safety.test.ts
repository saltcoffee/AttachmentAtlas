import { describe, expect, it } from 'vitest';
import { digest } from '../src/domain/model';
import { buildPlan } from '../src/application/plan';
import { OperationService } from '../src/application/execute';
import { RecoveryStore } from '../src/infrastructure/recovery-store';
import { MemoryDisk, MemoryVault, PNG, snapshot } from './helpers';

describe('referenced-image recycling safety', () => {
  it.each([
    ['used.png', 'note.md', '[![alt](used.png)](https://example.com)'],
    ['a&b.png', 'note.md', '![alt](a&amp;b.png)'],
    ['a&b.png', 'note.md', '![alt](a&#38;b.png#fragment)'],
    ['a&b.png', 'note.md', '[![alt](a&#x26;b.png?x=1)](https://example.com)'],
    ['a&b.png', 'note.md', '![alt][photo]\n\n[photo]: a&amp;b.png "title"'],
    [
      'a&b.png',
      'map.canvas',
      '{"nodes":[{"id":"t","type":"text","text":"[![alt](a&#38;b.png)](https://example.com)"}]}',
    ],
  ])('protects %s referenced by %s, and supports merge/restore: %s', async (path, source, text) => {
    const vault = new MemoryVault({ [path]: PNG, 'keep.png': PNG, [source]: text });
    const result = await snapshot(vault);
    const image = result.media.find((media) => media.path === path)!;
    expect(result.blockers).toEqual([]);
    expect(image.reasons).toEqual([]);
    expect(image.references).toHaveLength(1);
    expect(() => buildPlan(result, [path])).toThrow('Image is referenced');
    expect(vault.removed).toEqual([]);

    const recovery = new RecoveryStore(new MemoryDisk());
    const service = new OperationService(vault, recovery, digest);
    const plan = buildPlan(result, [path], 'keep.png');
    await service.execute(plan, result);
    expect(await vault.exists(path)).toBe(false);
    expect(await vault.readText(source)).toContain('/keep.png');
    expect(
      (await snapshot(vault)).media.find((media) => media.path === 'keep.png')?.references,
    ).toHaveLength(1);
    await service.restore(plan);
    expect(await vault.readText(source)).toBe(text);
    expect(await vault.readBinary(path)).toEqual(PNG);
    expect(await recovery.history()).toEqual([]);
  });
});
