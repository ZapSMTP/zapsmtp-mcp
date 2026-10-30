// Regressions Codex found in the tool schemas.
import { expect, it } from 'vitest';
import { API } from '../src/generated/api.js';
import { paramSchema, typeSchema, type JSONSchema } from '../src/schema.js';
import { call, connect, fakeClient } from './helpers.js';

// Only the JSON Schema constraints relevant to null; permits either union spelling.
function acceptsNull(schema: JSONSchema): boolean {
  if (schema.enum && !(schema.enum as unknown[]).includes(null)) return false;
  if (schema.anyOf && !(schema.anyOf as JSONSchema[]).some(acceptsNull)) return false;
  if (schema.oneOf && (schema.oneOf as JSONSchema[]).filter(acceptsNull).length !== 1) return false;
  if (schema.allOf && !(schema.allOf as JSONSchema[]).every(acceptsNull)) return false;
  return schema.type === undefined || schema.type === 'null' ||
    (Array.isArray(schema.type) && schema.type.includes('null'));
}

it.each(['domain_id', 'stream'])('allows null to clear an API key %s restriction', (fieldName) => {
  // API.md: PATCH /api-keys/{id} accepts domain_id|null and stream|null.
  const operation = API.operations.find((op) => op.httpMethod === 'PATCH' && op.path === '/api-keys/{id}');
  expect(operation).toBeDefined();
  const field = operation!.body.find((param) => param.name === fieldName)!;
  expect(field.type.nullable).toBe(true);
  const schema = paramSchema(field, API);
  expect(acceptsNull(schema), JSON.stringify(schema)).toBe(true);
});

it('spells a nullable type as a type union, and adds null to a nullable enum', () => {
  expect(typeSchema({ k: 'string', nullable: true }, API)).toEqual({ type: ['string', 'null'] });
  expect(typeSchema({ k: 'array', of: { k: 'string' }, nullable: true }, API)).toEqual({ type: ['array', 'null'], items: { type: 'string' } });
  expect(typeSchema({ k: 'any', nullable: true }, API)).toEqual({});
  expect(paramSchema({ name: 'stream', type: { k: 'string', nullable: true }, required: false, doc: '', enum: ['a'] }, API))
    .toEqual({ type: ['string', 'null'], enum: ['a', null] });
});

it('sends null on to the API to lift an API key restriction', async () => {
  const f = fakeClient(() => [200, { id: 'key-1' }]);
  const mcp = await connect(f.client, { toolsets: 'all' });
  try {
    const r = await call(mcp, 'api_keys_update', { id: 'key-1', domain_id: null, stream: null });
    expect(r.isError).toBe(false);
    expect(f.requests[0].body).toEqual({ domain_id: null, stream: null });
  } finally { await mcp.close(); }
});
