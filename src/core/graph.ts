import Ajv from 'ajv';
import graphSchema from '../../schemas/graph.schema.json';
import patchSchema from '../../schemas/patch.schema.json';
import { edgeId, propertyId, schemaId, stableStringify } from './identity';
import type {
  Evidence,
  Graph,
  GraphEdge,
  GraphNode,
  GraphPatch,
  GraphPath,
  PatchResult,
} from './model';

const ajv = new Ajv({ allErrors: false, strict: true });
const patchValidator = ajv.compile<GraphPatch>(patchSchema);
const graphValidator = ajv.compile<Graph>(graphSchema);

export function validatePatch(value: unknown): GraphPatch {
  if (!patchValidator(value))
    throw new Error(`Invalid patch: ${ajv.errorsText(patchValidator.errors)}`);
  checkDuplicateIds(value);
  for (const edge of value.edges) {
    if (edge.id !== edgeId(edge)) throw new Error('Invalid edge identity');
    if (edge.minItems !== undefined && edge.maxItems !== undefined && edge.minItems > edge.maxItems)
      throw new Error('Invalid array bounds');
    if (edge.type !== 'documented_association' && edge.direction !== 'forward')
      throw new Error('Schema edge direction must be forward');
    if (edge.type === 'documented_association' && edge.evidenceCategory !== 'documentation')
      throw new Error('Documented association requires documentation evidence');
    if (edge.type !== 'documented_association' && edge.evidenceCategory !== 'schema')
      throw new Error('Schema edge requires schema evidence');
  }
  for (const node of value.nodes) {
    if (!node.kind.endsWith(`:${node.version}`))
      throw new Error('Kind must include selected version');
    if (node.type === 'property') {
      if (
        !node.ownerId ||
        !node.occurrencePath ||
        !node.propertyPath ||
        node.id !== propertyId(node.ownerId, node.occurrencePath)
      )
        throw new Error('Invalid property owner or occurrence identity');
    } else if (
      node.id !== schemaId(node.namespace, node.kind) ||
      node.ownerId ||
      node.propertyPath ||
      node.occurrencePath
    ) {
      throw new Error('Invalid schema identity');
    }
  }
  return value;
}

function checkDuplicateIds(value: GraphPatch) {
  for (const items of [value.nodes, value.edges, value.evidence]) {
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new Error('Duplicate identity');
  }
}

export function validateGraph(value: unknown): Graph {
  if (!graphValidator(value))
    throw new Error(`Invalid graph: ${ajv.errorsText(graphValidator.errors)}`);
  validatePatch({
    formatVersion: value.formatVersion,
    nodes: value.nodes,
    edges: value.edges,
    evidence: value.evidence,
  });
  const nodes = new Map(value.nodes.map((node) => [node.id, node]));
  const evidence = new Map(value.evidence.map((item) => [item.id, item]));
  function owner(node: GraphNode): GraphNode {
    if (node.type !== 'property') return node;
    const parent = nodes.get(node.ownerId!);
    if (
      !parent ||
      parent.type === 'property' ||
      parent.kind !== node.kind ||
      parent.namespace !== node.namespace ||
      parent.schemaHash !== node.schemaHash
    )
      throw new Error('Invalid property owner');
    return parent;
  }
  function verifyEvidence(ids: string[], node: GraphNode, category?: string) {
    const owning = owner(node);
    for (const id of ids) {
      const item = evidence.get(id);
      if (
        !item ||
        item.namespace !== owning.namespace ||
        item.schemaKind !== owning.kind ||
        item.schemaVersion !== owning.version
      )
        throw new Error('Missing or incorrect owning evidence');
      if (category && item.category !== category) throw new Error('Mismatched evidence category');
      if (item.category === 'schema' && !item.origin && item.contentHash !== owning.schemaHash)
        throw new Error('Conflicting schema content hash');
      if (item.category === 'documentation' && !item.excerpt)
        throw new Error('Documentation evidence needs an excerpt');
    }
  }
  for (const node of value.nodes) verifyEvidence(node.evidenceIds, node);
  for (const edge of value.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) throw new Error('Dangling edge endpoint');
    verifyEvidence(edge.evidenceIds, source, edge.evidenceCategory);
    if (
      edge.type === 'contains_property' &&
      (target.type !== 'property' || target.ownerId !== owner(source).id)
    )
      throw new Error('Containment must point to a property of its owner');
    if (edge.type === 'composes_schema' && target.type !== 'fragment')
      throw new Error('Composition must point to a fragment');
    if (
      edge.type === 'references_record' &&
      (target.type === 'property' || target.type === 'fragment')
    )
      throw new Error('Record reference requires entity or reference-data schema');
  }
  // Unattached provenance cannot be a hidden transcript or unused research cache.
  const used = new Set([...value.nodes, ...value.edges].flatMap((item) => item.evidenceIds));
  if (value.evidence.some((item) => !used.has(item.id))) throw new Error('Orphan evidence');
  return value;
}

