import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyGraph, type Graph } from '../src/core/model.js';
import { Inspector } from '../src/viewer/inspector.js';

function fixture(): Graph {
  const graph = emptyGraph();
  graph.nodes = ['Alpha', 'Beta'].map((label) => ({
    id: label,
    label,
    type: 'entity',
    namespace: 'synthetic',
    kind: `synthetic:test:${label}:1.0.0`,
    version: '1.0.0',
    domain: 'test',
    schemaHash: 'synthetic-hash',
    evidenceIds: ['proof'],
  }));
  graph.edges = [
    {
      id: 'edge',
      source: 'Alpha',
      target: 'Beta',
      type: 'documented_association',
      direction: 'none',
      fieldPath: 'data.Ref[]',
      branch: ['oneOf[1]'],
      evidenceCategory: 'documentation',
      evidenceIds: ['proof'],
      required: false,
    },
  ];
  graph.evidence = [
    {
      id: 'proof',
      category: 'documentation',
      namespace: 'synthetic',
      location: 'javascript:alert(1)',
      revision: 'pinned-revision',
      contentHash: 'pinned-hash',
      schemaKind: 'synthetic:test:Alpha:1.0.0',
      schemaVersion: '1.0.0',
      pointer: '/properties/data/properties/Ref',
      visibility: 'unknown',
      license: 'Apache-2.0',
      redistribution: 'unknown',
      excerpt: '<script>malicious source text</script>',
    },
  ];
  return graph;
}

describe('viewer evidence inspector', () => {
  it('preserves undirected semantics and distinguishes readable paths, source pointers and selected versions', () => {
    const markup = renderToStaticMarkup(
      createElement(Inspector, {
        graph: fixture(),
        selection: { type: 'edge', id: 'edge' },
        onSelect: () => undefined,
      }),
    );
    expect(markup).toContain('Alpha — Beta');
    expect(markup).toContain('Undirected');
    expect(markup).toContain('data.Ref[]');
    expect(markup).toContain('/properties/data/properties/Ref');
    expect(markup).toContain('oneOf[1]');
    expect(markup).toContain('No version constraint declared');
    expect(markup).toContain('Exploration target version');
    expect(markup).toContain('Optional field');
    expect(markup).toContain('pinned-revision');
    expect(markup).toContain('pinned-hash');
  });

  it('renders source content as escaped text and never links executable URL schemes', () => {
    const graph = fixture();
    const before = JSON.stringify(graph);
    const markup = renderToStaticMarkup(
      createElement(Inspector, {
        graph,
        selection: { type: 'edge', id: 'edge' },
        onSelect: () => undefined,
      }),
    );
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('href="javascript:');
    expect(markup).toContain('&lt;script&gt;');
    expect(JSON.stringify(graph)).toBe(before);
  });
});
