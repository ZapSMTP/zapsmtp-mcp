// JSON Schema of tool inputs, built from the API model's parameter types.
import type { Api, Param, Type } from './generated/model.js';

export type JSONSchema = Record<string, unknown>;

/** The schema of one type. Request types (refs) are inlined: tool schemas must stand alone. */
export function typeSchema(t: Type, api: Api): JSONSchema {
  const s = baseSchema(t, api);
  // null clears a field (domain_id: null lifts an API key's restriction); any JSON value takes it already
  if (t.nullable && typeof s.type === 'string') s.type = [s.type, 'null'];
  return s;
}

function baseSchema(t: Type, api: Api): JSONSchema {
  switch (t.k) {
    case 'string': return { type: 'string' };
    case 'datetime': return { type: 'string', format: 'date-time' };
    case 'integer': return { type: 'integer' };
    case 'number': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    // one address or several: a list keeps every client's schema checker happy
    case 'strings': return { type: 'array', items: { type: 'string' } };
    case 'array': return { type: 'array', items: typeSchema(t.of!, api) };
    case 'map': return t.of!.k === 'any' ? { type: 'object' } : { type: 'object', additionalProperties: typeSchema(t.of!, api) };
    case 'ref': {
      const input = api.inputs[t.ref!];
      return objectSchema(input.fields, api, input.doc);
    }
    default: return {}; // any JSON value
  }
}

/** A parameter's schema with its description, allowed values and default. */
export function paramSchema(p: Param, api: Api, extraDoc = ''): JSONSchema {
  const s = typeSchema(p.type, api);
  if (p.enum) {
    if (p.type.k === 'array' || p.type.k === 'strings') (s.items as JSONSchema).enum = p.enum;
    else s.enum = p.type.nullable ? [...p.enum, null] : p.enum;
  }
  let doc = p.doc;
  if (p.type.k === 'strings') doc = joinDoc('One address or a list.', doc);
  if (p.default !== undefined) doc = joinDoc(doc, `Default: ${p.default}.`);
  doc = joinDoc(doc, extraDoc);
  if (doc) s.description = doc;
  return s;
}

export function objectSchema(fields: Param[], api: Api, doc?: string): JSONSchema {
  const s: JSONSchema = { type: 'object', properties: Object.fromEntries(fields.map((f) => [f.name, paramSchema(f, api)])) };
  const required = fields.filter((f) => f.required).map((f) => f.name);
  if (required.length) s.required = required;
  if (doc) s.description = doc;
  return s;
}

const joinDoc = (a: string, b: string): string => [a, b].filter(Boolean).join(' ');
