import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const fail = vi.hoisted(() => ({ rename: false, transient: 0 }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (fail.rename) throw new Error('Simulated replacement failure');
      if (fail.transient > 0) {
        fail.transient--;
        throw Object.assign(new Error('Simulated Windows reader sharing violation'), {
          code: 'EPERM',
        });
      }
      return actual.rename(...args);
    },
  };
});
it('retries a transient Windows sharing violation without deleting the canonical graph', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'schema-retry-'));
  try {
    const store = new GraphStore(dir);
    await store.init();
    fail.transient = 1;
    const result = await store.apply(syntheticPatch(), 0);
    expect(result.changed).toBe(true);
    expect((await store.read()).revision).toBe(1);
    expect((await store.read()).nodes).toHaveLength(2);
    expect(await readdir(dir)).toEqual(['graph.json']);
  } finally {
    fail.transient = 0;
    await rm(dir, { recursive: true, force: true });
  }
});
import { GraphStore } from '../src/core/store';
import { syntheticPatch } from './store-fixture';

it('preserves existing bytes and releases owned lock/temp files when atomic replacement fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'schema-failure-'));
  try {
    const store = new GraphStore(dir);
    await store.init();
    const before = await readFile(store.file, 'utf8');
    fail.rename = true;
    await expect(store.apply(syntheticPatch(), 0)).rejects.toThrow('Simulated replacement failure');
    expect(await readFile(store.file, 'utf8')).toBe(before);
    expect(await readdir(dir)).toEqual(['graph.json']);
    expect((await store.read()).revision).toBe(0);
  } finally {
    fail.rename = false;
    await rm(dir, { recursive: true, force: true });
  }
});
