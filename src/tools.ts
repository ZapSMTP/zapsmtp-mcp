// The MCP tools: one per API operation (generated from the API model), plus
// hand-written helpers that make agents effective (send_test_email,
// verify_webhook_signature).
import { verifyWebhookEvents, type ZapSMTP } from 'zapsmtp';
import { invoke, nextPageQuery, type Api, type Operation, type Param } from './generated/model.js';
import { annotations, describe, RECIPIENT_PARAMS, SENDS, sdkName, toolName, toolsetOf, TOOLSETS, type Annotations } from './catalog.js';
import { objectSchema, paramSchema, type JSONSchema } from './schema.js';

export interface ToolOptions {
  /** Toolset names, or "all". Default: the default toolsets. */
  toolsets?: string[] | 'all';
  /** Only tools that change nothing. */
  readOnly?: boolean;
  /** From used when a send omits it. */
  sender?: string;
  /** Reply-To used when a send omits it. */
  replyTo?: string;
  /** Sends to any other domain (or its subdomains) are refused. */
  allowedRecipientDomains?: string[];
}

export interface Tool {
  name: string;
  toolset: string;
  description: string;
  inputSchema: JSONSchema & { type: 'object' };
  annotations: Annotations;
  /** Runs the tool; resolves to its JSON result. Throws ToolInputError or the SDK's errors. */
  run(client: ZapSMTP, args: Record<string, unknown>): Promise<unknown>;
}

/** Arguments the tool cannot run with; the model should fix them and call again. */
export class ToolInputError extends Error {
  constructor(message: string, readonly code = 'invalid_arguments') {
    super(message);
    this.name = 'ToolInputError';
  }
}

const CURSOR_DOC = 'next_cursor of the previous page: returns the page after it, with the same filters.';
const IDEMPOTENCY_DOC = 'Sent as Idempotency-Key: a repeat with the same key and body returns the first result instead of sending again (24 hours). A new one is made when omitted.';

/** Every toolset name, the listed ones and any resource the API model adds. */
export function toolsetNames(api: Api): string[] {
  const names = TOOLSETS.map((t) => t.name);
  for (const op of api.operations) if (!names.includes(toolsetOf(op))) names.push(toolsetOf(op));
  return names;
}

export function buildTools(api: Api, opts: ToolOptions = {}): Tool[] {
  const known = toolsetNames(api);
  let wanted: Set<string>;
  if (opts.toolsets === 'all') wanted = new Set(known);
  else {
    const list = opts.toolsets ?? TOOLSETS.filter((t) => t.default).map((t) => t.name);
    const unknown = list.filter((t) => !known.includes(t));
    if (unknown.length) throw new ToolInputError(`Unknown toolset ${unknown.join(', ')}. Toolsets: ${known.join(', ')}, all`, 'invalid_toolset');
    wanted = new Set(list);
  }
  const domains = (opts.allowedRecipientDomains ?? []).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const policy: Policy = { sender: opts.sender || undefined, replyTo: opts.replyTo || undefined, domains };

  const tools = [...api.operations.map((op) => operationTool(api, op, policy)), sendTestEmailTool(policy), verifyWebhookTool()];
  const order = (t: Tool) => known.indexOf(t.toolset);
  return tools
    .filter((t) => wanted.has(t.toolset) && (!opts.readOnly || t.annotations.readOnlyHint))
    .sort((a, b) => order(a) - order(b));
}

interface Policy {
  sender?: string;
  replyTo?: string;
  domains: string[];
}

// ---- operation tools -------------------------------------------------------

