# Tracking and analytics

> Follow every ZapSMTP email from acceptance to click: statuses, open and click tracking, timelines, metrics by domain, tag or provider, and alerts.

Source: https://zapsmtp.com/docs/analytics/

Every recipient of every email gets its own trail of events: accepted, delayed, delivered or bounced, then opened, clicked or reported as spam. Read that trail per email, list and filter emails, pull aggregated metrics with rates, or receive each event as a webhook the moment it happens.

![The dashboard overview: sent, delivered, bounced and complaint counts with delivery, open and click rates and a chart of the last days](https://zapsmtp.com/docs/img/overview-light.webp)

The dashboard’s overview is built from the same data as the API calls on this page.

> Analytics cover live traffic. Mail sent with test keys (`zap_test_…`) appears in the email list and timelines (filter it with `mode=test`) and fires webhooks with `test: true`, but is left out of `/stats` and `/metrics`.

## The life of a recipient

Statuses belong to recipients, not to emails: an email to three people has three trails. Each event changes the recipient’s status to the event’s status, so the status you read is always the *latest* event, not the “best” one. A recipient who opened a delivered email shows `opened`; one who later reports it as spam shows `complained`.

A typical trail is `queued` → `delivered` → `opened` → `clicked`. A slow receiver adds one or more `delivery_delayed` before `delivered` or `bounced`. An address on your suppression list goes straight to `suppressed` and is never sent.

**Statuses and events**

- **Status (Webhook event)**: **Timeline `type`** · **Meaning** · **Ends delivery**
- **`queued` (email.sent)**: `Reception` · Accepted for delivery. One per recipient. · No
- **`delivery_delayed` (email.delivery_delayed)**: `TransientFailure` · The receiving server answered with a temporary failure (4xx) or could not be reached. We keep retrying; this can repeat. · No
- **`delivered` (email.delivered)**: `Delivery` · The receiving server accepted the message (2xx). Its reply is in response. · Yes
- **`bounced` (email.bounced)**: `Bounce, Expiration, OOB, AdminBounce` · Permanently rejected, retries ran out (subType Expired), the message was withdrawn from the queue, or a bounce email arrived later for a message that had been delivered (OOB). · Yes
- **`failed` (email.failed)**: `Rejection` · Rejected before sending. A scheduled email also fails when its account or key is no longer valid at send time. · Yes
- **`suppressed` (email.suppressed)**: `Suppressed` · Not sent: the address is on your suppression list. · Yes
- **`complained` (email.complained)**: `Feedback` · The recipient marked the message as spam. The address is added to your suppressions. · After delivery
- **`opened` (email.opened)**: `Open` · The tracking pixel loaded. Open tracking only; can repeat. · After delivery
- **`clicked` (email.clicked)**: `Click` · A tracked link was followed. Click tracking only; can repeat. · After delivery

**Final outcomes.** `delivered`, `bounced`, `failed` and `suppressed` end the delivery attempt: no more retries follow. After `delivered` the trail can still grow: opens and clicks, a complaint, or a late `bounced` when the receiving server accepts the message first and sends a bounce email afterwards. `queued` and `delivery_delayed` are never final.

**Bounce details.** Bounced, delayed, failed and suppressed events carry a classification: `Permanent`, `Transient` or `Undetermined` with a `subType` such as `MailboxDoesNotExist` or `Expired`. Only permanent mailbox- or domain-level failures and complaints add the address to your suppressions. The full list is in [Bounce classification](https://zapsmtp.com/docs/testing/#bounces), and every scenario can be produced on demand with [simulator addresses](https://zapsmtp.com/docs/testing/).

**Two more statuses.** `scheduled` is not an event: `GET /emails?status=scheduled` lists sends still waiting for their `scheduled_at`. With reply tracking on, an answer to an email appears in its log as `replied` and fires `email.replied`.

## Open tracking

With open tracking on, ZapSMTP adds a 1×1 transparent image just before `</body>` of the HTML part (or at its end when there is no `</body>`). The image URL carries a signed token naming the email and recipient. When a mail client loads it, the recipient gets an `opened` event and you get `email.opened` with `data.open.ip_address` and `data.open.user_agent`, plus `data.open.machine: true` when the open came from Apple’s privacy proxy. The image is served with no-cache headers, so a client that loads it again later records another open (repeats within 10 minutes from the same network are folded, see below).

- **HTML only.** A text-only email has nowhere to put a pixel, so it records no opens.
- **Images off means no open.** A recipient who reads the email without loading images is not counted. Open counts are a lower bound in that direction.
- **Repeats from the same network are folded.** The same pixel loaded again from the same IP address (the same /64 for IPv6) within 10 minutes is served but not counted again, so a client that refreshes or a scanner that retries does not inflate opens or send duplicate webhooks.

> **Apple Mail Privacy Protection.** Apple Mail users who turn on Mail Privacy Protection have every remote image fetched through Apple’s proxy, usually soon after delivery and whether or not the person reads the email. ZapSMTP recognises these fetches by the bare `Mozilla/5.0` user agent Apple’s proxy sends and marks their `email.opened` webhooks with `data.open.machine: true`. They still count as opens, and are split out everywhere: `GET /v1/metrics` returns `human_opened` and `human_open_rate` next to `opened` and `open_rate`, `GET /v1/stats/breakdown` returns `human_unique_opens` and `machine_opens`, an email’s open events carry `machine: true`, and the dashboard’s open rate is the human one. An email that a person opened after the proxy did counts as opened by a person. Use the human figures, or clicks, replies and conversions in your own app, for decisions that matter, such as removing inactive subscribers.

## Click tracking

With click tracking on, every `<a>` whose `href` is an absolute `http://` or `https://` URL is rewritten to a link on our tracking host. The original destination, the email and the recipient are inside a token signed with HMAC-SHA256, so the redirector only ever sends people to URLs that were in your email: it cannot be turned into an open redirect, and a token that was tampered with is answered with 404. A click records `clicked`, sends `email.clicked` with `data.click.link`, `ip_address` and `user_agent`, and redirects the browser to the destination with HTTP 302.

- HTML entities in the `href` (`&amp;`, `&#38;`) are decoded first, so people land exactly where the browser would have sent them.
- `mailto:`, `tel:`, relative links and anchors are left alone; links in the plain-text part are not rewritten.
- A repeated click on the same link from the same network within 10 minutes still redirects but is not counted again.
- Tracked links work for 365 days after the email was sent. After that they answer 410 *Gone* instead of redirecting.
- Your unsubscribe link, `{{{zap:unsubscribe_url}}}`, is filled in after click tracking and is never wrapped.
- A link marked with a [click action](https://zapsmtp.com/docs/click-actions/) (`data-zap-action`) is tracked even when click tracking is off, and its `email.clicked` carries `click.action`.

### Keep a link out of tracking

Add the `data-zap-notrack` attribute to any link that should go out untouched: password resets, magic sign-in links, links your security team wants to be readable, or links whose exact URL a receiver checks. The attribute can stand anywhere in the tag and is left in the sent HTML, where mail clients ignore it.

**Opting links out of click tracking**

```html
<!-- tracked: rewritten through the click redirector -->
<a href="https://acme.com/orders/A-1042">Track your order</a>

<!-- not tracked: data-zap-notrack may come before or after href -->
<a data-zap-notrack href="https://acme.com/account/reset?t=8f2c">Reset your password</a>

<!-- never rewritten: not an http(s) link -->
<a href="mailto:support@acme.com">Write to us</a>

<!-- your unsubscribe link is filled in after tracking and never wrapped -->
<a href="{{{zap:unsubscribe_url}}}">Unsubscribe</a>
```

## Tracking settings

Tracking is decided per email, from two layers:

1. **The domain default.** Each sending domain has `open_tracking` and `click_tracking`, both off when the domain is added. Set them on the domain page in the dashboard or with [PATCH /domains/{id}](https://zapsmtp.com/docs/domains/update-domain/). They apply to every email whose From address is on that domain.
2. **The per-send override.** `tracking` on [POST /emails](https://zapsmtp.com/docs/emails/send-email/) and on each item of [a batch](https://zapsmtp.com/docs/emails/send-batch/) takes `opens` and `clicks` (and `replies` for reply tracking). A field you set wins over the domain; a field you leave out keeps the domain default.

## Set a domain’s tracking defaults

`PATCH /v1/domains/{id}`

Every email from this domain is tracked unless the send says otherwise. New domains start with both off.

Requires a full-access live key; test keys get 403 test_key_restricted.

Fields left out keep their value. The response is the domain, as in `GET /domains/{id}`.

Reply tracking: each tracked email gets its own signed Reply-To, e.g. `r1-<email id>.<signature>@reply.acme.com`, so replies come back tied to the exact email. Each reply fires `email.replied` (classified as a person, out-of-office, unsubscribe request, bounce…) and arrives as a received email; only replies a person wrote are forwarded. The display name is kept (the Reply-To’s name, else the From name). One reply address takes at most 100 replies a day.

### Path parameters

- `id` (string, required): Domain id

### Body parameters

- `open_tracking` (boolean): Default open tracking for emails from this domain.
- `click_tracking` (boolean): Default click tracking for emails from this domain.
- `tls` (string): Outbound encryption: `opportunistic` (default: encrypt whenever offered), `required` (TLS or no delivery) or `verified` (TLS with a valid certificate). Limits: other values → 422 invalid_parameter "tls must be opportunistic, required or verified"
- `reply_tracking` (boolean): Default reply tracking for emails from this domain (override per email with `tracking.replies`). Limits: true without a reply_domain → 422 invalid_parameter "reply_tracking needs a reply_domain: add an inbound domain such as reply.<domain> first"
- `reply_domain` (string): Where tracked reply addresses live: one of your inbound domains, MX-verified, equal to this domain or a subdomain of it (e.g. `reply.acme.com`). `""` clears it. Limits: otherwise 422 invalid_parameter
- `reply_forward_to` (string): Where replies a person wrote are forwarded: a plain address on one of your verified domains, or a confirmed forward destination; never a receiving address. `""` (default) forwards to the email’s first Reply-To, else its From. Limits: otherwise 422 invalid_parameter

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `not_found` (HTTP 404): domain not found
- `invalid_parameter` (HTTP 422): bad tls; reply_domain not one of your inbound domains, not this domain or a subdomain of it, or without a verified MX record; reply_forward_to not a plain address, a receiving address, or not on a verified domain / confirmed forward destination; reply_tracking without a reply_domain

```bash
curl -X PATCH 'https://app.zapsmtp.com/v1/domains/019a1e9b-41c2-7a0e-b5d1-3f6c2e8a9d47' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "open_tracking": true,
  "click_tracking": true
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f10-8a10-7b22-8c31-5d2e9f0a4b17",
  "name": "acme.com",
  "status": "verified",
  "dkim_selector": "zap",
  "dkim_verified": true,
  "spf_verified": true,
  "dmarc_verified": true,
  "open_tracking": true,
  "click_tracking": true,
  "from_name": "",
  "tls": "opportunistic",
  "reply_tracking": true,
  "reply_domain": "reply.acme.com",
  "reply_forward_to": "support@acme.com",
  "brand_updated_at": null,
  "last_checked_at": "2026-10-21T14:05:00Z",
  "verified_at": "2026-10-21T14:05:00Z",
  "created_at": "2026-10-21T13:58:02Z",
  "zone": "acme.com",
  "records": [
    {
      "record": "DKIM",
      "type": "TXT",
      "name": "zap._domainkey.acme.com",
      "value": "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...",
      "required": true,
      "status": "verified"
    },
    {
      "record": "SPF",
      "type": "TXT",
      "name": "acme.com",
      "value": "v=spf1 include:_spf.zapsmtp.com ~all",
      "required": false,
      "status": "verified"
    },
    {
      "record": "DMARC",
      "type": "TXT",
      "name": "_dmarc.acme.com",
      "value": "v=DMARC1; p=none;",
      "required": false,
      "status": "verified"
    }
  ]
}
```

## Turn tracking on for one email

`POST /v1/emails`

tracking overrides the From domain’s defaults for this email only. Leave a field out to keep the domain default.

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
  - `filename` (string): File name shown to the recipient. Required with `content`; with `path` it defaults to the last segment of the URL.
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
- `tls` (string): `opportunistic`, `required` or `verified`: `required` delivers only over TLS, `verified` only with a valid certificate for the receiving server. The stricter of this and the domain’s policy applies: it raises the domain’s policy, never lowers it.

### Errors

- `validation_error` (HTTP 400): invalid JSON / unknown field
- `invalid_idempotency_key` (HTTP 400): Idempotency-Key must be 1 to 256 bytes
- `domain_not_verified` (HTTP 403): sender domain is not verified for this account
- `restricted_api_key` (HTTP 403): key restricted to another domain or stream
- `account_suspended` (HTTP 403): account is suspended
- `account_closing` (HTTP 403): account is scheduled for deletion (an owner can cancel it in the dashboard)
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
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Your October invoice",
  "html": "<p>Your invoice is ready: <a href=\"https://acme.com/invoices/A-1042\">view it</a>.</p><p><a href=\"https://acme.com/account/reset?t=8f2c\" data-zap-notrack>Reset your password</a></p>",
  "tracking": {
    "opens": true,
    "clicks": true
  },
  "tags": [
    {
      "name": "category",
      "value": "invoice"
    }
  ],
  "metadata": {
    "invoice_id": "A-1042"
  }
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## Turn tracking off for one email

`POST /v1/emails`

A password reset from a domain that tracks by default: no pixel, no rewritten links.

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
  - `filename` (string): File name shown to the recipient. Required with `content`; with `path` it defaults to the last segment of the URL.
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
- `tls` (string): `opportunistic`, `required` or `verified`: `required` delivers only over TLS, `verified` only with a valid certificate for the receiving server. The stricter of this and the domain’s policy applies: it raises the domain’s policy, never lowers it.

### Errors

- `validation_error` (HTTP 400): invalid JSON / unknown field
- `invalid_idempotency_key` (HTTP 400): Idempotency-Key must be 1 to 256 bytes
- `domain_not_verified` (HTTP 403): sender domain is not verified for this account
- `restricted_api_key` (HTTP 403): key restricted to another domain or stream
- `account_suspended` (HTTP 403): account is suspended
- `account_closing` (HTTP 403): account is scheduled for deletion (an owner can cancel it in the dashboard)
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
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <security@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Reset your password",
  "html": "<p><a href=\"https://acme.com/account/reset?t=8f2c\">Choose a new password</a></p>",
  "tracking": {
    "opens": false,
    "clicks": false
  },
  "tags": [
    {
      "name": "category",
      "value": "password_reset"
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

> **One recipient per email for exact attribution.** The pixel and links are added once per message, so their token can name a single recipient. When an email has several recipients, opens and clicks are attributed to the first `To` address, whoever actually opened it. To know exactly who opened and clicked, send one email per recipient; [POST /emails/batch](https://zapsmtp.com/docs/emails/send-batch/) takes up to 100 at once.

Open and click tracking applies to the HTML of emails sent through the HTTP API, templates included. Delivery, bounce and complaint events are recorded for every email, tracked or not, including mail sent over [SMTP](https://zapsmtp.com/docs/smtp/).

## One email’s timeline

[GET /emails/{id}](https://zapsmtp.com/docs/emails/get-email/) returns the email with `recipients` (each with its latest `status`, `updated_at` and the last server `response`) and `events` in time order. Each event has the public `status` from the table above and a `type` naming what happened. Delivery attempts add `response_code`, `response`, `attempts`, the `mx` host and `peer_addr` it talked to, and the `tls` version and cipher. Failures add `bounce_type` and `bounce_subtype`. Opens and clicks add `user_agent`; for a click, `response` holds the link that was followed.

## Read one email’s timeline

`GET /v1/emails/{id}`

Per-recipient status plus every event in order: the remote server’s reply, MX host, IP, TLS, attempts and, for opens and clicks, the user agent.

Requires a full-access key.

Only data inside the plan's log retention is visible. metadata may be null.

### Path parameters

- `id` (string, required): Email id

### Errors

- `restricted_api_key` (HTTP 403)
- `not_found` (HTTP 404): email not found (events can take a few seconds to appear)

```bash
curl 'https://app.zapsmtp.com/v1/emails/019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23' \
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

![One email in the dashboard: each recipient’s status and the event timeline with the receiving server’s reply, MX host, IP and TLS version](https://zapsmtp.com/docs/img/email-detail-light.webp)

The same timeline in the dashboard, under Emails.

The email id is the `id` returned by the send call. Keep it next to your own record (order, user, ticket) or put your own id in `metadata` so you can find the email later without storing ours. Emails are visible for your plan’s log retention (`plan.retention_days` in usage).

## List and filter emails

[GET /emails](https://zapsmtp.com/docs/emails/list-emails/) lists emails newest first, one item per email with `last_status`: the status of the email’s most recent event across all recipients.

**Filters**

- **`status`**: Latest status: `queued`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed`, `opened`, `clicked`, `suppressed`, or `scheduled` for waiting sends. Because it is the *latest* status, `status=delivered` leaves out delivered emails that were later opened; ask for `opened` and `clicked` too when you mean “reached the inbox”.
- **`q`**: Case-insensitive substring of a recipient or the subject, or an exact email id.
- **`metadata[key]`**: Exact match on a metadata value. Repeat for several keys; all must match.
- **`stream`**: `transactional` or `broadcast`.
- **`mode`**: `live` or `test`.
- **`days`**: Look-back window, 1–90 days, default 30, always capped by your plan’s retention.
- **`after`, `before`**: An email id or an RFC 3339 time. Together they give a date range; `before` with the last id of a page is the cursor for the next page.
- **`limit`**: 1–100, default 20.

The list has no tag filter: tags are for aggregated metrics and webhooks. To find individual emails, put the identifiers you will search by in `metadata`.

## Emails that bounced this week

`GET /v1/emails`

status matches the latest event of the email.

Requires a full-access key.

Use the last item's id as before= for the next page. metadata may be null when the email has none. last_status and last_event carry the same value.

### Query parameters

- `limit` (integer): 1-100. Limits: 422 invalid_parameter otherwise. Default `20`.
- `before` (string): Cursor: an email id (UUIDv7) or RFC 3339 time; returns emails accepted before it. An email id gives an exact page boundary. Limits: 422 invalid_parameter "before must be an email id or RFC 3339 time"
- `after` (string): Email id or RFC 3339 time; only emails created after it (still newest first). Limits: 422 invalid_parameter "after must be an email id or RFC 3339 time"
- `status` (string): Filter by latest status. status=scheduled lists pending scheduled sends instead (different item shape, ordered by scheduled time ascending, has_more always false, other filters/cursors ignored, though they must be valid). One of `queued`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed`, `opened`, `clicked`, `replied`, `suppressed`, `scheduled`.
- `q` (string): Case-insensitive substring of a recipient or subject, or an exact email id.
- `days` (integer): Look-back window in days, 1-90. Always capped by the plan's log retention. Limits: 422 invalid_parameter otherwise. Default `30`.
- `stream` (string): One of `transactional`, `broadcast`.
- `mode` (string): Filter live or test-mode (sandbox) traffic. Limits: 422 invalid_parameter for other values. One of `live`, `test`.
- `metadata[<key>]` (string): Exact match on a metadata value, e.g. metadata[order_id]=A-1042. Repeatable for several keys.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): bad before/after

```bash
curl 'https://app.zapsmtp.com/v1/emails?status=bounced&days=7&limit=50' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": true,
  "data": [
    {
      "object": "email",
      "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
      "from": "Acme <hello@acme.com>",
      "subject": "Your receipt",
      "to": [
        "jane@example.org"
      ],
      "last_status": "delivered",
      "last_event": "delivered",
      "created_at": "2026-10-21T15:04:10.902Z",
      "stream": "transactional",
      "test": false,
      "metadata": {
        "order_id": "A-1042"
      }
    }
  ]
}
```

## Find the emails of one order

`GET /v1/emails`

Exact match on a metadata value. Repeat metadata[...] to require several keys.

Requires a full-access key.

Use the last item's id as before= for the next page. metadata may be null when the email has none. last_status and last_event carry the same value.

### Query parameters

- `limit` (integer): 1-100. Limits: 422 invalid_parameter otherwise. Default `20`.
- `before` (string): Cursor: an email id (UUIDv7) or RFC 3339 time; returns emails accepted before it. An email id gives an exact page boundary. Limits: 422 invalid_parameter "before must be an email id or RFC 3339 time"
- `after` (string): Email id or RFC 3339 time; only emails created after it (still newest first). Limits: 422 invalid_parameter "after must be an email id or RFC 3339 time"
- `status` (string): Filter by latest status. status=scheduled lists pending scheduled sends instead (different item shape, ordered by scheduled time ascending, has_more always false, other filters/cursors ignored, though they must be valid). One of `queued`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed`, `opened`, `clicked`, `replied`, `suppressed`, `scheduled`.
- `q` (string): Case-insensitive substring of a recipient or subject, or an exact email id.
- `days` (integer): Look-back window in days, 1-90. Always capped by the plan's log retention. Limits: 422 invalid_parameter otherwise. Default `30`.
- `stream` (string): One of `transactional`, `broadcast`.
- `mode` (string): Filter live or test-mode (sandbox) traffic. Limits: 422 invalid_parameter for other values. One of `live`, `test`.
- `metadata[<key>]` (string): Exact match on a metadata value, e.g. metadata[order_id]=A-1042. Repeatable for several keys.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): bad before/after

```bash
curl 'https://app.zapsmtp.com/v1/emails?metadata%5Border_id%5D=A-1042' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": true,
  "data": [
    {
      "object": "email",
      "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
      "from": "Acme <hello@acme.com>",
      "subject": "Your receipt",
      "to": [
        "jane@example.org"
      ],
      "last_status": "delivered",
      "last_event": "delivered",
      "created_at": "2026-10-21T15:04:10.902Z",
      "stream": "transactional",
      "test": false,
      "metadata": {
        "order_id": "A-1042"
      }
    }
  ]
}
```

## Broadcast mail in a time range

`GET /v1/emails`

after and before take an email id or an RFC 3339 time; the window is still capped by days and your plan’s retention.

Requires a full-access key.

Use the last item's id as before= for the next page. metadata may be null when the email has none. last_status and last_event carry the same value.

### Query parameters

- `limit` (integer): 1-100. Limits: 422 invalid_parameter otherwise. Default `20`.
- `before` (string): Cursor: an email id (UUIDv7) or RFC 3339 time; returns emails accepted before it. An email id gives an exact page boundary. Limits: 422 invalid_parameter "before must be an email id or RFC 3339 time"
- `after` (string): Email id or RFC 3339 time; only emails created after it (still newest first). Limits: 422 invalid_parameter "after must be an email id or RFC 3339 time"
- `status` (string): Filter by latest status. status=scheduled lists pending scheduled sends instead (different item shape, ordered by scheduled time ascending, has_more always false, other filters/cursors ignored, though they must be valid). One of `queued`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed`, `opened`, `clicked`, `replied`, `suppressed`, `scheduled`.
- `q` (string): Case-insensitive substring of a recipient or subject, or an exact email id.
- `days` (integer): Look-back window in days, 1-90. Always capped by the plan's log retention. Limits: 422 invalid_parameter otherwise. Default `30`.
- `stream` (string): One of `transactional`, `broadcast`.
- `mode` (string): Filter live or test-mode (sandbox) traffic. Limits: 422 invalid_parameter for other values. One of `live`, `test`.
- `metadata[<key>]` (string): Exact match on a metadata value, e.g. metadata[order_id]=A-1042. Repeatable for several keys.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): bad before/after

```bash
curl 'https://app.zapsmtp.com/v1/emails?stream=broadcast&after=2026-10-20T00%3A00%3A00Z&before=2026-10-21T00%3A00%3A00Z&days=30&limit=100' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": true,
  "data": [
    {
      "object": "email",
      "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
      "from": "Acme <hello@acme.com>",
      "subject": "Your receipt",
      "to": [
        "jane@example.org"
      ],
      "last_status": "delivered",
      "last_event": "delivered",
      "created_at": "2026-10-21T15:04:10.902Z",
      "stream": "transactional",
      "test": false,
      "metadata": {
        "order_id": "A-1042"
      }
    }
  ]
}
```

## Search by recipient or subject

`GET /v1/emails`

q is a case-insensitive substring of a recipient or the subject, or an exact email id.

Requires a full-access key.

Use the last item's id as before= for the next page. metadata may be null when the email has none. last_status and last_event carry the same value.

### Query parameters

- `limit` (integer): 1-100. Limits: 422 invalid_parameter otherwise. Default `20`.
- `before` (string): Cursor: an email id (UUIDv7) or RFC 3339 time; returns emails accepted before it. An email id gives an exact page boundary. Limits: 422 invalid_parameter "before must be an email id or RFC 3339 time"
- `after` (string): Email id or RFC 3339 time; only emails created after it (still newest first). Limits: 422 invalid_parameter "after must be an email id or RFC 3339 time"
- `status` (string): Filter by latest status. status=scheduled lists pending scheduled sends instead (different item shape, ordered by scheduled time ascending, has_more always false, other filters/cursors ignored, though they must be valid). One of `queued`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed`, `opened`, `clicked`, `replied`, `suppressed`, `scheduled`.
- `q` (string): Case-insensitive substring of a recipient or subject, or an exact email id.
- `days` (integer): Look-back window in days, 1-90. Always capped by the plan's log retention. Limits: 422 invalid_parameter otherwise. Default `30`.
- `stream` (string): One of `transactional`, `broadcast`.
- `mode` (string): Filter live or test-mode (sandbox) traffic. Limits: 422 invalid_parameter for other values. One of `live`, `test`.
- `metadata[<key>]` (string): Exact match on a metadata value, e.g. metadata[order_id]=A-1042. Repeatable for several keys.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): bad before/after

```bash
curl 'https://app.zapsmtp.com/v1/emails?q=jane%40example.org&mode=live' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": true,
  "data": [
    {
      "object": "email",
      "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
      "from": "Acme <hello@acme.com>",
      "subject": "Your receipt",
      "to": [
        "jane@example.org"
      ],
      "last_status": "delivered",
      "last_event": "delivered",
      "created_at": "2026-10-21T15:04:10.902Z",
      "stream": "transactional",
      "test": false,
      "metadata": {
        "order_id": "A-1042"
      }
    }
  ]
}
```

**Page through every result**

Node.js:

```javascript
// Every bounced email of the last 7 days, page by page.
const API = 'https://app.zapsmtp.com/v1';
const headers = { Authorization: `Bearer ${process.env.ZAP_API_KEY}` };

const all = [];
let before;
do {
  const q = new URLSearchParams({ status: 'bounced', days: '7', limit: '100', ...(before && { before }) });
  const res = await fetch(`${API}/emails?${q}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const page = await res.json();
  all.push(...page.data);
  before = page.has_more ? page.data.at(-1).id : undefined;
} while (before);

console.log(all.length, 'bounced emails');
```

Python:

```python
# Every bounced email of the last 7 days, page by page.
import os, requests

API = "https://app.zapsmtp.com/v1"
H = {"Authorization": f"Bearer {os.environ['ZAP_API_KEY']}"}

emails, before = [], None
while True:
    params = {"status": "bounced", "days": 7, "limit": 100}
    if before:
        params["before"] = before
    r = requests.get(f"{API}/emails", headers=H, params=params, timeout=30)
    r.raise_for_status()
    page = r.json()
    emails += page["data"]
    if not page["has_more"]:
        break
    before = page["data"][-1]["id"]

print(len(emails), "bounced emails")
```

## Metrics

[GET /metrics](https://zapsmtp.com/docs/stats/metrics/) aggregates live mail over a period you choose, up to 400 days back, and returns `totals`, a `series` by hour or day and, with a `dimension`, one row per value in `groups`, busiest (most `sent`) first and at most 1,000 rows; there is no pagination, so with many tags the quietest ones are left out. Metrics are kept for 400 days whatever your plan’s log retention, so they are the source for long-term reporting.

**Parameters**

- **`from`, `to`**: RFC 3339; default the last 7 days. `to` is exclusive; at most 400 days apart. Data is kept in UTC hours, so `from` is rounded down to the start of its hour.
- **`granularity`**: `hour` (ranges up to 31 days) or `day` (UTC days). Default: `hour` up to 48 hours, else `day`. Buckets with no events are left out of `series`.
- **`dimension`**: `domain` (the From domain), `stream`, `provider` (the recipient’s mailbox provider: Gmail, Microsoft, Yahoo, Apple or Other) or `tag` (each `name=value`).
- **`domain`, `stream`, `provider`**: Filters; they combine with each other and with any dimension except `tag`.
- **`tag`**: One tag as `name=value`. Cannot be combined with `domain`, `stream` or `provider`, and groups only by `tag`.

**Counts and rates**

- **`sent`**: Recipients accepted (`queued`).
- **`delivered`, `bounced`, `complained`, `suppressed`, `failed`**: Recipients with that event.
- **`delayed`, `opened`, `clicked`**: Unique emails with at least one such event: a message opened five times counts once.
- **`delivery_rate`**: `delivered / sent`
- **`bounce_rate`**: `bounced / sent`
- **`complaint_rate`**: `complained / delivered`
- **`open_rate`**: `opened / delivered`
- **`human_open_rate`**: `human_opened / delivered`: leaves out emails that only Apple Mail Privacy Protection’s proxy opened
- **`click_rate`**: `clicked / delivered`

Rates are non-negative fractions, cut (not rounded) to four decimals: `0.0077` is 0.77%. They are not capped at 1 (see below). A rate whose denominator is 0 is `0`.

> **Events count when they happen.** Every event is counted in the hour it occurred, not the hour its email was sent. An email sent at 23:50 and delivered at 00:05 adds to `sent` on one day and to `delivered` on the next, and an open three days later counts on that day. Over a day or longer this evens out; over an hour or two, rates can drift and even exceed 1. Events are also processed asynchronously, so one can be recorded after the hour it belongs to is over: a recent past day can still grow slightly.

A few details of the groups: with `dimension=tag` an email with several tags appears in each tag’s group, while `totals` and `series` still count it once. Out-of-band bounces (bounce emails that arrive after delivery) carry no sending domain and are grouped under an empty `value`. Opens and clicks are counted under their email’s domain, stream and tags, but an email whose encoded tags exceed 200 bytes has its opens and clicks left out of tag metrics.

## Deliverability by mailbox provider

`GET /v1/metrics`

Gmail, Microsoft, Yahoo, Apple and Other, busiest first, with a daily series.

Requires a full-access key.

Counts are recipients, except `delayed`, `opened` and `clicked`: unique emails. Delivery and bounce rates are of `sent`; complaint, open and click rates of `delivered`. Test-mode mail is excluded. Kept for 400 days.

An out-of-band bounce (a later bounce email from the remote server) has no sending domain: it is grouped under an empty `value`.

Totals and the series count each email once whatever the dimension; with `dimension=tag` an email with several tags appears in each of its tags' groups.

### Query parameters

- `from` (string): RFC 3339 start. At most 400 days before `to`. Default `7 days ago`.
- `to` (string): RFC 3339 end (exclusive). Default `now`.
- `granularity` (string): `hour` (ranges up to 31 days) or `day` for `series`. One of `hour`, `day`. Default `hour up to 48 hours, else day`.
- `dimension` (string): `domain`, `stream`, `tag` or `provider`: adds `groups`, one row per value, busiest first.
- `domain` (string): Only this sending (From) domain.
- `stream` (string): `transactional` or `broadcast`.
- `provider` (string): Gmail, Microsoft, Yahoo, Apple or Other.
- `tag` (string): Only emails with this tag, as `name=value`. Cannot be combined with domain, stream or provider, and groups only by `tag`.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): Bad time, range, granularity or dimension, or a tag combined with another filter.

```bash
curl 'https://app.zapsmtp.com/v1/metrics?dimension=provider&from=2026-10-01T00%3A00%3A00Z&to=2026-10-26T00%3A00%3A00Z&granularity=day' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "metrics",
  "from": "2026-10-18T00:00:00Z",
  "to": "2026-10-25T00:00:00Z",
  "granularity": "day",
  "dimension": "domain",
  "totals": {
    "sent": 12400,
    "delivered": 12210,
    "bounced": 95,
    "delayed": 3,
    "complained": 4,
    "opened": 4380,
    "human_opened": 2409,
    "clicked": 912,
    "suppressed": 2,
    "failed": 0,
    "delivery_rate": 0.9847,
    "bounce_rate": 0.0077,
    "complaint_rate": 0.0003,
    "open_rate": 0.3587,
    "human_open_rate": 0.1972,
    "click_rate": 0.0747
  },
  "series": [
    {
      "time": "2026-10-18T00:00:00Z",
      "sent": 1700,
      "delivered": 1676,
      "bounced": 14,
      "delayed": 3,
      "complained": 1,
      "opened": 601,
      "human_opened": 331,
      "clicked": 120,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9859,
      "bounce_rate": 0.0082,
      "complaint_rate": 0.0006,
      "open_rate": 0.3586,
      "human_open_rate": 0.1974,
      "click_rate": 0.0716
    }
  ],
  "groups": [
    {
      "value": "acme.com",
      "sent": 9800,
      "delivered": 9668,
      "bounced": 70,
      "delayed": 3,
      "complained": 3,
      "opened": 3540,
      "human_opened": 1947,
      "clicked": 760,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9865,
      "bounce_rate": 0.0071,
      "complaint_rate": 0.0003,
      "open_rate": 0.3662,
      "human_open_rate": 0.2013,
      "click_rate": 0.0786
    },
    {
      "value": "news.acme.com",
      "sent": 2600,
      "delivered": 2542,
      "bounced": 25,
      "delayed": 3,
      "complained": 1,
      "opened": 840,
      "human_opened": 462,
      "clicked": 152,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9777,
      "bounce_rate": 0.0096,
      "complaint_rate": 0.0004,
      "open_rate": 0.3304,
      "human_open_rate": 0.1817,
      "click_rate": 0.0598
    }
  ]
}
```

## Metrics for one tag

`GET /v1/metrics`

tag=name=value. It cannot be combined with domain, stream or provider.

Requires a full-access key.

Counts are recipients, except `delayed`, `opened` and `clicked`: unique emails. Delivery and bounce rates are of `sent`; complaint, open and click rates of `delivered`. Test-mode mail is excluded. Kept for 400 days.

An out-of-band bounce (a later bounce email from the remote server) has no sending domain: it is grouped under an empty `value`.

Totals and the series count each email once whatever the dimension; with `dimension=tag` an email with several tags appears in each of its tags' groups.

### Query parameters

- `from` (string): RFC 3339 start. At most 400 days before `to`. Default `7 days ago`.
- `to` (string): RFC 3339 end (exclusive). Default `now`.
- `granularity` (string): `hour` (ranges up to 31 days) or `day` for `series`. One of `hour`, `day`. Default `hour up to 48 hours, else day`.
- `dimension` (string): `domain`, `stream`, `tag` or `provider`: adds `groups`, one row per value, busiest first.
- `domain` (string): Only this sending (From) domain.
- `stream` (string): `transactional` or `broadcast`.
- `provider` (string): Gmail, Microsoft, Yahoo, Apple or Other.
- `tag` (string): Only emails with this tag, as `name=value`. Cannot be combined with domain, stream or provider, and groups only by `tag`.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): Bad time, range, granularity or dimension, or a tag combined with another filter.

```bash
curl 'https://app.zapsmtp.com/v1/metrics?tag=category%3Dinvoice&from=2026-10-19T00%3A00%3A00Z&to=2026-10-26T00%3A00%3A00Z' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "metrics",
  "from": "2026-10-18T00:00:00Z",
  "to": "2026-10-25T00:00:00Z",
  "granularity": "day",
  "dimension": "domain",
  "totals": {
    "sent": 12400,
    "delivered": 12210,
    "bounced": 95,
    "delayed": 3,
    "complained": 4,
    "opened": 4380,
    "human_opened": 2409,
    "clicked": 912,
    "suppressed": 2,
    "failed": 0,
    "delivery_rate": 0.9847,
    "bounce_rate": 0.0077,
    "complaint_rate": 0.0003,
    "open_rate": 0.3587,
    "human_open_rate": 0.1972,
    "click_rate": 0.0747
  },
  "series": [
    {
      "time": "2026-10-18T00:00:00Z",
      "sent": 1700,
      "delivered": 1676,
      "bounced": 14,
      "delayed": 3,
      "complained": 1,
      "opened": 601,
      "human_opened": 331,
      "clicked": 120,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9859,
      "bounce_rate": 0.0082,
      "complaint_rate": 0.0006,
      "open_rate": 0.3586,
      "human_open_rate": 0.1974,
      "click_rate": 0.0716
    }
  ],
  "groups": [
    {
      "value": "acme.com",
      "sent": 9800,
      "delivered": 9668,
      "bounced": 70,
      "delayed": 3,
      "complained": 3,
      "opened": 3540,
      "human_opened": 1947,
      "clicked": 760,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9865,
      "bounce_rate": 0.0071,
      "complaint_rate": 0.0003,
      "open_rate": 0.3662,
      "human_open_rate": 0.2013,
      "click_rate": 0.0786
    },
    {
      "value": "news.acme.com",
      "sent": 2600,
      "delivered": 2542,
      "bounced": 25,
      "delayed": 3,
      "complained": 1,
      "opened": 840,
      "human_opened": 462,
      "clicked": 152,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9777,
      "bounce_rate": 0.0096,
      "complaint_rate": 0.0004,
      "open_rate": 0.3304,
      "human_open_rate": 0.1817,
      "click_rate": 0.0598
    }
  ]
}
```

## Compare tags

`GET /v1/metrics`

One group per name=value pair, busiest first, up to 1,000 groups. An email with several tags counts in each of them.

Requires a full-access key.

Counts are recipients, except `delayed`, `opened` and `clicked`: unique emails. Delivery and bounce rates are of `sent`; complaint, open and click rates of `delivered`. Test-mode mail is excluded. Kept for 400 days.

An out-of-band bounce (a later bounce email from the remote server) has no sending domain: it is grouped under an empty `value`.

Totals and the series count each email once whatever the dimension; with `dimension=tag` an email with several tags appears in each of its tags' groups.

### Query parameters

- `from` (string): RFC 3339 start. At most 400 days before `to`. Default `7 days ago`.
- `to` (string): RFC 3339 end (exclusive). Default `now`.
- `granularity` (string): `hour` (ranges up to 31 days) or `day` for `series`. One of `hour`, `day`. Default `hour up to 48 hours, else day`.
- `dimension` (string): `domain`, `stream`, `tag` or `provider`: adds `groups`, one row per value, busiest first.
- `domain` (string): Only this sending (From) domain.
- `stream` (string): `transactional` or `broadcast`.
- `provider` (string): Gmail, Microsoft, Yahoo, Apple or Other.
- `tag` (string): Only emails with this tag, as `name=value`. Cannot be combined with domain, stream or provider, and groups only by `tag`.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): Bad time, range, granularity or dimension, or a tag combined with another filter.

```bash
curl 'https://app.zapsmtp.com/v1/metrics?dimension=tag&from=2026-10-19T00%3A00%3A00Z&to=2026-10-26T00%3A00%3A00Z' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "metrics",
  "from": "2026-10-18T00:00:00Z",
  "to": "2026-10-25T00:00:00Z",
  "granularity": "day",
  "dimension": "domain",
  "totals": {
    "sent": 12400,
    "delivered": 12210,
    "bounced": 95,
    "delayed": 3,
    "complained": 4,
    "opened": 4380,
    "human_opened": 2409,
    "clicked": 912,
    "suppressed": 2,
    "failed": 0,
    "delivery_rate": 0.9847,
    "bounce_rate": 0.0077,
    "complaint_rate": 0.0003,
    "open_rate": 0.3587,
    "human_open_rate": 0.1972,
    "click_rate": 0.0747
  },
  "series": [
    {
      "time": "2026-10-18T00:00:00Z",
      "sent": 1700,
      "delivered": 1676,
      "bounced": 14,
      "delayed": 3,
      "complained": 1,
      "opened": 601,
      "human_opened": 331,
      "clicked": 120,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9859,
      "bounce_rate": 0.0082,
      "complaint_rate": 0.0006,
      "open_rate": 0.3586,
      "human_open_rate": 0.1974,
      "click_rate": 0.0716
    }
  ],
  "groups": [
    {
      "value": "acme.com",
      "sent": 9800,
      "delivered": 9668,
      "bounced": 70,
      "delayed": 3,
      "complained": 3,
      "opened": 3540,
      "human_opened": 1947,
      "clicked": 760,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9865,
      "bounce_rate": 0.0071,
      "complaint_rate": 0.0003,
      "open_rate": 0.3662,
      "human_open_rate": 0.2013,
      "click_rate": 0.0786
    },
    {
      "value": "news.acme.com",
      "sent": 2600,
      "delivered": 2542,
      "bounced": 25,
      "delayed": 3,
      "complained": 1,
      "opened": 840,
      "human_opened": 462,
      "clicked": 152,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9777,
      "bounce_rate": 0.0096,
      "complaint_rate": 0.0004,
      "open_rate": 0.3304,
      "human_open_rate": 0.1817,
      "click_rate": 0.0598
    }
  ]
}
```

## One domain, hour by hour, split by stream

`GET /v1/metrics`

Hourly series cover up to 31 days.

Requires a full-access key.

Counts are recipients, except `delayed`, `opened` and `clicked`: unique emails. Delivery and bounce rates are of `sent`; complaint, open and click rates of `delivered`. Test-mode mail is excluded. Kept for 400 days.

An out-of-band bounce (a later bounce email from the remote server) has no sending domain: it is grouped under an empty `value`.

Totals and the series count each email once whatever the dimension; with `dimension=tag` an email with several tags appears in each of its tags' groups.

### Query parameters

- `from` (string): RFC 3339 start. At most 400 days before `to`. Default `7 days ago`.
- `to` (string): RFC 3339 end (exclusive). Default `now`.
- `granularity` (string): `hour` (ranges up to 31 days) or `day` for `series`. One of `hour`, `day`. Default `hour up to 48 hours, else day`.
- `dimension` (string): `domain`, `stream`, `tag` or `provider`: adds `groups`, one row per value, busiest first.
- `domain` (string): Only this sending (From) domain.
- `stream` (string): `transactional` or `broadcast`.
- `provider` (string): Gmail, Microsoft, Yahoo, Apple or Other.
- `tag` (string): Only emails with this tag, as `name=value`. Cannot be combined with domain, stream or provider, and groups only by `tag`.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): Bad time, range, granularity or dimension, or a tag combined with another filter.

```bash
curl 'https://app.zapsmtp.com/v1/metrics?domain=acme.com&dimension=stream&granularity=hour&from=2026-10-24T00%3A00%3A00Z&to=2026-10-26T00%3A00%3A00Z' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "metrics",
  "from": "2026-10-18T00:00:00Z",
  "to": "2026-10-25T00:00:00Z",
  "granularity": "day",
  "dimension": "domain",
  "totals": {
    "sent": 12400,
    "delivered": 12210,
    "bounced": 95,
    "delayed": 3,
    "complained": 4,
    "opened": 4380,
    "human_opened": 2409,
    "clicked": 912,
    "suppressed": 2,
    "failed": 0,
    "delivery_rate": 0.9847,
    "bounce_rate": 0.0077,
    "complaint_rate": 0.0003,
    "open_rate": 0.3587,
    "human_open_rate": 0.1972,
    "click_rate": 0.0747
  },
  "series": [
    {
      "time": "2026-10-18T00:00:00Z",
      "sent": 1700,
      "delivered": 1676,
      "bounced": 14,
      "delayed": 3,
      "complained": 1,
      "opened": 601,
      "human_opened": 331,
      "clicked": 120,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9859,
      "bounce_rate": 0.0082,
      "complaint_rate": 0.0006,
      "open_rate": 0.3586,
      "human_open_rate": 0.1974,
      "click_rate": 0.0716
    }
  ],
  "groups": [
    {
      "value": "acme.com",
      "sent": 9800,
      "delivered": 9668,
      "bounced": 70,
      "delayed": 3,
      "complained": 3,
      "opened": 3540,
      "human_opened": 1947,
      "clicked": 760,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9865,
      "bounce_rate": 0.0071,
      "complaint_rate": 0.0003,
      "open_rate": 0.3662,
      "human_open_rate": 0.2013,
      "click_rate": 0.0786
    },
    {
      "value": "news.acme.com",
      "sent": 2600,
      "delivered": 2542,
      "bounced": 25,
      "delayed": 3,
      "complained": 1,
      "opened": 840,
      "human_opened": 462,
      "clicked": 152,
      "suppressed": 2,
      "failed": 0,
      "delivery_rate": 0.9777,
      "bounce_rate": 0.0096,
      "complaint_rate": 0.0004,
      "open_rate": 0.3304,
      "human_open_rate": 0.1817,
      "click_rate": 0.0598
    }
  ]
}
```

## Quick stats

Three lighter endpoints answer “what happened in the last N hours” (1–720, default 24), within your plan’s retention. Unlike metrics, [GET /stats](https://zapsmtp.com/docs/stats/stats/) and [GET /stats/timeseries](https://zapsmtp.com/docs/stats/stats-timeseries/) count *events*, not unique emails: three opens of one email are 3 `opened`. The time series picks its bucket from the window: 1 minute up to 1 hour, 5 minutes up to 6 hours, 30 minutes up to 24 hours, 3 hours up to 7 days, 12 hours beyond.

[GET /stats/breakdown](https://zapsmtp.com/docs/stats/stats-breakdown/) adds delivery by mailbox provider (`delayed` there counts emails delayed at least once), bounce classes, engagement with both total and unique opens and clicks, and the most clicked links with total and unique clicks.

## Event counts for the last 24 hours

`GET /v1/stats`

Event counts by status over the last N hours (live traffic only).

Requires a full-access key.

Counts events (not unique emails), ordered by status name; test-mode traffic excluded.

### Query parameters

- `hours` (integer): 1-720. Limits: 422 invalid_parameter otherwise. Default `24`.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): a query parameter is out of range or not one of its values

```bash
curl 'https://app.zapsmtp.com/v1/stats?hours=24' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "hours": 24,
  "data": [
    {
      "status": "bounced",
      "count": 12
    },
    {
      "status": "delivered",
      "count": 1840
    },
    {
      "status": "queued",
      "count": 1861
    }
  ]
}
```

## Events over the last 6 hours

`GET /v1/stats/timeseries`

5-minute buckets for windows up to 6 hours.

Requires a full-access key.

One point per (bucket, status); empty buckets are not emitted. Test-mode traffic excluded.

### Query parameters

- `hours` (integer): 1-720 (422 invalid_parameter otherwise). Bucket size: <=1h → 60 s, <=6h → 300 s, <=24h → 1800 s, <=168h → 10800 s, otherwise 43200 s. Default `24`.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): a query parameter is out of range or not one of its values

```bash
curl 'https://app.zapsmtp.com/v1/stats/timeseries?hours=6' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "hours": 24,
  "bucket_seconds": 1800,
  "since": "2026-10-20T15:00:00Z",
  "data": [
    {
      "t": "2026-10-20T15:00:00Z",
      "status": "delivered",
      "count": 74
    },
    {
      "t": "2026-10-20T15:00:00Z",
      "status": "queued",
      "count": 75
    }
  ]
}
```

## Engagement and top links this week

`GET /v1/stats/breakdown`

Per-provider delivery, bounce classes, engagement and top clicked links.

Requires a full-access key.

Providers are Gmail, Microsoft, Yahoo, Apple and Other. `delayed` counts emails that were delayed at least once.

### Query parameters

- `hours` (integer): 1-720. Limits: 422 invalid_parameter otherwise. Default `24`.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): a query parameter is out of range or not one of its values

```bash
curl 'https://app.zapsmtp.com/v1/stats/breakdown?hours=168' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "providers": [
    {
      "provider": "Gmail",
      "sent": 920,
      "delivered": 915,
      "bounced": 3,
      "delayed": 4,
      "complained": 1
    },
    {
      "provider": "Microsoft",
      "sent": 410,
      "delivered": 402,
      "bounced": 6,
      "delayed": 9,
      "complained": 0
    }
  ],
  "bounces": [
    {
      "classification": "InvalidRecipient",
      "count": 7
    }
  ],
  "engagement": {
    "delivered": 1840,
    "unique_opens": 702,
    "unique_clicks": 133,
    "opens": 1190,
    "clicks": 201,
    "human_unique_opens": 386,
    "machine_opens": 595
  },
  "top_links": [
    {
      "url": "https://acme.com/orders/A-1042",
      "clicks": 88,
      "unique": 80
    }
  ]
}
```

## Slice reports with tags and metadata

Both are set when you send and come back on delivery webhooks. On `email.opened` and `email.clicked` each is included only when it fits in 200 bytes (tags URL-encoded, metadata as JSON), so keep the identifiers you need there short; the email id always finds the full record. They serve different questions:

**Tags vs metadata**

- **`tags` ([{name, value}])**: Low-cardinality labels for **aggregates**: `category=receipt`, `campaign=oct-sale`, `template=welcome-v2`, `tenant=shop-17`. Names and values use letters, digits, `_` and `-`. Group by them with `/metrics?dimension=tag`, filter with `tag=name=value`. Webhooks carry them as `data.tags`.
- **`metadata` ({key: value})**: Your identifiers for **finding single emails**: `order_id`, `user_id`, `ticket`. Up to 10 keys, values up to 500 bytes (UTF-8). Filter with `/emails?metadata[key]=value`. Returned on `GET /emails`, `GET /emails/{id}` and webhooks.

Keep tag values to a bounded set: a tag per user or per order creates one metrics group per value and makes the breakdown useless. A good pattern is one tag for *what kind* of email it is and one for *which variant*, so an A/B test reads as two rows of `dimension=tag`.

## Webhooks: the real-time feed

Polling tells you what happened; webhooks tell you as it happens. Every event in the lifecycle table is delivered to your endpoint per recipient, signed, retried on failure, with the email’s tags, metadata (on opens and clicks only when short, see above) and stream. Use them to update your own records (mark an address invalid on `email.bounced`, stop a drip on `email.complained`, credit a campaign on `email.clicked`) and to feed your own warehouse. Payloads, retries and signature verification are in [Webhook events](https://zapsmtp.com/docs/webhook-events/).

## Stream outcomes to your endpoint

`POST /v1/webhooks`

Pick the events your reports need; each one arrives per recipient within seconds.

Requires a full-access live key; test keys get 403 test_key_restricted.

The secret is also readable later via GET /webhooks/{id}.

To send clicks of one button to this endpoint: `{"events": ["email.clicked"], "filter": {"actions": ["confirm_order"]}}`. Endpoints always return `filter`, with an empty list when there is none.

### Body parameters

- `url` (string, required): Absolute https:// URL. Limits: 422 invalid_parameter "url must be an absolute https:// URL"
- `events` (string[]): Limits: unknown type → 422 invalid_parameter "unknown event type <x>; allowed: ..." One of `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.opened`, `email.clicked`, `email.suppressed`, `email.received`, `thread.created`, `thread.replied`, `email.replied`, `email.opened_unique`, `email.clicked_unique`, `email.unsubscribed`, `email.forward_failed`, `domain.verified`, `domain.reputation_changed`, `email.scheduled`, `suppression.added`, `suppression.removed`, `domain.created`, `domain.deleted`. Default `every type except email.opened_unique and email.clicked_unique`.
- `include_content` (boolean): `email.received` carries the message: text, html, headers, and download links (valid 24 hours) for the attachments and the raw .eml; text and html are cut at 1 MB in total (`truncated: true`). Default `false`.
- `batch` (boolean): Send events up to 100 per request (or every second) as a JSON array, signed as one body; `Zap-Event-Id` is the batch id, each event keeps its own `id`. `email.received` with the full message still arrives alone. Default `false`.
- `filter` (object): Narrows what the endpoint receives: `actions` narrows `email.clicked` (and `email.clicked_unique`) to some [click actions](https://zapsmtp.com/docs/click-actions/); `domains` narrows every event to some domains. Empty or absent: every click, every domain. Default `{"actions": [], "domains": []}`.
  - `actions` (string[]): Action names (lowercase letters, digits, `_`, `.` and `-`, starting with a letter or digit, up to 64 characters). The endpoint then receives `email.clicked` only for links with one of these actions. Limits: more than 50 → 422 invalid_parameter "filter.actions: at most 50"; a bad name → 422 invalid_parameter "filter.actions: <name> is not an action name"
  - `domains` (string[]): Sending or receiving domains (lower case). The endpoint then receives only events of these domains: the From domain of sent email, the receiving domain of received mail, the domain of `domain.*` events. Limits: more than 50 → 422 invalid_parameter "filter.actions and filter.domains: at most 50 each"; a bad name → 422 invalid_parameter "filter.domains: <name> is not a domain name"

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `invalid_parameter` (HTTP 422)

```bash
curl -X POST 'https://app.zapsmtp.com/v1/webhooks' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "url": "https://acme.com/hooks/zapsmtp",
  "events": [
    "email.delivered",
    "email.bounced",
    "email.complained",
    "email.opened",
    "email.clicked"
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
    "actions": [],
    "domains": []
  }
}
```

**Count events per tag as they arrive**

Node.js:

```javascript
// Count outcomes per tag and day from webhooks, in real time.
// Verify Zap-Signature first: see /docs/webhook-events/#signatures.
app.post('/hooks/zapsmtp', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!verified(req)) return res.sendStatus(400);
  const event = JSON.parse(req.body);
  res.sendStatus(200); // answer fast, work afterwards

  if (event.data.test) return; // test keys
  const day = event.created_at.slice(0, 10);
  const tags = Object.entries(event.data.tags ?? {}).map(([k, v]) => `${k}=${v}`);
  for (const tag of tags.length ? tags : ['(none)']) {
    // dedupe on event.id: a retried delivery repeats it
    await db.query(
      `INSERT INTO webhook_counts (event_id, day, tag, type) VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id, tag) DO NOTHING`,
      [event.id, day, tag, event.type],
    );
  }
});
```

Python:

```python
# Count outcomes per tag and day from webhooks, in real time.
# Verify Zap-Signature first: see /docs/webhook-events/#signatures.
@app.post("/hooks/zapsmtp")
def zapsmtp():
    if not verified(request):
        abort(400)
    event = request.get_json()
    if event["data"].get("test"):  # test keys
        return "", 200
    day = event["created_at"][:10]
    tags = [f"{k}={v}" for k, v in (event["data"].get("tags") or {}).items()] or ["(none)"]
    with db:  # dedupe on event id: a retried delivery repeats it
        for tag in tags:
            db.execute("INSERT OR IGNORE INTO webhook_counts (event_id, day, tag, type) VALUES (?, ?, ?, ?)",
                       (event["id"], day, tag, event["type"]))
    return "", 200
