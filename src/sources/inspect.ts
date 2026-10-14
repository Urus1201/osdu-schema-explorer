import { createHash } from 'node:crypto';
import { edgeId, propertyId, schemaId, stableStringify } from '../core/identity';
import type { Evidence, GraphEdge, GraphNode, GraphPatch } from '../core/model';
import { InspectionLimit, LocalSources, kindParts, object, type SourceDocument } from './manifest';

export interface InspectOptions {
  kind: string;
  field: string;
  target?: string;
}
interface UseSite {
  document: SourceDocument;
  pointer: string;
  target: SourceDocument;
  field: string;
  branch: string[];
}
interface WalkState {
  document: SourceDocument;
  pointer: string;
  field: string;
  branch: string[];
  uses: UseSite[];
  depth: number;
  active: Set<string>;
  required?: boolean;
  minItems?: number;
  maxItems?: number;
}
interface Match {
  state: WalkState;
  annotationPointer: string;
  target: SourceDocument;
}
const escapePointer = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const normalizeField = (field: string) => field.replaceAll('[]', '');

function pointerValue(schema: Record<string, unknown>, pointer: string): unknown {
  let value: unknown = schema;
  if (!pointer) return value;
  for (const token of pointer.slice(1).split('/')) {
    if (/~(?![01])/.test(token)) return undefined;
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if ((!object(value) && !Array.isArray(value)) || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
function dialect(schema: Record<string, unknown>): string | undefined {
  if (typeof schema.$schema !== 'string') return undefined;
  const value = schema.$schema.replace(/#$/, '').replace(/^http:/, 'https:');
  if (
    /^https:\/\/json-schema.org\/(draft-0[467]\/schema|draft\/(2019-09|2020-12)\/schema)$/.test(
      value,
    )
  )
    return value;
  return undefined;
}
function evidence(
  sources: LocalSources,
  owner: SourceDocument,
  source: SourceDocument,
  pointer: string,
  uses: UseSite[] = [],
): Evidence {
  const item: Omit<Evidence, 'id'> = {
    category: 'schema',
    namespace: sources.manifest.namespace,
    location: source.entry.location,
    revision: sources.manifest.revision,
    contentHash: source.entry.contentHash,
    schemaKind: owner.entry.kind,
    schemaVersion: owner.entry.version,
    pointer,
    ...(typeof source.schema.$schema === 'string' ? { dialect: source.schema.$schema } : {}),
    visibility: sources.manifest.visibility,
    license: sources.manifest.license,
    redistribution: sources.manifest.redistribution,
    ...(sources.manifest.attribution ? { attribution: sources.manifest.attribution } : {}),
    ...(uses.length
      ? {
          origin: {
            schemaKind: source.entry.kind,
            schemaVersion: source.entry.version,
            location: source.entry.location,
            pointer,
            useSites: uses.map((use) => ({
              schemaKind: use.document.entry.kind,
              location: use.document.entry.location,
              pointer: use.pointer,
            })),
          },
        }
      : {}),
  };
  return {
    id: `evidence:${createHash('sha256').update(stableStringify(item)).digest('hex')}`,
    ...item,
  };
}
function schemaType(document: SourceDocument): GraphNode['type'] {
  const { group, entity } = kindParts(document.entry.kind);
  return (
    document.entry.type ??
    (group === 'reference-data'
      ? 'reference_data'
      : group === 'abstract' || group === entity
        ? 'fragment'
        : 'entity')
  );
}
function schemaNode(sources: LocalSources, document: SourceDocument, item: Evidence): GraphNode {
  const { group, entity } = kindParts(document.entry.kind);
  return {
    id: schemaId(sources.manifest.namespace, document.entry.kind),
    type: schemaType(document),
    label: entity,
    namespace: sources.manifest.namespace,
    kind: document.entry.kind,
    version: document.entry.version,
    domain: group,
    schemaHash: document.entry.contentHash,
    evidenceIds: [item.id],
  };
}
function buildPatch(sources: LocalSources, owner: SourceDocument, matches: Match[]): GraphPatch {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const items = new Map<string, Evidence>();
  const addEvidence = (item: Evidence) => {
    items.set(item.id, item);
    return item;
  };
  const addSchema = (document: SourceDocument) => {
    const item = addEvidence(evidence(sources, document, document, ''));
    const node = schemaNode(sources, document, item);
    nodes.set(node.id, node);
    return node;
  };
  const ownerNode = addSchema(owner);
  const addEdge = (edge: Omit<GraphEdge, 'id'>) => {
    const complete = { id: edgeId(edge), ...edge };
    edges.set(complete.id, complete);
  };
  for (const { state, annotationPointer, target } of matches) {
    const item = addEvidence(
      evidence(sources, owner, state.document, annotationPointer, state.uses),
    );
    const occurrencePath = [...state.uses.map((use) => use.pointer), state.pointer].join(
      '/$resolved',
    );
    const property: GraphNode = {
      ...ownerNode,
      id: propertyId(ownerNode.id, occurrencePath),
      type: 'property',
      label: state.field,
      ownerId: ownerNode.id,
      propertyPath: state.field,
      occurrencePath,
      evidenceIds: [item.id],
    };
    nodes.set(property.id, property);
    const common = {
      direction: 'forward' as const,
      fieldPath: state.field,
      branch: state.branch,
      evidenceCategory: 'schema' as const,
      evidenceIds: [item.id],
    };
    addEdge({ ...common, source: ownerNode.id, target: property.id, type: 'contains_property' });
    const targetNode = addSchema(target);
    addEdge({
      ...common,
      source: property.id,
      target: targetNode.id,
      type: 'references_record',
      ...(state.required === undefined ? {} : { required: state.required }),
      ...(state.minItems === undefined ? {} : { minItems: state.minItems }),
      ...(state.maxItems === undefined ? {} : { maxItems: state.maxItems }),
    });
    for (const use of state.uses) {
      if (use.document.entry.kind === use.target.entry.kind) continue;
      const from = addSchema(use.document);
      const to = addSchema(use.target);
      const composedEvidence = addEvidence(
        evidence(sources, use.document, use.document, use.pointer),
      );
      addEdge({
        ...common,
        fieldPath: use.field,
        branch: use.branch,
        source: from.id,
        target: to.id,
        type: 'composes_schema',
        evidenceIds: [composedEvidence.id],
      });
    }
  }
  const ordered = <T extends { id: string }>(map: Map<string, T>) =>
    [...map.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return {
    formatVersion: 1,
    nodes: ordered(nodes),
    edges: ordered(edges),
    evidence: ordered(items),
  };
}

export async function inspectRelationship(
  manifestFile: string,
  options: InspectOptions,
): Promise<{ patch: GraphPatch; issues: string[] }> {
  if (
    !options.field ||
    !options.field.split('.').every((part) => /^[^\s.[\]]+(?:\[\])*$/.test(part))
  )
    throw new Error(
      'Field must be an explicit dotted property path, with optional [] array markers',
    );
  const sources = await LocalSources.open(manifestFile);
  const entry = sources.entry(options.kind);
  if (!entry) throw new Error('Selected schema kind/version is absent from manifest');
  if (options.target && !sources.entry(options.target))
    throw new Error('Selected target kind/version is absent from manifest');
  const issues = new Set<string>();
  const matches: Match[] = [];
  let visits = 0;
  const wanted = normalizeField(options.field);
  const empty: GraphPatch = { formatVersion: 1, nodes: [], edges: [], evidence: [] };
  let owner: SourceDocument;
  try {
    owner = await sources.load(entry);
  } catch (error) {
    if (!(error instanceof InspectionLimit)) throw error;
    return { patch: empty, issues: [error.message] };
  }
  const relevant = (field: string) =>
    !field || wanted === normalizeField(field) || wanted.startsWith(`${normalizeField(field)}.`);

  async function walk(value: unknown, state: WalkState): Promise<void> {
    if (++visits > sources.bounds.maxNodes)
      throw new InspectionLimit('Schema node budget exceeded');
    if (state.depth > sources.bounds.maxDepth)
      throw new InspectionLimit('Schema depth budget exceeded');
    if (!object(value) || !relevant(state.field)) return;
    const documentDialect = dialect(state.document.schema);
    const location = `${state.document.entry.location}#${state.pointer}`;
    if (!documentDialect) {
      issues.add(`Unsupported or missing JSON Schema dialect at ${location}`);
      return;
    }
    if (value.$schema !== undefined && value.$schema !== state.document.schema.$schema) {
      issues.add(`Unsupported nested dialect at ${location}`);
      return;
    }
    if (state.pointer && (value.$id !== undefined || value.id !== undefined)) {
      issues.add(`Unsupported nested schema resource identifier at ${location}`);
      return;
    }
    if (value.$dynamicRef !== undefined || value.$recursiveRef !== undefined) {
      issues.add(`Unsupported dynamic/recursive reference at ${location}`);
      return;
    }
    const key = `${state.document.entry.path}#${state.pointer}|${state.field}`;
    if (state.active.has(key)) {
      issues.add(`Reference cycle at ${location}`);
      return;
    }
    const active = new Set(state.active).add(key);
    const next = { ...state, active, depth: state.depth + 1 };
    if (value.$ref !== undefined) {
      if (typeof value.$ref !== 'string') {
        issues.add(`Malformed $ref at ${location}`);
        return;
      }
      const resolved = await sources.resolveReference(state.document, value.$ref);
      if (!resolved) {
        issues.add(`Unresolved $ref at ${location}`);
        return;
      }
      if (
        resolved.document.entry.kind !== state.document.entry.kind &&
        schemaType(resolved.document) !== 'fragment'
      ) {
        issues.add(`Unsupported composition target: schema is not a fragment at ${location}`);
        return;
      }
      const referred = pointerValue(resolved.document.schema, resolved.pointer);
      if (referred === undefined) {
        issues.add(`Unresolved JSON Pointer at ${location}`);
        return;
      }
      await walk(referred, {
        ...next,
        ...resolved,
        uses: [
          ...state.uses,
          {
            document: state.document,
            pointer: `${state.pointer}/$ref`,
            target: resolved.document,
            field: state.field,
            branch: state.branch,
          },
        ],
      });
      if (/draft-0[467]/.test(documentDialect)) return;
    }
    if (
      normalizeField(state.field) === wanted &&
      (!options.field.includes('[]') || state.field === options.field) &&
      value['x-osdu-relationship'] !== undefined
    ) {
      const relationships = value['x-osdu-relationship'];
      if (!Array.isArray(relationships))
        issues.add(`Unsupported relationship annotation at ${location}`);
      else
        for (const [index, relation] of relationships.entries()) {
          if (
            !object(relation) ||
            typeof relation.GroupType !== 'string' ||
            typeof relation.EntityType !== 'string'
          ) {
            issues.add(`Malformed relationship annotation at ${location}`);
            continue;
          }
          const candidates = sources.manifest.schemas.filter((candidate) => {
            const parts = kindParts(candidate.kind);
            return (
              parts.group === relation.GroupType &&
              parts.entity === relation.EntityType &&
              (!options.target || candidate.kind === options.target)
            );
          });
          if (candidates.length !== 1) {
            issues.add(`Unresolved or ambiguous selected relationship target at ${location}`);
            continue;
          }
          const target = await sources.load(candidates[0]);
          if (schemaType(target) === 'fragment') {
            issues.add(
              `Unsupported record-reference target: selected kind is a fragment at ${location}`,
            );
            continue;
          }
          matches.push({
            state,
            annotationPointer: `${state.pointer}/x-osdu-relationship/${index}`,
            target,
          });
        }
    }
    if (object(value.properties)) {
      for (const property of Object.keys(value.properties).sort()) {
        const field = state.field ? `${state.field}.${property}` : property;
        if (!relevant(field)) continue;
        const required =
          Array.isArray(value.required) && value.required.includes(property) ? true : undefined;
        await walk(value.properties[property], {
          ...next,
          field,
          pointer: `${state.pointer}/properties/${escapePointer(property)}`,
          required,
          minItems: undefined,
          maxItems: undefined,
        });
      }
    }
    if (value.items !== undefined) {
      const arrayState = {
        ...next,
        field: `${state.field}[]`,
        pointer: `${state.pointer}/items`,
        ...(Number.isSafeInteger(value.minItems) && (value.minItems as number) >= 0
          ? { minItems: value.minItems as number }
          : {}),
        ...(Number.isSafeInteger(value.maxItems) && (value.maxItems as number) >= 0
          ? { maxItems: value.maxItems as number }
          : {}),
      };
      if (Array.isArray(value.items)) {
        if (documentDialect.includes('2020-12'))
          issues.add(`Unsupported tuple items for declared dialect at ${location}`);
        else
          for (const [index, item] of value.items.entries())
            await walk(item, {
              ...arrayState,
              pointer: `${arrayState.pointer}/${index}`,
              branch: [...state.branch, `${location}/items/${index}`],
            });
      } else await walk(value.items, arrayState);
    }
    if (value.prefixItems !== undefined) {
      if (documentDialect.includes('2020-12') && Array.isArray(value.prefixItems)) {
        for (const [index, item] of value.prefixItems.entries())
          await walk(item, {
            ...next,
            field: `${state.field}[]`,
            pointer: `${state.pointer}/prefixItems/${index}`,
            branch: [...state.branch, `${location}/prefixItems/${index}`],
          });
      } else issues.add(`Unsupported prefixItems for declared dialect at ${location}`);
    }
    for (const keyword of ['allOf', 'oneOf', 'anyOf']) {
      if (value[keyword] === undefined) continue;
      if (!Array.isArray(value[keyword])) {
        issues.add(`Malformed ${keyword} at ${location}`);
        continue;
      }
      for (const [index, part] of value[keyword].entries()) {
        const pointer = `${state.pointer}/${keyword}/${index}`;
        await walk(part, {
          ...next,
          pointer,
          branch:
            keyword === 'allOf'
              ? state.branch
              : [...state.branch, `${state.document.entry.location}#${pointer}`],
        });
      }
    }
    if (value.if !== undefined) {
      if (/draft-0[46]/.test(documentDialect))
        issues.add(`Unsupported conditional for declared dialect at ${location}`);
      else
        for (const keyword of ['then', 'else'])
          if (value[keyword] !== undefined)
            await walk(value[keyword], {
              ...next,
              pointer: `${state.pointer}/${keyword}`,
              branch: [...state.branch, `${location}/if => ${keyword}`],
            });
    }
    for (const keyword of [
      'patternProperties',
      'additionalProperties',
      'dependentSchemas',
      'dependencies',
      'contains',
      'not',
      'unevaluatedProperties',
      'unevaluatedItems',
    ])
      if (object(value[keyword]))
        issues.add(`Unsupported scoped keyword ${keyword} at ${location}`);
  }
  try {
    await walk(owner.schema, {
      document: owner,
      pointer: '',
      field: '',
      branch: [],
      uses: [],
      depth: 0,
      active: new Set(),
    });
  } catch (error) {
    if (!(error instanceof InspectionLimit)) throw error;
    issues.add(error.message);
    return { patch: empty, issues: [...issues].sort() };
  }
  if (!matches.length)
    issues.add('No relationship verified within the selected field and pinned source scope');
  return {
    patch: matches.length ? buildPatch(sources, owner, matches) : empty,
    issues: [...issues].sort(),
  };
}
