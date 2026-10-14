import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectRelationship } from '../src/sources/inspect';
import { applyPatch } from '../src/core/graph';
import { emptyGraph } from '../src/core/model';

const sourceKind = 'test:wks:master-data--SyntheticSource:1.0.0';
const targetKind = 'test:wks:master-data--SyntheticTarget:2.0.0';
const fragmentKind = 'test:wks:abstract--SyntheticFragment:1.0.0';
const dialect = 'http://json-schema.org/draft-07/schema#';
const annotation = [{ GroupType: 'master-data', EntityType: 'SyntheticTarget' }];
const directories: string[] = [];

async function fixture(
  source: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  additional: { kind: string; schema: Record<string, unknown> }[] = [],
) {
  const directory = await mkdtemp(join(tmpdir(), 'schema-inspect-'));
  directories.push(directory);
  const documents = [
    { kind: sourceKind, schema: { $schema: dialect, ...source } },
    { kind: targetKind, schema: { $schema: dialect, title: 'Synthetic target' } },
    ...additional,
  ];
  const schemas = [];
  for (const [index, document] of documents.entries()) {
    const path = `schema-${index}.json`;
    const bytes = JSON.stringify(document.schema);
    await writeFile(join(directory, path), bytes);
    schemas.push({
      kind: document.kind,
      version: document.kind.split(':').at(-1),
      path,
      location: path,
      contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
  }
  const manifest = {
    formatVersion: 1,
    namespace: 'synthetic-tests',
    revision: 'synthetic-revision-1',
    license: 'Apache-2.0',
    visibility: 'private',
    redistribution: 'unknown',
    schemas,
    ...extra,
  };
  const manifestFile = join(directory, 'manifest.json');
  await writeFile(manifestFile, JSON.stringify(manifest));
  return { manifestFile, directory, manifest };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('bounded source inspection (all inputs are synthetic)', () => {
  it('rejects inherited object names as inspection-bound options', async () => {
    const input = await fixture({}, { bounds: { constructor: 1 } });
    await expect(
      inspectRelationship(input.manifestFile, { kind: sourceKind, field: 'TargetID' }),
    ).rejects.toThrow(/bounds/i);
  });
  it('verifies only the selected annotated field and keeps selected version separate from declared constraints', async () => {
    const { manifestFile } = await fixture({
      properties: {
        data: {
          properties: {
            TargetID: { type: 'string', 'x-osdu-relationship': annotation },
            OtherID: { 'x-osdu-relationship': annotation },
          },
          required: ['TargetID'],
        },
      },
    });
    const result = await inspectRelationship(manifestFile, {
      kind: sourceKind,
      field: 'data.TargetID',
      target: targetKind,
    });
    expect(result.issues).toEqual([]);
    expect(result.patch.nodes).toHaveLength(3);
    expect(result.patch.edges.map((edge) => edge.type).sort()).toEqual([
      'contains_property',
      'references_record',
    ]);
    const edge = result.patch.edges.find((edge) => edge.type === 'references_record')!;
    expect(edge).toMatchObject({
      direction: 'forward',
      fieldPath: 'data.TargetID',
      required: true,
      branch: [],
    });
    expect(edge.targetConstraint).toBeUndefined();
    expect(
      result.patch.evidence.some(
        (evidence) =>
          evidence.pointer === '/properties/data/properties/TargetID/x-osdu-relationship/0',
      ),
    ).toBe(true);
    expect(result.patch.nodes.some((node) => node.propertyPath === 'data.OtherID')).toBe(false);
    expect(applyPatch(emptyGraph(), result.patch).graph.edges).toHaveLength(2);
    expect(
      await inspectRelationship(manifestFile, {
        kind: sourceKind,
        field: 'data.TargetID',
        target: targetKind,
      }),
    ).toEqual(result);
  });

  it('preserves array bounds, alternative branches, fragment origins and use sites without flattening composition', async () => {
    const { manifestFile } = await fixture(
      { properties: { data: { allOf: [{ $ref: 'schema-2.json' }] } } },
      {},
      [
        {
          kind: fragmentKind,
          schema: {
            $schema: dialect,
            oneOf: [
              {
                properties: {
                  Links: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 5,
                    items: { type: 'string', 'x-osdu-relationship': annotation },
                  },
                },
              },
              { properties: { Unrelated: { type: 'string' } } },
            ],
          },
        },
      ],
    );
    const result = await inspectRelationship(manifestFile, {
      kind: sourceKind,
      field: 'data.Links[]',
      target: targetKind,
    });
    const edge = result.patch.edges.find((edge) => edge.type === 'references_record')!;
    expect(edge).toMatchObject({ fieldPath: 'data.Links[]', minItems: 1, maxItems: 5 });
    expect(edge.branch.some((branch) => branch.includes('/oneOf/0'))).toBe(true);
    expect(result.patch.edges.some((edge) => edge.type === 'composes_schema')).toBe(true);
    expect(result.patch.edges.find((edge) => edge.type === 'composes_schema')).toMatchObject({
      fieldPath: 'data',
      branch: [],
    });
    expect(
      result.patch.evidence.find((evidence) => evidence.pointer.endsWith('/x-osdu-relationship/0'))
        ?.origin,
    ).toMatchObject({
      schemaKind: fragmentKind,
      useSites: [{ schemaKind: sourceKind, pointer: '/properties/data/allOf/0/$ref' }],
    });
    expect(applyPatch(emptyGraph(), result.patch).graph.edges).toHaveLength(3);
  });

  it('leaves the candidate patch empty when the field has no annotation or target mapping is wrong', async () => {
    const { manifestFile } = await fixture({
      properties: { data: { properties: { TargetID: { type: 'string' } } } },
    });
    const result = await inspectRelationship(manifestFile, {
      kind: sourceKind,
      field: 'data.TargetID',
      target: targetKind,
    });
    expect(result.patch).toEqual({ formatVersion: 1, nodes: [], edges: [], evidence: [] });
    expect(result.issues.join(' ')).toMatch(/No relationship verified/);
  });

  it('rejects tampered source bytes before emitting facts', async () => {
    const { manifestFile, directory } = await fixture({
      properties: { TargetID: { 'x-osdu-relationship': annotation } },
    });
    await writeFile(join(directory, 'schema-0.json'), '{}');
    await expect(
      inspectRelationship(manifestFile, {
        kind: sourceKind,
        field: 'TargetID',
        target: targetKind,
      }),
    ).rejects.toThrow(/hash/i);
  });

  it('detects reference cycles and bounded depth instead of treating them as verified', async () => {
    const { manifestFile } = await fixture({
      $ref: '#/definitions/loop',
      definitions: { loop: { $ref: '#/definitions/loop' } },
    });
    const result = await inspectRelationship(manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
      target: targetKind,
    });
    expect(result.patch.edges).toEqual([]);
    expect(result.issues.join(' ')).toMatch(/cycle/i);
    const bounded = await fixture(
      { properties: { data: { properties: { TargetID: { 'x-osdu-relationship': annotation } } } } },
      { bounds: { maxDepth: 1 } },
    );
    const result2 = await inspectRelationship(bounded.manifestFile, {
      kind: sourceKind,
      field: 'data.TargetID',
      target: targetKind,
    });
    expect(result2.patch.edges).toEqual([]);
    expect(result2.issues.join(' ')).toMatch(/depth/i);
  });

  it('ignores draft 7 ref siblings but inspects them under draft 2020-12', async () => {
    const schema = {
      properties: { TargetID: { $ref: '#/definitions/plain', 'x-osdu-relationship': annotation } },
      definitions: { plain: { type: 'string' } },
    };
    const old = await fixture(schema);
    expect(
      (
        await inspectRelationship(old.manifestFile, {
          kind: sourceKind,
          field: 'TargetID',
          target: targetKind,
        })
      ).patch.edges,
    ).toEqual([]);
    const modern = await fixture({
      ...schema,
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    });
    expect(
      (
        await inspectRelationship(modern.manifestFile, {
          kind: sourceKind,
          field: 'TargetID',
          target: targetKind,
        })
      ).patch.edges.some((edge) => edge.type === 'references_record'),
    ).toBe(true);
  });

  it('reports unsupported dialects and dynamic references rather than claiming verification', async () => {
    const { manifestFile } = await fixture({
      $schema: 'https://synthetic.invalid/dialect',
      properties: { TargetID: { 'x-osdu-relationship': annotation } },
    });
    const result = await inspectRelationship(manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
      target: targetKind,
    });
    expect(result.patch.edges).toEqual([]);
    expect(result.issues.join(' ')).toMatch(/dialect/i);
    const dynamic = await fixture({
      properties: { TargetID: { $dynamicRef: '#node', 'x-osdu-relationship': annotation } },
    });
    const result2 = await inspectRelationship(dynamic.manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
      target: targetKind,
    });
    expect(result2.patch.edges).toEqual([]);
    expect(result2.issues.join(' ')).toMatch(/unsupported/i);
  });

  it('rejects source paths escaping the manifest directory and pins exact schema identity', async () => {
    const { manifestFile, manifest } = await fixture({});
    manifest.schemas[0].path = '../outside.json';
    await writeFile(manifestFile, JSON.stringify(manifest));
    await expect(
      inspectRelationship(manifestFile, { kind: sourceKind, field: 'TargetID' }),
    ).rejects.toThrow(/path/i);
    const wrong = await fixture({ 'x-osdu-schema-source': targetKind });
    await expect(
      inspectRelationship(wrong.manifestFile, { kind: sourceKind, field: 'TargetID' }),
    ).rejects.toThrow(/identity/i);
  });

  it('keeps conditionals and tuples qualified and declines ambiguous target versions', async () => {
    const conditional = await fixture({
      properties: {
        data: {
          if: { properties: { Mode: { const: 'a' } } },
          then: { properties: { TargetID: { 'x-osdu-relationship': annotation } } },
          else: { properties: { OtherID: { 'x-osdu-relationship': annotation } } },
        },
      },
    });
    const conditionalResult = await inspectRelationship(conditional.manifestFile, {
      kind: sourceKind,
      field: 'data.TargetID',
      target: targetKind,
    });
    expect(
      conditionalResult.patch.edges.find((edge) => edge.type === 'references_record')?.branch,
    ).toEqual(['schema-0.json#/properties/data/if => then']);
    const ambiguous = await fixture(
      { properties: { TargetID: { 'x-osdu-relationship': annotation } } },
      {},
      [{ kind: 'test:wks:master-data--SyntheticTarget:1.0.0', schema: { $schema: dialect } }],
    );
    const result = await inspectRelationship(ambiguous.manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
    });
    expect(result.patch.nodes).toEqual([]);
    expect(result.issues.join(' ')).toMatch(/ambiguous/i);
    const resolved = await inspectRelationship(ambiguous.manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
      target: targetKind,
    });
    expect(resolved.patch.nodes.filter((node) => node.label === 'SyntheticTarget')).toHaveLength(1);
  });

  it('fails closed on document and node budgets, even if a partial match was found', async () => {
    const source = {
      allOf: [
        { properties: { TargetID: { 'x-osdu-relationship': annotation } } },
        { properties: { TargetID: { 'x-osdu-relationship': annotation } } },
      ],
    };
    const nodes = await fixture(source, { bounds: { maxNodes: 4 } });
    const limited = await inspectRelationship(nodes.manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
      target: targetKind,
    });
    expect(limited.patch.nodes).toEqual([]);
    expect(limited.issues.join(' ')).toMatch(/node budget/i);
    const docs = await fixture(source, { bounds: { maxDocuments: 1 } });
    const limitedDocs = await inspectRelationship(docs.manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
      target: targetKind,
    });
    expect(limitedDocs.patch.nodes).toEqual([]);
    expect(limitedDocs.issues.join(' ')).toMatch(/document budget/i);
  });

  it('never fetches unlisted remote references and does not inspect unrelated cache documents', async () => {
    const { manifestFile, directory } = await fixture(
      {
        properties: {
          TargetID: { $ref: 'https://synthetic.invalid/unlisted.json' },
          Unrelated: { $ref: 'schema-2.json' },
        },
      },
      {},
      [{ kind: fragmentKind, schema: { $schema: dialect } }],
    );
    await writeFile(join(directory, 'schema-2.json'), 'tampered unrelated document');
    const result = await inspectRelationship(manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
      target: targetKind,
    });
    expect(result.patch.nodes).toEqual([]);
    expect(result.issues.join(' ')).toMatch(/Unresolved \$ref/);
  });

  it('validates array markers and keeps serialized patches reusable', async () => {
    const { manifestFile } = await fixture({
      properties: { TargetID: { 'x-osdu-relationship': annotation } },
    });
    expect(
      (
        await inspectRelationship(manifestFile, {
          kind: sourceKind,
          field: 'TargetID[]',
          target: targetKind,
        })
      ).patch.nodes,
    ).toEqual([]);
    const result = await inspectRelationship(manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
      target: targetKind,
    });
    const graph = applyPatch(emptyGraph(), JSON.parse(JSON.stringify(result.patch))).graph;
    expect(applyPatch(graph, result.patch).changed).toBe(false);
  });

  it('rejects mutable pins, invalid bounds and malformed annotations without speculative facts', async () => {
    const mutable = await fixture({}, { revision: 'master' });
    await expect(
      inspectRelationship(mutable.manifestFile, { kind: sourceKind, field: 'TargetID' }),
    ).rejects.toThrow(/revision/i);
    const bounds = await fixture({}, { bounds: { maxNodes: 0 } });
    await expect(
      inspectRelationship(bounds.manifestFile, { kind: sourceKind, field: 'TargetID' }),
    ).rejects.toThrow(/bounds/i);
    const malformed = await fixture({
      properties: { TargetID: { 'x-osdu-relationship': { EntityType: 'SyntheticTarget' } } },
    });
    const result = await inspectRelationship(malformed.manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
      target: targetKind,
    });
    expect(result.patch.nodes).toEqual([]);
    expect(result.issues.join(' ')).toMatch(/annotation/i);
    const bytes = await fixture({}, { bounds: { maxBytes: 1 } });
    const bounded = await inspectRelationship(bytes.manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
    });
    expect(bounded.patch.nodes).toEqual([]);
    expect(bounded.issues.join(' ')).toMatch(/byte budget/i);
  });

  it('reports reuse through a non-fragment instead of emitting an invalid composition edge', async () => {
    const { manifestFile } = await fixture({ $ref: 'schema-1.json' });
    const result = await inspectRelationship(manifestFile, {
      kind: sourceKind,
      field: 'TargetID',
      target: targetKind,
    });
    expect(result.patch.edges).toEqual([]);
    expect(result.issues.join(' ')).toMatch(/composition target/i);
  });
});