```

## Build your own dashboard

The simplest durable setup is a daily job that pulls finished UTC days into your own store. Events count in the hour they happen, but a late-processed event can still land in a day that is already over, so don’t treat one pull as final: re-pull a rolling window of the last few days on every run and upsert by day. Re-runs are then safe and late events correct earlier rows. To backfill, run the same request for earlier days, up to 400 days back.

Store counts, not rates. A week’s bounce rate is `sum(bounced) / sum(sent)` over the week, not the average of seven daily rates. Summing days works for the additive counts (`sent`, `delivered`, `bounced`, `complained`, `suppressed`, `failed`) and the delivery, bounce and complaint rates built from them. `opened`, `clicked` and `delayed` are unique emails within the requested window: an email opened on Monday and again on Tuesday is in both daily rows, so summing days over-counts. For their weekly or monthly values, and for open and click rates over such a period, ask `/metrics` for the whole period at once.

**Upsert the last 3 days every day**

Node.js:

```javascript
// Run daily after 00:00 UTC, e.g. cron "15 0 * * *".
// Re-pulls the last 3 finished UTC days per tag (plus the total) and
// upserts them into Postgres, so late events correct earlier rows.
import pg from 'pg';

const API = 'https://app.zapsmtp.com/v1';
const headers = { Authorization: `Bearer ${process.env.ZAP_API_KEY}` };
const iso = (d) => d.toISOString().replace('.000Z', 'Z');
const LOOKBACK_DAYS = 3;
const db = new pg.Client(); // PG* environment variables
await db.connect();
await db.query(`CREATE TABLE IF NOT EXISTS zap_daily (
  day date, tag text, sent int, delivered int, bounced int, delayed int, complained int,
  opened int, clicked int, suppressed int, failed int, PRIMARY KEY (day, tag))`);

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
for (let i = LOOKBACK_DAYS; i >= 1; i--) {
  const from = new Date(today.getTime() - i * 86_400_000);
  const to = new Date(from.getTime() + 86_400_000);
  const q = new URLSearchParams({ from: iso(from), to: iso(to), granularity: 'day', dimension: 'tag' });
  const res = await fetch(`${API}/metrics?${q}`, { headers });
  if (!res.ok) throw new Error(`metrics: ${res.status} ${await res.text()}`);
  const m = await res.json();
  // groups: at most 1,000, busiest first
  for (const [tag, c] of [['(all)', m.totals], ...m.groups.map((g) => [g.value, g])]) {
    await db.query(
      `INSERT INTO zap_daily VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (day, tag) DO UPDATE SET sent=$3, delivered=$4, bounced=$5, delayed=$6,
         complained=$7, opened=$8, clicked=$9, suppressed=$10, failed=$11`,
      [iso(from).slice(0, 10), tag, c.sent, c.delivered, c.bounced, c.delayed, c.complained,
       c.opened, c.clicked, c.suppressed, c.failed],
    );
  }
}
await db.end();
```

Python:

```python
# Run daily after 00:00 UTC. Re-pulls the last 3 finished UTC days per
# domain, stream, provider and tag and upserts them into SQLite (any SQL
# database works the same way), so late events correct earlier rows.
import datetime as dt, os, sqlite3, requests

