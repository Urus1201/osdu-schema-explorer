import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { Evidence, NodeType } from '../core/model';

export interface SchemaSource {
  kind: string;
  version: string;
  path: string;
  location: string;
  contentHash: string;
  type?: Exclude<NodeType, 'property'>;
}
export interface SourceManifest {
  formatVersion: 1;
  namespace: string;
  revision: string;
  license: string;
  visibility: Evidence['visibility'];
  redistribution: Evidence['redistribution'];
  attribution?: string;
  schemas: SchemaSource[];
  bounds?: Partial<InspectionBounds>;
}
export interface InspectionBounds {
  maxDocuments: number;
  maxDepth: number;
  maxNodes: number;
  maxBytes: number;
}
export interface SourceDocument {
  entry: SchemaSource;
  schema: Record<string, unknown>;
}
export class InspectionLimit extends Error {}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function kindParts(kind: string): { version: string; group: string; entity: string } {
  const parts = kind.split(':');
  if (parts.length !== 4 || parts.some((part) => !part) || !/^\d+\.\d+\.\d+$/.test(parts[3]))
    throw new Error('Schema kind must contain an exact version');
  const [group, ...entity] = parts[2].split('--');
  return { version: parts[3], group, entity: entity.join('--') || group };
}
function portablePath(path: string): boolean {
  return (
    !!path &&
    !isAbsolute(path) &&
    !/[\\:#?]/.test(path) &&
    !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
    path.split('/').every((part) => !!part && part !== '.' && part !== '..')
  );
}
function locationValid(location: string): boolean {
  if (portablePath(location)) return true;
  try {
    const url = new URL(location);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search;
  } catch {
    return false;
  }
}
async function boundedRead(file: string, limit: number): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit)
      throw new InspectionLimit('Source byte budget exceeded or source is not a regular file');
    const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > stat.size || count > limit)
      throw new InspectionLimit('Source changed size or exceeded byte budget during read');
    return buffer.subarray(0, count);
  } finally {
    await handle.close();
  }
}

