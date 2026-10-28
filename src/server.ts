// The MCP server: the tools over one API key, and the docs as resources.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema, ErrorCode, ListResourcesRequestSchema, ListToolsRequestSchema, McpError, ReadResourceRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { VERSION as SDK_VERSION, ZapSMTP, ZapSMTPError } from 'zapsmtp';
import { readDoc, type DocPage } from './docs.js';
import { ToolInputError, type Tool } from './tools.js';
import { VERSION } from './version.js';

export const INSTRUCTIONS = `ZapSMTP is an email API and SMTP relay: send, receive and track email.
- To try a send safely, use send_test_email: simulator addresses never leave ZapSMTP and show any outcome (delivered, bounced, complained, delayed).
- Sends are idempotent per idempotency_key: reuse the key when retrying the same send.
- Lists return one page; pass next_cursor as cursor to get the next one.
- Errors carry the API's code, message and request_id; quote the request_id to support.
- The docs are resources (llms.txt first) when the client reads resources.`;

export interface ClientConfig {
  apiKey: string;
  /** Default: ZAP_BASE_URL, else the SDK's default. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** An SDK client that names this server in its User-Agent. */
export function makeClient(cfg: ClientConfig): ZapSMTP {
  return new ZapSMTP(cfg.apiKey, {
    baseUrl: cfg.baseUrl,
    fetch: cfg.fetch,
    defaultHeaders: { 'User-Agent': `zapsmtp-mcp/${VERSION} (node/${process.versions.node}; zapsmtp-node/${SDK_VERSION})` },
  });
}

export interface ServerContext {
  client: ZapSMTP;
  tools: Tool[];
  docs?: DocPage[];
  docsDir?: string;
}

export function createServer({ client, tools, docs = [], docsDir = '' }: ServerContext): Server {
  const server = new Server(
    { name: 'zapsmtp', title: 'ZapSMTP', version: VERSION },
    { capabilities: { tools: {}, ...(docs.length ? { resources: {} } : {}) }, instructions: INSTRUCTIONS },
  );
  const byName = new Map(tools.map((t) => [t.name, t]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = byName.get(req.params.name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `Unknown tool ${req.params.name}`);
    try {
      const result = await tool.run(client, (req.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: 'text', text: JSON.stringify(redact(result, client.apiKey)) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(redact({ error: errorInfo(err) }, client.apiKey)) }] };
    }
  });

  if (docs.length) {
    const byUri = new Map(docs.map((d) => [d.uri, d]));
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: docs.map((d) => ({ uri: d.uri, name: d.name, title: d.title, description: d.description, mimeType: 'text/markdown' })),
    }));
    server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
      const page = byUri.get(req.params.uri);
      if (!page) throw new McpError(ErrorCode.InvalidParams, `Unknown resource ${req.params.uri}`);
      return { contents: [{ uri: page.uri, mimeType: 'text/markdown', text: readDoc(docsDir, page) }] };
    });
  }
  return server;
}

/** What the model sees of a failure: the API's status, code, message and request id. */
export function errorInfo(err: unknown): Record<string, unknown> {
  if (err instanceof ZapSMTPError) {
    const e: Record<string, unknown> = { status: err.status, code: err.code || err.name, message: err.message };
    if (err.type) e.type = err.type;
    if (err.requestId) e.request_id = err.requestId;
    return e;
  }
  if (err instanceof ToolInputError) return { code: err.code, message: err.message };
  return { code: 'internal_error', message: err instanceof Error ? err.message : String(err) };
}

/**
 * Never let the server's API key reach the model, whatever echoes it: every
 * string of the result (keys included) is scrubbed before it is serialized,
 * so JSON escaping cannot hide the key.
 */
export function redact(value: unknown, key: string): unknown {
  if (typeof value === 'string') return key ? value.split(key).join('[redacted]') : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [redact(k, key), redact(v, key)]));
  return value;
}