API = "https://app.zapsmtp.com/v1"
H = {"Authorization": f"Bearer {os.environ['ZAP_API_KEY']}"}
fmt = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")
LOOKBACK_DAYS = 3

today = dt.datetime.now(dt.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

db = sqlite3.connect("zapsmtp.db")
db.execute("""CREATE TABLE IF NOT EXISTS daily_metrics (
  day TEXT, dimension TEXT, value TEXT,
  sent INT, delivered INT, bounced INT, delayed INT, complained INT,
  opened INT, clicked INT, suppressed INT, failed INT,
  PRIMARY KEY (day, dimension, value))""")

cols = ("sent", "delivered", "bounced", "delayed", "complained", "opened", "clicked", "suppressed", "failed")
for i in range(LOOKBACK_DAYS, 0, -1):
    start = today - dt.timedelta(days=i)
    end = start + dt.timedelta(days=1)
    for dim in ("domain", "stream", "provider", "tag"):
        r = requests.get(f"{API}/metrics", headers=H, timeout=30,
                         params={"from": fmt(start), "to": fmt(end), "granularity": "day", "dimension": dim})
        r.raise_for_status()
        for g in r.json()["groups"]:  # at most 1,000 groups, busiest first
            db.execute("INSERT OR REPLACE INTO daily_metrics VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                       (start.date().isoformat(), dim, g["value"], *(g[c] for c in cols)))
db.commit()
```

For a live view, combine the two sources: webhooks for the last minutes, the daily pull as the reconciled record. If a webhook was missed, the metrics still have the event.

## Alert on bounce and complaint rates

Mailbox providers judge you on bounces and spam complaints. Gmail and Yahoo ask bulk senders to keep the spam rate they see well below 0.3%, and a bounce rate above a few percent usually means a stale or bought list. The recipe below checks the last 24 hours per sending domain every hour and posts to a chat webhook of yours when a threshold is crossed. Tune the thresholds to your traffic; the minimum volume keeps a handful of emails from paging anyone.

**Hourly deliverability alert**

Node.js:

```javascript
// Run every hour. Alerts when a sending domain's bounce or complaint
// rate over the last 24 hours crosses a threshold.
const API = 'https://app.zapsmtp.com/v1';
const headers = { Authorization: `Bearer ${process.env.ZAP_API_KEY}` };
const MIN_SENT = 200;        // ignore tiny samples
const MAX_BOUNCE = 0.02;     // 2% of sent
const MAX_COMPLAINT = 0.001; // 0.1% of delivered

const to = new Date();
const from = new Date(to.getTime() - 24 * 3_600_000);
const q = new URLSearchParams({ dimension: 'domain', from: from.toISOString(), to: to.toISOString() });
const res = await fetch(`${API}/metrics?${q}`, { headers });
if (!res.ok) throw new Error(`metrics: ${res.status}`);
const { groups } = await res.json();

const problems = groups
  .filter((g) => g.value && g.sent >= MIN_SENT) // '' = out-of-band bounces with no domain
  .flatMap((g) => [
    g.bounce_rate > MAX_BOUNCE && `${g.value}: bounce rate ${(g.bounce_rate * 100).toFixed(2)}% (${g.bounced}/${g.sent})`,
    g.complaint_rate > MAX_COMPLAINT && `${g.value}: complaint rate ${(g.complaint_rate * 100).toFixed(3)}% (${g.complained}/${g.delivered})`,
  ])
  .filter(Boolean);

if (problems.length) {
  // your own chat webhook, pager or email
  await fetch(process.env.ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'ZapSMTP deliverability alert\n' + problems.join('\n') }),
  });
}
```

Python:

```python
# Run every hour. Alerts when a sending domain's bounce or complaint
# rate over the last 24 hours crosses a threshold.
import datetime as dt, os, requests

