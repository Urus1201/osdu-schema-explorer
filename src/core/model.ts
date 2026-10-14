export const nodeTypes = ['entity', 'property', 'fragment', 'reference_data'] as const;
export const edgeTypes = [
  'references_record',
  'contains_property',
  'composes_schema',
  'documented_association',
] as const;
export type NodeType = (typeof nodeTypes)[number];
export type EdgeType = (typeof edgeTypes)[number];
export type EvidenceCategory = 'schema' | 'documentation';

export interface Evidence {
  id: string;
  category: EvidenceCategory;
  namespace: string;
  location: string;
  revision: string;
  contentHash: string;
  schemaKind: string;
  schemaVersion: string;
  pointer: string;
  dialect?: string;
  origin?: {
    schemaKind: string;
    schemaVersion: string;
    location: string;
    pointer: string;
    useSites: { schemaKind: string; location: string; pointer: string }[];
  };
  excerpt?: string;
  visibility: 'public' | 'private' | 'unknown';
  license: string;
  redistribution: 'reviewed' | 'unknown' | 'prohibited';
  attribution?: string;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  namespace: string;
  kind: string;
  version: string;
  domain: string;
  schemaHash: string;
  evidenceIds: string[];
  description?: string;
  ownerId?: string;
  propertyPath?: string;
  occurrencePath?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  direction: 'forward' | 'none';
  fieldPath: string;
  branch: string[];
  evidenceCategory: EvidenceCategory;
  evidenceIds: string[];
  description?: string;
  required?: boolean;
  minItems?: number;
  maxItems?: number;
  targetConstraint?: string;
}

export interface GraphPatch {
  formatVersion: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidence: Evidence[];
}

export interface Graph extends GraphPatch {
  revision: number;
}
export interface PatchResult {
  graph: Graph;
  changed: boolean;
  addedNodeIds: string[];
  addedEdgeIds: string[];
}
export interface GraphPath {
  nodeIds: string[];
  edgeIds: string[];
  structural: boolean;
}
export interface FocusMessage {
  nodeIds: string[];
  edgeIds: string[];
  addedNodeIds?: string[];
  addedEdgeIds?: string[];
}

export function emptyGraph(): Graph {
  return { formatVersion: 1, revision: 0, nodes: [], edges: [], evidence: [] };
}
