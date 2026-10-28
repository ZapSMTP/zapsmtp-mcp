import { describe, expect, it } from 'vitest';
import { call, connect, fakeClient } from './helpers.js';

describe('independent MCP security regressions', () => {
  it.each(['outside@evil.test', 'inside@allowed.test.evil.test', 'inside@аllowed.test'])('rejects an unapproved recipient %j', async (to) => {
    const f = fakeClient(() => [200, { id: 'sent' }]);
    const mcp = await connect(f.client, { sender: 'sender@allowed.test', allowedRecipientDomains: ['allowed.test'] });
    try {
      const r = await call(mcp, 'emails_send', { to: [to] });
      expect({ isError: r.isError, requests: f.requests.length }).toEqual({ isError: true, requests: 0 });
    } finally { await mcp.close(); }
  });

  it.each(['zap_x', 'zap_test_quote"secret', 'zap_test_back\\slash'])('redacts echoed credential %j after decoding JSON', async (key) => {
    const f = fakeClient(() => [200, { echo: key }], key);
    const mcp = await connect(f.client);
    try {
      const r = await call(mcp, 'usage_get');
      expect(r.json.echo).toBe('[redacted]');
    } finally { await mcp.close(); }
  });

  it.each([
    ['emails_send', { to: ['outside@evil.test, inside@allowed.test'] }],
    ['emails_send_batch', { emails: [{ to: ['outside@evil.test, inside@allowed.test'] }] }],
    ['emails_receiving_reply', { id: 'received-1', to: ['outside@evil.test, inside@allowed.test'] }],
    ['inbound_forward_destinations_create', { email: 'outside@evil.test, inside@allowed.test' }],
  ])('refuses a mailbox list hidden in one recipient on %s', async (name, args) => {
    const f = fakeClient(() => [200, { id: 'sent' }]);
    const mcp = await connect(f.client, { toolsets: 'all', sender: 'sender@allowed.test', allowedRecipientDomains: ['allowed.test'] });
    try {
      const r = await call(mcp, name as string, args as Record<string, unknown>);
      expect({ isError: r.isError, requests: f.requests.length }).toEqual({ isError: true, requests: 0 });
    } finally { await mcp.close(); }
  });

  it('rejects inherited Object property names as unknown arguments', async () => {
    const f = fakeClient(() => [200, {}]);
    const mcp = await connect(f.client);
    try {
      const r = await call(mcp, 'usage_get', { constructor: 'unexpected' });
      expect({ isError: r.isError, requests: f.requests.length }).toEqual({ isError: true, requests: 0 });
    } finally { await mcp.close(); }
  });

  it('rejects a batch item missing its required recipient before sending', async () => {
    const f = fakeClient(() => [200, { data: [] }]);
    const mcp = await connect(f.client, { sender: 'sender@allowed.test' });
    try {
      const r = await call(mcp, 'emails_send_batch', { emails: [{ text: 'no recipient' }] });
      expect({ isError: r.isError, requests: f.requests.length }).toEqual({ isError: true, requests: 0 });
    } finally { await mcp.close(); }
  });
});
