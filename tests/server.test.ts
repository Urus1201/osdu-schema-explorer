import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { GraphStore } from '../src/core/store';
import { createService } from '../src/server/service';
import { syntheticPatch } from './store-fixture';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function service() {
  const dir = await mkdtemp(join(tmpdir(), 'schema-service-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const store = new GraphStore(dir);
  const app = await createService({ store, port: 0, pollMs: 25 });
  cleanup.push(app.close);
  return { ...app, store };
}
it('serves saved graph and rejects semantic writes', async () => {
  const app = await service();
  expect((await (await fetch(`${app.url}/api/graph`)).json()).nodes).toEqual([]);
  expect((await fetch(`${app.url}/api/graph`, { method: 'POST', body: '{}' })).status).toBe(405);
});
it('blocks foreign hosts and origins before routing', async () => {
  const app = await service();
  expect(
    (await fetch(`${app.url}/api/graph`, { headers: { Origin: 'https://evil.invalid' } })).status,
  ).toBe(403);
  const status = await new Promise<number | undefined>((resolve) => {
    const req = request(`${app.url}/api/graph`, { headers: { Host: 'evil.invalid' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.end();
  });
  expect(status).toBe(403);
});
it('rejects unknown focus keys and IDs without storing submitted text', async () => {
  const app = await service();
  const before = await readFile(app.store.file, 'utf8');
  for (const body of [
    { nodeIds: [], edgeIds: [], question: 'QUESTION_SENTINEL' },
    { nodeIds: ['QUESTION_SENTINEL'], edgeIds: [] },
  ]) {
    expect(
      (
        await fetch(`${app.url}/api/focus`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(400);
  }
  expect(await readFile(app.store.file, 'utf8')).toBe(before);
});
it('streams initial graph and transient focus', async () => {
  const app = await service();
  const controller = new AbortController();
  const response = await fetch(`${app.url}/api/events`, { signal: controller.signal });
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: graph');
  expect(
    (
      await fetch(`${app.url}/api/focus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"nodeIds":[],"edgeIds":[]}',
      })
    ).status,
  ).toBe(200);
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: focus');
  controller.abort();
});
it('streams CLI/store additions without a rebuild and marks only newly added IDs', async () => {
  const app = await service();
  const controller = new AbortController();
  const response = await fetch(`${app.url}/api/events`, { signal: controller.signal });
  const reader = response.body!.getReader();
  await reader.read();
  const patch = syntheticPatch();
  await app.store.apply(patch, 0);
  const event = new TextDecoder().decode((await reader.read()).value);
  const payload = JSON.parse(event.split('data: ')[1]);
  expect(payload.graph.nodes).toHaveLength(2);
  expect(payload.addedNodeIds.sort()).toEqual(patch.nodes.map((node) => node.id).sort());
  expect(payload.addedEdgeIds).toEqual([patch.edges[0].id]);
  controller.abort();
});
it('rejects oversized focus bodies with a bounded error response', async () => {
  const app = await service();
  const response = await fetch(`${app.url}/api/focus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeIds: [], edgeIds: [], extra: 'x'.repeat(20000) }),
  });
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain('xxx');
});
it('keeps live subscribers connected when a valid graph event exceeds the socket buffer', async () => {
  const app = await service();
  const controller = new AbortController();
  try {
    const response = await fetch(`${app.url}/api/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read();
    const patch = syntheticPatch(Array.from({ length: 100 }, (_, index) => `N${index}`));
    for (const node of patch.nodes) node.description = 'synthetic '.repeat(100);
    await app.store.apply(patch, 0);
    let event = '';
    while (!event.includes('\n\n')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      event += new TextDecoder().decode(chunk.value);
    }
    expect(JSON.parse(event.split('data: ')[1]).graph.nodes).toHaveLength(100);
    const focusResponse = await fetch(`${app.url}/api/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"nodeIds":[],"edgeIds":[]}',
    });
    expect((await focusResponse.json()).focused).toBe(true);
  } finally {
    controller.abort();
  }
});