function operationTool(api: Api, op: Operation, policy: Policy): Tool {
  const name = sdkName(op);
  const sends = SENDS.has(name);
  const params = [...op.pathParams, ...op.query, ...op.body];
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];
  for (const p of params) {
    const s = paramSchema(p, api, sends ? sendDoc(p, policy) : '');
    const inPath = op.pathParams.includes(p);
    if (inPath) s.minLength = 1;
    properties[p.name] = s;
    if (p.required || inPath || (sends && p.name === 'from' && !policy.sender)) required.push(p.name);
  }
  if (op.bodyArray) {
    const input = api.inputs[op.bodyArray];
    const item = objectSchema(input.fields, api, input.doc);
    if (sends) {
      for (const f of input.fields) {
        const doc = sendDoc(f, policy);
        if (doc) (item.properties as Record<string, JSONSchema>)[f.name] = paramSchema(f, api, doc);
      }
      if (!policy.sender) item.required = [...new Set([...(item.required as string[]), 'from'])];
    }
    properties.emails = { type: 'array', items: item, minItems: 1, maxItems: 100, description: 'The emails to send, up to 100.' };
    required.push('emails');
  }
  for (const o of op.options) properties[o.name] = paramSchema(o, api);
  if (op.idempotent) properties.idempotency_key = { type: 'string', description: IDEMPOTENCY_DOC };
  const paged = op.returns?.page && op.paging !== null;
  if (paged) properties.cursor = { type: 'string', description: CURSOR_DOC };

  let description = describe(op);
  if (op.returns?.page) description += paged ? ' Returns one page: {data, has_more, next_cursor}; pass next_cursor as cursor for the next page.' : ' Returns {data, has_more}.';

  const inputSchema: Tool['inputSchema'] = { type: 'object', properties, additionalProperties: false };
  if (required.length) inputSchema.required = required;
  const queryNames = new Set(op.query.map((q) => q.name));

  return {
    name: toolName(op),
    toolset: toolsetOf(op),
    description,
    inputSchema,
    annotations: annotations(op),
    async run(client, args) {
      checkArgs(args, inputSchema);
      const path = op.pathParams.map((p) => String(args[p.name]));
      const values: Record<string, unknown> = {};
      for (const p of [...op.query, ...op.body]) if (args[p.name] !== undefined) values[p.name] = args[p.name];
      if (paged && args.cursor !== undefined) Object.assign(values, decodeCursor(args.cursor, queryNames));
      const options: Record<string, unknown> = {};
      for (const o of op.options) if (args[o.name] !== undefined) options[o.name] = args[o.name];
      if (args.idempotency_key !== undefined) options.idempotencyKey = args.idempotency_key;

      let items: Record<string, unknown>[] | undefined;
      if (op.bodyArray) {
        items = (args.emails as Record<string, unknown>[]).map((e, i) => {
          if (!e || typeof e !== 'object' || Array.isArray(e)) throw new ToolInputError(`emails[${i}] must be an object`);
          const email = applySender({ ...e }, policy, `emails[${i}].`);
          for (const f of api.inputs[op.bodyArray!].fields) {
            if (f.required && email[f.name] == null) throw new ToolInputError(`Missing required argument emails[${i}].${f.name}`);
          }
          return email;
        });
      } else if (sends) applySender(values, policy, '');

      const fields = RECIPIENT_PARAMS[name];
      if (fields && policy.domains.length) {
        if (name === 'emails.receiving.reply' && (values.to === undefined || values.reply_all === true)) {
          throw new ToolInputError('Refused: recipients are restricted (--allowed-recipient-domains), so a reply must name its recipients in to and cannot use reply_all.', 'recipient_not_allowed');
        }
        for (const e of items ?? [values]) checkRecipients(e, fields, policy.domains);
      }

      const query: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) if (queryNames.has(k)) query[k] = v;
      const res = await invoke(client, op, { path, params: values, items, options });
      return shape(res, op, query);
    },
  };
}

function sendDoc(p: Param, policy: Policy): string {
  if (p.name === 'from' && policy.sender) return `Default: ${policy.sender}.`;
  if (p.name === 'reply_to' && policy.replyTo) return `Default: ${policy.replyTo}.`;
  return '';
}

function applySender(e: Record<string, unknown>, policy: Policy, at: string): Record<string, unknown> {
  if (e.from === undefined || e.from === '') {
    if (!policy.sender) throw new ToolInputError(`${at}from is required: no default sender is configured`);
    e.from = policy.sender;
  }
  if (e.reply_to === undefined && policy.replyTo) e.reply_to = policy.replyTo;
  return e;
}

