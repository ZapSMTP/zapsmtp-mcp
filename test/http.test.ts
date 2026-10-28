// Streamable HTTP mode: per-client bearer keys, no key held by the server.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '../src/generated/api.js';
import { bearer, startHttp, type RunningHttp } from '../src/http.js';
import { buildTools } from '../src/tools.js';

// a fake API that answers every request with the key it was sent
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
let api: Server;
let apiUrl: string;
let mcp: RunningHttp;

beforeAll(async () => {
  api = createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Request-Id': 'req_1' });
      res.end(JSON.stringify({ object: 'usage', key: hash(req.headers.authorization!) }));
    }, Math.random() * 20);
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}/v1`;
  mcp = await startHttp({ host: '127.0.0.1', port: 0, tools: buildTools(API), baseUrl: apiUrl, maxBody: 4096 });
});
afterAll(async () => {
  await mcp.close();
  api.close();
});

async function client(key?: string): Promise<Client> {
  const c = new Client({ name: 'test', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(mcp.url), key ? { requestInit: { headers: { Authorization: `Bearer ${key}` } } } : {}));
  return c;
}

function raw(method: string, path: string, headers: Record<string, string> = {}, body?: string, setHost = true): Promise<{ status: number; headers: Record<string, unknown>; body: any }> {
  const u = new URL(mcp.url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, method, path, headers, setHost }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text ? JSON.parse(text) : undefined }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const INIT = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } });
const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

describe('http mode', () => {
  it('serves tools to a client with its own key', async () => {
    const c = await client('zap_test_aaaaaaaaaaaa');
    const { tools } = await c.listTools();
    expect(tools.length).toBe(buildTools(API).length);
    const res = await c.callTool({ name: 'usage_get', arguments: {} });
    expect(JSON.parse((res.content as any)[0].text)).toEqual({ object: 'usage', key: hash('Bearer zap_test_aaaaaaaaaaaa') });
    await c.close();
  });

  it('keeps every client on its own key', async () => {
    const keys = ['zap_test_alice_000000', 'zap_test_bob_11111111', 'zap_test_carol_222222'];
    const clients = await Promise.all(keys.map((k) => client(k)));
    const runs = await Promise.all(clients.flatMap((c, i) => Array.from({ length: 5 }, async () => {
      const res = await c.callTool({ name: 'usage_get', arguments: {} });
      return [keys[i], JSON.parse((res.content as any)[0].text).key] as const;
    })));
    for (const [key, seen] of runs) expect(seen).toBe(hash(`Bearer ${key}`));
    await Promise.all(clients.map((c) => c.close()));
  });

  it('refuses a client without a key', async () => {
    await expect(client()).rejects.toThrow(/401|Unauthorized/);
    const r = await raw('POST', '/mcp', JSON_HEADERS, INIT);
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toMatch(/^Bearer realm="zapsmtp"/);
    expect(r.body.error.message).toMatch(/Authorization: Bearer/);
    expect((await raw('POST', '/mcp', { ...JSON_HEADERS, authorization: 'Basic abc' }, INIT)).status).toBe(401);
  });

  it('answers health, unknown paths, and methods of a stateless server', async () => {
    expect(await raw('GET', '/health')).toMatchObject({ status: 200, body: { status: 'ok' } });
    expect((await raw('GET', '/other')).status).toBe(404);
    const get = await raw('GET', '/mcp', { authorization: 'Bearer zap_test_x' });
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe('POST');
    expect((await raw('DELETE', '/mcp')).status).toBe(405);
  });

  it('refuses other hosts and origins on loopback (DNS rebinding)', async () => {
    const port = new URL(mcp.url).port;
    const auth = { ...JSON_HEADERS, authorization: 'Bearer zap_test_x' };
    expect((await raw('POST', '/mcp', { ...auth, host: `evil.example:${port}` }, INIT)).status).toBe(403);
    expect((await raw('POST', '/mcp', auth, INIT, false)).status).toBe(400); // node itself refuses HTTP/1.1 without Host
    expect((await raw('POST', '/mcp', { ...auth, origin: 'https://evil.example' }, INIT)).status).toBe(403);
    expect((await raw('POST', '/mcp', { ...auth, origin: 'not a url' }, INIT)).status).toBe(403);
    expect((await raw('POST', '/mcp', { ...auth, origin: `http://localhost:${port}`, host: `localhost:${port}` }, INIT)).status).toBe(200);
    expect((await raw('POST', '/mcp', { ...auth, host: `[::1]:${port}` }, INIT)).status).toBe(200);
  });

  it('refuses bodies that are not JSON or too large', async () => {
    const auth = { ...JSON_HEADERS, authorization: 'Bearer zap_test_x' };
    const bad = await raw('POST', '/mcp', auth, '{nope');
    expect(bad).toMatchObject({ status: 400, body: { error: { code: -32700 } } });
    const big = await raw('POST', '/mcp', auth, JSON.stringify({ x: 'y'.repeat(300_000) }));
    expect(big.status).toBe(413);
  });

  it('answers 500 when the server fails, and ends a response it already started', async () => {
    const auth = { ...JSON_HEADERS, authorization: 'Bearer zap_test_x' };
    const failing = await startHttp({ host: '127.0.0.1', port: 0, tools: [], create: () => { throw 'no server'; } });
    const u = new URL(failing.url);
    const post = (url: URL) => fetch(url, { method: 'POST', headers: auth, body: INIT });
    let res = await post(u);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    await failing.close();
    const late = await startHttp({
      host: '127.0.0.1', port: 0, tools: [],
      create: () => ({
        connect: async (t: any) => {
          t.handleRequest = async (_req: unknown, r: any) => { r.writeHead(200); r.write('partial'); throw new Error('late failure'); };
        },
        close: async () => undefined,
      }) as any,
    });
    res = await post(new URL(late.url));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('partial');
    await late.close();
  });

  it('serves on any address with --host', async () => {
    const other = await startHttp({ host: '::1', port: 0, tools: [] });
    expect(other.url).toMatch(/^http:\/\/\[::1\]:\d+\/mcp$/);
    await other.close();
    const anyHost = await startHttp({ host: '0.0.0.0', port: 0, tools: [] });
    const r = await new Promise<number>((resolve) => {
      request({ host: '127.0.0.1', port: new URL(anyHost.url).port, method: 'POST', path: '/mcp', headers: { host: 'mail.example:1', 'content-type': 'application/json' } }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      }).end(INIT);
    });
    expect(r).toBe(401); // no rebinding check off loopback, but still a key
    await anyHost.close();
  });

  it('fails to start on a taken port', async () => {
    await expect(startHttp({ host: '127.0.0.1', port: Number(new URL(mcp.url).port), tools: [] })).rejects.toThrow(/EADDRINUSE/);
  });

  it('parses bearer headers', () => {
    expect(bearer('Bearer abc')).toBe('abc');
    expect(bearer('bearer  abc ')).toBe('abc');
    expect(bearer('Bearer')).toBeUndefined();
    expect(bearer(undefined)).toBeUndefined();
    expect(bearer('Bearer a b')).toBeUndefined();
  });
});