API = "https://app.zapsmtp.com/v1"
H = {"Authorization": f"Bearer {os.environ['ZAP_API_KEY']}"}
MIN_SENT, MAX_BOUNCE, MAX_COMPLAINT = 200, 0.02, 0.001

to = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
start = to - dt.timedelta(hours=24)
r = requests.get(f"{API}/metrics", headers=H, timeout=30, params={
    "dimension": "domain",
    "from": start.isoformat().replace("+00:00", "Z"),
    "to": to.isoformat().replace("+00:00", "Z"),
})
r.raise_for_status()

problems = []
for g in r.json()["groups"]:
    if not g["value"] or g["sent"] < MIN_SENT:  # '' = out-of-band bounces with no domain
        continue
    if g["bounce_rate"] > MAX_BOUNCE:
        problems.append(f"{g['value']}: bounce rate {g['bounce_rate']:.2%} ({g['bounced']}/{g['sent']})")
    if g["complaint_rate"] > MAX_COMPLAINT:
        problems.append(f"{g['value']}: complaint rate {g['complaint_rate']:.3%} ({g['complained']}/{g['delivered']})")

if problems:  # your own chat webhook, pager or email
    requests.post(os.environ["ALERT_WEBHOOK_URL"], timeout=10,
                  json={"text": "ZapSMTP deliverability alert\n" + "\n".join(problems)})
