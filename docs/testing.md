# Testing and simulator

> Test every delivery path with ZapSMTP test keys and simulator addresses: bounces, complaints, delays and exact SMTP replies.

Source: https://zapsmtp.com/docs/testing/

Exercise the failure paths before your users do. Simulator addresses never leave ZapSMTP, work with live and test keys, never touch your suppression list or reputation, and accept `+labels` such as `delivered+signup@simulator.zapsmtp.com`.

**Simulator addresses**

- **`delivered@` (email.delivered)**: 250 accepted by the mailbox
- **`bounced@` (email.bounced)**: 550 5.1.1 Permanent / MailboxDoesNotExist
- **`full@` (email.bounced)**: 552 5.2.2 Permanent / MailboxFull
- **`blocked@` (email.bounced)**: 554 5.7.1 Permanent / SpamBlocked
- **`delayed@` (email.delivery_delayed → email.delivered)**: 451 on the first attempt, delivered ~20 s later
- **`complained@` (email.delivered → email.complained)**: delivered, then an ARF abuse complaint
- **`suppressed@` (email.suppressed)**: treated as on your suppression list; not sent
- **`bounce+421+4.7.0+try-later@` (email.delivery_delayed)**: any reply you need: bounce+<code>[+<x.y.z>][+<words-with-dashes>]

## Try every scenario at once

`POST /v1/emails`

One email to several simulator addresses: each recipient produces its own events and webhooks within seconds.

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
    "complained@simulator.zapsmtp.com",
    "bounce+421+4.7.0+try-later@simulator.zapsmtp.com"
  ],
  "subject": "Scenario test",
  "text": "Testing every path."
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## Test keys

Keys that start with `zap_test_` run validation, the email log, events and webhooks exactly as live keys do, accept any From domain and never deliver. They do not count against your monthly plan. Filter their traffic with `GET /emails?mode=test`; their events carry `test: true`.

## Bounce classification

Bounced, delayed, failed and suppressed events carry a `bounce` object: `type` is `Permanent`, `Transient` or `Undetermined`, `subType` says why, `message` is the receiver’s reply and `suppressed` tells whether the address was added to your suppressions. Only permanent mailbox- or domain-level failures suppress an address; a rejection caused by the sender side never does.

**subType**

- **`MailboxDoesNotExist`**: The address does not exist. Suppressed.
- **`DomainDoesNotExist`**: The domain has no mail server. Suppressed.
- **`MailboxInactive`**: The mailbox is disabled. Suppressed.
- **`MailboxFull`**: Over quota at the receiver.
- **`MessageTooLarge`**: Rejected for size.
- **`ContentRejected`**: Rejected for its content.
- **`AttachmentRejected`**: Rejected for an attachment.
- **`SpamBlocked`**: Filtered as spam. The recipient is not suppressed.
- **`IPBlocked`**: The provider refuses the sending IP (e.g. Yahoo TSS, Microsoft S3150). The IP is paused and your mail moves to other IPs; the recipient is not suppressed.
- **`PolicyRejected`**: Sender policy (SPF, DMARC, PTR). The recipient is not suppressed.
- **`RelayDenied`**: The receiver refused to relay.
- **`DNSFailure`**: DNS lookup failed.
- **`ConnectionFailed`**: Could not connect.
- **`Expired`**: Retries ran out.
- **`Suppressed`**: Skipped: the address is on your suppression list.
- **`AutoReply`**: An out-of-office or similar reply.
- **`General`**: Anything else.

## Spam checks

Score a draft with [POST /emails/spam-check](https://zapsmtp.com/docs/emails/spam-check-draft/) or a sent email with [POST /emails/{id}/spam-check](https://zapsmtp.com/docs/emails/spam-check-email/). The message is DKIM-signed with your real key and checked as if it arrived from your real sending IP, with two spam engines and live blocklists. The response lists the rules that fired and infrastructure issues, such as a listed IP, separately from content problems.
