import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyPatch, findPath, lookup, validateGraph, validatePatch } from '../core/graph';
import type { Graph } from '../core/model';
import { GraphStore } from '../core/store';
import { validateFocus } from '../server/service';
import { inspectRelationship } from '../sources/inspect';

const help = `OSDU Schema Explorer — graph operations (JSON output)
  init                         create only a missing, empty store
  lookup --term TEXT           search saved nodes, never persist the term
  path --from ID --to ID [--structural] [--directed] [--max-depth N]
  validate [--patch FILE]      validate current graph or candidate patch
  apply --patch FILE --expected-revision N
  inspect --manifest FILE --kind KIND --field PATH [--target KIND]
  focus --nodes ID,ID --edges ID,ID [--service http://127.0.0.1:4310]
  export --output FILE         private local export; refuses overwrite
  export --public --reviewed --nodes ID,ID --edges ID,ID --output FILE
Global: --store DIRECTORY (default knowledge). No semantic HTTP writes.
Public export requires explicitly reviewed IDs, public source evidence,
reviewed redistribution rights, compatible license and attribution.
`;
const flags: Record<string, string[]> = {
  help: [],
  init: [],
  lookup: ['term'],
  path: ['from', 'to', 'structural', 'directed', 'max-depth'],
  validate: ['patch'],
  apply: ['patch', 'expected-revision'],
  inspect: ['manifest', 'kind', 'field', 'target'],
  focus: ['nodes', 'edges', 'service'],
  export: ['output', 'public', 'reviewed', 'nodes', 'edges'],
};
const booleanFlags = new Set(['structural', 'directed', 'public', 'reviewed']);

function argumentsFor(args: string[]) {
  let command = '';
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      if (command) throw new Error('Invalid command');
      command = arg;
      continue;
    }
    const key = arg.slice(2);
    if (options.has(key)) throw new Error('Duplicate flag');
    if (booleanFlags.has(key)) options.set(key, 'true');
    else {
      const next = args[++index];
      if (next === undefined || next.startsWith('--')) throw new Error('Missing flag value');
      options.set(key, next);
    }
  }
  command ||= 'help';
  if (
    !Object.hasOwn(flags, command) ||
    [...options.keys()].some((key) => key !== 'store' && !flags[command].includes(key))
  )
    throw new Error('Invalid arguments');
  return { command, options };
}

async function jsonFile(file: string): Promise<unknown> {
  const handle = await open(resolve(file), 'r');
  try {
    if ((await handle.stat()).size > 32 * 1024 * 1024) throw new Error('Input exceeds size limit');
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}

function ids(text: string): string[] {
  return text === '' ? [] : text.split(',');
}

/** A rights check assists review; it cannot certify absence of private material. */
export function publicExport(graph: Graph, nodeIds: string[], edgeIds: string[]): Graph {
  const selectedNodes = new Set(nodeIds);
  const selectedEdges = new Set(edgeIds);
  if (
    selectedNodes.size !== nodeIds.length ||
    selectedEdges.size !== edgeIds.length ||
    nodeIds.some((id) => !graph.nodes.some((node) => node.id === id)) ||
    edgeIds.some((id) => !graph.edges.some((edge) => edge.id === id))
  )
    throw new Error('Invalid export selection');
  const nodes = graph.nodes.filter((node) => selectedNodes.has(node.id));
  const edges = graph.edges.filter((edge) => selectedEdges.has(edge.id));
  if (
    edges.some((edge) => !selectedNodes.has(edge.source) || !selectedNodes.has(edge.target)) ||
    nodes.some((node) => node.ownerId && !selectedNodes.has(node.ownerId))
  )
    throw new Error('Export selection omits required nodes');
  const required = new Set([...nodes, ...edges].flatMap((item) => item.evidenceIds));
  const evidence = graph.evidence.filter((item) => required.has(item.id));
  const licenses = new Set([
    'Apache-2.0',
    'MIT',
    'ISC',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'CC0-1.0',
    'CC-BY-4.0',
  ]);
  const publicLocation = (location: string) => {
    try {
      const url = new URL(location);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.hostname.includes('.') &&
        !/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) &&
        !/\.(local|internal|localhost)$/.test(url.hostname)
      );
    } catch {
      return false;
    }
  };
  if (
    evidence.some(
      (item) =>
        item.visibility !== 'public' ||
        item.redistribution !== 'reviewed' ||
        !licenses.has(item.license) ||
        !item.attribution ||
        !publicLocation(item.location) ||
        (item.origin &&
          (!publicLocation(item.origin.location) ||
            item.origin.useSites.some((site) => !publicLocation(site.location)))),
    )
  )
    throw new Error('Public source rights are not fully reviewed');
  return validateGraph({ formatVersion: 1, revision: graph.revision, nodes, edges, evidence });
}

