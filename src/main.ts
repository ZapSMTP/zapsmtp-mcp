// The zapsmtp-mcp command: options, then stdio (default) or Streamable HTTP.
import { parseArgs } from 'node:util';
import type { Readable, Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { API } from './generated/api.js';
import { DEFAULT_TOOLSETS, TOOLSETS } from './catalog.js';
import { DOCS_DIR, loadDocs } from './docs.js';
import { startHttp } from './http.js';
import { createServer, makeClient } from './server.js';
import { buildTools, toolsetNames, ToolInputError, type ToolOptions } from './tools.js';
import { VERSION } from './version.js';

export const HELP = `zapsmtp-mcp ${VERSION}: the ZapSMTP MCP server

Usage:
  zapsmtp-mcp [options]                 stdio (for a client that starts the server)
  zapsmtp-mcp --http [--port 3000]      Streamable HTTP at http://127.0.0.1:3000/mcp

Options:
  --key <key>                         API key for stdio (env ZAP_API_KEY). Not used with --http:
                                      there every client sends its own as Authorization: Bearer <key>
  --http                              Serve Streamable HTTP instead of stdio
  --port <port>                       HTTP port (env ZAP_MCP_PORT, default 3000)
  --host <host>                       HTTP address (env ZAP_MCP_HOST, default 127.0.0.1)
  --toolsets <a,b|all>                Toolsets to expose (env ZAP_TOOLSETS, default: ${DEFAULT_TOOLSETS.join(',')})
  --read-only                         Only tools that change nothing (env ZAP_READ_ONLY=1)
  --sender <address>                  From for sends that omit it (env ZAP_SENDER)
  --reply-to <address>                Reply-To for sends that omit it (env ZAP_REPLY_TO)
  --allowed-recipient-domains <a,b>   Refuse sends to any other domain (env ZAP_ALLOWED_RECIPIENT_DOMAINS)
  --base-url <url>                    API base URL (env ZAP_BASE_URL, default https://api.zapsmtp.com/v1)
  --list-tools                        Print the tools these options expose and exit
  -h, --help                          Show this help
  -v, --version                       Show the version

Toolsets:
${TOOLSETS.map((t) => `  ${t.name.padEnd(18)}${t.default ? '*' : ' '} ${t.description}`).join('\n')}
  (* default)
`;

export interface IO {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}

export interface Options extends ToolOptions {
  key?: string;
  http: boolean;
  port: number;
  host: string;
  baseUrl?: string;
  listTools: boolean;
  help: boolean;
  version: boolean;
}

export class UsageError extends Error {}

const list = (s: string | undefined): string[] | undefined => s === undefined ? undefined : s.split(',').map((x) => x.trim()).filter(Boolean);
const truthy = (s: string | undefined): boolean => !!s && !['0', 'false', 'no', 'off', ''].includes(s.toLowerCase());

export function parseOptions(argv: string[], env: Record<string, string | undefined>): Options {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        key: { type: 'string' }, http: { type: 'boolean' }, port: { type: 'string' }, host: { type: 'string' },
        toolsets: { type: 'string' }, 'read-only': { type: 'boolean' }, sender: { type: 'string' }, 'reply-to': { type: 'string' },
        'allowed-recipient-domains': { type: 'string' }, 'base-url': { type: 'string' }, 'list-tools': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      },
    }));
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const str = (k: string) => values[k] as string | undefined;
  const http = !!values.http;
  if (http && str('key') !== undefined) throw new UsageError('--key is for stdio: with --http every client sends its own key as Authorization: Bearer <key>');
  const portText = str('port') ?? env.ZAP_MCP_PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port > 65535) throw new UsageError(`--port must be a port number, not ${portText}`);
  const toolsets = list(str('toolsets') ?? env.ZAP_TOOLSETS);
  return {
    key: http ? undefined : str('key') ?? env.ZAP_API_KEY,
    http,
    port,
    host: str('host') ?? env.ZAP_MCP_HOST ?? '127.0.0.1',
    baseUrl: str('base-url') ?? env.ZAP_BASE_URL,
    toolsets: toolsets?.includes('all') ? 'all' : toolsets,
    readOnly: !!values['read-only'] || truthy(env.ZAP_READ_ONLY),
    sender: str('sender') ?? env.ZAP_SENDER,
    replyTo: str('reply-to') ?? env.ZAP_REPLY_TO,
    allowedRecipientDomains: list(str('allowed-recipient-domains') ?? env.ZAP_ALLOWED_RECIPIENT_DOMAINS),
    listTools: !!values['list-tools'],
    help: !!values.help,
    version: !!values.version,
  };
}

export interface Running {
  /** The HTTP endpoint, in HTTP mode. */
  url?: string;
  close(): Promise<void>;
}

/** Runs the command. Resolves to an exit code, or to the running server. */
export async function main(argv: string[], env: Record<string, string | undefined>, io: IO, docsDir = DOCS_DIR): Promise<number | Running> {
  let opts: Options;
  let tools;
  try {
    opts = parseOptions(argv, env);
    if (opts.help) return write(io.stdout, HELP, 0);
    if (opts.version) return write(io.stdout, `${VERSION}\n`, 0);
    tools = buildTools(API, opts);
  } catch (err) {
    if (err instanceof UsageError || err instanceof ToolInputError) return write(io.stderr, `zapsmtp-mcp: ${err.message}\nRun zapsmtp-mcp --help for usage.\n`, 2);
    throw err;
  }
  if (opts.listTools) {
    const lines = tools.map((t) => `${t.name.padEnd(50)} ${t.toolset.padEnd(18)} ${t.annotations.readOnlyHint ? 'read' : 'write'}`);
    return write(io.stdout, `${lines.join('\n')}\n${tools.length} tools (toolsets: ${toolsetNames(API).join(', ')})\n`, 0);
  }
  const docs = loadDocs(docsDir);
  if (opts.http) {
    const running = await startHttp({ host: opts.host, port: opts.port, tools, docs, docsDir, baseUrl: opts.baseUrl });
    io.stderr.write(`zapsmtp-mcp ${VERSION}: ${tools.length} tools at ${running.url} (each client sends Authorization: Bearer <its API key>)\n`);
    return { url: running.url, close: running.close };
  }
  if (!opts.key) {
    return write(io.stderr, 'zapsmtp-mcp: no API key: set ZAP_API_KEY or pass --key (or serve --http, where clients send their own)\n', 2);
  }
  const server = createServer({ client: makeClient({ apiKey: opts.key, baseUrl: opts.baseUrl }), tools, docs, docsDir });
  await server.connect(new StdioServerTransport(io.stdin, io.stdout));
  io.stderr.write(`zapsmtp-mcp ${VERSION}: ${tools.length} tools on stdio\n`);
  return { close: () => server.close() };
}

function write(stream: Writable, text: string, code: number): number {
  stream.write(text);
  return code;
}
