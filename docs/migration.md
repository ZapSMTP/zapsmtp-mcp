# Migrating to ZapSMTP

> Move from Resend, SendGrid, Mailgun, Postmark or Amazon SES: field and event mappings, templates, webhooks, suppressions, DNS and a safe rollout.

Source: https://zapsmtp.com/docs/migration/

Move sending from Resend, SendGrid, Mailgun, Postmark or Amazon SES without a big-bang switch. Map your request fields and webhook events, convert templates, import suppressions, publish DNS next to your current records, then move traffic a percentage at a time with a rollback ready.

> The fastest path needs no code: if your application already sends over SMTP, change the host and credentials (SMTP relay). For the API, the tables below map every provider's fields and events one by one. Sends, batches and reads below run with a test key (`zap_test_…`) against simulator addresses. Setup and configuration requests (domains, templates, webhooks, suppressions, API keys) change the account and need a full-access live key: a test key gets `403 test_key_restricted`.

## Order of work

1. Add your domain and publish DKIM and SPF next to your existing records.
2. Create a test key (`zap_test_…`) and port the send call using the provider sections below.
3. Convert templates and connect webhooks.
4. Import suppressions before the first live email.
5. Shadow, then roll out by percentage, then cut over, keeping a rollback open.

## Zero-code path: SMTP relay

