import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HELP, main, parseOptions, type IO, type Running } from '../src/main.js';
import { VERSION } from '../src/version.js';
import { cases, conformance, KEY } from './helpers.js';

function io(): IO & { out: () => string; err: () => string } {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (d) => { out += d; });
  stderr.on('data', (d) => { err += d; });
  return { stdin: new PassThrough(), stdout, stderr, out: () => out, err: () => err };
}

describe('options', () => {
  it('reads flags, then the environment, then defaults', () => {
    expect(parseOptions([], {})).toEqual({
      key: undefined, http: false, port: 3000, host: '127.0.0.1', baseUrl: undefined, toolsets: undefined, readOnly: false,
      sender: undefined, replyTo: undefined, allowedRecipientDomains: undefined, listTools: false, help: false, version: false,
    });
    const env = {
      ZAP_API_KEY: 'zap_env', ZAP_BASE_URL: 'http://b/v1', ZAP_TOOLSETS: 'emails, logs', ZAP_READ_ONLY: 'true', ZAP_SENDER: 'a@x.com',
      ZAP_REPLY_TO: 'r@x.com', ZAP_ALLOWED_RECIPIENT_DOMAINS: 'x.com,y.com', ZAP_MCP_PORT: '4000', ZAP_MCP_HOST: '0.0.0.0',
    };
    expect(parseOptions([], env)).toMatchObject({
      key: 'zap_env', baseUrl: 'http://b/v1', toolsets: ['emails', 'logs'], readOnly: true, sender: 'a@x.com', replyTo: 'r@x.com',
      allowedRecipientDomains: ['x.com', 'y.com'], port: 4000, host: '0.0.0.0',
    });
    expect(parseOptions(['--key', 'zap_flag', '--toolsets', 'all', '--read-only', '--sender', 's@x.com', '--reply-to', 'q@x.com',
      '--allowed-recipient-domains', 'z.com', '--base-url', 'http://c/v1', '--list-tools', '-h', '-v'], env)).toMatchObject({
      key: 'zap_flag', toolsets: 'all', readOnly: true, sender: 's@x.com', replyTo: 'q@x.com', allowedRecipientDomains: ['z.com'],
      baseUrl: 'http://c/v1', listTools: true, help: true, version: true,
    });
    expect(parseOptions([], { ZAP_READ_ONLY: '0' }).readOnly).toBe(false);
    expect(parseOptions(['--http', '--port', '8080', '--host', '::1'], { ZAP_API_KEY: 'zap_env' })).toMatchObject({ http: true, port: 8080, host: '::1', key: undefined });
  });

  it('refuses bad usage', () => {
    expect(() => parseOptions(['--nope'], {})).toThrow(/Unknown option '--nope'/);
    expect(() => parseOptions(['extra'], {})).toThrow(/positional/);
    expect(() => parseOptions(['--port', 'x'], {})).toThrow(/--port must be a port number, not x/);
    expect(() => parseOptions(['--port', '70000'], {})).toThrow(/--port/);
    expect(() => parseOptions(['--http', '--key', 'k'], {})).toThrow(/--key is for stdio/);
  });
});

describe('main', () => {
  it('prints help and version', async () => {
    let s = io();
    expect(await main(['--help'], {}, s)).toBe(0);
    expect(s.out()).toBe(HELP);
    expect(HELP).toMatch(/--allowed-recipient-domains/);
    s = io();
    expect(await main(['--version'], {}, s)).toBe(0);
    expect(s.out()).toBe(`${VERSION}\n`);
    expect(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version).toBe(VERSION);
  });

  it('lists the tools of the options', async () => {
    const s = io();
    expect(await main(['--list-tools', '--toolsets', 'emails', '--read-only'], {}, s)).toBe(0);
    expect(s.out()).toMatch(/^emails_list +emails +read$/m);
    expect(s.out()).not.toMatch(/emails_send/);
    expect(s.out()).toMatch(/\n\d+ tools \(toolsets: emails, receiving/);
    const w = io();
    expect(await main(['--list-tools'], {}, w)).toBe(0);
    expect(w.out()).toMatch(/^emails_send +emails +write$/m);
  });

  it('exits 2 on usage errors and without a key', async () => {
    let s = io();
    expect(await main(['--toolsets', 'nope'], {}, s)).toBe(2);
    expect(s.err()).toMatch(/Unknown toolset nope/);
    s = io();
    expect(await main(['--bogus'], {}, s)).toBe(2);
    s = io();
    expect(await main([], {}, s)).toBe(2);
    expect(s.err()).toMatch(/no API key/);
  });

  it('throws what is not a usage error', async () => {
    const s = io();
    s.stdout.write = () => { throw new Error('stdout closed'); };
    await expect(main(['--toolsets', 'emails', '--help'], {}, s)).rejects.toThrow('stdout closed');
  });

  it('serves stdio with the key from the environment', async () => {
    const c = await conformance();
    const s = io();
    const running = await main([], { ZAP_API_KEY: KEY, ZAP_BASE_URL: c.baseUrl }, s, '/nonexistent/') as Running;
    expect(s.err()).toMatch(/tools on stdio/);
    const lines: any[] = [];
    let buf = '';
    s.stdout.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0;) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
    });
    const send = (m: unknown) => (s.stdin as PassThrough).write(JSON.stringify(m) + '\n');
    const reply = (id: number) => new Promise<any>((resolve) => {
      const t = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(t); resolve(m); } }, 5);
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect((await reply(1)).result.serverInfo.name).toBe('zapsmtp');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'usage_get', arguments: {} } });
    const usage = cases.find((x) => x.id === 'usage').response.body;
    expect(JSON.parse((await reply(2)).result.content[0].text)).toEqual(usage);
    await running.close();
    c.stop();
  });

  it('serves HTTP', async () => {
    const s = io();
    const running = await main(['--http', '--port', '0'], {}, s) as Running;
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(s.err()).toMatch(/Authorization: Bearer/);
    const res = await fetch(running.url!.replace('/mcp', '/health'));
    expect(res.status).toBe(200);
    await running.close();
  });
});

describe('generated code', () => {
  it('is current with the API reference', () => {
    const script = fileURLToPath(new URL('../../codegen/generate.mjs', import.meta.url));
    expect(() => execFileSync(process.execPath, [script, '--check', '--only', 'mcp'], { stdio: 'pipe' })).not.toThrow();
  });
});
