import type {
  EvidenceCategory,
  FocusMessage,
  Graph,
  GraphNode,
  EdgeType,
  NodeType,
} from '../core/model.js';
import { entityOverview, matchesFocus, type ViewEdge, type ViewGraph } from './graph-overview.js';
import type { Selection } from './graph-canvas.js';

export interface ViewFilters {
  search: string;
  domain: string;
  nodeType: NodeType | 'all';
  evidence: EvidenceCategory | 'all';
  edgeType: EdgeType | 'all';
  detail: 'compact' | 'expanded';
}

export const initialFilters: ViewFilters = {
  search: '',
  domain: 'all',
  nodeType: 'all',
  evidence: 'all',
  edgeType: 'all',
  detail: 'compact',
};

export type RendererNode = GraphNode & {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
};
export type RendererLink = Omit<ViewEdge, 'source' | 'target'> & {
  source: string | RendererNode;
  target: string | RendererNode;
  curvature?: number;
};
export interface RendererGraph {
  nodes: RendererNode[];
  links: RendererLink[];
}

export function focusedNodeIds(data: RendererGraph, focus: FocusMessage): Set<string> {
  const ids = new Set(focus.nodeIds);
  const edges = new Set(focus.edgeIds);
  for (const edge of data.links) {
    if (matchesFocus(edge, edges, ids)) {
      ids.add(endpointId(edge.source));
      ids.add(endpointId(edge.target));
    }
  }
  return ids;
}

export function endpointId(endpoint: string | RendererNode): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

export function selectionNeighborhood(data: RendererGraph, selection: Selection) {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (selection?.type === 'node' && data.nodes.some((node) => node.id === selection.id)) {
    nodes.add(selection.id);
  }
  for (const edge of data.links) {
    const source = endpointId(edge.source);
    const target = endpointId(edge.target);
    if (
      (selection?.type === 'edge' && selection.id === edge.id) ||
      (selection?.type === 'node' && (selection.id === source || selection.id === target))
    ) {
      nodes.add(source);
      nodes.add(target);
      edges.add(edge.id);
    }
  }
  return { nodes, edges };
}

export function rendererHighlights(data: RendererGraph, focus: FocusMessage) {
  const focusNodes = new Set(focus.nodeIds);
  const focusEdges = new Set(focus.edgeIds);
  const addedNodes = new Set(focus.addedNodeIds);
  const additions = new Set(focus.addedEdgeIds);
  return {
    focusedNodes: focusedNodeIds(data, focus),
    focusedEdges: new Set(
      data.links
        .filter((edge) => matchesFocus(edge, focusEdges, focusNodes))
        .map((edge) => edge.id),
    ),
    addedNodes,
    addedEdges: new Set(
      data.links.filter((edge) => matchesFocus(edge, additions, addedNodes)).map((edge) => edge.id),
    ),
  };
}

/** Only this disposable copy is given to force renderers. */
export function createRendererGraph(graph: ViewGraph, previous?: RendererGraph): RendererGraph {
  const positions = new Map(previous?.nodes.map((node) => [node.id, node]));
  const nodes: RendererNode[] = structuredClone(graph.nodes);
  for (const node of nodes) {
    const prior = positions.get(node.id);
    if (prior) {
      for (const coordinate of ['x', 'y', 'z', 'vx', 'vy', 'vz'] as const) {
        if (Number.isFinite(prior[coordinate])) node[coordinate] = prior[coordinate];
      }
    }
  }
  const links: RendererLink[] = structuredClone(graph.edges);
  const parallel = new Map<string, RendererLink[]>();
  for (const edge of links) {
    const key = JSON.stringify([endpointId(edge.source), endpointId(edge.target)].sort());
    const group = parallel.get(key) ?? [];
    group.push(edge);
    parallel.set(key, group);
  }
  for (const group of parallel.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id, 'en'));
    group.forEach((edge, index) => {
      const source = endpointId(edge.source);
      const target = endpointId(edge.target);
      edge.curvature =
        source === target
          ? 0.4 + index * 0.15
          : (index - (group.length - 1) / 2) *
            Math.min(0.22, 1 / group.length) *
            (source < target ? 1 : -1);
    });
  }
  return { nodes, links };
}

