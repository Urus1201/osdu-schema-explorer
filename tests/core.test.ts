import { describe, expect, it } from 'vitest';
import { applyPatch, findPath, lookup, validateGraph, validatePatch } from '../src/core/graph';
import { edgeId, propertyId, schemaId, stableStringify } from '../src/core/identity';
import { emptyGraph, type Evidence, type GraphNode, type GraphPatch } from '../src/core/model';

// Entirely synthetic mechanics; these names and facts are NOT OSDU schemas.
const hash = 'a'.repeat(64);
const namespace = 'synthetic.test';
function node(name: string): GraphNode {
  const kind = `test:synthetic:entity--${name}:1.0.0`;
  return {
    id: schemaId(namespace, kind),
    type: 'entity',
    label: name,
    namespace,
    kind,
    version: '1.0.0',
    domain: 'synthetic',
    schemaHash: hash,
    evidenceIds: [`e:${name}`],
  };
}
function evidence(n: GraphNode): Evidence {
  return {
    id: n.evidenceIds[0],
    category: 'schema',
    namespace,
    location: `fixtures/${n.label}.json`,
    revision: 'synthetic-v1',
    contentHash: hash,
    schemaKind: n.kind,
    schemaVersion: n.version,
    pointer: '',
    dialect: 'http://json-schema.org/draft-07/schema#',
    visibility: 'public',
    license: 'Apache-2.0',
    redistribution: 'reviewed',
    attribution: 'Project-owned synthetic fixture',
  };
}
function patch(names = ['A', 'B']): GraphPatch {
  const nodes = names.map(node);
  const edge = {
    source: nodes[0].id,
    target: nodes[1].id,
    type: 'references_record' as const,
    direction: 'forward' as const,
    fieldPath: 'data.TargetID',
    branch: [],
    evidenceCategory: 'schema' as const,
    evidenceIds: nodes[0].evidenceIds,
  };
  return {
    formatVersion: 1,
    nodes,
    evidence: nodes.map(evidence),
    edges: [{ ...edge, id: edgeId(edge) }],
  };
}

describe('strict graph contract', () => {
  it('accepts empty startup and rejects unknown question/history/renderer keys', () => {
    expect(validateGraph(emptyGraph())).toEqual(emptyGraph());
    expect(() => validateGraph({ ...emptyGraph(), question: 'private' })).toThrow();
    const p = patch();
    expect(() => validatePatch({ ...p, nodes: [{ ...p.nodes[0], x: 1 }, p.nodes[1]] })).toThrow();
    expect(() =>
      validatePatch({ ...p, evidence: [{ ...p.evidence[0], askedBy: 'private' }, p.evidence[1]] }),
    ).toThrow();
  });
  it('checks stable identities, ownership, evidence integrity and duplicate ids', () => {
    const g = applyPatch(emptyGraph(), patch()).graph;
    expect(() => validateGraph({ ...g, nodes: [...g.nodes, g.nodes[0]] })).toThrow(/duplicate/i);
    expect(() =>
      validateGraph({ ...g, nodes: [{ ...g.nodes[0], id: 'bad' }, g.nodes[1]] }),
    ).toThrow();
    expect(() => validateGraph({ ...g, evidence: [] })).toThrow(/evidence/i);
    const bad = structuredClone(g);
    bad.evidence[0].schemaKind = 'other';
    expect(() => validateGraph(bad)).toThrow(/owner|evidence/i);
    expect(() => validateGraph({ ...g, edges: [{ ...g.edges[0], source: 'missing' }] })).toThrow();
  });
  it('does not accept bounds as reverse cardinality or undeclared fields', () => {
    const p = patch();
    expect(() =>
      validatePatch({ ...p, edges: [{ ...p.edges[0], reverseCardinality: 'many' }] }),
    ).toThrow();
    expect(() =>
      validatePatch({ ...p, edges: [{ ...p.edges[0], minItems: 3, maxItems: 2 }] }),
    ).toThrow();
  });
});

