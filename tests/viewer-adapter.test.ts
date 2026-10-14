import { describe, expect, it } from 'vitest';
import type { Graph, GraphNode } from '../src/core/model.js';
import {
  createRendererGraph,
  filterGraph,
  focusedNodeIds,
  initialFilters,
  safeSourceUrl,
} from '../src/viewer/graph-adapter.js';

function fixture(): Graph {
  const node = (id: string, type: GraphNode['type'], domain: string): GraphNode => ({
    id,
    type,
    domain,
    label: id,
    kind: `synthetic:test:${id}:1.0.0`,
    version: '1.0.0',
    namespace: 'synthetic',
    schemaHash: 'test-hash',
    evidenceIds: ['proof'],
  });
  return {
    formatVersion: 1,
    revision: 2,
    nodes: [
      node('Alpha', 'entity', 'a'),
      node('field', 'property', 'a'),
      node('Beta', 'entity', 'b'),
    ],
    edges: [
      {
        id: 'first',
        source: 'Alpha',
        target: 'field',
        type: 'contains_property',
        direction: 'forward',
        fieldPath: 'data.Field',
        branch: [],
        evidenceCategory: 'schema',
        evidenceIds: ['proof'],
      },
      {
        id: 'second',
        source: 'field',
        target: 'Beta',
        type: 'references_record',
        direction: 'forward',
        fieldPath: 'data.Field',
        branch: ['oneOf[0]'],
        evidenceCategory: 'documentation',
        evidenceIds: ['doc'],
      },
    ],
    evidence: [
      {
        id: 'proof',
        category: 'schema',
        namespace: 'synthetic',
        location: 'fixtures/schema.json',
        revision: 'test',
        contentHash: 'hash',
        schemaKind: 'synthetic:test:Alpha:1.0.0',
        schemaVersion: '1.0.0',
        pointer: '/properties/data',
        visibility: 'unknown',
        license: 'Apache-2.0',
        redistribution: 'unknown',
      },
      {
        id: 'doc',
        category: 'documentation',
        namespace: 'synthetic',
        location: 'fixtures/readme.md',
        revision: 'test',
        contentHash: 'doc-hash',
        schemaKind: 'synthetic:test:Alpha:1.0.0',
        schemaVersion: '1.0.0',
        pointer: '/association',
        visibility: 'unknown',
        license: 'Apache-2.0',
        redistribution: 'unknown',
      },
    ],
  };
}

describe('viewer graph adapter', () => {
  it('isolates force positions, endpoint objects and nested data from canonical facts', () => {
    const graph = fixture();
    const before = JSON.stringify(graph);
    const rendered = createRendererGraph(graph);
    rendered.nodes[0].x = 123;
    rendered.nodes[0].evidenceIds.push('renderer-only');
    rendered.links[0].source = rendered.nodes[0];
    rendered.links[1].branch.push('renderer-only');
    expect(JSON.stringify(graph)).toBe(before);
    expect(graph.edges[0].source).toBe('Alpha');
  });

  it('filters only saved facts and removes links with hidden endpoints', () => {
    const graph = fixture();
    const view = filterGraph(graph, { ...initialFilters, domain: 'a' });
    expect(view.nodes.map((node) => node.id)).toEqual(['Alpha', 'field']);
    expect(view.edges.map((edge) => edge.id)).toEqual(['first']);
    expect(graph.nodes).toHaveLength(3);
  });

  it('preserves renderer coordinates for existing nodes when saved facts append', () => {
    const graph = fixture();
    const previous = createRendererGraph({
      ...graph,
      nodes: graph.nodes.slice(0, 2),
      edges: graph.edges.slice(0, 1),
    });
    previous.nodes[0].x = 50;
    previous.nodes[0].y = -12;
    const next = createRendererGraph(graph, previous);
    expect(next.nodes[0].x).toBe(50);
    expect(next.nodes[0].y).toBe(-12);
    expect(next.nodes[2].x).toBeUndefined();
    expect(graph.nodes[0]).not.toHaveProperty('x');
  });

  it('focuses a saved path including edge endpoints without synthesizing shortcut facts', () => {
    const view = filterGraph(fixture(), initialFilters, {
      nodeIds: [],
      edgeIds: ['first', 'second'],
    });
    expect(view.nodes.map((node) => node.id)).toEqual(['Alpha', 'field', 'Beta']);
    expect(view.edges.map((edge) => edge.id)).toEqual(['first', 'second']);
    expect(view.edges.some((edge) => edge.source === 'Alpha' && edge.target === 'Beta')).toBe(
      false,
    );
  });

  it('compact mode hides structural detail and never invents a direct relationship', () => {
    const view = filterGraph(fixture(), { ...initialFilters, detail: 'compact' });
    expect(view.nodes.map((node) => node.id)).toEqual(['Alpha', 'Beta']);
    expect(view.edges).toEqual([]);
  });

  it('searches saved labels without modifying the graph and distinguishes edge evidence', () => {
    const graph = fixture();
    expect(
      filterGraph(graph, { ...initialFilters, search: 'beta' }).nodes.map((node) => node.id),
    ).toEqual(['Beta']);
    expect(
      filterGraph(graph, { ...initialFilters, evidence: 'schema' }).edges.map((edge) => edge.id),
    ).toEqual(['first']);
    expect(
      filterGraph(graph, { ...initialFilters, edgeType: 'references_record' }).edges.map(
        (edge) => edge.id,
      ),
    ).toEqual(['second']);
    expect(JSON.stringify(graph)).not.toContain('search');
  });

  it('keeps endpoints visible for documentation-backed relationships even when the node definition has schema evidence', () => {
    const view = filterGraph(fixture(), { ...initialFilters, evidence: 'documentation' });
    expect(view.nodes.map((node) => node.id)).toEqual(['field', 'Beta']);
    expect(view.edges.map((edge) => edge.id)).toEqual(['second']);
  });

  it('focuses endpoints after the force library replaces link IDs with node objects', () => {
    const rendered = createRendererGraph(fixture());
    rendered.links[0].source = rendered.nodes[0];
    expect([...focusedNodeIds(rendered, { nodeIds: [], edgeIds: ['first'] })]).toEqual([
      'Alpha',
      'field',
    ]);
  });

  it('links only web source URLs, displaying portable paths and executable schemes as text', () => {
    expect(safeSourceUrl('https://example.org/schema.json')).toBe(
      'https://example.org/schema.json',
    );
    expect(safeSourceUrl('fixtures/schema.json')).toBeUndefined();
    expect(safeSourceUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeSourceUrl('file:///private/schema.json')).toBeUndefined();
  });
});
