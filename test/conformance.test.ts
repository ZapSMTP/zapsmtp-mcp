// Every generated tool, called once through an MCP client against the
// conformance mock (sdks/conformance/server.mjs), which checks the exact
// request: method, path, query, body and headers.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '../src/generated/api.js';
import { toolName } from '../src/catalog.js';
import { makeClient } from '../src/server.js';
import { call, cases, conformance, connect, KEY } from './helpers.js';

let stop: () => void;
let mcp: Client;

beforeAll(async () => {
  const c = await conformance();
  stop = c.stop;
  const client = makeClient({ apiKey: KEY, baseUrl: c.baseUrl });
  mcp = await connect(client, { toolsets: 'all' });
});
afterAll(() => stop?.());

/** The tool arguments of a conformance case: path parameters by name, then the parameters. */
function argsOf(c: any): Record<string, unknown> {
  const op = API.operations.find((o) => o.id === c.id)!;
  const args: Record<string, unknown> = {};
  op.pathParams.forEach((p, i) => { args[p.name] = c.call.pathArgs[i]; });
  if (c.call.items) return { ...args, emails: c.call.items, ...c.call.options };
  return { ...args, ...c.call.params };
}

describe('conformance', () => {
  it('has a case and a tool for every operation', async () => {
    const { tools } = await mcp.listTools();
    const names = new Set(tools.map((t) => t.name));
    expect(cases.length).toBe(API.operations.length);
    for (const op of API.operations) {
      expect(names.has(toolName(op)), toolName(op)).toBe(true);
      expect(cases.some((c) => c.id === op.id), op.id).toBe(true);
    }
    expect(tools.length).toBe(API.operations.length + 2);
  });

  for (const c of cases) {
    const op = API.operations.find((o) => o.id === c.id)!;
    it(`${toolName(op)} (${c.id})`, async () => {
      const { isError, json, text } = await call(mcp, toolName(op), argsOf(c));
      expect(isError, text).toBe(false);
      if (c.response.body === null) expect(json).toEqual({ ok: true });
      else if (op.returns?.page) {
        expect(json.data).toEqual(c.response.body.data);
        expect(json.has_more).toBe(c.response.body.has_more);
        expect(json).toHaveProperty('next_cursor');
      } else expect(json).toEqual(c.response.body);
    });
  }
});