describe('minimal additive patches', () => {
  it('adds once, does not mutate input, preserves revision and bytes on repeat', () => {
    const p = patch();
    const before = stableStringify(p);
    const g = emptyGraph();
    const added = applyPatch(g, p);
    expect(added.graph.revision).toBe(1);
    expect(added.addedNodeIds).toHaveLength(2);
    expect(g).toEqual(emptyGraph());
    expect(stableStringify(p)).toBe(before);
    const repeated = applyPatch(added.graph, p);
    expect(repeated.changed).toBe(false);
    expect(stableStringify(repeated.graph)).toBe(stableStringify(added.graph));
  });
  it('keeps disconnected facts and distinct fields without invented shortcuts', () => {
    const first = applyPatch(emptyGraph(), patch()).graph;
    const second = applyPatch(first, patch(['C', 'D'])).graph;
    expect(second.nodes).toHaveLength(4);
    expect(findPath(second, node('A').id, node('D').id)).toBeNull();
    const newField = structuredClone(patch());
    newField.edges[0].fieldPath = 'data.SecondTarget';
    newField.edges[0].id = edgeId(newField.edges[0]);
    const result = applyPatch(second, newField);
    expect(result.graph.edges).toHaveLength(3);
    expect(findPath(result.graph, node('A').id, node('B').id)?.edgeIds).toHaveLength(1);
  });
  it('rejects conflicting bytes or same identity different meaning atomically', () => {
    const g = applyPatch(emptyGraph(), patch()).graph;
    const p = patch();
    p.nodes[0].schemaHash = 'b'.repeat(64);
    expect(() => applyPatch(g, p)).toThrow(/conflict/i);
    expect(g.revision).toBe(1);
    const changed = patch();
    changed.edges[0].required = true;
    expect(() => applyPatch(g, changed)).toThrow(/conflict/i);
  });
  it('merges new provenance without overwriting facts and validates complete union', () => {
    const g = applyPatch(emptyGraph(), patch()).graph;
    const p = patch();
    p.evidence[0] = { ...p.evidence[0], id: 'alternate', pointer: '/properties/Target' };
    p.nodes[0].evidenceIds = ['alternate'];
    p.edges[0].evidenceIds = ['alternate'];
    expect(applyPatch(g, p).graph.evidence).toHaveLength(3);
    expect(() =>
      applyPatch(g, { formatVersion: 1, nodes: [], edges: [], evidence: [] }),
    ).not.toThrow();
    const dangling = structuredClone(p);
    dangling.edges[0].target = 'bad';
    dangling.edges[0].id = edgeId(dangling.edges[0]);
    expect(() => applyPatch(g, dangling)).toThrow();
  });
  it('preserves existing bytes when only evidence set ordering differs', () => {
    const original = patch();
    const extra = patch();
    extra.evidence[0] = { ...extra.evidence[0], id: 'alternate', pointer: '/alternate' };
    extra.nodes[0].evidenceIds = ['alternate'];
    extra.edges[0].evidenceIds = ['alternate'];
    const graph = applyPatch(applyPatch(emptyGraph(), original).graph, extra).graph;
    for (const item of [...graph.nodes, ...graph.edges]) item.evidenceIds.reverse();
    const bytes = JSON.stringify(graph);
    const result = applyPatch(graph, extra);
    expect(result.changed).toBe(false);
    expect(JSON.stringify(result.graph)).toBe(bytes);
  });
});

describe('deterministic reuse and structural path distinction', () => {
  it('looks up saved labels/kinds case-insensitively and honors reference direction', () => {
    const g = applyPatch(emptyGraph(), patch()).graph;
    expect(lookup(g, 'entity--a')).toEqual([node('A')]);
    expect(findPath(g, node('B').id, node('A').id, { directed: true })).toBeNull();
    expect(findPath(g, node('B').id, node('A').id)?.edgeIds).toHaveLength(1);
  });
  it('never calls shared fragment composition a verified business relationship', () => {
    const p = patch();
    p.nodes[1].type = 'fragment';
    p.edges[0].type = 'composes_schema';
    p.edges[0].id = edgeId(p.edges[0]);
    const g = applyPatch(emptyGraph(), p).graph;
    expect(findPath(g, p.nodes[0].id, p.nodes[1].id)).toBeNull();
    expect(findPath(g, p.nodes[0].id, p.nodes[1].id, { structural: true })?.structural).toBe(true);
  });
  it('requires property occurrence to belong to the exact owning schema', () => {
    const n = node('A');
    const child = {
      ...n,
      type: 'property' as const,
      ownerId: n.id,
      propertyPath: 'data.Target',
      occurrencePath: '/properties/data/properties/Target',
      id: propertyId(n.id, '/properties/data/properties/Target'),
    };
    const p = { formatVersion: 1 as const, nodes: [n, child], edges: [], evidence: [evidence(n)] };
    expect(applyPatch(emptyGraph(), p).graph.nodes).toHaveLength(2);
    expect(() => applyPatch(emptyGraph(), { ...p, nodes: [child] })).toThrow(/owner/i);
  });
});