/** The result as the model sees it: a page carries a cursor for the next one; no body is {ok: true}. */
function shape(res: unknown, op: Operation, query: Record<string, unknown>): unknown {
  if (res === undefined || res === null) return { ok: true };
  if (op.returns?.page) {
    const page = res as { data: unknown[]; has_more: boolean; next_cursor?: string | null };
    const next = nextPageQuery(op.paging, query, page);
    return { ...page, next_cursor: next ? encodeCursor(next) : null };
  }
  return res;
}

// ---- arguments -------------------------------------------------------------

function checkArgs(args: Record<string, unknown>, schema: Tool['inputSchema']): void {
  const props = schema.properties as Record<string, JSONSchema>;
  const unknown = Object.keys(args).filter((k) => !Object.hasOwn(props, k));
  if (unknown.length) throw new ToolInputError(`Unknown argument${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}. Arguments: ${Object.keys(props).join(', ')}`);
  const missing = ((schema.required ?? []) as string[]).filter((k) => args[k] === undefined || args[k] === null);
  if (missing.length) throw new ToolInputError(`Missing required argument${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`);
  for (const [k, s] of Object.entries(props)) {
    if (s.minLength === 1 && args[k] !== undefined && !(typeof args[k] === 'number' || (typeof args[k] === 'string' && args[k] !== ''))) {
      throw new ToolInputError(`${k} must be a non-empty string`);
    }
    if (k === 'emails' && !Array.isArray(args[k])) throw new ToolInputError('emails must be a list');
  }
}

export function encodeCursor(query: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(query), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: unknown, allowed: Set<string>): Record<string, unknown> {
  let q: unknown;
  try {
    q = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    q = null;
  }
  if (!q || typeof q !== 'object' || Array.isArray(q) || Object.keys(q).some((k) => !allowed.has(k))) {
    throw new ToolInputError('cursor is not a next_cursor of this list');
  }
  return q as Record<string, unknown>;
}

// ---- recipients ------------------------------------------------------------

/** The domain of "Name <a@b.com>" or "a@b.com", lowercased; "" when there is none. */
export function domainOf(address: string): string {
  const m = /<([^>]*)>\s*$/.exec(address);
  const a = (m ? m[1] : address).trim();
  const at = a.lastIndexOf('@');
  return at < 0 ? '' : a.slice(at + 1).toLowerCase().replace(/\.$/, '');
}

/**
 * The addresses of one recipient value: a mail server reads "a@x.com, b@y.com"
 * as two, so each is checked. Commas and semicolons inside quotes or angle
 * brackets do not split.
 */
export function splitAddresses(value: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '<') angle++;
    else if (!quoted && ch === '>') angle = Math.max(0, angle - 1);
    if (!quoted && angle === 0 && (ch === ',' || ch === ';')) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function allowed(domain: string, domains: string[]): boolean {
  return domain !== '' && domains.some((d) => domain === d || domain.endsWith('.' + d));
}

function checkRecipients(e: Record<string, unknown>, fields: string[], domains: string[]): void {
  for (const f of fields) {
    const v = e[f];
    if (v === undefined || v === null) continue;
    for (const value of Array.isArray(v) ? v : [v]) {
      const addresses = splitAddresses(String(value));
      const bad = addresses.length ? addresses.find((a) => !allowed(domainOf(a), domains)) : String(value);
      if (bad !== undefined) {
        throw new ToolInputError(`Refused: ${bad} is outside the allowed recipient domains (${domains.join(', ')})`, 'recipient_not_allowed');
      }
    }
  }
}

// ---- hand-written tools ----------------------------------------------------

