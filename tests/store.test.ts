import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphStore } from '../src/core/store';
import { syntheticPatch } from './store-fixture';

const directories: string[] = [];
async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'schema-store-'));
  directories.push(dir);
  return new GraphStore(dir);
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
describe('safe local store', () => {
  it('persists independent additions through restart without rewriting a repeated patch', async () => {
    const current = await store();
    await current.init();
    await current.apply(syntheticPatch(), 0);
    await current.apply(syntheticPatch(['C', 'D']), 1);
    const restarted = new GraphStore(current.directory);
    expect((await restarted.init()).nodes.map((node) => node.label).sort()).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
    const before = await readFile(current.file, 'utf8');
    expect((await restarted.apply(syntheticPatch(), 2)).changed).toBe(false);
    expect(await readFile(current.file, 'utf8')).toBe(before);
  });
  it('allows exactly one concurrent writer and keeps a complete validated result', async () => {
    const current = await store();
    await current.init();
    const results = await Promise.allSettled([
      current.apply(syntheticPatch(), 0),
      new GraphStore(current.directory).apply(syntheticPatch(['C', 'D']), 0),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const graph = await current.read();
    expect(graph.revision).toBe(1);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });
  it('initializes empty and preserves bytes across restart and no-op patches', async () => {
    const first = await store();
    expect(await first.init()).toEqual({
      formatVersion: 1,
      revision: 0,
      nodes: [],
      edges: [],
      evidence: [],
    });
    const before = await readFile(first.file, 'utf8');
    const result = await first.apply({ formatVersion: 1, nodes: [], edges: [], evidence: [] }, 0);
    expect(result.changed).toBe(false);
    expect(await readFile(first.file, 'utf8')).toBe(before);
    expect((await new GraphStore(first.directory).init()).revision).toBe(0);
  });
  it('rejects stale revisions without replacing the store', async () => {
    const current = await store();
    await current.init();
    await expect(
      current.apply({ formatVersion: 1, nodes: [], edges: [], evidence: [] }, 4),
    ).rejects.toThrow(/revision/i);
    expect((await current.read()).revision).toBe(0);
  });
  it('fails closed on existing locks and leaves their contents untouched', async () => {
    const current = await store();
    await current.init();
    await writeFile(join(current.directory, 'graph.lock'), 'existing writer');
    await expect(
      current.apply({ formatVersion: 1, nodes: [], edges: [], evidence: [] }, 0),
    ).rejects.toThrow(/locked/i);
    expect(await readFile(join(current.directory, 'graph.lock'), 'utf8')).toBe('existing writer');
  });
  it('does not reset malformed existing state during startup', async () => {
    const current = await store();
    await current.init();
    await writeFile(current.file, '{broken');
    await expect(current.init()).rejects.toThrow();
    expect(await readFile(current.file, 'utf8')).toBe('{broken');
  });
  it('rejects invalid patches without changing valid state', async () => {
    const current = await store();
    await current.init();
    await expect(
      current.apply(
        { formatVersion: 1, nodes: [], edges: [{ source: 'missing' }], evidence: [] },
        0,
      ),
    ).rejects.toThrow();
    expect((await current.read()).revision).toBe(0);
  });
});