function merge<T extends GraphNode | GraphEdge | Evidence>(existing: T[], incoming: T[]): T[] {
  const result = new Map(existing.map((item) => [item.id, structuredClone(item)]));
  for (const item of incoming) {
    const previous = result.get(item.id);
    if (!previous) {
      result.set(item.id, structuredClone(item));
      continue;
    }
    if ('evidenceIds' in item && 'evidenceIds' in previous) {
      const oldFields = { ...previous, evidenceIds: [] };
      const newFields = { ...item, evidenceIds: [] };
      if (stableStringify(oldFields) !== stableStringify(newFields))
        throw new Error(`Identity/content conflict: ${item.id}`);
      previous.evidenceIds = [...new Set([...previous.evidenceIds, ...item.evidenceIds])].sort();
    } else if (stableStringify(previous) !== stableStringify(item)) {
      throw new Error(`Evidence content conflict: ${item.id}`);
    }
  }
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

export function applyPatch(graph: Graph, patch: GraphPatch): PatchResult {
  validateGraph(graph);
  validatePatch(patch);
  const next = validateGraph({
    ...graph,
    nodes: merge(graph.nodes, patch.nodes),
    edges: merge(graph.edges, patch.edges),
    evidence: merge(graph.evidence, patch.evidence),
  });
  // Existing valid noncanonical ordering is preserved on a semantic no-op.
  const equivalent = stableStringify(semanticOrder(next)) === stableStringify(semanticOrder(graph));
  if (equivalent) return { graph, changed: false, addedNodeIds: [], addedEdgeIds: [] };
  if (graph.revision === Number.MAX_SAFE_INTEGER) throw new Error('Revision exhausted');
  next.revision = graph.revision + 1;
  const oldNodes = new Set(graph.nodes.map((node) => node.id));
  const oldEdges = new Set(graph.edges.map((edge) => edge.id));
  return {
    graph: next,
    changed: true,
    addedNodeIds: next.nodes.filter((n) => !oldNodes.has(n.id)).map((n) => n.id),
    addedEdgeIds: next.edges.filter((e) => !oldEdges.has(e.id)).map((e) => e.id),
  };
}
function semanticOrder(graph: Graph) {
  const facts = <T extends GraphNode | GraphEdge>(items: T[]) =>
    items.map((item) => ({ ...item, evidenceIds: [...item.evidenceIds].sort() })).sort(byId);
  return {
    ...graph,
    nodes: facts(graph.nodes),
    edges: facts(graph.edges),
    evidence: [...graph.evidence].sort(byId),
  };
}
function byId(a: { id: string }, b: { id: string }) {
  return a.id.localeCompare(b.id, 'en');
}

export function lookup(graph: Graph, term: string): GraphNode[] {
  const search = term.trim().toLocaleLowerCase('en');
  return graph.nodes
    .filter((node) =>
      `${node.label}\n${node.kind}\n${node.propertyPath ?? ''}`
        .toLocaleLowerCase('en')
        .includes(search),
    )
    .sort(byId);
}

export function findPath(
  graph: Graph,
  from: string,
  to: string,
  options: { structural?: boolean; directed?: boolean; maxDepth?: number } = {},
): GraphPath | null {
  const nodes = new Set(graph.nodes.map((node) => node.id));
  if (!nodes.has(from) || !nodes.has(to)) return null;
  // Endpoints alone are not proof of a relationship, including a self query.
  if (from === to) return null;
  const adjacency = new Map<string, { next: string; edge: GraphEdge }[]>();
  for (const edge of [...graph.edges].sort(byId)) {
    if (!options.structural && edge.type === 'composes_schema') continue;
    const add = (source: string, target: string) => {
      const list = adjacency.get(source) ?? [];
      list.push({ next: target, edge });
      adjacency.set(source, list);
    };
    add(edge.source, edge.target);
    if (!options.directed || edge.direction === 'none') add(edge.target, edge.source);
  }
  const queue: GraphPath[] = [{ nodeIds: [from], edgeIds: [], structural: false }];
  const visited = new Set([from]);
  const maxDepth = options.maxDepth ?? 20;
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    if (path.edgeIds.length >= maxDepth) continue;
    for (const { next, edge } of adjacency.get(path.nodeIds.at(-1)!) ?? []) {
      if (visited.has(next)) continue;
      const candidate = {
        nodeIds: [...path.nodeIds, next],
        edgeIds: [...path.edgeIds, edge.id],
        structural: path.structural || edge.type === 'composes_schema',
      };
      if (next === to) return candidate;
      visited.add(next);
      queue.push(candidate);
    }
  }
  return null;
}