Applications, CMS plugins and frameworks that send through SMTP move by changing configuration only. SMTP and the API share one pipeline: the same email log, events, webhooks, suppressions and limits. Create an SMTP credential per application; its username starts with `smtp_`, it can only send, and you can revoke it on its own. Choose the stream per message with the `X-Zap-Stream: broadcast` header (default `transactional`). Full details are in [SMTP relay](https://zapsmtp.com/docs/smtp/).

**Point your mailer at ZapSMTP**

Generic:

```
SMTP_HOST=mail.zapsmtp.com
SMTP_PORT=587            # STARTTLS; 2525 also works, 465 for implicit TLS
SMTP_USER=smtp_xxxxxxxxxxxx
SMTP_PASSWORD=…          # shown once when you create the credential
```

Laravel:

```
MAIL_MAILER=smtp
MAIL_HOST=mail.zapsmtp.com
MAIL_PORT=587
MAIL_ENCRYPTION=tls
MAIL_USERNAME=smtp_xxxxxxxxxxxx
MAIL_PASSWORD=…
```

Django:

```
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = "mail.zapsmtp.com"
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.environ["ZAP_SMTP_USER"]
EMAIL_HOST_PASSWORD = os.environ["ZAP_SMTP_PASSWORD"]
```

SMTP is also the route for anything that sends prebuilt MIME, such as SES `SendRawEmail` or Mailgun’s MIME endpoint.

## From Resend

Request fields, the batch endpoint, idempotency keys and event names match, and error bodies also carry Resend’s flat `statusCode`, `name` and `message`, so Resend SDKs parse ZapSMTP errors. In the Node SDK, set `RESEND_BASE_URL` and use a ZapSMTP key. Test the SDK features your code uses (scheduling, templates, attachments) with a test key before switching.

**Request fields: Resend → ZapSMTP**

- **`from, to, cc, bcc, subject, html, text`**: Same names and shapes. Up to 50 recipients across `to`, `cc` and `bcc`.
- **`reply_to (SDK: replyTo)`**: `reply_to`
- **`scheduled_at (SDK: scheduledAt)`**: `scheduled_at`: RFC 3339 or `in 30 minutes`, up to 7 days ahead.
- **`tags [{name, value}]`**: `tags`, same shape. Names and values match `[A-Za-z0-9_-]`.
- **`headers, attachments`**: Same. Attachments take `filename` with `content` (base64) or `path` (HTTPS URL). The whole JSON request is capped at 40 MB, base64 included (about a third larger than the files), and a batch shares that one limit; larger requests get `413 payload_too_large`.
- **`Idempotency-Key header`**: Same header, kept 24 hours per API key.
- **`POST /emails/batch`**: Same endpoint, up to 100 emails.
- **`Authorization: Bearer re_…`**: `Authorization: Bearer zap_…`

**Webhook events: Resend → ZapSMTP**

- **`email.sent, email.delivered, email.delivery_delayed`**: Same names.
- **`email.bounced, email.complained, email.failed`**: Same names. Bounces carry `bounce.type` and `bounce.subType`.
- **`email.opened, email.clicked`**: Same names.
- **`email.received`**: Same name. Metadata only unless the endpoint has `include_content`.
- **`(no equivalent)`**: `email.suppressed`: the send was skipped because the address is on your suppression list.

**Node.js: Resend → ZapSMTP**

Before (Resend):

```
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: 'Acme <hello@acme.com>',
  to: ['jane@example.com'],
  subject: 'Your receipt',
  html: '<p>Thanks for your order.</p>',
  replyTo: 'support@acme.com',
  tags: [{ name: 'category', value: 'receipt' }],
});
```

After: environment:

```
# Server environment: only these two values change
RESEND_BASE_URL=https://api.zapsmtp.com/v1
RESEND_API_KEY=zap_your_api_key
```

After: application code:

```
// Unchanged: the SDK reads RESEND_BASE_URL and sends to ZapSMTP
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: 'Acme <hello@acme.com>',
  to: ['jane@example.com'],
  subject: 'Your receipt',
  html: '<p>Thanks for your order.</p>',
  replyTo: 'support@acme.com',
  tags: [{ name: 'category', value: 'receipt' }],
});
```

After (fetch):

```
const res = await fetch('https://api.zapsmtp.com/v1/emails', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + process.env.ZAP_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from: 'Acme <hello@acme.com>',
    to: ['jane@example.com'],
    subject: 'Your receipt',
    html: '<p>Thanks for your order.</p>',
    reply_to: 'support@acme.com',
    tags: [{ name: 'category', value: 'receipt' }],
  }),
});
const { id } = await res.json();
```

**Python: Resend → ZapSMTP**

Before (Resend):

```
import os, resend

resend.api_key = os.environ["RESEND_API_KEY"]
resend.Emails.send({
    "from": "Acme <hello@acme.com>",
    "to": ["jane@example.com"],
    "subject": "Your receipt",
    "html": "<p>Thanks for your order.</p>",
    "reply_to": "support@acme.com",
})
```

After (ZapSMTP):

```
import os, requests

r = requests.post(
    "https://api.zapsmtp.com/v1/emails",
    headers={"Authorization": f"Bearer {os.environ['ZAP_API_KEY']}"},
    json={
        "from": "Acme <hello@acme.com>",
        "to": ["jane@example.com"],
        "subject": "Your receipt",
        "html": "<p>Thanks for your order.</p>",
        "reply_to": "support@acme.com",
    },
    timeout=30,
)
r.raise_for_status()
email_id = r.json()["id"]
```

**Webhooks.** Resend signs with `svix-id`, `svix-timestamp` and `svix-signature` headers (base64 signatures, base64-decoded secret). ZapSMTP sends `Zap-Signature: t=…,v1=…`: a hex HMAC-SHA256 over `<t>.<raw body>`, keyed with the whole `whsec_…` string, not decoded. Deduplicate on `Zap-Event-Id`. Replace the verification step; the payload handling can stay.

## The same request, sent to ZapSMTP

`POST /v1/emails`

A typical Resend-style send. Field names are unchanged; unknown fields are rejected with `400 validation_error`, so remove anything ZapSMTP does not document.

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
  -H 'Idempotency-Key: order-1042-receipt' \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Your receipt",
  "html": "<p>Thanks for your order.</p>",
  "reply_to": "support@acme.com",
  "tags": [
    {
      "name": "category",
      "value": "receipt"
    }
  ]
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## From SendGrid

SendGrid’s v3 `mail/send` nests recipients in `personalizations`. A single personalization maps to one ZapSMTP email; several personalizations that should each be a separate message map to `POST /emails/batch`. Note that all addresses in one ZapSMTP `to` see each other, as in any normal email.

**Request fields: SendGrid → ZapSMTP**

- **`from {email, name}`**: `from`: `"Acme <hello@acme.com>"`
- **`personalizations[].to / cc / bcc`**: `to`, `cc`, `bcc`. Each personalization that should be a separate email becomes one item in `POST /emails/batch`.
- **`subject`**: `subject`
- **`content [{type: text/plain \| text/html, value}]`**: `text` and `html`
- **`reply_to {email, name}`**: `reply_to`
- **`attachments [{content, filename, type, content_id}]`**: `attachments [{content, filename, content_type, content_id}]`
- **`categories []`**: `tags [{name, value}]`, e.g. `{name: "category", value: "receipt"}`
- **`custom_args {}`**: `metadata`: at most 10 string pairs, returned on the delivery events of that email.
- **`send_at (Unix time)`**: `scheduled_at` (RFC 3339), up to 7 days ahead.
- **`template_id + dynamic_template_data`**: `template: {id, variables}`; see Templates.
- **`tracking_settings`**: `tracking: {opens, clicks}`

**Event Webhook: SendGrid → ZapSMTP**

- **`processed`**: `email.sent`
- **`delivered`**: `email.delivered`
- **`deferred`**: `email.delivery_delayed`
- **`bounce`**: `email.bounced`
- **`dropped`**: `email.suppressed` when the address is suppressed, otherwise `email.failed`
- **`spamreport`**: `email.complained`
- **`open, click`**: `email.opened`, `email.clicked`
- **`unsubscribe`**: No event: the address is added to suppressions with reason `unsubscribe`.

**SendGrid → ZapSMTP**

Before (Node.js, SendGrid):

```
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
await sgMail.send({
  to: 'jane@example.com',
  from: { email: 'hello@acme.com', name: 'Acme' },
  subject: 'Your receipt',
  html: '<p>Thanks for your order.</p>',
  categories: ['receipt'],
  customArgs: { order_id: 'A-1042' },
});
```

After (Node.js):

```
await fetch('https://api.zapsmtp.com/v1/emails', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + process.env.ZAP_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'Acme <hello@acme.com>',
    to: 'jane@example.com',
    subject: 'Your receipt',
    html: '<p>Thanks for your order.</p>',
    tags: [{ name: 'category', value: 'receipt' }],
    metadata: { order_id: 'A-1042' },
  }),
});
```

Before (Python, SendGrid):

```
import os
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

message = Mail(
    from_email=("hello@acme.com", "Acme"),
    to_emails="jane@example.com",
    subject="Your receipt",
    html_content="<p>Thanks for your order.</p>",
)
SendGridAPIClient(os.environ["SENDGRID_API_KEY"]).send(message)
```

After (Python):

```
import os, requests

requests.post(
    "https://api.zapsmtp.com/v1/emails",
    headers={"Authorization": f"Bearer {os.environ['ZAP_API_KEY']}"},
    json={
        "from": "Acme <hello@acme.com>",
        "to": "jane@example.com",
        "subject": "Your receipt",
        "html": "<p>Thanks for your order.</p>",
        "tags": [{"name": "category", "value": "receipt"}],
        "metadata": {"order_id": "A-1042"},
    },
    timeout=30,
).raise_for_status()
```

**Webhooks.** SendGrid posts arrays of events and signs them with an ECDSA key (the `X-Twilio-Email-Event-Webhook-Signature` header). ZapSMTP posts one event per request with an HMAC-SHA256 `Zap-Signature`, so drop the array loop and the public-key check. `custom_args` come back as `data.metadata`.

**Templates.** Dynamic templates use Handlebars; convert conditionals and loops to Mustache sections (table below). Suppression groups have no direct equivalent: an unsubscribe applies to the whole account’s `broadcast` mail (transactional mail still goes out), and broadcast mail carries a one-click `List-Unsubscribe` header automatically.

## Personalizations as a batch

`POST /v1/emails/batch`

Several SendGrid personalizations (or Mailgun recipient variables) become one batch: each item is its own email with its own recipient, subject and metadata. Up to 100 per call.

Requires a full-access or sending-access key. Test keys follow the same rules as for sending.

Per-email error codes use the same classification as POST /emails (domain_not_verified, restricted_api_key, rate_limit_exceeded, monthly_quota_exceeded, etc. appear inside errors[] rather than as the HTTP status). Emails are sent concurrently (up to 16 at a time); each email may have its own scheduled_at.

Body: length 1-100 else 422 invalid_parameter "batch must contain 1 to 100 emails"

An item of `data` carries `reply_to` when reply tracking is on for that email.

### Headers

- `x-batch-validation` (string): strict (default) | permissive (case-insensitive). strict: if any email fails validation nothing is sent and 422 is returned. permissive: valid emails are sent; invalid ones are reported in errors.
- `Idempotency-Key` (string): optional, 1-256 bytes

### Body parameters

- `[ ]` (object[], required): 1–100 emails. Each item takes the fields of [Send an email](https://zapsmtp.com/docs/emails/send-email/).

### Errors

- `validation_error` (HTTP 400): invalid JSON or x-batch-validation not strict/permissive
- `invalid_idempotency_key` (HTTP 400): Idempotency-Key must be 1 to 256 bytes
- `idempotency_key_reused` (HTTP 409)
- `idempotency_request_in_progress` (HTTP 409)
- `payload_too_large` (HTTP 413)
- `invalid_parameter` (HTTP 422): batch size outside 1-100
- `validation_error` (HTTP 422): strict mode, any email invalid
- `service_unavailable` (HTTP 503): too many large bodies in flight

```bash
curl -X POST 'https://api.zapsmtp.com/v1/emails/batch' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '[
  {
    "from": "Acme <hello@acme.com>",
    "to": [
      "delivered@simulator.zapsmtp.com"
    ],
    "subject": "Your order A-1042 shipped",
    "text": "Hi Ann, it is on its way.",
    "metadata": {
      "order_id": "A-1042"
    }
  },
  {
    "from": "Acme <hello@acme.com>",
    "to": [
      "delivered+bob@simulator.zapsmtp.com"
    ],
    "subject": "Your order A-1043 shipped",
    "text": "Hi Bob, it is on its way.",
    "metadata": {
      "order_id": "A-1043"
    }
  }
]'
```

**Response `200 OK`**

```json
{
  "data": [
    {
      "index": 0,
      "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
    },
    {
      "index": 2,
      "id": "019a1f2e-7c3c-7a10-8b21-4d5e6f7a8b9c",
      "suppressed": [
        "old@example.org"
      ]
    }
  ],
  "errors": [
    {
      "index": 1,
      "code": "missing_required_field",
      "message": "subject is required"
    }
  ]
}
```

## From Mailgun

Mailgun’s `/v3/<domain>/messages` takes form fields with `o:`, `h:` and `v:` prefixes and HTTP basic auth. ZapSMTP takes JSON with a bearer key, and the sending domain comes from `from` instead of the URL.

**Request fields: Mailgun → ZapSMTP**

- **`from, to, cc, bcc, subject, text, html`**: Same names, sent as JSON instead of form fields.
- **`h:Reply-To`**: `reply_to`
- **`h:X-My-Header`**: `headers: {"X-My-Header": "…"}`
- **`attachment / inline (files)`**: `attachments`; inline images set `content_id`.
- **`o:tag`**: `tags [{name, value}]`
- **`v:my-var (custom variables)`**: `metadata`
- **`o:deliverytime`**: `scheduled_at`
- **`o:tracking-opens, o:tracking-clicks`**: `tracking: {opens, clicks}`
- **`template + template variables`**: `template: {id, variables}`
- **`recipient-variables (batch sending)`**: One item per recipient in `POST /emails/batch`.

**Webhook events: Mailgun → ZapSMTP**

- **`accepted`**: `email.sent`
- **`delivered`**: `email.delivered`
- **`failed (temporary)`**: `email.delivery_delayed`
- **`failed (permanent)`**: `email.bounced`, or `email.suppressed` for a suppressed address
- **`complained`**: `email.complained`
- **`opened, clicked`**: `email.opened`, `email.clicked`
- **`unsubscribed`**: No event: suppression with reason `unsubscribe`.

**Mailgun → ZapSMTP**

Before (Node.js, Mailgun):

```
const form = new FormData();
form.append('from', 'Acme <hello@acme.com>');
form.append('to', 'jane@example.com');
form.append('subject', 'Your receipt');
form.append('html', '<p>Thanks for your order.</p>');
form.append('o:tag', 'receipt');
form.append('v:order_id', 'A-1042');

await fetch('https://api.mailgun.net/v3/mg.acme.com/messages', {
  method: 'POST',
  headers: { Authorization: 'Basic ' + btoa('api:' + process.env.MAILGUN_API_KEY) },
  body: form,
});
```

After (Node.js):

```
await fetch('https://api.zapsmtp.com/v1/emails', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + process.env.ZAP_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'Acme <hello@acme.com>',
    to: 'jane@example.com',
    subject: 'Your receipt',
    html: '<p>Thanks for your order.</p>',
    tags: [{ name: 'tag', value: 'receipt' }],
    metadata: { order_id: 'A-1042' },
  }),
});
```

Before (Python, Mailgun):

```
import os, requests

requests.post(
    "https://api.mailgun.net/v3/mg.acme.com/messages",
    auth=("api", os.environ["MAILGUN_API_KEY"]),
    data={
        "from": "Acme <hello@acme.com>",
        "to": "jane@example.com",
        "subject": "Your receipt",
        "html": "<p>Thanks for your order.</p>",
        "o:tag": "receipt",
        "v:order_id": "A-1042",
    },
)
```

After (Python):

```
import os, requests

requests.post(
    "https://api.zapsmtp.com/v1/emails",
    headers={"Authorization": f"Bearer {os.environ['ZAP_API_KEY']}"},
    json={
        "from": "Acme <hello@acme.com>",
        "to": "jane@example.com",
        "subject": "Your receipt",
        "html": "<p>Thanks for your order.</p>",
        "tags": [{"name": "tag", "value": "receipt"}],
        "metadata": {"order_id": "A-1042"},
    },
    timeout=30,
).raise_for_status()
```

**Webhooks.** Mailgun puts a `signature` object (`timestamp`, `token`, `signature`) inside the JSON body and the event in `event-data`. ZapSMTP signs in the `Zap-Signature` header and puts the event fields in `data`. Permanent and temporary failures are separate event types in ZapSMTP instead of a `severity` field.

## Tags, metadata and scheduling

`POST /v1/emails`

`o:tag`, `v:` variables and `o:deliverytime` map to `tags`, `metadata` and `scheduled_at`. Metadata comes back on the delivery events of the email.

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
  "to": "delivered@simulator.zapsmtp.com",
  "subject": "Your weekly summary",
  "html": "<p>Here is your week.</p>",
  "tags": [
    {
      "name": "tag",
      "value": "weekly-summary"
    }
  ],
  "metadata": {
    "user_id": "u_42"
  },
  "scheduled_at": "in 10 minutes",
  "tracking": {
    "opens": true,
    "clicks": true
  }
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## From Postmark

Postmark uses PascalCase fields; ZapSMTP uses snake_case. Message streams map to `stream`: `transactional` or `broadcast`, each on its own IP pool. Postmark templates are Mustache-based, so most of them move with few or no changes.

**Request fields: Postmark → ZapSMTP**

- **`From, To, Cc, Bcc, Subject`**: `from`, `to`, `cc`, `bcc`, `subject`. Comma-separated lists become arrays.
- **`ReplyTo`**: `reply_to`
- **`HtmlBody, TextBody`**: `html`, `text`
- **`Headers [{Name, Value}]`**: `headers: {"Name": "Value"}`
- **`Attachments [{Name, Content, ContentType, ContentID}]`**: `attachments [{filename, content, content_type, content_id}]`
- **`Tag`**: `tags: [{name: "tag", value: "…"}]`. Values allow letters, digits, `_` and `-` only.
- **`Metadata`**: `metadata` (at most 10 keys)
- **`MessageStream`**: `stream`: `transactional` or `broadcast`
- **`TrackOpens, TrackLinks`**: `tracking: {opens, clicks}`
- **`TemplateAlias / TemplateId + TemplateModel`**: `template: {id, variables}`; `id` accepts a template id or alias.
- **`X-Postmark-Server-Token header`**: `Authorization: Bearer zap_…`

**Webhooks: Postmark RecordType → ZapSMTP**

- **`Delivery`**: `email.delivered`
- **`Bounce (hard)`**: `email.bounced` with `bounce.type: "Permanent"`
- **`Bounce (soft / transient)`**: `email.delivery_delayed` while retrying; `email.bounced` when retries run out
- **`SpamComplaint`**: `email.complained`
- **`Open, Click`**: `email.opened`, `email.clicked`
- **`SubscriptionChange`**: No event: suppression with reason `unsubscribe`.

**Postmark → ZapSMTP**

Before (Node.js, Postmark):

```
import { ServerClient } from 'postmark';

const client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN);
await client.sendEmailWithTemplate({
  From: 'Acme <hello@acme.com>',
  To: 'jane@example.com',
  TemplateAlias: 'receipt',
  TemplateModel: { name: 'Jane', order_id: 'A-1042' },
  MessageStream: 'outbound',
});
```

After (Node.js):

```
await fetch('https://api.zapsmtp.com/v1/emails', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + process.env.ZAP_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'Acme <hello@acme.com>',
    to: 'jane@example.com',
    template: { id: 'receipt', variables: { name: 'Jane', order_id: 'A-1042' } },
    stream: 'transactional',
  }),
});
```

Before (Python, Postmark):

```
import os, requests

requests.post(
    "https://api.postmarkapp.com/email/withTemplate",
    headers={"X-Postmark-Server-Token": os.environ["POSTMARK_SERVER_TOKEN"]},
    json={
        "From": "Acme <hello@acme.com>",
        "To": "jane@example.com",
        "TemplateAlias": "receipt",
        "TemplateModel": {"name": "Jane", "order_id": "A-1042"},
    },
)
```

After (Python):

```
import os, requests

requests.post(
    "https://api.zapsmtp.com/v1/emails",
    headers={"Authorization": f"Bearer {os.environ['ZAP_API_KEY']}"},
    json={
        "from": "Acme <hello@acme.com>",
        "to": "jane@example.com",
        "template": {"id": "receipt", "variables": {"name": "Jane", "order_id": "A-1042"}},
    },
    timeout=30,
).raise_for_status()
```

**Webhooks.** ZapSMTP signs every request; verify `Zap-Signature` as shown in [Webhook events](https://zapsmtp.com/docs/webhook-events/#signatures) instead of relying on URL credentials. Switch your handler from `RecordType` to `type`.

## Send with a stored template

`POST /v1/emails`

Postmark `TemplateAlias` + `TemplateModel`, SendGrid `template_id` + `dynamic_template_data` and SES `TemplateName` + `TemplateData` all become `template: {id, variables}`. The template must be published, and every variable it substitutes must be supplied; a missing section condition simply counts as false.

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
  "to": "delivered@simulator.zapsmtp.com",
  "template": {
    "id": "welcome",
    "variables": {
      "first_name": "Ann"
    }
  }
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## From Amazon SES

SES v2 `SendEmail` wraps content in `Content.Simple`, `Content.Raw` or `Content.Template` and is signed with AWS credentials. ZapSMTP uses a flat JSON body and an API key. Events arrive as webhooks directly, without a configuration set or an SNS topic in between.

**Request fields: SES v2 → ZapSMTP**

- **`FromEmailAddress`**: `from`
- **`Destination.ToAddresses / CcAddresses / BccAddresses`**: `to`, `cc`, `bcc`
- **`ReplyToAddresses`**: `reply_to`
- **`Content.Simple.Subject / Body.Html / Body.Text`**: `subject`, `html`, `text`
- **`Content.Raw (MIME)`**: No raw MIME field in the API: send prebuilt MIME through the [SMTP relay](https://zapsmtp.com/docs/smtp/).
- **`Content.Template (TemplateName, TemplateData)`**: `template: {id, variables}`; `variables` is an object, not a JSON string.
- **`EmailTags [{Name, Value}]`**: `tags [{name, value}]`
- **`ConfigurationSetName`**: Not needed: events go to the [webhooks](https://zapsmtp.com/docs/webhooks/) you subscribe; tracking is set per domain or with `tracking`.

**Event types: SES → ZapSMTP**

- **`Send`**: `email.sent`
- **`Delivery`**: `email.delivered`
- **`DeliveryDelay`**: `email.delivery_delayed`
- **`Bounce`**: `email.bounced`
- **`Complaint`**: `email.complained`
- **`Reject, Rendering Failure`**: `email.failed`; template errors are returned synchronously as `422 template_render_error`
- **`Open, Click`**: `email.opened`, `email.clicked`

**Amazon SES v2 → ZapSMTP**

Before (Node.js, SES v2):

```
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const ses = new SESv2Client({ region: 'us-east-1' });
await ses.send(new SendEmailCommand({
  FromEmailAddress: 'Acme <hello@acme.com>',
  Destination: { ToAddresses: ['jane@example.com'] },
  Content: {
    Simple: {
      Subject: { Data: 'Your receipt' },
      Body: { Html: { Data: '<p>Thanks for your order.</p>' } },
    },
  },
  EmailTags: [{ Name: 'category', Value: 'receipt' }],
}));
```

After (Node.js):

```
await fetch('https://api.zapsmtp.com/v1/emails', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + process.env.ZAP_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'Acme <hello@acme.com>',
    to: ['jane@example.com'],
    subject: 'Your receipt',
    html: '<p>Thanks for your order.</p>',
    tags: [{ name: 'category', value: 'receipt' }],
  }),
});
```

Before (Python, SES v2):

```
import boto3

ses = boto3.client("sesv2", region_name="us-east-1")
ses.send_email(
    FromEmailAddress="Acme <hello@acme.com>",
    Destination={"ToAddresses": ["jane@example.com"]},
    Content={"Simple": {
        "Subject": {"Data": "Your receipt"},
        "Body": {"Html": {"Data": "<p>Thanks for your order.</p>"}},
    }},
    EmailTags=[{"Name": "category", "Value": "receipt"}],
)
```

After (Python):

```
import os, requests

requests.post(
    "https://api.zapsmtp.com/v1/emails",
    headers={"Authorization": f"Bearer {os.environ['ZAP_API_KEY']}"},
    json={
        "from": "Acme <hello@acme.com>",
        "to": ["jane@example.com"],
        "subject": "Your receipt",
        "html": "<p>Thanks for your order.</p>",
        "tags": [{"name": "category", "value": "receipt"}],
    },
    timeout=30,
).raise_for_status()
```

**Webhooks.** Instead of confirming an SNS subscription and validating SNS message signatures, verify one HMAC header. Bounce details move from `bounce.bounceType` / `bounceSubType` to `data.bounce.type` (`Permanent`, `Transient`, `Undetermined`) and `data.bounce.subType`; see the [bounce classification](https://zapsmtp.com/docs/testing/#bounces).

**Suppressions.** Export the account-level suppression list (bounces and complaints) and import it as shown below.

## Templates

ZapSMTP templates are logic-less Mustache. Templates from Postmark (Mustache-based) usually carry over; Handlebars templates from SendGrid, Mailgun and SES need their conditionals, loops and helpers rewritten. Templates have a draft and a published version, and sends always use the published one: create with `"publish": true` or [publish](https://zapsmtp.com/docs/templates/publish-template/) after review. Handlebars tags are refused on save: `{{#each items}}`, `{{> footer}}` or `{{first name}}` return `422 template_render_error` *html: line L, column C: {{…}} is not a variable name*, with the position of the first one to rewrite. A required variable must be supplied on send: a missing one returns `422 template_variables_missing` instead of an empty string. A missing section condition (`{{#vip}}`) counts as false, variables inside a section that is skipped are not evaluated, and `zap:` placeholders are never required. Rendering works with a test key; creating and publishing templates needs a full-access live key.

**Handlebars-style → ZapSMTP**

- **`{{name}} / {{{html}}}`**: Same: escaped and raw.
- **`{{user.first_name}}`**: Same: dotted paths work.
- **`{{#if vip}}…{{/if}}`**: `{{#vip}}…{{/vip}}`: a section renders when the value is truthy.
- **`{{else}} / {{#unless x}}`**: An inverted section: `{{^x}}…{{/x}}`.
- **`{{#each items}}{{this.name}}{{/each}}`**: `{{#items}}{{name}}{{/items}}`; `{{.}}` is the current item of a list of strings.
- **`Helpers ({{formatDate …}}, {{#equals}} …)`**: None: templates are logic-less. Format values before you send them.
- **`%recipient.name% (Mailgun batch variables)`**: `{{name}}` with a separate batch item per recipient.
- **`Unsubscribe placeholders`**: `{{{zap:unsubscribe_url}}}` becomes the recipient’s signed one-click unsubscribe link.

**Convert a template**

Before (Handlebars-style):

```
<p>Hi {{customer.first_name}},</p>
{{#if vip}}<p>Your VIP discount is applied.</p>{{else}}<p>Join VIP for 10% off.</p>{{/if}}
<ul>
{{#each items}}<li>{{this.name}} × {{this.qty}}</li>{{/each}}
</ul>
```

After (ZapSMTP Mustache):

```
<p>Hi {{customer.first_name}},</p>
{{#vip}}<p>Your VIP discount is applied.</p>{{/vip}}{{^vip}}<p>Join VIP for 10% off.</p>{{/vip}}
<ul>
{{#items}}<li>{{name}} × {{qty}}</li>{{/items}}
</ul>
<p><a href="{{{zap:unsubscribe_url}}}">Unsubscribe</a></p>
```

## Check a converted template

`POST /v1/templates/render`

Render converted source with sample data before you save it. Syntax errors and the resulting subject, HTML and text come back without sending anything. Rendering works with a test key; saving templates needs a full-access live key.

Requires a full-access key.

### Body parameters

- `subject` (string)
- `html` (string)
- `text` (string)
- `variables` (object): Default `{}`.

### Errors

- `restricted_api_key` (HTTP 403)
- `template_render_error` (HTTP 422): <field>: <syntax error>

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates/render' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "subject": "Order {{order_id}}",
  "html": "<p>Hi {{customer.first_name}},</p>{{#vip}}<p>VIP discount applied.</p>{{/vip}}{{^vip}}<p>Join VIP for 10% off.</p>{{/vip}}<ul>{{#items}}<li>{{name}} × {{qty}}</li>{{/items}}</ul>",
  "variables": {
    "order_id": "A-1042",
    "customer": {
      "first_name": "Ann"
    },
    "vip": false,
    "items": [
      {
        "name": "Mug",
        "qty": 2
      },
      {
        "name": "Tea",
        "qty": 1
      }
    ]
  }
}'
```

**Response `200 OK`**

```json
{
  "subject": "Hello Jane",
  "html": "<p>Welcome, Jane!</p>",
  "text": "",
  "missing_variables": [
    "plan"
  ],
  "variable_names": [
    "name",
    "plan"
  ],
  "design": null
}
```

## Webhooks during the transition

Run both providers’ endpoints side by side and normalize events into the shape your application already uses. ZapSMTP sends one event per recipient (`data.to` is a single address), retries failures for about 28 hours and keeps the event id stable in `Zap-Event-Id`. The delivery events of an email you sent (`email.sent` through `email.suppressed`) carry its `tags` and `metadata`. `email.replied` carries the tags but not the metadata, and inbound and conversation events (`email.received`, `thread.*`) have their own payloads; see [Webhook events](https://zapsmtp.com/docs/webhook-events/). Creating a webhook needs a live key.

**Normalize ZapSMTP events**

Node.js:

```javascript
// One handler for both providers while traffic is split.
// ZapSMTP posts one JSON event per request and per recipient; verify
// Zap-Signature first (see /docs/webhook-events/#signatures).
const ZAP = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'deferred',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.suppressed': 'dropped',
  'email.failed': 'dropped',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
};

export function fromZap(event) {
  const kind = ZAP[event.type];
  if (!kind) return null;
  return {
    kind,
    email: event.data.to,                 // a single address
    messageId: event.data.email_id,
    permanent: event.data.bounce?.type === 'Permanent',
    meta: event.data.metadata ?? {},      // your former custom args
  };
}
```

Python:

```python
ZAP = {
    "email.delivered": "delivered",
    "email.delivery_delayed": "deferred",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.suppressed": "dropped",
    "email.failed": "dropped",
    "email.opened": "opened",
    "email.clicked": "clicked",
}

def from_zap(event: dict) -> dict | None:
    kind = ZAP.get(event["type"])
    if kind is None:
        return None
    data = event["data"]
    return {
        "kind": kind,
        "email": data["to"],                       # a single address
        "message_id": data["email_id"],
        "permanent": (data.get("bounce") or {}).get("type") == "Permanent",
        "meta": data.get("metadata") or {},
    }
```

## Subscribe your webhook endpoint

`POST /v1/webhooks`

Point a new endpoint, or a new path on your existing handler, at ZapSMTP and keep the old provider’s endpoint running until cutover. The response contains the `whsec_…` signing secret.

Requires a full-access live key; test keys get 403 test_key_restricted.

The secret is also readable later via GET /webhooks/{id}.

To send clicks of one button to this endpoint: `{"events": ["email.clicked"], "filter": {"actions": ["confirm_order"]}}`. Endpoints always return `filter`, with an empty list when there is none.

### Body parameters

- `url` (string, required): Absolute https:// URL. Limits: 422 invalid_parameter "url must be an absolute https:// URL"
- `events` (string[]): Limits: unknown type → 422 invalid_parameter "unknown event type <x>; allowed: ..." One of `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.opened`, `email.clicked`, `email.suppressed`, `email.received`, `thread.created`, `thread.replied`, `email.replied`. Default `all event types`.
- `include_content` (boolean): `email.received` carries the message: text, html, headers, and download links (valid 24 hours) for the attachments and the raw .eml; text and html are cut at 1 MB in total (`truncated: true`). Default `false`.
- `batch` (boolean): Send events up to 100 per request (or every second) as a JSON array, signed as one body; `Zap-Event-Id` is the batch id, each event keeps its own `id`. `email.received` with the full message still arrives alone. Default `false`.
- `filter` (object): Narrows `email.clicked` to some [click actions](https://zapsmtp.com/docs/click-actions/); other event types are not affected. Empty or absent: every click. Default `{"actions": []}`.
  - `actions` (string[]): Action names (lowercase letters, digits, `_`, `.` and `-`, starting with a letter or digit, up to 64 characters). The endpoint then receives `email.clicked` only for links with one of these actions. Limits: more than 50 → 422 invalid_parameter "filter.actions: at most 50"; a bad name → 422 invalid_parameter "filter.actions: <name> is not an action name"

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `invalid_parameter` (HTTP 422)

```bash
curl -X POST 'https://api.zapsmtp.com/v1/webhooks' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "url": "https://acme.com/hooks/zapsmtp",
  "events": [
    "email.delivered",
    "email.delivery_delayed",
    "email.bounced",
    "email.complained",
    "email.suppressed",
    "email.failed"
  ]
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f22-6e7f-7091-8a2b-3c4d5e6f7a8b",
  "url": "https://acme.com/hooks/zapsmtp",
  "secret": "whsec_Q7v2Lk9Xp4Rb1Tz8Mw3Nc6Hy0Fd5Gs2J",
  "events": [
    "email.delivered",
    "email.bounced",
    "email.complained"
  ],
  "enabled": true,
  "disabled_reason": null,
  "created_at": "2026-10-21T15:40:00Z",
  "include_content": false,
  "batch": false,
  "filter": {
    "actions": []
  }
}
```

## Import suppressions

Bring over hard bounces, complaints and unsubscribes before the first live email, so nobody who opted out or bounced is mailed again. Export them from your current provider (dashboard or API) as one address per line. `POST /suppressions/batch` takes up to 1,000 addresses per call and needs a full-access live key (test keys cannot change suppressions); imported entries use reason `manual` (stops every stream) or `unsubscribe` (stops broadcast mail only), while `hard_bounce` and `complaint` are set only by ZapSMTP itself. Sends to a suppressed address are skipped and reported as `email.suppressed`.

**Import a suppression export**

Node.js:

```javascript
// node import-suppressions.mjs suppressed.txt  (one address per line)
import { readFileSync } from 'node:fs';

const API = 'https://api.zapsmtp.com/v1';
const emails = [...new Set(readFileSync(process.argv[2], 'utf8')
  .split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < emails.length; i += 1000) {
  const chunk = emails.slice(i, i + 1000);
  for (;;) {
    const res = await fetch(API + '/suppressions/batch', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.ZAP_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: chunk, reason: 'manual' }),
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep(1000 * Number(res.headers.get('Retry-After') ?? 1));
      continue;
    }
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()));
    const { added } = await res.json();
    console.log('rows', i, '-', i + chunk.length, 'added', added);
    break;
  }
  await sleep(200); // stay well under the rate limit
}
```

Python:

```python
# python import_suppressions.py suppressed.txt  (one address per line)
import os, sys, time, requests

API = "https://api.zapsmtp.com/v1"
with open(sys.argv[1]) as f:
    emails = sorted({line.strip().lower() for line in f if line.strip()})

s = requests.Session()
s.headers["Authorization"] = f"Bearer {os.environ['ZAP_API_KEY']}"
for i in range(0, len(emails), 1000):
    chunk = emails[i:i + 1000]
    while True:
        r = s.post(f"{API}/suppressions/batch",
                   json={"emails": chunk, "reason": "manual"}, timeout=60)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(int(r.headers.get("Retry-After", "1")))
            continue
        r.raise_for_status()
        print(f"rows {i}-{i + len(chunk)} added {r.json()['added']}")
        break
    time.sleep(0.2)  # stay well under the rate limit
```

## Import suppressions in bulk

`POST /v1/suppressions/batch`

Up to 1,000 addresses per call. Duplicates and addresses already on the list are kept as they are (except that a `manual` entry replaces an `unsubscribe`), so re-running an import is safe. `reason` is `manual`, which stops every stream, or `unsubscribe`, which stops broadcast mail only.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Body parameters

- `emails` (string[], required): 1–1,000 addresses.
- `reason` (string): `manual`: no email at all; `unsubscribe`: no broadcast email (transactional email still goes out). One of `manual`, `unsubscribe`. Default `manual`.

### Errors

- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `invalid_parameter` (HTTP 422): Empty or over 1,000 addresses, an invalid address, or an unknown reason.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/suppressions/batch' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "emails": [
    "old-bounce@example.com",
    "complainer@example.net"
  ],
  "reason": "manual"
}'
```

**Response `201 Created`**

```json
{
  "object": "suppression_batch",
  "added": 2,
  "reason": "manual",
  "emails": [
    "ann@example.com",
    "bob@example.com"
  ]
}
```

## Import unsubscribes

`POST /v1/suppressions/batch`

Import marketing opt-outs with `reason: "unsubscribe"`: they then stop broadcast mail only, so receipts and password resets still reach those people. Import bounces and complaints as `manual`.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Body parameters

- `emails` (string[], required): 1–1,000 addresses.
- `reason` (string): `manual`: no email at all; `unsubscribe`: no broadcast email (transactional email still goes out). One of `manual`, `unsubscribe`. Default `manual`.

### Errors

- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `invalid_parameter` (HTTP 422): Empty or over 1,000 addresses, an invalid address, or an unknown reason.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/suppressions/batch' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "emails": [
    "opted-out@example.com"
  ],
  "reason": "unsubscribe"
}'
```

**Response `201 Created`**

```json
{
  "object": "suppression_batch",
  "added": 2,
  "reason": "manual",
  "emails": [
    "ann@example.com",
    "bob@example.com"
  ]
}
```

## Migration plan

## 1. DNS side by side

Both providers can sign and send for the same domain at the same time. Adding and verifying a domain needs a full-access live key. Add ZapSMTP’s DKIM key under its own `zap` selector and leave the old provider’s key in place. A domain has one SPF record, so add the ZapSMTP include to it rather than publishing a second record, and keep the old include until the old provider sends nothing. Keep your DMARC record as it is. Live keys can send only from verified domains.

**Zone records through the migration**

Before:

```
acme.com.                TXT    "v=spf1 include:<old provider> ~all"
<old selector>._domainkey.acme.com.  CNAME/TXT  <old provider's DKIM key>
_dmarc.acme.com.         TXT    "v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.com"
```

During migration:

```
; one SPF record, both includes (SPF allows one record per name)
acme.com.                TXT    "v=spf1 include:<old provider> include:_spf.zapsmtp.com ~all"
; keep the old DKIM key and add ZapSMTP's: different selectors coexist
<old selector>._domainkey.acme.com.  CNAME/TXT  <old provider's DKIM key>
zap._domainkey.acme.com. TXT    "v=DKIM1; k=rsa; p=MIIBIjANBgkq…"
; DMARC unchanged: keep your existing policy and reports
_dmarc.acme.com.         TXT    "v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.com"
```

After cutover:

```
acme.com.                TXT    "v=spf1 include:_spf.zapsmtp.com ~all"
zap._domainkey.acme.com. TXT    "v=DKIM1; k=rsa; p=MIIBIjANBgkq…"
_dmarc.acme.com.         TXT    "v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.com"
```

## Add your sending domain

`POST /v1/domains`

Returns the DKIM, SPF and DMARC records. The DKIM selector is `zap`, so it sits next to your current provider’s key without conflict.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Body parameters

- `name` (string, required): Domain name (lowercased, trailing dot removed). Limits: valid hostname <=253 chars, else 422 invalid_parameter "invalid domain name"

### Errors

- `plan_limit_reached` (HTTP 403): the <Plan> plan includes <n> domains; upgrade your plan to add more
- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `conflict` (HTTP 409): domain already added
- `invalid_parameter` (HTTP 422): invalid domain name

```bash
curl -X POST 'https://api.zapsmtp.com/v1/domains' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "acme.com"
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f10-8a10-7b22-8c31-5d2e9f0a4b17",
  "name": "acme.com",
  "status": "pending",
  "dkim_selector": "zap",
  "dkim_verified": false,
  "spf_verified": false,
  "dmarc_verified": false,
  "open_tracking": false,
  "click_tracking": false,
  "from_name": "",
  "tls": "opportunistic",
  "reply_tracking": false,
  "reply_domain": "",
  "reply_forward_to": "",
  "brand_updated_at": null,
  "last_checked_at": null,
  "verified_at": null,
  "created_at": "2026-10-21T13:58:02Z",
  "zone": "acme.com",
  "records": [
    {
      "record": "DKIM",
      "type": "TXT",
      "name": "zap._domainkey.acme.com",
      "value": "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...",
      "required": true,
      "status": "pending"
    },
    {
      "record": "SPF",
      "type": "TXT",
      "name": "acme.com",
      "value": "v=spf1 include:_spf.zapsmtp.com ~all",
      "required": false,
      "status": "pending"
    },
    {
      "record": "DMARC",
      "type": "TXT",
      "name": "_dmarc.acme.com",
      "value": "v=DMARC1; p=none;",
      "required": false,
      "status": "pending"
    }
  ]
}
```

## 2. Test keys, simulator and shadow traffic

A test key can send and read, but not change the account. It accepts any From domain, runs validation, stored templates, the email log, events and webhooks exactly like a live key, never delivers and does not count against your plan. Use it first against [simulator addresses](https://zapsmtp.com/docs/testing/) to exercise every webhook path, then mirror production requests to catch fields or templates that do not convert. Filter shadow traffic with `GET /emails?mode=test` and the [request log](https://zapsmtp.com/docs/logs/list-logs/).

## Test before any traffic moves

`POST /v1/emails`

Send with a test key (`zap_test_…`) to simulator addresses: bounces, complaints and delays reach your webhook within seconds without touching real recipients or your reputation.

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
    "delivered@simulator.zapsmtp.com",
    "bounced@simulator.zapsmtp.com",
    "complained@simulator.zapsmtp.com"
  ],
  "subject": "Migration check",
  "text": "Webhook and suppression handling test."
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

**Mirror production sends with a test key**

Node.js:

```javascript
// Shadow: keep sending live through the old provider and replay every
// request to ZapSMTP with a test key (zap_test_…). Test keys run validation,
// templates, the email log and webhooks, deliver nothing and are not counted.
export async function send(msg) {
  const result = await oldProvider.send(msg);           // still the source of truth
  fetch('https://api.zapsmtp.com/v1/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.ZAP_TEST_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(toZap(msg)),
  })
    .then(async (r) => { if (!r.ok) log.warn('zapsmtp shadow', r.status, await r.text()); })
    .catch((e) => log.warn('zapsmtp shadow', e.message));  // never affects the user
  return result;
}
```

Python:

```python
import os, threading, requests

