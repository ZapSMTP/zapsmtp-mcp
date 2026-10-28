// The hand-written layer over the generated operations: tool names, toolsets,
// annotations and descriptions. Everything here is a judgement call the API
// model cannot make; the parameters themselves always come from the model.
import { snake, type Operation } from './generated/model.js';

export interface Toolset {
  name: string;
  description: string;
  default: boolean;
}

/** Every toolset, in the order they are listed. A resource without one here gets its own (snake_case name). */
export const TOOLSETS: Toolset[] = [
  { name: 'emails', description: 'Send (one or a batch), list, get, reschedule, cancel, spam-check and share sent emails; their attachments', default: true },
  { name: 'receiving', description: 'Received (inbound) emails: list, get, reply, report spam, redeliver, attachments, delete', default: true },
  { name: 'threads', description: 'Conversations of sent and received emails', default: true },
  { name: 'templates', description: 'Templates: create, update, render, publish, duplicate, versions', default: true },
  { name: 'variables', description: 'Template variables and global variables', default: true },
  { name: 'domains', description: 'Sending domains: DNS records, verification, tracking, DMARC reports, reputation, brand (BIMI)', default: true },
  { name: 'webhooks', description: 'Webhook endpoints, test deliveries, delivery history, event replay, secret rotation, signature verification', default: true },
  { name: 'suppressions', description: 'The suppression list: add, remove, look up', default: true },
  { name: 'logs', description: 'API request logs', default: true },
  { name: 'stats', description: 'Sending statistics, time series, breakdowns and metrics', default: true },
  { name: 'usage', description: 'This month\'s usage and plan', default: true },
  { name: 'simulator', description: 'Simulator addresses, and send_test_email to try any delivery outcome safely', default: true },
  { name: 'inbound', description: 'Inbound domains, routes and forward destinations', default: false },
  { name: 'actions', description: 'Click actions (named buttons and links)', default: false },
  { name: 'template_modules', description: 'Reusable template modules', default: false },
  { name: 'template_assets', description: 'Images hosted for templates', default: false },
  { name: 'template_timers', description: 'Countdown timer images', default: false },
  { name: 'api_keys', description: 'API keys: create, update, revoke', default: false },
  { name: 'smtp_credentials', description: 'SMTP relay credentials', default: false },
  { name: 'dedicated_ips', description: 'Dedicated sending IPs and their warm-up', default: false },
];

export const DEFAULT_TOOLSETS = TOOLSETS.filter((t) => t.default).map((t) => t.name);

/** The SDK method path of an operation, e.g. "emails.receiving.list". */
export const sdkName = (op: Operation): string => [...op.resource, op.method].join('.');

/** emails.receiving.attachments.list -> emails_receiving_attachments_list */
export const toolName = (op: Operation): string => [...op.resource, op.method].map(snake).join('_');

/** Received emails get a toolset of their own; every other operation belongs to its top-level resource. */
export const toolsetOf = (op: Operation): string => op.resource[0] === 'emails' && op.resource[1] === 'receiving' ? 'receiving' : snake(op.resource[0]);

/** POST operations that change nothing: they compute an answer. */
const READ_ONLY_POSTS = new Set(['templates.render', 'templates.renderSource', 'emails.spamCheck', 'emails.spamCheckSent']);
/** Operations that destroy or revoke something besides DELETE requests. */
const DESTRUCTIVE = new Set(['emails.cancel', 'webhooks.rotateSecret', 'suppressions.deleteBatch', 'templates.versions.restore']);
/** POST operations that end in the same state when repeated. */
const IDEMPOTENT_POSTS = new Set([
  'emails.cancel', 'domains.verify', 'inbound.domains.verify', 'domains.checkReputation', 'templates.publish',
  'emails.receiving.reportSpam', 'suppressions.createBatch', 'suppressions.deleteBatch', 'templates.versions.restore',
]);
/** Operations that send email or call a URL outside ZapSMTP. */
const OPEN_WORLD = new Set([
  'emails.send', 'emails.sendBatch', 'emails.receiving.reply', 'inbound.forwardDestinations.create',
  'inbound.forwardDestinations.resendConfirmation', 'webhooks.test', 'webhooks.events.replay', 'emails.receiving.redeliver',
]);

export interface Annotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export function annotations(op: Operation): Annotations {
  const name = sdkName(op);
  const readOnly = op.httpMethod === 'GET' || READ_ONLY_POSTS.has(name);
  const a: Annotations = { title: op.title, readOnlyHint: readOnly, openWorldHint: OPEN_WORLD.has(name) };
  if (!readOnly) {
    a.destructiveHint = op.httpMethod === 'DELETE' || DESTRUCTIVE.has(name);
    a.idempotentHint = op.httpMethod === 'PUT' || op.httpMethod === 'DELETE' || op.httpMethod === 'PATCH' || IDEMPOTENT_POSTS.has(name);
  }
  return a;
}

/** Operations whose recipients --allowed-recipient-domains checks, and the parameters that hold them. */
export const RECIPIENT_PARAMS: Record<string, string[]> = {
  'emails.send': ['to', 'cc', 'bcc'],
  'emails.sendBatch': ['to', 'cc', 'bcc'],
  'emails.receiving.reply': ['to', 'cc', 'bcc'],
  'inbound.forwardDestinations.create': ['email'],
};

/** Operations that take the default sender and Reply-To. */
export const SENDS = new Set(['emails.send', 'emails.sendBatch']);

const MAX_DESCRIPTION = 900;

/** The operation's documentation, cut at a sentence end when it is long. */
export function describe(op: Operation): string {
  return trim(op.doc, MAX_DESCRIPTION);
}

export function trim(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return end > max / 2 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ')) + ' …';
}