export class LocalSources {
  readonly manifest: SourceManifest;
  readonly bounds: InspectionBounds;
  private readonly loaded = new Map<string, SourceDocument>();
  private byteCount = 0;
  private constructor(
    private readonly directory: string,
    manifest: SourceManifest,
  ) {
    this.manifest = manifest;
    this.bounds = {
      maxDocuments: 12,
      maxDepth: 32,
      maxNodes: 2000,
      maxBytes: 4 * 1024 * 1024,
      ...manifest.bounds,
    };
  }
  static async open(file: string): Promise<LocalSources> {
    const directory = await realpath(dirname(resolve(file)));
    const manifest: unknown = JSON.parse((await boundedRead(file, 1024 * 1024)).toString('utf8'));
    if (
      !object(manifest) ||
      manifest.formatVersion !== 1 ||
      !['namespace', 'revision', 'license'].every(
        (key) => typeof manifest[key] === 'string' && (manifest[key] as string).trim(),
      ) ||
      !Array.isArray(manifest.schemas)
    )
      throw new Error('Invalid source manifest');
    if (/^(master|main|head|latest)$/i.test(manifest.revision as string))
      throw new Error('Manifest revision must pin a reproducible snapshot');
    if (
      !['public', 'private', 'unknown'].includes(String(manifest.visibility)) ||
      !['reviewed', 'unknown', 'prohibited'].includes(String(manifest.redistribution))
    )
      throw new Error('Manifest must declare source visibility and redistribution status');
    if (manifest.attribution !== undefined && typeof manifest.attribution !== 'string')
      throw new Error('Invalid source attribution');
    const kinds = new Set<string>();
    const paths = new Set<string>();
    for (const entry of manifest.schemas) {
      if (
        !object(entry) ||
        !['kind', 'version', 'path', 'location', 'contentHash'].every(
          (key) => typeof entry[key] === 'string',
        )
      )
        throw new Error('Invalid schema manifest entry');
      if (!portablePath(entry.path as string) || !locationValid(entry.location as string))
        throw new Error(
          'Manifest schema path/location must be portable and within the manifest directory',
        );
      if (kindParts(entry.kind as string).version !== entry.version)
        throw new Error('Manifest schema identity/version disagreement');
      if (!/^(sha256:)?[a-f0-9]{64}$/.test(entry.contentHash as string))
        throw new Error('Manifest must pin a SHA-256 content hash');
      if (
        entry.type !== undefined &&
        !['entity', 'fragment', 'reference_data'].includes(String(entry.type))
      )
        throw new Error('Invalid manifest schema type');
      if (kinds.has(entry.kind as string) || paths.has(entry.path as string))
        throw new Error('Duplicate manifest schema identity or path');
      kinds.add(entry.kind as string);
      paths.add(entry.path as string);
    }
    if (manifest.bounds !== undefined) {
      if (!object(manifest.bounds)) throw new Error('Invalid inspection bounds');
      const caps = { maxDocuments: 64, maxDepth: 128, maxNodes: 20000, maxBytes: 16 * 1024 * 1024 };
      for (const [key, value] of Object.entries(manifest.bounds)) {
        if (
          !Object.hasOwn(caps, key) ||
          !Number.isSafeInteger(value) ||
          (value as number) < 1 ||
          (value as number) > caps[key as keyof typeof caps]
        )
          throw new Error('Inspection bounds must be positive integers within hard caps');
      }
    }
    return new LocalSources(directory, manifest as unknown as SourceManifest);
  }
  entry(kind: string): SchemaSource | undefined {
    return this.manifest.schemas.find((entry) => entry.kind === kind);
  }
  async load(entry: SchemaSource): Promise<SourceDocument> {
    const cached = this.loaded.get(entry.kind);
    if (cached) return cached;
    if (this.loaded.size >= this.bounds.maxDocuments)
      throw new InspectionLimit('Source document budget exceeded');
    const file = await realpath(resolve(this.directory, entry.path));
    const fromDirectory = relative(this.directory, file);
    if (
      fromDirectory === '..' ||
      fromDirectory.startsWith(`..\\`) ||
      fromDirectory.startsWith('../') ||
      isAbsolute(fromDirectory)
    )
      throw new Error('Source path escapes manifest directory');
    const bytes = await boundedRead(file, this.bounds.maxBytes - this.byteCount);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== entry.contentHash.replace(/^sha256:/, ''))
      throw new Error('Source content hash mismatch');
    const schema: unknown = JSON.parse(bytes.toString('utf8'));
    if (!object(schema)) throw new Error('Source root must be a JSON Schema object');
    const declared = schema['x-osdu-schema-source'];
    if (declared !== undefined && declared !== entry.kind)
      throw new Error('Source declared schema identity differs from manifest');
    this.byteCount += bytes.length;
    const document = { entry, schema };
    this.loaded.set(entry.kind, document);
    return document;
  }
  async resolveReference(
    document: SourceDocument,
    ref: string,
  ): Promise<{ document: SourceDocument; pointer: string } | undefined> {
    const [resource, fragment = '', ...extra] = ref.split('#');
    if (extra.length) return undefined;
    let pointer: string;
    try {
      pointer = decodeURIComponent(fragment);
    } catch {
      return undefined;
    }
    if (pointer && !pointer.startsWith('/')) return undefined;
    if (!resource) return { document, pointer };
    let resolvedLocation: string | undefined;
    try {
      resolvedLocation = new URL(
        resource,
        typeof document.schema.$id === 'string' ? document.schema.$id : document.entry.location,
      ).href;
    } catch {
      /* Local refs use their manifest path. */
    }
    const resolvedPath = relative(
      this.directory,
      resolve(this.directory, dirname(document.entry.path), resource),
    ).replaceAll('\\', '/');
    const entry = this.manifest.schemas.find(
      (entry) =>
        entry.path === resolvedPath ||
        entry.location === resource ||
        (resolvedLocation !== undefined &&
          (entry.location === resolvedLocation ||
            this.loaded.get(entry.kind)?.schema.$id === resolvedLocation)),
    );
    return entry ? { document: await this.load(entry), pointer } : undefined;
  }
}
