import { describe, expect, it } from 'vitest';
import type { Graph, GraphNode } from '../src/core/model.js';
import {
  createRendererGraph,
  filterGraph,
  focusedNodeIds,
  initialFilters,
  nodeLabelLines,
  nodeVisual,
  safeSourceUrl,
  rendererHighlights,
  selectionNeighborhood,
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
    ...(type === 'property'
      ? { ownerId: 'Alpha', propertyPath: 'data.Field', occurrencePath: '/properties/Field' }
      : {}),
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

const expandedFilters = { ...initialFilters, detail: 'expanded' as const };

describe('viewer graph adapter', () => {
  it('highlights only immediate neighbors after the renderer resolves endpoint objects', () => {
    const graph = fixture();
    graph.nodes.push({ ...graph.nodes[2], id: 'Gamma' });
    graph.edges.push({ ...graph.edges[1], id: 'third', source: 'Beta', target: 'Gamma' });
    const rendered = createRendererGraph(filterGraph(graph, initialFilters));
    const [alpha, beta] = rendered.nodes;
    rendered.links[0].source = alpha;
    rendered.links[0].target = beta;
    const neighborhood = selectionNeighborhood(rendered, { type: 'node', id: 'Alpha' });
    expect([...neighborhood.nodes]).toEqual(['Alpha', 'Beta']);
    expect([...neighborhood.edges]).toEqual(['second']);
  });

  it('projects focus and additions from hidden containment onto the original reference ID', () => {
    const data = createRendererGraph(filterGraph(fixture(), initialFilters));
    const highlights = rendererHighlights(data, {
      nodeIds: [],
      edgeIds: ['first'],
      addedNodeIds: ['field'],
      addedEdgeIds: [],
    });
    expect([...highlights.focusedEdges]).toEqual(['second']);
    expect([...highlights.focusedNodes]).toEqual(['Alpha', 'Beta']);
    expect([...highlights.addedEdges]).toEqual(['second']);
  });

  it('keeps type colors when an entire path is focused, using an outline for state', () => {
    const [entity, property] = fixture().nodes;
    expect(nodeVisual(entity, { focused: true })).toMatchObject({
      color: '#15736c',
      outline: '#184dd3',
      value: 4,
    });
    expect(nodeVisual(property, { focused: true })).toMatchObject({
      color: '#3577be',
      outline: '#184dd3',
      value: 1,
    });
    expect(nodeVisual(entity, { added: true })).toMatchObject({
      color: '#15736c',
      outline: '#bf7822',
    });
    expect(nodeVisual(entity, { added: true, selected: true }).outline).toBe('#184dd3');
    expect(nodeVisual(entity, {}).outline).toBeUndefined();
  });

  it('wraps long canvas labels without shortening the saved field path', () => {
    const node = fixture().nodes[1];
    node.label = 'data.VerticalMeasurement.WellboreTVDTrajectoryID';
    expect(nodeLabelLines(node)).toEqual(['Wellbore TVD', 'Trajectory ID']);
    expect(node.label).toBe('data.VerticalMeasurement.WellboreTVDTrajectoryID');
    expect(nodeLabelLines({ ...node, type: 'entity', label: 'WellboreMarkerSet' })).toEqual([
      'Wellbore Marker Set',
    ]);
    expect(
      nodeLabelLines({ ...node, type: 'fragment', label: 'AbstractFacilityVerticalMeasurement' }),
    ).toEqual(['Abstract Facility', 'Vertical Measurement']);
    expect(nodeLabelLines({ ...node, label: 'data.' })).toEqual(['data.']);
    expect(nodeLabelLines({ ...node, label: 'X'.repeat(50) }).join('')).toBe('X'.repeat(50));
    expect(
      nodeLabelLines({ ...node, label: 'X'.repeat(50) }).every((line) => line.length <= 20),
    ).toBe(true);
  });

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
    const view = filterGraph(graph, { ...expandedFilters, domain: 'a' });
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
    const view = filterGraph(fixture(), expandedFilters, {
      nodeIds: [],
      edgeIds: ['first', 'second'],
    });
    expect(view.nodes.map((node) => node.id)).toEqual(['Alpha', 'field', 'Beta']);
    expect(view.edges.map((edge) => edge.id)).toEqual(['first', 'second']);
    expect(view.edges.some((edge) => edge.source === 'Alpha' && edge.target === 'Beta')).toBe(
      false,
    );
  });

  it('defaults to an entity overview with inspectable references instead of property nodes', () => {
    const graph = fixture();
    const before = JSON.stringify(graph);
    const view = filterGraph(graph, initialFilters);
    expect(view.nodes.map((node) => node.id)).toEqual(['Alpha', 'Beta']);
    expect(view.edges).toEqual([
      {
        ...graph.edges[1],
        source: 'Alpha',
        propertyId: 'field',
        pathEdgeIds: ['first', 'second'],
      },
    ]);
    expect(JSON.stringify(graph)).toBe(before);
    expect(graph.edges[1].source).toBe('field');
  });

  it('projects separate fields and branches without merging their saved identities or evidence', () => {
    const graph = fixture();
    graph.edges.push({ ...graph.edges[1], id: 'other-branch', branch: ['oneOf[1]'] });
    graph.nodes.push({ ...graph.nodes[1], id: 'other-field', propertyPath: 'data.OtherID' });
    graph.edges.push(
      { ...graph.edges[0], id: 'other-containment', target: 'other-field' },
      {
        ...graph.edges[1],
        id: 'other-reference',
        source: 'other-field',
        fieldPath: 'data.OtherID',
      },
    );
    const view = filterGraph(fixture(), { ...initialFilters, detail: 'compact' });
    expect(view.edges[0]).toMatchObject({
      id: 'second',
      branch: ['oneOf[0]'],
      evidenceIds: ['doc'],
      evidenceCategory: 'documentation',
    });
    expect(filterGraph(graph, initialFilters).edges.map((edge) => edge.id)).toEqual([
      'second',
      'other-branch',
      'other-reference',
    ]);
  });

  it('finds a hidden property by its full path and retains its source and target', () => {
    const view = filterGraph(fixture(), { ...initialFilters, search: 'data.Field' });
    expect(view.nodes.map((node) => node.id)).toEqual(['Alpha', 'Beta']);
    expect(view.edges.map((edge) => edge.id)).toEqual(['second']);
  });

  it('keeps projected references connected when filtering their relationship or evidence', () => {
    for (const filters of [
      { ...initialFilters, edgeType: 'references_record' as const },
      { ...initialFilters, evidence: 'documentation' as const },
    ]) {
      const view = filterGraph(fixture(), filters);
      expect(view.nodes.map((node) => node.id)).toEqual(['Alpha', 'Beta']);
      expect(view.edges.map((edge) => edge.id)).toEqual(['second']);
    }
  });

  it('maps focused containment and hidden property IDs onto the visible reference', () => {
    for (const focus of [
      { nodeIds: [], edgeIds: ['first'] },
      { nodeIds: ['field'], edgeIds: [] },
    ]) {
      const view = filterGraph(fixture(), initialFilters, focus);
      expect(view.nodes.map((node) => node.id)).toEqual(['Alpha', 'Beta']);
      expect(view.edges.map((edge) => edge.id)).toEqual(['second']);
      expect([...focusedNodeIds(createRendererGraph(view), focus)]).toEqual(
        expect.arrayContaining(['Alpha', 'Beta']),
      );
    }
  });

  it('does not infer entity references through shared fragments or missing containment', () => {
    const graph = fixture();
    const fragment = { ...graph.nodes[0], id: 'shared', type: 'fragment' as const };
    graph.nodes.push(fragment);
    graph.edges = [
      { ...graph.edges[0], id: 'composition-a', target: 'shared', type: 'composes_schema' },
      {
        ...graph.edges[0],
        id: 'composition-b',
        source: 'Beta',
        target: 'shared',
        type: 'composes_schema',
      },
      graph.edges[1],
    ];
    const view = filterGraph(graph, initialFilters);
    expect(view.nodes.map((node) => node.id)).toEqual(['Alpha', 'Beta']);
    expect(view.edges).toEqual([]);
  });

  it('restores the complete canonical property path in expanded detail', () => {
    const graph = fixture();
    const view = filterGraph(graph, expandedFilters);
    expect(view.nodes).toEqual(graph.nodes);
    expect(view.edges).toEqual(graph.edges);
  });

  it('searches saved labels without modifying the graph and distinguishes edge evidence', () => {
    const graph = fixture();
    expect(
      filterGraph(graph, { ...expandedFilters, search: 'beta' }).nodes.map((node) => node.id),
    ).toEqual(['Beta']);
    expect(
      filterGraph(graph, { ...expandedFilters, evidence: 'schema' }).edges.map((edge) => edge.id),
    ).toEqual(['first']);
    expect(
      filterGraph(graph, { ...expandedFilters, edgeType: 'references_record' }).edges.map(
        (edge) => edge.id,
      ),
    ).toEqual(['second']);
    expect(JSON.stringify(graph)).not.toContain('search');
  });

  it('keeps endpoints visible for documentation-backed relationships even when the node definition has schema evidence', () => {
    const view = filterGraph(fixture(), { ...expandedFilters, evidence: 'documentation' });
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
