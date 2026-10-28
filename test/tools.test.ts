import { describe, expect, it } from 'vitest';
import { API } from '../src/generated/api.js';
import { nextPageQuery, snake } from '../src/generated/model.js';
import { annotations, DEFAULT_TOOLSETS, describe as describeOp, toolName, toolsetOf, trim } from '../src/catalog.js';
import { paramSchema, typeSchema } from '../src/schema.js';
import { allowed, buildTools, decodeCursor, domainOf, encodeCursor, splitAddresses, ToolInputError, toolsetNames } from '../src/tools.js';
import { call, connect, fakeClient, vectors } from './helpers.js';

const op = (id: string) => API.operations.find((o) => o.id === id)!;
const SIM = {
  domain: 'simulator.zapsmtp.com', note: '',
  scenarios: [
    { address: 'delivered@simulator.zapsmtp.com', event: 'email.delivered', result: '250' },
    { address: 'bounced@simulator.zapsmtp.com', event: 'email.bounced', result: '550' },
    { address: 'bounce+421+4.7.0+try-later@simulator.zapsmtp.com', event: 'email.delivery_delayed', result: 'any' },
  ],
};

describe('catalog', () => {
  it('names tools after the SDK method path', () => {
    expect(toolName(op('send-email'))).toBe('emails_send');
    expect(toolName(op('list-received'))).toBe('emails_receiving_list');
    expect(toolName(op('get-template-version'))).toBe('templates_versions_get');
    expect(toolName(op('send-batch'))).toBe('emails_send_batch');
    expect(snake('forward-destinations')).toBe('forward_destinations');
    const names = API.operations.map(toolName);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  });

  it('groups received emails apart from emails', () => {
    expect(toolsetOf(op('list-received'))).toBe('receiving');
    expect(toolsetOf(op('list-received-attachments'))).toBe('receiving');
    expect(toolsetOf(op('list-sent-attachments'))).toBe('emails');
    expect(toolsetOf(op('create-forward-destination'))).toBe('inbound');
    expect(toolsetOf(op('list-api-keys'))).toBe('api_keys');
  });

  it('annotates reads, deletes, revocations, idempotent updates and sends', () => {
    expect(annotations(op('list-emails'))).toEqual({ title: 'List emails', readOnlyHint: true, openWorldHint: false });
    expect(annotations(op('render-template')).readOnlyHint).toBe(true);
    expect(annotations(op('delete-domain'))).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(annotations(op('cancel-email'))).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(annotations(op('rotate-secret'))).toMatchObject({ destructiveHint: true, idempotentHint: false });
    expect(annotations(op('revoke-api-key'))).toMatchObject({ destructiveHint: true });
    expect(annotations(op('send-email'))).toMatchObject({ destructiveHint: false, idempotentHint: false, openWorldHint: true });
    expect(annotations(op('update-domain'))).toMatchObject({ destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(annotations(op('put-global-variable'))).toMatchObject({ idempotentHint: true });
    expect(annotations(op('verify-domain'))).toMatchObject({ idempotentHint: true, destructiveHint: false });
    expect(annotations(op('create-domain'))).toMatchObject({ idempotentHint: false, destructiveHint: false });
  });

  it('trims long docs at a sentence end', () => {
    expect(trim('short.', 10)).toBe('short.');
    expect(trim('One sentence here. Two sentences here.', 30)).toBe('One sentence here.');
    expect(trim('a b c d e f g h i j k l m n o p', 10)).toBe('a b c d e …');
    expect(describeOp(op('send-email')).length).toBeLessThanOrEqual(900);
    expect(describeOp(op('send-email')).endsWith('.')).toBe(true);
    expect(describeOp(op('get-email'))).toBe(op('get-email').doc);
  });
});

describe('schemas', () => {
  const api = API;
  it('maps every parameter type', () => {
    expect(typeSchema({ k: 'string' }, api)).toEqual({ type: 'string' });
    expect(typeSchema({ k: 'datetime' }, api)).toEqual({ type: 'string', format: 'date-time' });
    expect(typeSchema({ k: 'integer' }, api)).toEqual({ type: 'integer' });
    expect(typeSchema({ k: 'number' }, api)).toEqual({ type: 'number' });
    expect(typeSchema({ k: 'boolean' }, api)).toEqual({ type: 'boolean' });
    expect(typeSchema({ k: 'any' }, api)).toEqual({});
    expect(typeSchema({ k: 'strings' }, api)).toEqual({ type: 'array', items: { type: 'string' } });
    expect(typeSchema({ k: 'array', of: { k: 'integer' } }, api)).toEqual({ type: 'array', items: { type: 'integer' } });
    expect(typeSchema({ k: 'map', of: { k: 'string' } }, api)).toEqual({ type: 'object', additionalProperties: { type: 'string' } });
    expect(typeSchema({ k: 'map', of: { k: 'any' } }, api)).toEqual({ type: 'object' });
    expect(typeSchema({ k: 'ref', ref: 'Tag' }, api)).toMatchObject({ type: 'object', required: ['name', 'value'], description: expect.any(String) });
    expect(typeSchema({ k: 'ref', ref: 'Tracking' }, api)).not.toHaveProperty('required');
  });

  it('documents enums, defaults and lists', () => {
    expect(paramSchema({ name: 'events', type: { k: 'array', of: { k: 'string' } }, required: false, doc: '', enum: ['a', 'b'] }, api))
      .toEqual({ type: 'array', items: { type: 'string', enum: ['a', 'b'] } });
    expect(paramSchema({ name: 'x', type: { k: 'string' }, required: false, doc: 'X.', enum: ['a'], default: 'a' }, api))
      .toEqual({ type: 'string', enum: ['a'], description: 'X. Default: a.' });
    expect(paramSchema({ name: 'to', type: { k: 'strings' }, required: true, doc: '' }, api).description).toBe('One address or a list.');
  });
});

describe('tool selection', () => {
  it('exposes the default toolsets', () => {
    const tools = buildTools(API);
    expect(new Set(tools.map((t) => t.toolset))).toEqual(new Set(DEFAULT_TOOLSETS));
    expect(tools.some((t) => t.name === 'send_test_email')).toBe(true);
    expect(tools.some((t) => t.name === 'verify_webhook_signature')).toBe(true);
    expect(tools.some((t) => t.name === 'api_keys_create')).toBe(false);
  });

  it('filters by toolset and read-only', () => {
    const tools = buildTools(API, { toolsets: ['emails', 'webhooks'], readOnly: true });
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(['emails', 'webhooks']).toContain(t.toolset);
      expect(t.annotations.readOnlyHint).toBe(true);
    }
    expect(tools.map((t) => t.name)).toContain('verify_webhook_signature');
    expect(tools.map((t) => t.name)).not.toContain('emails_send');
    expect(tools.map((t) => t.name)).toContain('emails_spam_check');
  });

  it('exposes every operation with all', () => {
    expect(buildTools(API, { toolsets: 'all' }).length).toBe(API.operations.length + 2);
  });

  it('refuses unknown toolsets', () => {
    expect(() => buildTools(API, { toolsets: ['emails', 'nope'] })).toThrow(/Unknown toolset nope/);
  });

  it('gives a new resource a toolset of its own', () => {
    const extra = { ...op('usage'), id: 'x', resource: ['brandNew'], method: 'get' };
    const api = { ...API, operations: [...API.operations, extra] };
    expect(toolsetNames(api)).toContain('brand_new');
    expect(buildTools(api, { toolsets: ['brand_new'] }).map((t) => t.name)).toEqual(['brand_new_get']);
  });

  it('builds schemas with path parameters, cursors and idempotency keys', () => {
    const tools = Object.fromEntries(buildTools(API, { toolsets: 'all' }).map((t) => [t.name, t]));
    expect(tools.templates_versions_get.inputSchema).toMatchObject({ required: ['id', 'vid'], properties: { id: { type: 'string', minLength: 1 } } });
    expect(tools.emails_list.inputSchema.properties).toHaveProperty('cursor');
    expect(tools.emails_list.description).toMatch(/next_cursor/);
    expect(tools.webhooks_list.inputSchema.properties).not.toHaveProperty('cursor');
    expect(tools.webhooks_list.description).toMatch(/Returns \{data, has_more\}/);
    expect(tools.emails_send.inputSchema.properties).toHaveProperty('idempotency_key');
    expect(tools.emails_send.inputSchema.required).toEqual(['from', 'to']);
    expect((tools.emails_send_batch.inputSchema.properties as any).emails.items.required).toContain('from');
    expect(tools.emails_send_batch.inputSchema.properties).toHaveProperty('validation');
    expect(tools.usage_get.inputSchema).not.toHaveProperty('required');
  });

  it('makes from optional and documents the defaults when a sender is set', () => {
    const tools = Object.fromEntries(buildTools(API, { sender: 'Acme <a@acme.com>', replyTo: 'help@acme.com' }).map((t) => [t.name, t]));
    expect(tools.emails_send.inputSchema.required).toEqual(['to']);
    expect((tools.emails_send.inputSchema.properties as any).from.description).toMatch(/Default: Acme <a@acme.com>/);
    expect((tools.emails_send.inputSchema.properties as any).reply_to.description).toMatch(/Default: help@acme.com/);
    const item = (tools.emails_send_batch.inputSchema.properties as any).emails.items;
    expect(item.required).toEqual(['to']);
    expect(item.properties.from.description).toMatch(/Default: Acme/);
    expect(tools.send_test_email.inputSchema).not.toHaveProperty('required');
  });
});

describe('cursors', () => {
  it('round-trips and refuses foreign cursors', () => {
    const c = encodeCursor({ before: 'x', limit: 2 });
    expect(decodeCursor(c, new Set(['before', 'limit']))).toEqual({ before: 'x', limit: 2 });
    expect(() => decodeCursor(c, new Set(['before']))).toThrow(ToolInputError);
    expect(() => decodeCursor('%%%', new Set(['before']))).toThrow(/not a next_cursor/);
    expect(() => decodeCursor(encodeCursor([1] as any), new Set())).toThrow(/not a next_cursor/);
    expect(() => decodeCursor(Buffer.from('null').toString('base64url'), new Set())).toThrow(/not a next_cursor/);
  });

  it('continues every kind of list as the SDK does', () => {
    const page = (data: any[], extra = {}) => ({ data, has_more: true, ...extra });
    const items = [{ id: 'a', last_message_at: 't1' }, { id: 'b', last_message_at: 't2' }];
    expect(nextPageQuery('before', { limit: 2 }, page(items))).toEqual({ limit: 2, before: 'b' });
    expect(nextPageQuery('after', {}, page(items))).toEqual({ after: 'b' });
    expect(nextPageQuery('logs', {}, page(items))).toEqual({ before: 'b' });
    expect(nextPageQuery('logs', { after: 'z' }, page(items))).toEqual({ after: 'a' });
    expect(nextPageQuery('thread', {}, page(items))).toEqual({ before: 't2', before_id: 'b' });
    expect(nextPageQuery('cursor', {}, page(items, { next_cursor: 'nc' }))).toEqual({ after: 'nc' });
    expect(nextPageQuery('cursor', {}, page(items))).toBeNull();
    expect(nextPageQuery(null, {}, page(items))).toBeNull();
    expect(nextPageQuery('before', {}, { data: items, has_more: false })).toBeNull();
    for (const p of ['before', 'after', 'thread'] as const) expect(nextPageQuery(p, {}, page([]))).toBeNull();
    expect(nextPageQuery('logs', {}, page([]))).toBeNull();
    expect(nextPageQuery('logs', { after: 'z' }, page([]))).toBeNull();
  });

  it('pages through a list with next_cursor', async () => {
    const { client, requests } = fakeClient((r) => r.url.searchParams.get('before') === 'e2'
      ? [200, { object: 'list', has_more: false, data: [{ id: 'e3' }] }]
      : [200, { object: 'list', has_more: true, data: [{ id: 'e1' }, { id: 'e2' }] }]);
    const mcp = await connect(client);
    const first = await call(mcp, 'emails_list', { limit: 2, status: 'bounced' });
    expect(first.json).toMatchObject({ object: 'list', has_more: true, data: [{ id: 'e1' }, { id: 'e2' }] });
    const second = await call(mcp, 'emails_list', { cursor: first.json.next_cursor });
    expect(second.json).toMatchObject({ has_more: false, next_cursor: null, data: [{ id: 'e3' }] });
    expect(Object.fromEntries(requests[1].url.searchParams)).toEqual({ limit: '2', status: 'bounced', before: 'e2' });
    const bad = await call(mcp, 'emails_list', { cursor: 'nope' });
    expect(bad.isError).toBe(true);
    expect(bad.json.error.code).toBe('invalid_arguments');
  });
});

describe('arguments', () => {
  const ok = () => fakeClient(() => [200, { id: 'x' }]);

  it('refuses unknown and missing arguments', async () => {
    const mcp = await connect(ok().client);
    let r = await call(mcp, 'emails_get', { id: 'a', bogus: 1 });
    expect(r).toMatchObject({ isError: true, json: { error: { code: 'invalid_arguments', message: expect.stringMatching(/Unknown argument bogus/) } } });
    r = await call(mcp, 'emails_get', { id: 'a', bogus: 1, other: 2 });
    expect(r.json.error.message).toMatch(/Unknown arguments bogus, other/);
    r = await call(mcp, 'emails_get', {});
    expect(r.json.error.message).toBe('Missing required argument id');
    r = await call(mcp, 'templates_versions_get', { id: null });
    expect(r.json.error.message).toBe('Missing required arguments id, vid');
    r = await call(mcp, 'emails_get', { id: { x: 1 } });
    expect(r.json.error.message).toBe('id must be a non-empty string');
    r = await call(mcp, 'emails_get', { id: '' });
    expect(r.json.error.message).toBe('id must be a non-empty string');
    r = await call(mcp, 'emails_send_batch', { emails: 'x' });
    expect(r.json.error.message).toBe('emails must be a list');
    r = await call(mcp, 'emails_send_batch', { emails: ['x'] });
    expect(r.json.error.message).toBe('emails[0] must be an object');
  });

  it('accepts a numeric id and runs with no arguments at all', async () => {
    const { client, requests } = ok();
    const mcp = await connect(client);
    expect((await call(mcp, 'emails_get', { id: 42 })).isError).toBe(false);
    expect(requests[0].url.pathname).toBe('/v1/emails/42');
    const res = await mcp.callTool({ name: 'usage_get' });
    expect(res.isError).toBeFalsy();
  });
});

describe('sends', () => {
  it('uses the default sender and Reply-To only when a send omits them', async () => {
    const { client, requests } = fakeClient(() => [200, { id: 'x' }]);
    const mcp = await connect(client, { sender: 'Acme <a@acme.com>', replyTo: 'help@acme.com' });
    await call(mcp, 'emails_send', { to: 'j@example.org', subject: 's', text: 't' });
    expect(requests[0].body).toEqual({ from: 'Acme <a@acme.com>', reply_to: 'help@acme.com', to: 'j@example.org', subject: 's', text: 't' });
    await call(mcp, 'emails_send', { from: 'b@acme.com', reply_to: [], to: ['j@example.org'], text: 't' });
    expect(requests[1].body).toEqual({ from: 'b@acme.com', reply_to: [], to: ['j@example.org'], text: 't' });
    await call(mcp, 'emails_send_batch', { emails: [{ to: 'j@example.org', text: 'a' }, { from: 'c@acme.com', to: 'k@example.org', text: 'b' }], validation: 'permissive', idempotency_key: 'k-1' });
    expect(requests[2].body).toEqual([
      { from: 'Acme <a@acme.com>', reply_to: 'help@acme.com', to: 'j@example.org', text: 'a' },
      { from: 'c@acme.com', reply_to: 'help@acme.com', to: 'k@example.org', text: 'b' },
    ]);
    expect(requests[2].headers['x-batch-validation']).toBe('permissive');
    expect(requests[2].headers['idempotency-key']).toBe('k-1');
  });

  it('requires from without a default sender', async () => {
    const { client, requests } = fakeClient(() => [200, { id: 'x' }]);
    const mcp = await connect(client);
    const r = await call(mcp, 'emails_send_batch', { emails: [{ from: 'a@acme.com', to: 'j@example.org' }, { to: 'k@example.org' }] });
    expect(r.json.error.message).toBe('emails[1].from is required: no default sender is configured');
    expect((await call(mcp, 'emails_send_batch', { emails: [{ from: 'a@acme.com', to: null }] })).json.error.message).toBe('Missing required argument emails[0].to');
    expect((await call(mcp, 'emails_send', { to: 'j@example.org', from: '' })).json.error.message).toBe('from is required: no default sender is configured');
    expect((await call(mcp, 'emails_send', { to: 'j@example.org' })).json.error.message).toBe('Missing required argument from');
    expect(requests).toHaveLength(0);
  });

  it('refuses recipients outside the allowed domains', async () => {
    const { client, requests } = fakeClient(() => [200, { id: 'x' }]);
    const mcp = await connect(client, { toolsets: 'all', sender: 'a@acme.com', allowedRecipientDomains: [' Example.org ', '@acme.com', ''] });
    expect((await call(mcp, 'emails_send', { to: ['Jane <jane@example.org>', 'x@mail.acme.com'], cc: null, text: 't' })).isError).toBe(false);
    let r = await call(mcp, 'emails_send', { to: 'jane@example.org', bcc: ['spy@evil.com'], text: 't' });
    expect(r.json.error).toEqual({ code: 'recipient_not_allowed', message: 'Refused: spy@evil.com is outside the allowed recipient domains (example.org, acme.com)' });
    r = await call(mcp, 'emails_send', { to: 'no-domain', text: 't' });
    expect(r.json.error.code).toBe('recipient_not_allowed');
    r = await call(mcp, 'emails_send_batch', { emails: [{ to: 'a@example.org' }, { to: 'b@notexample.org' }] });
    expect(r.json.error.message).toMatch(/b@notexample.org/);
    r = await call(mcp, 'emails_receiving_reply', { id: 'r1', text: 'hi' });
    expect(r.json.error.message).toMatch(/must name its recipients/);
    r = await call(mcp, 'emails_receiving_reply', { id: 'r1', to: 'a@example.org', reply_all: true });
    expect(r.json.error.code).toBe('recipient_not_allowed');
    expect((await call(mcp, 'emails_receiving_reply', { id: 'r1', to: 'a@example.org', text: 'hi' })).isError).toBe(false);
    r = await call(mcp, 'inbound_forward_destinations_create', { email: 'me@gmail.com' });
    expect(r.json.error.code).toBe('recipient_not_allowed');
    expect(requests.map((q) => q.url.pathname)).toEqual(['/v1/emails', '/v1/emails/receiving/r1/reply']);
    // the reply keeps the email's own sender: no default From
    expect(requests[1].body).toEqual({ to: 'a@example.org', text: 'hi' });
  });

  it('checks every address of a comma-separated value', async () => {
    const { client, requests } = fakeClient(() => [200, { id: 'x' }]);
    const mcp = await connect(client, { sender: 'a@acme.com', allowedRecipientDomains: ['example.org'] });
    for (const to of ['spy@evil.com, jane@example.org', 'jane@example.org; spy@evil.com', ['ok@example.org', 'x@evil.com,y@example.org'], ' ', '"Doe, Jane" <j@example.org>, spy@evil.com']) {
      const r = await call(mcp, 'emails_send', { to, text: 't' });
      expect(r.json.error?.code, JSON.stringify(to)).toBe('recipient_not_allowed');
    }
    expect((await call(mcp, 'emails_send', { to: '"Doe, Jane" <j@example.org>, "x;y" <k@sub.example.org>', text: 't' })).isError).toBe(false);
    expect(requests).toHaveLength(1);
    expect(splitAddresses('a <b,c> , d')).toEqual(['a <b,c>', 'd']);
    expect(splitAddresses('a>, b')).toEqual(['a>', 'b']);
  });

  it('parses recipient domains', () => {
    expect(domainOf('Jane Doe <Jane@Example.ORG>')).toBe('example.org');
    expect(domainOf('"a@b" <x@y.com.>')).toBe('y.com');
    expect(domainOf('plain')).toBe('');
    expect(allowed('sub.acme.com', ['acme.com'])).toBe(true);
    expect(allowed('evilacme.com', ['acme.com'])).toBe(false);
    expect(allowed('', ['acme.com'])).toBe(false);
  });
});

describe('send_test_email', () => {
  const sim = () => fakeClient((r) => r.url.pathname === '/v1/simulator' ? [200, SIM] : [200, { id: 'em_1' }]);

  it('sends to the simulator address of a scenario', async () => {
    const { client, requests } = sim();
    const mcp = await connect(client, { sender: 'a@acme.com', allowedRecipientDomains: ['acme.com'] });
    let r = await call(mcp, 'send_test_email', {});
    expect(r.json).toEqual({ id: 'em_1', to: 'delivered@simulator.zapsmtp.com', expected_event: 'email.delivered', expected_result: '250' });
    expect(requests[1].body).toEqual({ from: 'a@acme.com', to: 'delivered@simulator.zapsmtp.com', subject: 'ZapSMTP test: delivered', text: 'A test of the delivered outcome, sent through the ZapSMTP simulator.' });
    r = await call(mcp, 'send_test_email', { scenario: ' Bounced@simulator.zapsmtp.com', from: 'b@acme.com', subject: 'S', html: '<p>x</p>', tags: [{ name: 'k', value: 'v' }] });
    expect(r.json.expected_event).toBe('email.bounced');
    expect(requests[3].body).toEqual({ from: 'b@acme.com', to: 'bounced@simulator.zapsmtp.com', subject: 'S', html: '<p>x</p>', tags: [{ name: 'k', value: 'v' }] });
    r = await call(mcp, 'send_test_email', { scenario: 'bounce+550+5.1.1+gone' });
    expect(r.json).toMatchObject({ to: 'bounce+550+5.1.1+gone@simulator.zapsmtp.com', expected_result: 'bounce+550+5.1.1+gone' });
    r = await call(mcp, 'send_test_email', { scenario: 'bounce+421+4.7.0+try-later', text: 'own' });
    expect(r.json.expected_event).toBe('email.delivery_delayed');
  });

  it('refuses unknown scenarios and a missing sender', async () => {
    const mcp = await connect(sim().client);
    let r = await call(mcp, 'send_test_email', { scenario: 'exploded', from: 'a@acme.com' });
    expect(r.json.error.message).toBe('Unknown scenario "exploded". Scenarios: delivered, bounced, or bounce+<code>[+<x.y.z>][+<words>]');
    r = await call(mcp, 'send_test_email', {});
    expect(r.json.error.message).toBe('Missing required argument from');
  });
});

describe('verify_webhook_signature', () => {
  it('passes or fails every shared vector', async () => {
    const mcp = await connect(fakeClient(() => [500, {}]).client, { toolsets: ['webhooks'] });
    for (const v of vectors) {
      const r = await call(mcp, 'verify_webhook_signature', { payload: v.payload, signature: v.header, secret: v.secret, now: v.now, tolerance_seconds: v.tolerance });
      expect(r.isError).toBe(false);
      expect(r.json.valid, v.name).toBe(v.valid);
      if (v.valid) expect(r.json.events.length).toBeGreaterThan(0);
      else expect(r.json.reason).toEqual(expect.any(String));
    }
    const r = await call(mcp, 'verify_webhook_signature', { payload: '{}', signature: 't=1,v1=00', secret: 'whsec_x' });
    expect(r.json).toEqual({ valid: false, reason: 'Webhook signature is too old (or from the future)' });
  });
});