def send(msg: dict):
    result = old_provider.send(msg)  # still the source of truth
    def shadow():
        try:
            r = requests.post("https://api.zapsmtp.com/v1/emails", timeout=10,
                              headers={"Authorization": f"Bearer {os.environ['ZAP_TEST_KEY']}"},
                              json=to_zap(msg))
            if not r.ok:
                log.warning("zapsmtp shadow %s %s", r.status_code, r.text)
        except requests.RequestException as e:
            log.warning("zapsmtp shadow %s", e)
    threading.Thread(target=shadow, daemon=True).start()
    return result
```

## 3. Percentage rollout

Switch a growing share of recipients to a live key: 1%, 10%, 50%, then all. Bucketing by recipient keeps each address on one provider, which keeps its events and suppressions in one place. Send an `Idempotency-Key` so a retried request never sends twice; a `429` or `5xx` means nothing was accepted, so a retry or fallback is safe. A `200` with `unconfirmed: true` counts as sent and must not be retried.

**Route a percentage of traffic**

Node.js:

```javascript
import { createHash } from 'node:crypto';

// ZAP_PERCENT: 0 → 1 → 10 → 50 → 100. Hashing the recipient keeps each
// address on one provider, so its events and suppressions stay in one place.
const bucket = (email) => createHash('sha256').update(email.toLowerCase()).digest().readUInt16BE(0) % 100;

