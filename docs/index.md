# Documentation

> Send your first email with the ZapSMTP API in minutes: keys, live code examples in eight languages, test mode and the full API reference.

Source: https://zapsmtp.com/docs/

One HTTP request or an SMTP connection. Every example on these pages runs for real: paste a test key above and press **Try it**.

1. **Create an account and a test key.** [Sign up](https://app.zapsmtp.com/signup), open *API keys* and create a key in *test* mode. Test keys (`zap_test_…`) go through validation, logging, events and webhooks, but nothing is delivered and nothing counts against your plan.
2. **Send to the simulator.** Addresses at `simulator.zapsmtp.com` act out delivery scenarios: `delivered@`, `bounced@`, `complained@` and [more](https://zapsmtp.com/docs/testing/).
3. **Verify your domain and switch to a live key.** Add your domain, publish the DNS records it gives you and [verify it](https://zapsmtp.com/docs/domains/verify-domain/). Live keys send only from verified domains.

> Base URL `https://api.zapsmtp.com/v1`. Authenticate with `Authorization: Bearer <key>`. Requests and responses are JSON.

## Send your first email

`POST /v1/emails`

Send an email (or schedule it with scheduled_at).

Requires a full-access or sending-access key. Live keys: From domain must be verified by the account. Test keys: any From domain, nothing delivered, monthly quota not charged.

Recipients are deduplicated and lowercased; max 50 across to+cc+bcc. Message-ID is <id>@<hostname>, or <id>.<thread_id>@<hostname> for a reply that continues a conversation.

The response also carries `thread_id`: the conversation this email belongs to. An email with `In-Reply-To` / `References` headers (set them in `headers`) joins the thread of the message it answers; otherwise it starts a new one.

`failed_recipients`: addresses the mail server refused while it took the others; they are not sent and not charged. `unconfirmed: true`: the mail server took the message but its answer was lost; it counts as sent and must not be retried (its events tell the outcome).

Scheduled emails (`scheduled_at`): at most 10,000 (256 MB) may wait per account. At send time the account and the key are checked again: a suspended account or a revoked or expired key fails the email.

With reply tracking on, the response carries `reply_to`: the tracked address the email carries in place of its own Reply-To. Human replies are forwarded to the domain’s `reply_forward_to`, else to the email’s first Reply-To, else to its From.

### Headers

- `Idempotency-Key` (string): optional, 1-256 bytes (see [Idempotency](https://zapsmtp.com/docs/conventions/#idempotency))

### Body parameters

- `from` (string): RFC 5322 address, e.g. "Acme <hello@acme.com>". Domain must be verified (live keys). When only an address is given, the domain's from_name (brand settings) is used as display name. May be omitted when template is used and the template defines from. Limits: missing → 422 missing_required_field; unparsable → 422 invalid_parameter "invalid from address"
- `to` (string | string[], required): Recipient(s). Limits: at least one; each must parse as an address (422 invalid_parameter "invalid to address ...")
- `cc` (string | string[]): Cc recipients.
- `bcc` (string | string[]): Bcc recipients.
- `reply_to` (string | string[]): Reply-To address(es).
- `subject` (string): Subject line. May be omitted when template is used and the template defines a subject. Limits: blank → 422 missing_required_field
- `html` (string): HTML body. At least one of html/text is required (unless template is used). Limits: both empty → 422 missing_required_field "html or text is required"; cannot be combined with template (422 invalid_parameter)
- `text` (string): Plain-text body. When only `html` is given, a plain-text part is generated from it (readable text, links as `text (url)`, hidden elements such as the preheader left out).
- `headers` (object<string,string>): Custom headers. Limits: Reserved headers are rejected (422 invalid_parameter "header ... cannot be set"): From, To, Cc, Bcc, Reply-To, Subject, Date, Message-Id, Mime-Version, Content-Type, Content-Transfer-Encoding, DKIM-Signature, Return-Path, Received, any X-Zap-*, X-ZapRef. Names must be printable ASCII without spaces or ':'.
- `attachments` (object[]): Attachments; 40 MB total. Limits: 422 invalid_attachment with message attachments[i]: set either content or path, not both | content must be base64 | content or path is required | filename is required | path must be an http(s) URL | fetching path returned HTTP <n> | attachments exceed 40MB in total
  - `filename` (string, required): File name shown to the recipient.
  - `content` (string): File content, base64-encoded. Set `content` or `path`, not both.
  - `path` (string): An HTTPS URL we download the file from instead (private and internal addresses are refused).
  - `content_type` (string): MIME type. Detected from the file name when omitted.
  - `content_id` (string): Makes the file inline: reference it in the HTML as `cid:<content_id>`.
- `tags` (object[]): Returned in webhooks as data.tags. Limits: at most 20 tags per email; name and value must match ^[A-Za-z0-9_-]{1,256}$ (422 invalid_parameter)
  - `name` (string, required): Letters, digits, `_` and `-`, up to 256 characters.
  - `value` (string, required): Same characters, up to 256.
- `scheduled_at` (string): RFC 3339 time (e.g. 2026-10-21T15:00:00Z) or relative "in <n> <unit>" with unit min|mins|minute|minutes|h|hour|hours|d|day|days. Times in the past send immediately. Limits: unparsable → 422 invalid_parameter; more than 7 days ahead → 422 invalid_parameter "scheduled_at must be within 7 days"
- `metadata` (object<string,string>): Returned in webhooks and GET /emails; filter with GET /emails?metadata[key]=value. Limits: max 10 keys; keys ^[A-Za-z0-9_-]{1,40}$; values max 500 bytes (UTF-8) (422 invalid_parameter)
- `stream` (string): Limits: other values → 422 invalid_parameter; conflicting with the key's stream → 403 restricted_api_key One of `transactional`, `broadcast`. Default `transactional (or the key's stream)`.
- `tracking` (object): Overrides the From domain's open, click and reply tracking defaults for this email.
  - `opens` (boolean): Track opens for this email.
  - `clicks` (boolean): Track link clicks for this email.
  - `replies` (boolean): Reply tracking: the email carries a signed Reply-To on the domain’s `reply_domain`, so replies come back tied to this email (`email.replied`). Needs a reply domain on the sending domain (see [Update a domain](https://zapsmtp.com/docs/domains/update-domain/)), else 422 invalid_parameter.
- `template` (object): Render a stored, published template: id = template id or alias. Request subject/from override the template's. Cannot be combined with html/text. Limits: missing id → 422 missing_required_field "template.id is required"; unknown → 422 invalid_parameter "template <id> not found"; never published → 422 invalid_parameter; `variables.global` → 422 invalid_parameter (reserved); a value of the wrong type → 422 template_variables_invalid; a required variable without value or default → 422 template_variables_missing; anything else the template uses still absent → 422 template_render_error "missing template variables: a, b"
  - `id` (string, required): Template id or alias. The template must be published.
  - `variables` (object): Values for the template’s own variables. Checked against the published [variable schema](https://zapsmtp.com/docs/templating/#schema): defaults fill absent values, optional variables without one render empty, names the schema does not declare are passed through. `global` is reserved: global variables come from the account.
- `tls` (string): `required` or `verified`: deliver only over TLS (`verified`: with a valid certificate for the receiving server). Raises the domain's policy, never lowers it.

### Errors

- `validation_error` (HTTP 400): invalid JSON / unknown field
- `invalid_idempotency_key` (HTTP 400): Idempotency-Key must be 1 to 256 bytes
- `domain_not_verified` (HTTP 403): sender domain is not verified for this account
- `restricted_api_key` (HTTP 403): key restricted to another domain or stream
- `account_suspended` (HTTP 403): account is suspended
- `idempotency_key_reused` (HTTP 409)
- `idempotency_request_in_progress` (HTTP 409)
- `payload_too_large` (HTTP 413): request body exceeds 40MB
- `misdirected_cell` (HTTP 421): the account is served by another cell: "this account is served by cell <cell> at <url>", Zap-Cell: <cell>; send to that URL
- `missing_required_field` (HTTP 422)
- `invalid_parameter` (HTTP 422): e.g. too many recipients (max 50), invalid address, bad tags/metadata/stream/scheduled_at, "at least one recipient is required"
- `invalid_attachment` (HTTP 422)
- `template_render_error` (HTTP 422)
- `template_variables_invalid` (HTTP 422): template variables of the wrong type: a, b (checked against the published variable schema)
- `template_variables_missing` (HTTP 422): missing required template variables: a, b (required, no value and no default)
- `rejected` (HTTP 422): the mail transfer agent refused the message: <reason>
- `rate_limit_exceeded` (HTTP 429): rate limit exceeded
- `monthly_quota_exceeded` (HTTP 429): monthly quota exceeded
- `daily_quota_exceeded` (HTTP 429): daily sending limit reached; it resets at 00:00 UTC
- `overloaded` (HTTP 429): server at capacity ("the server is at capacity; retry shortly", Retry-After: 1) or event pipeline backed up ("the event pipeline is backed up; retry shortly", Retry-After: 5); nothing sent, retry
- `service_unavailable` (HTTP 503): a backing store failing over ("a backing service is failing over; retry shortly", Retry-After: 2); MTA unreachable ("mail transfer agent temporarily unavailable, retry"), suppression list being rebuilt ("suppression list is being rebuilt, retry shortly"), or too many large request bodies in flight (Retry-After: 5)

```bash
curl -X POST 'https://api.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Hello from ZapSMTP",
  "html": "<p>It works.</p>"
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## Check what happened

`GET /v1/emails/{id}`

Retrieve one email with per-recipient status and its event timeline.

Requires a full-access key.

Only data inside the plan's log retention is visible. metadata may be null.

### Path parameters

- `id` (string, required): Email id

### Errors

- `restricted_api_key` (HTTP 403)
- `not_found` (HTTP 404): email not found (events can take a few seconds to appear)

```bash
curl 'https://api.zapsmtp.com/v1/emails/019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "email",
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
  "from": "Acme <hello@acme.com>",
  "subject": "Your receipt",
  "created_at": "2026-10-21T15:04:10.902Z",
  "recipients": [
    {
      "email": "jane@example.org",
      "status": "delivered",
      "updated_at": "2026-10-21T15:04:12.381Z",
      "response": "250 2.0.0 OK 1761059052 x7si123"
    }
  ],
  "events": [
    {
      "type": "Reception",
      "status": "queued",
      "recipient": "jane@example.org",
      "time": "2026-10-21T15:04:10.902Z",
      "attempts": 0
    },
    {
      "type": "Delivery",
      "status": "delivered",
      "recipient": "jane@example.org",
      "time": "2026-10-21T15:04:12.381Z",
      "response_code": 250,
      "response": "250 2.0.0 OK 1761059052 x7si123",
      "attempts": 1,
      "mx": "gmail-smtp-in.l.google.com.",
      "peer_addr": "142.250.153.27",
      "tls": "TLSv1.3 TLS_AES_256_GCM_SHA384",
      "egress_source": "ip-1"
    }
  ],
  "stream": "transactional",
  "test": false,
  "metadata": {
    "order_id": "A-1042"
  }
}
```

## API reference

Billing, account settings and [team management](https://zapsmtp.com/docs/teams/) belong to the dashboard and are not in this reference. Team and client-account endpoints (accounts, members, invites) refuse API keys with `403 session_required`.

- [Emails](https://zapsmtp.com/docs/emails/): Send, schedule, batch and inspect email through the ZapSMTP API.
- [Domains](https://zapsmtp.com/docs/domains/): Add and verify sending domains; tracking, reply tracking, brand and reputation.
- [Webhooks](https://zapsmtp.com/docs/webhooks/): Receive signed delivery events, inspect attempts, replay and rotate secrets.
- [Click actions](https://zapsmtp.com/docs/actions/): Named buttons and links: tell clicks apart, describe them and see their activity.
- [Templates](https://zapsmtp.com/docs/templates/): Store email templates with Mustache variables and render previews.
- [Variables](https://zapsmtp.com/docs/variables/): The variable catalogue and the account’s global variables ({{global.key}}).
- [Modules, images & timers](https://zapsmtp.com/docs/template-library/): Saved modules, template images and countdown timers for the visual template editor.
- [Received emails](https://zapsmtp.com/docs/receiving/): Read inbound email: bodies, headers, authentication results and attachments.
- [Inbound setup](https://zapsmtp.com/docs/inbound/): Inbound addresses on managed or own domains, routing rules and stats.
- [Suppressions](https://zapsmtp.com/docs/suppressions/): Addresses ZapSMTP will not send to: hard bounces, complaints, unsubscribes.
- [Statistics](https://zapsmtp.com/docs/stats/): Delivery totals, time series, provider / bounce breakdowns and metrics by domain, stream or tag.
- [API keys & SMTP credentials](https://zapsmtp.com/docs/keys/): Create and revoke API keys and per-application SMTP credentials.
- [Logs & usage](https://zapsmtp.com/docs/logs/): Every API request with its bodies, and this month’s usage against your plan.
- [Simulator & dedicated IPs](https://zapsmtp.com/docs/platform/): Simulator addresses for testing and your dedicated sending IPs.

## Guides

- [SDKs and OpenAPI](https://zapsmtp.com/docs/sdks/): Libraries for Node.js, Python, PHP, Laravel, Go, Ruby, Java and .NET, and the OpenAPI description.
- [AI tools](https://zapsmtp.com/docs/ai-tools/): MCP server, Agent Skills, llms.txt and the CLI for coding assistants.
- [Sending email](https://zapsmtp.com/docs/sending/): Recipients, attachments, inline images, headers, tags, idempotency, scheduling, batches and retries.
- [Domains & DNS setup](https://zapsmtp.com/docs/domain-setup/): DKIM, SPF and DMARC step by step at Cloudflare, GoDaddy, Route 53 and more; troubleshooting.
- [Templates and variables](https://zapsmtp.com/docs/templating/): The template language with worked examples, typed variables with defaults, global values, and sending by id or alias.
- [Receiving email](https://zapsmtp.com/docs/inbound-guide/): Addresses, routes, the inbound webhook, attachments, conversations and replies.
- [Tracking and analytics](https://zapsmtp.com/docs/analytics/): Statuses, opens and clicks, filtering emails, metrics by domain, tag and provider, alerts.
- [Deliverability guide](https://zapsmtp.com/docs/deliverability/): Gmail and Yahoo sender rules, alignment, warm-up, unsubscribe, content and a launch checklist.
- [Recipes](https://zapsmtp.com/docs/recipes/): Ten end-to-end examples: password reset, receipts, welcome series, newsletters, support inbox.
- [Migrating to ZapSMTP](https://zapsmtp.com/docs/migration/): From Resend, SendGrid, Mailgun, Postmark or Amazon SES, with field maps and a rollout plan.
- [Dashboard tour](https://zapsmtp.com/docs/dashboard/): Sending health, email timelines, domains, keys, webhooks and inbound, screen by screen.
- [Email template editor](https://zapsmtp.com/docs/template-editor/): Gallery, visual editor, HTML with live preview, versions and sending by template id.
- [Errors, limits & paging](https://zapsmtp.com/docs/conventions/): Error shape and codes, rate limits, quotas, idempotency, pagination.
- [Testing & simulator](https://zapsmtp.com/docs/testing/): Test keys, simulator scenarios, bounce classification, spam checks.
- [SMTP relay](https://zapsmtp.com/docs/smtp/): Connect any mailer: hosts, ports, credentials and client examples.
- [Webhook events](https://zapsmtp.com/docs/webhook-events/): Event types, payloads, retries and signature verification.
- [Click actions](https://zapsmtp.com/docs/click-actions/): Name buttons and links, receive each click with its action, and route actions to their own endpoints.
- [Teams & client accounts](https://zapsmtp.com/docs/teams/): One login for many accounts: client accounts, invites and roles.
