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
  it('shows a definition immediately below the selected schema name', () => {
    const graph = fixture();
    graph.nodes[0].description = 'A synthetic entity <with> a source definition.';
    const markup = renderToStaticMarkup(
      createElement(Inspector, {
        graph,
        selection: { type: 'node', id: 'Alpha' },
        onSelect: () => undefined,
      }),
    );
    expect(markup).toContain('aria-label="Definition"');
    expect(markup).toContain('A synthetic entity &lt;with&gt; a source definition.');
    expect(markup.indexOf('Definition')).toBeLessThan(markup.indexOf('Entity relationships'));
  });

  it('explains when a source definition is unavailable', () => {
    const markup = renderToStaticMarkup(
      createElement(Inspector, {
        graph: fixture(),
        selection: { type: 'node', id: 'Alpha' },
        onSelect: () => undefined,
      }),
    );
    expect(markup).toContain('No schema definition available for this version.');
  });

  it('keeps long definitions compact with the full source text in a disclosure', () => {
    const graph = fixture();
    graph.nodes[0].description = 'Synthetic source description. '.repeat(30);
    const markup = renderToStaticMarkup(
      createElement(Inspector, {
        graph,
        selection: { type: 'node', id: 'Alpha' },
        onSelect: () => undefined,
      }),
    );
    expect(markup).toContain('<summary>Full schema description</summary>');
    expect(markup).toContain(graph.nodes[0].description.trim());
  });

  it('inspects a collapsed reference using its owning entity, exact property and original evidence', () => {
    const graph = fixture();
    graph.nodes.push({
      ...graph.nodes[0],
      id: 'field',
      type: 'property',
      label: 'data.Ref[]',
      propertyPath: 'data.Ref[]',
      ownerId: 'Alpha',
      occurrencePath: '/properties/data/properties/Ref',
    });
    graph.edges[0] = {
      ...graph.edges[0],
      source: 'field',
      type: 'references_record',
      direction: 'forward',
    };
    const markup = renderToStaticMarkup(
      createElement(Inspector, {
        graph,
        selection: { type: 'edge', id: 'edge' },
        onSelect: () => undefined,
      }),
    );
    expect(markup).toContain('Alpha → Beta');
    expect(markup).toContain('<dt>Property</dt>');
    expect(markup).toContain('<code>Ref[]</code>');
    expect(markup).toContain('data.Ref[]');
    expect(markup).toContain('oneOf[1]');
    expect(markup).toContain('pinned-revision');
    expect(markup).toContain('pinned-hash');
  });

  it('offers keyboard-operable property relationships when an entity is selected', () => {
    const markup = renderToStaticMarkup(
      createElement(Inspector, {
        graph: fixture(),
        selection: { type: 'node', id: 'Alpha' },
        onSelect: () => undefined,
      }),
    );
    expect(markup).toContain('aria-label="Inspect Ref[] from Alpha to Beta"');
  });

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
