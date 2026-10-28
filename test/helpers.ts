import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ZapSMTP } from 'zapsmtp';
import { API } from '../src/generated/api.js';
import type { DocPage } from '../src/docs.js';
import { createServer, makeClient } from '../src/server.js';
import { buildTools, type ToolOptions } from '../src/tools.js';

const dir = fileURLToPath(new URL('../../conformance/', import.meta.url));
export const cases: any[] = JSON.parse(readFileSync(dir + 'cases.json', 'utf8'));
export const vectors: any[] = JSON.parse(readFileSync(new URL('../../spec/webhook-vectors.json', import.meta.url), 'utf8')).vectors;
export const KEY = 'zap_test_conformance';

/** Starts sdks/conformance/server.mjs; resolves to its base URL and a stop function. */
export async function conformance(): Promise<{ baseUrl: string; stop: () => void }> {
  const server: ChildProcess = spawn(process.execPath, [dir + 'server.mjs', '0']);
  const port = await new Promise<number>((resolve, reject) => {
    server.stdout!.on('data', (d) => {
      const m = /listening (\d+)/.exec(String(d));
      if (m) resolve(Number(m[1]));
    });
    server.on('exit', reject);
  });
  return { baseUrl: `http://127.0.0.1:${port}/v1`, stop: () => server.kill() };
}

export interface Recorded {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: any;
}

/**
 * A fetch that answers from a function and records every request. The answer
 * is [status, body] or [status, body, headers].
 */
export function fakeFetch(answer: (r: Recorded) => [number, unknown, Record<string, string>?]) {
  const requests: Recorded[] = [];
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const r: Recorded = { method: init.method ?? 'GET', url: new URL(String(input)), headers, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) };
    requests.push(r);
    const [status, body, h = {}] = answer(r);
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_fake', ...h } });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

/** An MCP client connected in-process to a server over the given SDK client. */
export async function connect(client: ZapSMTP, opts: ToolOptions = {}, docs: DocPage[] = [], docsDir = ''): Promise<Client> {
  const server = createServer({ client, tools: buildTools(API, opts), docs, docsDir });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new Client({ name: 'test', version: '1.0.0' });
  await mcp.connect(b);
  return mcp;
}

/** Calls a tool; returns {isError, json}. */
export async function call(mcp: Client, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; json: any; text: string }> {
  const res = await mcp.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0].text;
  return { isError: !!res.isError, json: JSON.parse(text), text };
}

export function fakeClient(answer: Parameters<typeof fakeFetch>[0], apiKey = 'zap_test_fake_key_123') {
  const f = fakeFetch(answer);
  return { client: makeClient({ apiKey, baseUrl: 'http://api.test/v1', fetch: f.fetch }), requests: f.requests };
}
