// Streamable HTTP mode: POST /mcp, where every client brings its own API key
// as Authorization: Bearer <key>. The server holds no key: each request gets
// its own SDK client and MCP server (stateless), so keys never meet.
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { DocPage } from './docs.js';
import { createServer, makeClient } from './server.js';
import type { Tool } from './tools.js';

export interface HttpOptions {
  host: string;
  port: number;
  tools: Tool[];
  docs?: DocPage[];
  docsDir?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Largest request body accepted, in bytes (default 64 MiB: a batch with attachments). */
  maxBody?: number;
  /** Makes the MCP server of one request (default createServer): a hook to add tools when embedding. */
  create?: typeof createServer;
}

export interface RunningHttp {
  server: HttpServer;
  url: string;
  close(): Promise<void>;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function startHttp(opts: HttpOptions): Promise<RunningHttp> {
  const maxBody = opts.maxBody ?? 64 * 1024 * 1024;
  const loopback = LOOPBACK.has(opts.host);
  const server = createHttpServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal error');
      else res.end();
      process.stderr.write(`zapsmtp-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, { status: 'ok' });
    if (url.pathname !== '/mcp') return json(res, 404, { error: 'not found: the MCP endpoint is /mcp' });
    // a server on loopback answers only to loopback names (DNS rebinding)
    if (loopback && (!hostAllowed(req.headers.host) || !originAllowed(req.headers.origin))) {
      return rpcError(res, 403, -32000, 'Forbidden: Host or Origin is not local');
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return rpcError(res, 405, -32000, 'Method not allowed: this server is stateless, POST JSON-RPC messages to /mcp');
    }
    const key = bearer(req.headers.authorization);
    if (!key) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="zapsmtp", error="invalid_token", error_description="Send your ZapSMTP API key as Authorization: Bearer <key>"');
      return rpcError(res, 401, -32001, 'Unauthorized: send your ZapSMTP API key as Authorization: Bearer <key>');
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, maxBody));
    } catch (err) {
      if (err instanceof TooLarge) {
        res.setHeader('Connection', 'close');
        return rpcError(res, 413, -32600, `Request body larger than ${maxBody} bytes`);
      }
      return rpcError(res, 400, -32700, 'Parse error: the body is not JSON');
    }
    const client = makeClient({ apiKey: key, baseUrl: opts.baseUrl, fetch: opts.fetch });
    const mcp = (opts.create ?? createServer)({ client, tools: opts.tools, docs: opts.docs, docsDir: opts.docsDir });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  function hostAllowed(host: string | undefined): boolean {
    const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(String(host));
    return !!m && LOOPBACK.has(m[1].toLowerCase());
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      const { port } = server.address() as AddressInfo;
      const host = opts.host.includes(':') && !opts.host.startsWith('[') ? `[${opts.host}]` : opts.host;
      resolve({
        server,
        url: `http://${host}:${port}/mcp`,
        close: () => new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // not a browser
  try {
    return LOOPBACK.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** The key of "Bearer <key>"; undefined when there is none. */
export function bearer(header: string | undefined): string | undefined {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return m ? m[1] : undefined;
}

class TooLarge extends Error {}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      if (size > max) return; // drain the rest without keeping it
      size += c.length;
      if (size <= max) chunks.push(c);
      else {
        chunks.length = 0;
        reject(new TooLarge());
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, code: number, message: string): void {
  json(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}