export async function send(msg, idempotencyKey) {
  if (bucket(msg.to) >= Number(process.env.ZAP_PERCENT ?? 0)) return oldProvider.send(msg);
  const res = await fetch('https://api.zapsmtp.com/v1/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.ZAP_API_KEY,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,   // safe to retry
    },
    body: JSON.stringify(toZap(msg)),
  });
  if (res.ok) return res.json();
  // 429 and 5xx mean nothing was accepted: retry later, or fall back once
  if (res.status === 429 || res.status >= 500) return oldProvider.send(msg);
  throw new Error('ZapSMTP ' + res.status + ': ' + (await res.text())); // 4xx: fix the request
}
```

Python:

```python
import hashlib, os, requests

def bucket(email: str) -> int:
    return int.from_bytes(hashlib.sha256(email.lower().encode()).digest()[:2], "big") % 100

def send(msg: dict, idempotency_key: str):
    if bucket(msg["to"]) >= int(os.environ.get("ZAP_PERCENT", "0")):
        return old_provider.send(msg)
    r = requests.post("https://api.zapsmtp.com/v1/emails", timeout=30, json=to_zap(msg), headers={
        "Authorization": f"Bearer {os.environ['ZAP_API_KEY']}",
        "Idempotency-Key": idempotency_key,
    })
    if r.ok:
        return r.json()
    if r.status_code == 429 or r.status_code >= 500:  # nothing was accepted
        return old_provider.send(msg)
    raise RuntimeError(f"ZapSMTP {r.status_code}: {r.text}")  # 4xx: fix the request
