import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Graph, GraphNode } from '../core/model';
import { LocalSources } from './manifest';

async function manifestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const directories = [
    directory,
    ...entries.filter((entry) => entry.isDirectory()).map((entry) => join(directory, entry.name)),
  ];
  const files = await Promise.all(
    directories.map(async (root) =>
      (await readdir(root, { withFileTypes: true }).catch(() => []))
        .filter((entry) => entry.isFile() && /^manifest(?:-[\w-]+)?\.json$/.test(entry.name))
        .map((entry) => join(root, entry.name)),
    ),
  );
  return files.flat().sort();
}

async function describeGraph(graph: Graph, directory: string): Promise<Graph> {
  const candidates: { file: string; sources: LocalSources }[] = [];
  for (const file of await manifestFiles(directory)) {
    try {
      candidates.push({ file, sources: await LocalSources.open(file) });
    } catch {
      // Unavailable source metadata must not make saved knowledge unavailable.
    }
  }
  const matches = (sources: LocalSources, node: GraphNode) => {
    const entry = sources.entry(node.kind);
    return (
      entry &&
      sources.manifest.namespace === node.namespace &&
      entry.version === node.version &&
      entry.contentHash === node.schemaHash &&
      graph.evidence.some(
        (item) =>
          node.evidenceIds.includes(item.id) &&
          item.category === 'schema' &&
          item.schemaKind === node.kind &&
          item.schemaVersion === node.version &&
          item.namespace === node.namespace &&
          item.revision === sources.manifest.revision &&
          item.contentHash === entry.contentHash &&
          item.location === entry.location &&
          item.pointer === '',
      )
    );
  };
  const nodes: GraphNode[] = [];
  for (const node of graph.nodes) {
    let description = node.description;
    if (node.type !== 'property' && !description) {
      for (const candidate of candidates) {
        if (!matches(candidate.sources, node)) continue;
        try {
          // Each definition is a one-document inspection with its own source budget.
          const sources = await LocalSources.open(candidate.file);
          if (!matches(sources, node)) continue;
          const { schema } = await sources.load(sources.entry(node.kind)!);
          if (typeof schema.description === 'string' && schema.description.trim()) {
            description = schema.description.trim();
            break;
          }
        } catch {
          // Missing or changed bytes have no verified definition; never guess one.
        }
      }
    }
    nodes.push(description ? { ...node, description } : node);
  }
  return { ...graph, nodes };
}

/** Read-only presentation metadata, cached until the saved graph revision changes. */
export function createDescriptionReader(directory: string): (graph: Graph) => Promise<Graph> {
  let cached: { revision: number; result: Promise<Graph> } | undefined;
  return (graph) => {
    if (cached?.revision !== graph.revision)
      cached = { revision: graph.revision, result: describeGraph(graph, directory) };
    return cached.result;
  };
}
