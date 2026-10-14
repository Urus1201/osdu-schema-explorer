import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { publicExport, runCli } from '../src/cli/commands';
import { applyPatch } from '../src/core/graph';
import { emptyGraph } from '../src/core/model';
import { syntheticPatch } from './store-fixture';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'schema-cli-'));
  dirs.push(dir);
  let output = '';
  let errors = '';
  const io = {
    stdout: (text: string) => {
      output += text;
    },
    stderr: (text: string) => {
      errors += text;
    },
  };
  return { dir, io, output: () => output, errors: () => errors };
}
it('help does not create or read a store', async () => {
  const app = await setup();
  expect(await runCli(['help', '--store', join(app.dir, 'missing')], app.io)).toBe(0);
  expect(await readdir(app.dir)).toEqual([]);
  expect(app.output()).toContain('expected-revision');
});
it('initializes an empty isolated store and searches without persisting terms', async () => {
  const app = await setup();
  expect(await runCli(['init', '--store', app.dir], app.io)).toBe(0);
  const before = await readFile(join(app.dir, 'graph.json'), 'utf8');
  expect(await runCli(['lookup', '--store', app.dir, '--term', 'QUESTION_SENTINEL'], app.io)).toBe(
    0,
  );
  expect(await readFile(join(app.dir, 'graph.json'), 'utf8')).toBe(before);
  expect(await readdir(app.dir)).toEqual(['graph.json']);
});
it('does not echo unrecognized user-supplied flags in errors', async () => {
  const app = await setup();
  expect(await runCli(['init', '--QUESTION_SENTINEL', 'private'], app.io)).toBe(1);
  expect(app.errors()).not.toContain('QUESTION_SENTINEL');
});
it('exports privately without overwriting files and blocks unreviewed public export', async () => {
  const app = await setup();
  const output = join(app.dir, 'export.json');
  await runCli(['init', '--store', app.dir], app.io);
  expect(await runCli(['export', '--store', app.dir, '--output', output], app.io)).toBe(0);
  expect(JSON.parse(await readFile(output, 'utf8')).nodes).toEqual([]);
  expect(await runCli(['export', '--store', app.dir, '--output', output], app.io)).toBe(1);
  expect(
    await runCli(
      ['export', '--store', app.dir, '--output', join(app.dir, 'public.json'), '--public'],
      app.io,
    ),
  ).toBe(1);
});
it('requires public visibility, reviewed compatible rights, attribution and public provenance', () => {
  const graph = applyPatch(emptyGraph(), syntheticPatch()).graph;
  const nodes = graph.nodes.map((node) => node.id);
  const edges = graph.edges.map((edge) => edge.id);
  expect(publicExport(graph, nodes, edges).nodes).toHaveLength(2);
  for (const alteration of [
    { visibility: 'private' },
    { visibility: 'unknown' },
    { redistribution: 'unknown' },
    { license: 'Proprietary' },
    { attribution: undefined },
    { location: 'private/schema.json' },
    { location: 'https://127.0.0.1/schema' },
  ]) {
    const unreviewed = structuredClone(graph);
    Object.assign(unreviewed.evidence[0], alteration);
    expect(() => publicExport(unreviewed, nodes, edges)).toThrow();
  }
  expect(() => publicExport(graph, [nodes[0]], edges)).toThrow();
});
it('validates and applies a reviewed candidate patch, rejecting stale replay without changing bytes', async () => {
  const app = await setup();
  const patchFile = join(app.dir, 'patch.json');
  await runCli(['init', '--store', app.dir], app.io);
  await writeFile(patchFile, JSON.stringify(syntheticPatch()));
  expect(await runCli(['validate', '--store', app.dir, '--patch', patchFile], app.io)).toBe(0);
  expect(
    await runCli(
      ['apply', '--store', app.dir, '--patch', patchFile, '--expected-revision', '0'],
      app.io,
    ),
  ).toBe(0);
  const graphFile = join(app.dir, 'graph.json');
  const before = await readFile(graphFile, 'utf8');
  expect(JSON.parse(before).nodes).toHaveLength(2);
  expect(
    await runCli(
      ['apply', '--store', app.dir, '--patch', patchFile, '--expected-revision', '0'],
      app.io,
    ),
  ).toBe(1);
  expect(await readFile(graphFile, 'utf8')).toBe(before);
  expect(
    await runCli(
      ['apply', '--store', app.dir, '--patch', patchFile, '--expected-revision', '1'],
      app.io,
    ),
  ).toBe(0);
  expect(await readFile(graphFile, 'utf8')).toBe(before);
});
