import { edgeId, schemaId } from '../src/core/identity';
import type { GraphPatch } from '../src/core/model';

// Mechanics only. No actual OSDU schemas, tenant records or externally owned text.
export function syntheticPatch(names = ['A', 'B']): GraphPatch {
  const hash = 'c'.repeat(64);
  const nodes = names.map((label) => {
    const kind = `test:synthetic:entity--${label}:1.0.0`;
    return {
      id: schemaId('synthetic', kind),
      kind,
      label,
      namespace: 'synthetic',
      version: '1.0.0',
      type: 'entity' as const,
      domain: 'synthetic',
      schemaHash: hash,
      evidenceIds: [`e:${label}`],
    };
  });
  const reference = {
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
    edges: [{ ...reference, id: edgeId(reference) }],
    evidence: nodes.map((node) => ({
      id: node.evidenceIds[0],
      namespace: 'synthetic',
      category: 'schema' as const,
      location: `https://example.org/synthetic/${node.label}.json`,
      revision: 'synthetic-v1',
      contentHash: hash,
      schemaKind: node.kind,
      schemaVersion: node.version,
      pointer: '',
      visibility: 'public' as const,
      redistribution: 'reviewed' as const,
      license: 'Apache-2.0',
      attribution: 'Project-owned synthetic test fixture',
    })),
  };
}