function sendTestEmailTool(policy: Policy): Tool {
  const properties: Record<string, JSONSchema> = {
    scenario: {
      type: 'string',
      description: 'The outcome to simulate: delivered (default), bounced, full, blocked, delayed, complained, suppressed, or any reply as bounce+<code>[+<x.y.z>][+<words-with-dashes>] (e.g. bounce+421+4.7.0+try-later). simulator_get lists them.',
    },
    from: { type: 'string', description: `Sender address on a verified domain.${policy.sender ? ` Default: ${policy.sender}.` : ''}` },
    subject: { type: 'string', description: 'Default: "ZapSMTP test: <scenario>".' },
    text: { type: 'string', description: 'Plain-text body. Default: a short note.' },
    html: { type: 'string', description: 'HTML body.' },
    tags: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'] } },
  };
  const inputSchema: Tool['inputSchema'] = { type: 'object', properties, additionalProperties: false };
  if (!policy.sender) inputSchema.required = ['from'];
  return {
    name: 'send_test_email',
    toolset: 'simulator',
    description: 'Send a test email to a simulator address, which never leaves ZapSMTP and never affects reputation or suppressions, to see a delivery outcome (delivered, bounced, complained, delayed...). Returns the email id and the event to expect; follow it with emails_get.',
    inputSchema,
    annotations: { title: 'Send a test email to the simulator', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(client, args) {
      checkArgs(args, inputSchema);
      const scenario = String(args.scenario ?? 'delivered').trim().toLowerCase();
      const sim = await client.simulator.get();
      const local = scenario.includes('@') ? scenario.slice(0, scenario.lastIndexOf('@')) : scenario;
      const match = sim.scenarios.find((s) => s.address.slice(0, s.address.lastIndexOf('@')) === local);
      if (!match && !/^bounce\+\d{3}(\+[\w.-]+)*$/.test(local)) {
        const names = sim.scenarios.map((s) => s.address.slice(0, s.address.lastIndexOf('@'))).filter((n) => !n.includes('+'));
        throw new ToolInputError(`Unknown scenario "${scenario}". Scenarios: ${names.join(', ')}, or bounce+<code>[+<x.y.z>][+<words>]`);
      }
      const to = `${local}@${sim.domain}`;
      const email = applySender({
        from: args.from,
        to,
        subject: args.subject ?? `ZapSMTP test: ${local}`,
        text: args.text ?? (args.html === undefined ? `A test of the ${local} outcome, sent through the ZapSMTP simulator.` : undefined),
        html: args.html,
        tags: args.tags,
      }, policy, '');
      for (const k of Object.keys(email)) if (email[k] === undefined) delete email[k];
      const sent = await client.emails.send(email as never);
      return { ...sent, to, expected_event: match?.event ?? 'email.bounced or email.delivery_delayed (by the code)', expected_result: match?.result ?? local };
    },
  };
}

function verifyWebhookTool(): Tool {
  const inputSchema: Tool['inputSchema'] = {
    type: 'object',
    properties: {
      payload: { type: 'string', description: 'The request body exactly as received, before any JSON parsing.' },
      signature: { type: 'string', description: 'The Zap-Signature header: t=<unix seconds>,v1=<hex>[,v1=<hex>].' },
      secret: { type: 'string', description: 'The endpoint\'s signing secret (whsec_...), as webhooks_create or webhooks_rotate_secret returned it.' },
      tolerance_seconds: { type: 'integer', minimum: 0, description: 'Oldest signature accepted, in seconds. Default: 300.' },
      now: { type: 'integer', description: 'Check as of this unix time in seconds, e.g. when the request was recorded. Default: now.' },
    },
    required: ['payload', 'signature', 'secret'],
    additionalProperties: false,
  };
  return {
    name: 'verify_webhook_signature',
    toolset: 'webhooks',
    description: 'Check a ZapSMTP webhook request: the Zap-Signature header against the raw body and the endpoint secret (HMAC-SHA256, constant time, timestamp within the tolerance). Returns {valid: true, events} (a batch webhook has several) or {valid: false, reason}. Runs locally; nothing is sent.',
    inputSchema,
    annotations: { title: 'Verify a webhook signature', readOnlyHint: true, openWorldHint: false },
    async run(_client, args) {
      checkArgs(args, inputSchema);
      try {
        const opts: { tolerance?: number; now?: number } = {};
        if (args.tolerance_seconds !== undefined) opts.tolerance = Number(args.tolerance_seconds);
        if (args.now !== undefined) opts.now = Number(args.now);
        return { valid: true, events: verifyWebhookEvents(String(args.payload), String(args.signature), String(args.secret), opts) };
      } catch (err) {
        return { valid: false, reason: (err as Error).message };
      }
    },
  };
}
