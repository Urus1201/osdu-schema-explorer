import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { applyPatch, validateGraph, validatePatch } from './graph';
import { emptyGraph, type Graph, type PatchResult } from './model';

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** All semantic writes pass validation, an exclusive lock and a revision check. */
export class GraphStore {
  readonly directory: string;
  readonly file: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
    this.file = join(this.directory, 'graph.json');
  }

  async init(): Promise<Graph> {
    await mkdir(this.directory, { recursive: true });
    try {
      return await this.read();
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return this.withLock(async () => {
      try {
        return await this.read();
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      const graph = emptyGraph();
      await this.replace(graph);
      return graph;
    });
  }

  async read(): Promise<Graph> {
    const handle = await open(this.file, 'r');
    try {
      if ((await handle.stat()).size > 32 * 1024 * 1024)
        throw new Error('Graph exceeds local store size limit');
      return validateGraph(JSON.parse(await handle.readFile('utf8')) as unknown);
    } finally {
      await handle.close();
    }
  }

  async apply(patch: unknown, expectedRevision: number): Promise<PatchResult> {
    const validated = validatePatch(patch);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error('Expected revision must be a nonnegative integer');
    return this.withLock(async () => {
      const graph = await this.read();
      if (graph.revision !== expectedRevision)
        throw new Error('Graph revision conflict; reread before applying');
      const result = applyPatch(graph, validated);
      if (result.changed) await this.replace(result.graph);
      return result;
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = join(this.directory, 'graph.lock');
    let lock;
    try {
      lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
        throw new Error('Graph is locked; inspect recovery instructions');
      throw error;
    }
    try {
      return await operation();
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }

  private async replace(graph: Graph): Promise<void> {
    const checked = validateGraph(graph);
    const serialized = `${JSON.stringify(checked, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > 32 * 1024 * 1024)
      throw new Error('Graph exceeds local store size limit');
    const temporary = join(this.directory, `graph-${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(temporary);
      throw error;
    }
    await handle.close();
    try {
      validateGraph(JSON.parse(await readFile(temporary, 'utf8')) as unknown);
      // rename replaces atomically on supported local filesystems, including Windows.
      // Never unlink the destination as a fallback: failure preserves the old graph.
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(temporary, this.file);
          break;
        } catch (error) {
          const sharingViolation =
            error instanceof Error &&
            'code' in error &&
            ['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code));
          if (!sharingViolation || attempt >= 5) throw error;
          await pause(50 * 2 ** attempt);
        }
      }
    } catch (error) {
      await unlink(temporary);
      throw error;
    }
  }
}