export function filterGraph(graph: Graph, filters: ViewFilters, focus?: FocusMessage): ViewGraph {
  const display = filters.detail === 'compact' ? entityOverview(graph) : graph;
  const search = filters.search.trim().toLocaleLowerCase();
  const evidence = new Map(graph.evidence.map((item) => [item.id, item.category]));
  const evidenceEndpoints = new Set<string>();
  if (filters.evidence !== 'all') {
    for (const edge of display.edges) {
      if (
        edge.evidenceCategory === filters.evidence &&
        (filters.edgeType === 'all' || edge.type === filters.edgeType)
      ) {
        evidenceEndpoints.add(edge.source);
        evidenceEndpoints.add(edge.target);
      }
    }
  }
  const focusedNodes = new Set(focus?.nodeIds);
  const focusedEdges = new Set(focus?.edgeIds);
  if (focus) {
    for (const edge of display.edges) {
      if (matchesFocus(edge, focusedEdges, focusedNodes)) {
        focusedEdges.add(edge.id);
        focusedNodes.add(edge.source);
        focusedNodes.add(edge.target);
      }
    }
  }
  const searchEndpoints = new Set<string>();
  if (search && filters.detail === 'compact') {
    const properties = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const edge of display.edges as ViewEdge[]) {
      const property = edge.propertyId ? properties.get(edge.propertyId) : undefined;
      if (
        [edge.fieldPath, property?.label, property?.propertyPath].some((value) =>
          value?.toLocaleLowerCase().includes(search),
        )
      ) {
        searchEndpoints.add(edge.source);
        searchEndpoints.add(edge.target);
      }
    }
  }
  const nodes = display.nodes.filter((node) => {
    if (focus && !focusedNodes.has(node.id)) return false;
    if (filters.domain !== 'all' && node.domain !== filters.domain) return false;
    if (filters.nodeType !== 'all' && node.type !== filters.nodeType) return false;
    if (
      filters.evidence !== 'all' &&
      !evidenceEndpoints.has(node.id) &&
      !node.evidenceIds.some((id) => evidence.get(id) === filters.evidence)
    )
      return false;
    return (
      !search ||
      searchEndpoints.has(node.id) ||
      [node.label, node.kind, node.description, node.propertyPath].some((value) =>
        value?.toLocaleLowerCase().includes(search),
      )
    );
  });
  const visible = new Set(nodes.map((node) => node.id));
  const edges = display.edges.filter(
    (edge) =>
      visible.has(edge.source) &&
      visible.has(edge.target) &&
      (!focus || focusedEdges.has(edge.id)) &&
      (filters.evidence === 'all' || edge.evidenceCategory === filters.evidence) &&
      (filters.edgeType === 'all' || edge.type === filters.edgeType),
  );
  return { ...graph, nodes, edges };
}

export const nodeNames: Record<NodeType, string> = {
  entity: 'Entity',
  property: 'Property',
  fragment: 'Fragment',
  reference_data: 'Reference data',
};
export const relationNames: Record<EdgeType, string> = {
  references_record: 'Record reference',
  contains_property: 'Contains property',
  composes_schema: 'Schema composition',
  documented_association: 'Documented association',
};
export const nodeColors: Record<NodeType, string> = {
  entity: '#15736c',
  property: '#3577be',
  fragment: '#8562b4',
  reference_data: '#ce8628',
};
export const edgeColors: Record<EdgeType, string> = {
  references_record: '#3b728c',
  contains_property: '#748292',
  composes_schema: '#8562b4',
  documented_association: '#bd7625',
};

export function nodeVisual(
  node: GraphNode,
  state: { selected?: boolean; focused?: boolean; added?: boolean },
) {
  return {
    color: nodeColors[node.type],
    value: node.type === 'entity' ? 4 : node.type === 'property' ? 1 : 2,
    outline: state.selected
      ? '#184dd3'
      : state.added
        ? '#bf7822'
        : state.focused
          ? '#184dd3'
          : undefined,
  };
}

/** Canvas captions only; the inspector and list retain exact schema names and paths. */
export function nodeLabelLines(node: GraphNode): string[] {
  const name = node.type === 'property' ? node.label.split('.').at(-1) || node.label : node.label;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    for (const part of word.match(/.{1,20}/gu) ?? []) {
      if (line && line.length + part.length + 1 > 20) {
        lines.push(line);
        line = '';
      }
      line = line ? `${line} ${part}` : part;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [node.label];
}

export function safeSourceUrl(location: string): string | undefined {
  try {
    const url = new URL(location);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
