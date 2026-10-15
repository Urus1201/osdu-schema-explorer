import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { GraphStore } from '../core/store';
import type { FocusMessage, Graph } from '../core/model';
import { createDescriptionReader } from '../sources/descriptions';

export function validateFocus(value: unknown, graph: Graph): FocusMessage {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid focus');
  const input = value as Record<string, unknown>;
  const allowed = ['nodeIds', 'edgeIds', 'addedNodeIds', 'addedEdgeIds'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('Invalid focus');
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const edges = new Set(graph.edges.map((edge) => edge.id));
  const result: FocusMessage = { nodeIds: [], edgeIds: [] };
  for (const key of allowed as (keyof FocusMessage)[]) {
    if (input[key] === undefined && key.startsWith('added')) continue;
    const ids = input[key];
    const known = key.toLowerCase().includes('node') ? nodes : edges;
    if (
      !Array.isArray(ids) ||
      ids.length > 1000 ||
      ids.some((id) => typeof id !== 'string' || id.length > 4096 || !known.has(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new Error('Invalid focus');
    result[key] = ids;
  }
  return result;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type'] !== 'application/json') throw new Error('Invalid body');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    bytes += buffer.length;
    if (bytes > 16 * 1024) throw new Error('Invalid body');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export interface ServiceOptions {
  store: GraphStore;
  port?: number;
  pollMs?: number;
  staticDir?: string;
  sourceDirectory?: string;
}

export async function createService(options: ServiceOptions) {
  const { store, staticDir } = options;
  const describe = options.sourceDirectory
    ? createDescriptionReader(options.sourceDirectory)
    : async (graph: Graph) => graph;
  const readGraph = async () => describe(await store.read());
  let graph = await describe(await store.init());
  const subscribers = new Set<ServerResponse>();
  let port = options.port ?? 4310;
  const emit = (event: string, payload: unknown) => {
    const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const subscriber of subscribers) {
      // A false write means buffered, not failed; disconnect only a slow, bounded queue.
      if (subscriber.writableLength > 64 * 1024 * 1024) subscriber.destroy();
      else subscriber.write(message);
    }
  };
  const update = (next: Graph) => {
    if (next.revision === graph.revision) return;
    const previousNodes = new Set(graph.nodes.map((node) => node.id));
    const previousEdges = new Set(graph.edges.map((edge) => edge.id));
    const addedNodeIds = next.nodes
      .filter((node) => !previousNodes.has(node.id))
      .map((node) => node.id);
    const addedEdgeIds = next.edges
      .filter((edge) => !previousEdges.has(edge.id))
      .map((edge) => edge.id);
    graph = next;
    emit('graph', { graph, addedNodeIds, addedEdgeIds });
  };
  const server = createServer((request, response) => {
    void route(request, response).catch(() => {
      if (!response.headersSent) json(response, 503, { error: 'Local service unavailable' });
      else response.destroy();
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  server.maxConnections = 64;

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const origins = new Set(
      [...hosts, '127.0.0.1:5173', 'localhost:5173'].map((host) => `http://${host}`),
    );
    const origin = request.headers.origin;
    if (!hosts.has(request.headers.host ?? '') || (origin !== undefined && !origins.has(origin))) {
      json(response, 403, { error: 'Request not allowed' });
      return;
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    const path = request.url ?? '';
    if (path.includes('?') || path.includes('#')) {
      json(response, 400, { error: 'Invalid request' });
      return;
    }
    if (
      request.method === 'OPTIONS' &&
      ['/api/graph', '/api/events', '/api/focus'].includes(path)
    ) {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      response.end();
      return;
    }
    if (path === '/api/graph' || path === '/api/events') {
      if (request.method !== 'GET') {
        json(response, 405, { error: 'Method not allowed' });
        return;
      }
      const latest = await readGraph();
      update(latest);
      if (path === '/api/graph') {
        json(response, 200, latest);
        return;
      }
      if (subscribers.size >= 32) {
        json(response, 503, { error: 'Viewer limit reached' });
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.write(
        `event: graph\ndata: ${JSON.stringify({ graph: latest, addedNodeIds: [], addedEdgeIds: [] })}\n\n`,
      );
      subscribers.add(response);
      response.on('close', () => subscribers.delete(response));
      return;
    }
    if (path === '/api/focus') {
      if (request.method !== 'POST') {
        json(response, 405, { error: 'Method not allowed' });
        return;
      }
      let focus: FocusMessage;
      const latest = await readGraph();
      try {
        focus = validateFocus(await body(request), latest);
      } catch {
        json(response, 400, { error: 'Invalid focus payload' });
        return;
      }
      update(latest);
      emit('focus', focus);
      json(response, 200, { focused: subscribers.size > 0 });
      return;
    }
    if (path.startsWith('/api/')) {
      json(response, 404, { error: 'Not found' });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      json(response, 405, { error: 'Method not allowed' });
      return;
    }
    if (staticDir && (path === '/' || /^\/assets\/[A-Za-z0-9_.-]+$/.test(path))) {
      try {
        const root = await realpath(resolve(staticDir));
        const file = await realpath(resolve(root, path === '/' ? 'index.html' : path.slice(1)));
        const inside = relative(root, file);
        if (inside.startsWith(`..${sep}`) || inside === '..')
          throw new Error('Outside static root');
        const types: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.woff2': 'font/woff2',
        };
        const type = types[extname(file)];
        if (!type) throw new Error('Unsupported asset');
        const bytes = await readFile(file);
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        response.end(request.method === 'HEAD' ? undefined : bytes);
        return;
      } catch {
        json(response, 404, { error: 'Not found' });
        return;
      }
    }
    json(response, 404, { error: 'Not found' });
  }

  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      accept();
    });
  });
  const address = server.address();
  if (address && typeof address !== 'string') port = address.port;
  let polling = false;
  const poll = setInterval(
    () => {
      if (polling) return;
      polling = true;
      void readGraph()
        .then(update)
        .catch(() => emit('store-error', { error: 'Saved graph unavailable' }))
        .finally(() => {
          polling = false;
        });
    },
    Math.max(25, options.pollMs ?? 500),
  );
  const heartbeat = setInterval(() => {
    for (const subscriber of subscribers) subscriber.write(': keepalive\n\n');
  }, 15000);
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    async close(): Promise<void> {
      clearInterval(poll);
      clearInterval(heartbeat);
      for (const subscriber of subscribers) subscriber.end();
      server.closeAllConnections();
      await new Promise<void>((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
    },
  };
}