```

Between steps, compare delivery, bounce and complaint rates for the two providers using [statistics](https://zapsmtp.com/docs/stats/), and check the [deliverability guide](https://zapsmtp.com/docs/deliverability/) if you send high volumes from new IPs.

## 4. Cutover checklist

- Domain verified: DKIM shows verified, SPF includes ZapSMTP, DMARC reports show ZapSMTP mail passing.
- Live API keys created per application and environment; SMTP credentials per application.
- Every template converted, rendered with real data and published.
- Webhook endpoint subscribed, signatures verified, duplicates skipped by `Zap-Event-Id`, a test event received ([send one](https://zapsmtp.com/docs/webhooks/test-webhook/)).
- Suppressions imported, including any added on the old provider during the rollout.
- Error handling covers `422` validation errors, `429` with `Retry-After`, and quota errors; see [Errors, limits & paging](https://zapsmtp.com/docs/conventions/).
- Rollout at 100% for a full sending cycle (daily and weekly jobs included) with stable rates.
- Then remove the old provider’s SPF include and DKIM record, and revoke its keys.

## 5. Rollback

Until the old provider’s DNS and keys are removed, rollback is a configuration change: set the rollout percentage to 0 (or point the SMTP host back). Before you resume on the old provider, copy over the suppressions ZapSMTP collected (bounces, complaints and one-click unsubscribes) so those recipients stay excluded. Webhook retries for emails already sent through ZapSMTP keep arriving, so leave the ZapSMTP endpoint running until they finish.

## Export suppressions for a rollback

`GET /v1/suppressions`

Page through the list with `after=next_cursor` and add the addresses to the previous provider, so recipients who bounced, complained or unsubscribed on ZapSMTP stay excluded there too.

Requires a full-access key.

`reason` is `hard_bounce`, `complaint`, `unsubscribe` or `manual`; `source_id` is the email that caused it (`null` when added by hand). Pass `next_cursor` as `after` for the next page.

`unsubscribe` stops only broadcast email (`stream: broadcast`); transactional email to the address still goes out. Every other reason stops all email to it.

### Query parameters

- `limit` (integer): 1-1000; out-of-range falls back to 100. Default `100`.
- `after` (string): Opaque cursor from next_cursor. Limits: 422 invalid_parameter "invalid after cursor"
- `before` (string): Legacy: RFC 3339 timestamp; returns entries created before it. Ignored when after is set. Limits: 422 invalid_parameter "before must be RFC3339"

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422)

```bash
curl 'https://api.zapsmtp.com/v1/suppressions?limit=1000' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": true,
  "data": [
    {
      "email": "old@example.org",
      "reason": "hard_bounce",
      "source_id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
      "created_at": "2026-10-21T15:04:13Z"
    },
    {
      "email": "angry@example.net",
      "reason": "complaint",
      "source_id": "019a1f2a-1b2c-7d3e-8f4a-5b6c7d8e9f00",
      "created_at": "2026-10-21T11:20:40Z"
    }
  ],
  "next_cursor": "MTc2MTA0NzI0MDAwMDAwMDAwMHxhbmdyeUBleGFtcGxlLm5ldA"
}
```
