import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { emptyGraph } from '../src/core/model';
import { createDescriptionReader } from '../src/sources/descriptions';
import { GraphStore } from '../src/core/store';
import { createService } from '../src/server/service';
import { syntheticPatch } from './store-fixture';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(description: unknown = 'A synthetic entity used to verify definitions.') {
  const directory = await mkdtemp(join(tmpdir(), 'schema-descriptions-'));
  directories.push(directory);
  const release = join(directory, 'pinned-release');
  await mkdir(release);
  const graph = { ...emptyGraph(), ...syntheticPatch(), revision: 1 };
  const schema = JSON.stringify({ description });
  const hash = `sha256:${createHash('sha256').update(schema).digest('hex')}`;
  graph.nodes[0].schemaHash = hash;
  graph.evidence[0].contentHash = hash;
  const manifest = {
    formatVersion: 1,
    namespace: graph.nodes[0].namespace,
    revision: graph.evidence[0].revision,
    license: 'Apache-2.0',
    visibility: 'public',
    redistribution: 'unknown',
    schemas: [
      {
        kind: graph.nodes[0].kind,
        version: graph.nodes[0].version,
        path: 'entity.json',
        location: graph.evidence[0].location,
        contentHash: hash,
      },
    ],
  };
  await writeFile(join(release, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(release, 'entity.json'), schema);
  return { directory, release, graph, manifest };
}

it('adds verified source definitions to a rendering copy without modifying saved facts', async () => {
  const { directory, graph } = await fixture();
  const before = JSON.stringify(graph);
  const read = createDescriptionReader(directory);
  const result = await read(graph);
  expect(result.nodes[0].description).toBe('A synthetic entity used to verify definitions.');
  expect(result.nodes[1].description).toBeUndefined();
  expect(result.revision).toBe(graph.revision);
  expect(JSON.stringify(graph)).toBe(before);
  expect(await read(graph)).toBe(result);
  const next = await read({ ...graph, revision: 2 });
  expect(next.revision).toBe(2);
  expect(next.nodes[0].description).toBe(result.nodes[0].description);
});

it('serves definitions over HTTP and events without writing them to the canonical store', async () => {
  const { directory, graph } = await fixture();
  const store = new GraphStore(join(directory, 'knowledge'));
  await store.init();
  await store.apply(
    { formatVersion: 1, nodes: graph.nodes, edges: graph.edges, evidence: graph.evidence },
    0,
  );
  const app = await createService({ store, port: 0, sourceDirectory: directory });
  const controller = new AbortController();
  try {
    const served = await (await fetch(`${app.url}/api/graph`)).json();
    expect(served.nodes[0].description).toBeDefined();
    const events = await fetch(`${app.url}/api/events`, { signal: controller.signal });
    const reader = events.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(initial.split('data: ')[1]).graph).toEqual(served);
    expect(await store.read()).toEqual(graph);
  } finally {
    controller.abort();
    await app.close();
  }
});

it.each(['namespace', 'revision', 'kind', 'version', 'location', 'contentHash'] as const)(
  'does not borrow a definition with a mismatched %s',
  async (field) => {
    const { directory, release, graph, manifest } = await fixture();
    if (field === 'namespace' || field === 'revision') manifest[field] = 'other';
    else if (field === 'kind') manifest.schemas[0].kind = graph.nodes[1].kind;
    else if (field === 'version') {
      manifest.schemas[0].kind = graph.nodes[0].kind.replace('1.0.0', '2.0.0');
      manifest.schemas[0].version = '2.0.0';
    } else manifest.schemas[0][field] = field === 'contentHash' ? 'd'.repeat(64) : 'other.json';
    await writeFile(join(release, 'manifest.json'), JSON.stringify(manifest));
    expect((await createDescriptionReader(directory)(graph)).nodes[0].description).toBeUndefined();
  },
);

it('fails closed for changed source bytes while keeping the graph available', async () => {
  const { directory, release, graph } = await fixture();
  await writeFile(join(release, 'entity.json'), JSON.stringify({ description: 'Changed bytes' }));
  expect((await createDescriptionReader(directory)(graph)).nodes[0].description).toBeUndefined();
});

it.each([undefined, '', '   ', 123, {}])(
  'ignores missing or invalid descriptions: %j',
  async (value) => {
    const { directory, graph } = await fixture(value === undefined ? null : value);
    expect((await createDescriptionReader(directory)(graph)).nodes[0].description).toBeUndefined();
  },
);

it('preserves saved descriptions and never assigns an entity definition to a property', async () => {
  const { directory, graph } = await fixture();
  graph.nodes[0].description = 'Existing saved definition.';
  expect((await createDescriptionReader(directory)(graph)).nodes[0].description).toBe(
    graph.nodes[0].description,
  );
  graph.nodes[0].type = 'property';
  delete graph.nodes[0].description;
  expect((await createDescriptionReader(directory)(graph)).nodes[0].description).toBeUndefined();
});

it('tolerates an absent cache and invalid manifests', async () => {
  const { directory, release, graph } = await fixture();
  await writeFile(join(release, 'manifest.json'), '{');
  expect(await createDescriptionReader(directory)(graph)).toEqual(graph);
  expect(await createDescriptionReader(join(directory, 'absent'))(graph)).toEqual(graph);
});