```

When an alert fires, narrow it down with `dimension=provider` for that domain (one provider rejecting you looks different from a bad list), list the bounced emails and read the `bounce_subtype` on their timelines, and check the domain’s [reputation](https://zapsmtp.com/docs/domains/domain-reputation/).

## Request logs

Events describe what happened to the mail; the request log describes what your code asked for. [GET /logs](https://zapsmtp.com/docs/logs/list-logs/) lists requests made with an API key that got past authentication. Not logged: the dashboard’s own calls, requests to `/logs` itself, and requests rejected before logging (an invalid key, or a test key attempting an account change). Each entry has method, path, status, duration, IP and user agent; [GET /logs/{id}](https://zapsmtp.com/docs/logs/get-log/) adds the request and response bodies. Every response carries `X-Request-Id`; for a logged request it is the id of its log entry: log it on your side and you can always find the exact request. Filter by exact status (`422`) or class (`4xx`), method, path prefix or API key.

## Send requests that failed validation

`GET /v1/logs`

Authenticated API-key requests; X-Request-Id on a logged response is its log id.

Requires a full-access key.

Requests made with API keys are logged; the dashboard’s own calls are not. The `X-Request-Id` header of every response is the id of its log entry.

### Query parameters

- `limit` (integer): 1–100. Limits: 422 invalid_parameter otherwise. Default `20`.
- `before` (string): A log id: return older entries.
- `after` (string): A log id: return newer entries.
- `status` (string): An exact status (`422`) or a class: `2xx`, `4xx`, `5xx`.
- `method` (string): HTTP method.
- `path` (string): Path prefix, e.g. `/v1/emails`.
- `api_key_id` (string): Only requests made with this key.

### Errors

- `invalid_parameter` (HTTP 422): before or after is not a log id.

```bash
curl 'https://app.zapsmtp.com/v1/logs?status=422&method=POST&path=%2Fv1%2Femails&limit=20' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": true,
  "data": [
    {
      "object": "log",
      "id": "019a1f31-5b2e-7c9d-8e4f-1a2b3c4d5e6f",
      "api_key_id": "019a1c11-2f3e-7a4b-9c5d-6e7f8a9b0c1d",
      "method": "POST",
      "path": "/v1/emails",
      "route": "/v1/emails",
      "status": 200,
      "duration_ms": 38,
      "ip": "203.0.113.7",
      "user_agent": "node-fetch/3.3",
      "created_at": "2026-10-22T15:04:10.902Z"
    }
  ]
}
```

## Usage

[GET /usage](https://zapsmtp.com/docs/logs/usage/) reports this month’s emails sent against your plan: `sent`, `included`, `limit` (`null` on paid plans without a spending cap), overage so far, and your plan with its `retention_days`, which bounds how far back the email list, timelines and `/stats` can see. The Free plan adds `daily_limit` and `sent_today`. Test-key mail does not count.

## This month’s usage

`GET /v1/usage`

This month’s sending against your plan: emails sent, included volume, limit, overage and, on the Free plan, today’s count.

Requires a full-access key.

`limit` is `null` on paid plans without a spending cap: email keeps flowing and extra volume is billed. The Free plan adds `daily_limit` and `sent_today`.

```bash
curl 'https://app.zapsmtp.com/v1/usage' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "usage",
  "month": "2026-10",
  "sent": 52310,
  "included": 50000,
  "limit": null,
  "overage_emails": 2310,
  "overage_cents": 196,
  "plan": {
    "id": "pro_50k",
    "name": "Pro 50k",
    "retention_days": 30
  }
}
```
