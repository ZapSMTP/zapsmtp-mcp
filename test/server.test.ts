import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConnectionError, ZapSMTPError } from 'zapsmtp';
import { DOCS_DIR, loadDocs, readDoc } from '../src/docs.js';
import { errorInfo, INSTRUCTIONS, makeClient, redact } from '../src/server.js';
import { ToolInputError } from '../src/tools.js';
import { VERSION } from '../src/version.js';
import { call, connect, fakeClient } from './helpers.js';

describe('server', () => {
  it('describes itself and lists annotated tools', async () => {
    const mcp = await connect(fakeClient(() => [200, {}]).client);
    expect(mcp.getServerVersion()).toMatchObject({ name: 'zapsmtp', version: VERSION });
    expect(mcp.getInstructions()).toBe(INSTRUCTIONS);
    expect(mcp.getServerCapabilities()).not.toHaveProperty('resources');
    const { tools } = await mcp.listTools();
    const send = tools.find((t) => t.name === 'emails_send')!;
    expect(send.annotations).toMatchObject({ title: 'Send an email', readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(send.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('refuses an unknown tool as a protocol error', async () => {
    const mcp = await connect(fakeClient(() => [200, {}]).client);
    await expect(mcp.callTool({ name: 'nope', arguments: {} })).rejects.toThrow(/Unknown tool nope/);
  });

  it('sends the server in the User-Agent', async () => {
    const { client, requests } = fakeClient(() => [200, { object: 'usage' }]);
    await (await connect(client)).callTool({ name: 'usage_get', arguments: {} });
    expect(requests[0].headers['user-agent']).toMatch(/^zapsmtp-mcp\/\d+\.\d+\.\d+ \(node\/[\d.]+; zapsmtp-node\/\d+\.\d+\.\d+\)$/);
  });

  it('turns API errors into tool errors with code, message and request id', async () => {
    const { client } = fakeClient(() => [404, { statusCode: 404, name: 'not_found', message: 'Email not found', error: { code: 'not_found', message: 'Email not found', type: 'invalid_request_error' } }, { 'x-request-id': 'req_123' }]);
    const r = await call(await connect(client), 'emails_get', { id: 'e1' });
    expect(r).toMatchObject({ isError: true, json: { error: { status: 404, code: 'not_found', type: 'invalid_request_error', message: 'Email not found', request_id: 'req_123' } } });
  });

  it('maps errors without a body, connection errors and the unexpected', () => {
    expect(errorInfo(new ZapSMTPError('HTTP 418', { status: 418 }))).toEqual({ status: 418, code: 'ZapSMTPError', message: 'HTTP 418' });
    expect(errorInfo(new ConnectionError('fetch failed'))).toEqual({ status: 0, code: 'ConnectionError', message: 'fetch failed' });
    expect(errorInfo(new ToolInputError('bad', 'x'))).toEqual({ code: 'x', message: 'bad' });
    expect(errorInfo(new Error('boom'))).toEqual({ code: 'internal_error', message: 'boom' });
    expect(errorInfo('str')).toEqual({ code: 'internal_error', message: 'str' });
  });

  it('never returns the API key, even when the API echoes it', async () => {
    const key = 'zap_live_secret_key_0123456789';
    const { client } = fakeClient(() => [401, { message: `Invalid API key ${key}`, error: { code: 'invalid_api_key', message: `Invalid API key ${key}` } }], key);
    const r = await call(await connect(client), 'usage_get');
    expect(r.text).not.toContain(key);
    expect(r.json.error.message).toBe('Invalid API key [redacted]');
    expect(redact('abc', '')).toBe('abc');
    expect(redact({ [key]: [key, 1, null] }, key)).toEqual({ '[redacted]': ['[redacted]', 1, null] });
  });

  it('reports a network failure', async () => {
    const client = makeClient({ apiKey: 'zap_test_x', baseUrl: 'http://127.0.0.1:1/v1', fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    const r = await call(await connect(client), 'emails_get', { id: 'e1' });
    expect(r.json.error).toMatchObject({ status: 0, code: 'ConnectionError', message: 'fetch failed' });
  });
});

describe('docs resources', () => {
  it('lists and reads the bundled pages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zap-docs-'));
    writeFileSync(join(dir, 'llms.txt'), '# ZapSMTP\n> Email API.\n');
    const pages = [{ uri: 'https://zapsmtp.com/llms.txt', name: 'llms.txt', title: 'ZapSMTP', description: 'Email API.', file: 'llms.txt' }];
    writeFileSync(join(dir, 'index.json'), JSON.stringify(pages));
    const docs = loadDocs(dir);
    expect(docs).toEqual(pages);
    const mcp = await connect(fakeClient(() => [200, {}]).client, {}, docs, dir);
    expect(mcp.getServerCapabilities()).toHaveProperty('resources');
    const { resources } = await mcp.listResources();
    expect(resources).toEqual([{ uri: 'https://zapsmtp.com/llms.txt', name: 'llms.txt', title: 'ZapSMTP', description: 'Email API.', mimeType: 'text/markdown' }]);
    const read = await mcp.readResource({ uri: 'https://zapsmtp.com/llms.txt' });
    expect(read.contents).toEqual([{ uri: 'https://zapsmtp.com/llms.txt', mimeType: 'text/markdown', text: '# ZapSMTP\n> Email API.\n' }]);
    await expect(mcp.readResource({ uri: 'https://zapsmtp.com/nope.md' })).rejects.toThrow(/Unknown resource/);
    expect(readDoc(dir, pages[0])).toContain('ZapSMTP');
  });

  it('has none without a bundle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zap-docs-'));
    expect(loadDocs(dir)).toEqual([]);
    writeFileSync(join(dir, 'index.json'), '{"not": "a list"}');
    expect(loadDocs(dir)).toEqual([]);
    expect(DOCS_DIR).toMatch(/[/\\]docs[/\\]$/);
  });
});
