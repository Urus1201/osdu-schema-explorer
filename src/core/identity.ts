import type { GraphEdge } from './model';

export function schemaId(namespace: string, kind: string): string {
  return `schema:${encodeURIComponent(namespace)}:${encodeURIComponent(kind)}`;
}

export function propertyId(ownerId: string, occurrencePath: string): string {
  return `property:${encodeURIComponent(ownerId)}:${encodeURIComponent(occurrencePath)}`;
}

export function edgeId(
  edge: Pick<GraphEdge, 'source' | 'target' | 'type' | 'fieldPath' | 'branch' | 'direction'>,
): string {
  return `edge:${[edge.source, edge.type, edge.direction, edge.target, edge.fieldPath, JSON.stringify(edge.branch)].map(encodeURIComponent).join(':')}`;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
