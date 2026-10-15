import type { Graph, GraphEdge } from '../core/model.js';

/** A display connection retains the identity and provenance of its saved reference. */
export interface ViewEdge extends GraphEdge {
  propertyId?: string;
  pathEdgeIds?: string[];
}

export interface ViewGraph extends Graph {
  edges: ViewEdge[];
}

/** Collapse explicit owner → property → target paths only; never traverse shared fragments. */
export function entityOverview(graph: Graph): ViewGraph {
  const allNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes = graph.nodes.filter(
    (node) => node.type === 'entity' || node.type === 'reference_data',
  );
  const visible = new Set(nodes.map((node) => node.id));
  const containment = new Map(
    graph.edges
      .filter(
        (edge) =>
          edge.type === 'contains_property' && allNodes.get(edge.target)?.ownerId === edge.source,
      )
      .map((edge) => [edge.target, edge]),
  );
  const edges: ViewEdge[] = [];
  for (const edge of graph.edges) {
    if (edge.type !== 'references_record' && edge.type !== 'documented_association') continue;
    if (!visible.has(edge.target)) continue;
    if (visible.has(edge.source)) {
      edges.push(edge);
      continue;
    }
    const property = allNodes.get(edge.source);
    const parent = containment.get(edge.source);
    if (property?.type !== 'property' || !parent || !visible.has(parent.source)) continue;
    edges.push({
      ...edge,
      source: parent.source,
      propertyId: property.id,
      pathEdgeIds: [parent.id, edge.id],
    });
  }
  return { ...graph, nodes, edges };
}

export function matchesFocus(
  edge: Pick<ViewEdge, 'id' | 'propertyId' | 'pathEdgeIds'>,
  edgeIds: Set<string>,
  nodeIds: Set<string> = new Set(),
): boolean {
  return (
    edgeIds.has(edge.id) ||
    (edge.pathEdgeIds?.some((id) => edgeIds.has(id)) ?? false) ||
    (edge.propertyId !== undefined && nodeIds.has(edge.propertyId))
  );
}