export async function runCli(
  args: string[],
  io: { stdout: (text: string) => void; stderr: (text: string) => void } = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
): Promise<number> {
  try {
    const { command, options } = argumentsFor(args);
    const required = (key: string) => {
      const value = options.get(key);
      if (value === undefined) throw new Error('Required flag missing');
      return value;
    };
    const print = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
    if (command === 'help') {
      io.stdout(help);
      return 0;
    }
    if (command === 'inspect') {
      const result = await inspectRelationship(required('manifest'), {
        kind: required('kind'),
        field: required('field'),
        ...(options.has('target') ? { target: required('target') } : {}),
      });
      print(result.patch);
      for (const issue of result.issues) io.stderr(`${issue}\n`);
      return 0;
    }
    const store = new GraphStore(options.get('store') ?? resolve('knowledge'));
    if (command === 'init') {
      print(await store.init());
      return 0;
    }
    const graph = await store.read();
    switch (command) {
      case 'lookup':
        print(lookup(graph, required('term')));
        break;
      case 'path': {
        const depth = options.has('max-depth') ? Number(required('max-depth')) : 32;
        if (!Number.isSafeInteger(depth) || depth < 1 || depth > 100)
          throw new Error('Invalid path bound');
        print(
          findPath(graph, required('from'), required('to'), {
            structural: options.has('structural'),
            directed: options.has('directed'),
            maxDepth: depth,
          }),
        );
        break;
      }
      case 'validate': {
        if (options.has('patch'))
          applyPatch(graph, validatePatch(await jsonFile(required('patch'))));
        print({ valid: true, revision: graph.revision });
        break;
      }
      case 'apply': {
        const revision = required('expected-revision');
        if (!/^(0|[1-9]\d*)$/.test(revision)) throw new Error('Invalid expected revision');
        print(await store.apply(await jsonFile(required('patch')), Number(revision)));
        break;
      }
      case 'focus': {
        const focus = validateFocus(
          { nodeIds: ids(required('nodes')), edgeIds: ids(required('edges')) },
          graph,
        );
        const url = new URL(options.get('service') ?? 'http://127.0.0.1:4310');
        if (
          url.protocol !== 'http:' ||
          !['127.0.0.1', 'localhost'].includes(url.hostname) ||
          url.pathname !== '/' ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error('Invalid service URL');
        let focused = false;
        try {
          const response = await fetch(`${url.origin}/api/focus`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(focus),
            signal: AbortSignal.timeout(1500),
            redirect: 'error',
          });
          if (response.ok) {
            const status = (await response.json()) as { focused?: unknown };
            focused = status.focused === true;
          }
        } catch {
          /* Focus is best-effort; saved facts remain usable without a viewer. */
        }
        print({ focused });
        break;
      }
      case 'export': {
        const publicMode = options.has('public');
        if (
          publicMode &&
          (!options.has('reviewed') || !options.has('nodes') || !options.has('edges'))
        )
          throw new Error('Explicit public review is required');
        if (!publicMode && ['reviewed', 'nodes', 'edges'].some((key) => options.has(key)))
          throw new Error('Public selection requires public mode');
        const exported = publicMode
          ? publicExport(graph, ids(required('nodes')), ids(required('edges')))
          : graph;
        const output = resolve(required('output'));
        const handle = await open(output, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(exported, null, 2)}\n`);
          await handle.sync();
        } finally {
          await handle.close();
        }
        print({
          exported: true,
          visibility: publicMode ? 'public-reviewed' : 'private',
          nodes: exported.nodes.length,
          edges: exported.edges.length,
        });
        break;
      }
    }
    return 0;
  } catch {
    // Never reflect user text, source text, paths or request bodies in errors/logs.
    io.stderr(
      'Command failed. Check flags, validated input, source rights and current revision; see graph help and docs/recovery.md.\n',
    );
    return 1;
  }
}
