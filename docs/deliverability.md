# Deliverability guide

> Reach the inbox with ZapSMTP: Gmail, Yahoo and Microsoft sender rules, DKIM and DMARC, one-click unsubscribe, warm-up, suppressions and monitoring.

Source: https://zapsmtp.com/docs/deliverability/

What mailbox providers require from senders today, what ZapSMTP already does for you, and what is still yours to do: authentication, unsubscribe, warm-up, list hygiene, content and monitoring, with the API calls for each step.

## Sender requirements

Since February 2024 Gmail and Yahoo enforce rules for everyone who sends to their users, with stricter rules for bulk senders (Google counts a sender as bulk after close to 5,000 messages a day to Gmail addresses). Since May 2025 Outlook.com applies similar rules to senders above 5,000 messages a day. Mail that does not meet them is deferred, sent to spam or rejected.

**Requirements and how ZapSMTP covers them**

- **SPF and DKIM (All senders: at least one. Bulk: both.)**: Every verified domain has its own 2048-bit DKIM key and ZapSMTP signs every message with it. SPF passes for the Return-Path, which is a ZapSMTP bounce domain. **Yours:** publish the DKIM record (required to verify) and the SPF include.
- **DMARC (Bulk senders. `p=none` is enough.)**: ZapSMTP suggests a record and collects aggregate reports for you (DMARC reports). **Yours:** publish `_dmarc` on your domain.
- **Alignment (Bulk: the From domain matches the SPF or DKIM domain.)**: DKIM is signed with `d=` your exact From domain, so DMARC passes through DKIM alignment, even with `adkim=s`. See Alignment.
- **One-click unsubscribe (Bulk, for marketing and subscribed mail. RFC 8058. Honour within 2 days.)**: On the `broadcast` stream ZapSMTP adds `List-Unsubscribe` and `List-Unsubscribe-Post`; a click stops broadcast mail to the address at once. **Yours:** send marketing on `broadcast` and put a visible link in the body.
- **Spam rate (Below 0.3% in Google Postmaster Tools; aim below 0.1%.)**: Complaints from feedback loops suppress the address automatically. **Yours:** consent, expected content, and watching complaint rates.
- **PTR (reverse DNS) (All senders.)**: ZapSMTP’s sending IPs have reverse DNS names; each dedicated IP lists its `hostname`. Nothing for you to do.
- **TLS (All senders.)**: STARTTLS whenever the receiver offers it; receivers with MTA-STS or DANE are only reached over a verified connection. `tls: "required"` or `"verified"` per domain or email raises the bar.
- **RFC 5322 format (All senders.)**: ZapSMTP builds the message: one From, Date, Message-ID, MIME structure. Reserved headers cannot be overridden through the API.

## Authenticate your domain

Add each domain you send from. ZapSMTP matches the From domain exactly: `news.acme.com` is a separate domain from `acme.com`, with its own key. A domain counts as verified once its DKIM record is found; SPF and DMARC are checked and reported but not required to send.

- **DKIM.** A TXT record at `<selector>._domainkey.<domain>`. Copy it exactly: one changed character makes every signature fail.
- **SPF.** A domain may have only *one* `v=spf1` record. Two records are a permanent error at receivers; `verify` warns about it. Add the include to your existing record instead. Keep the record under 10 DNS lookups.
- **DMARC.** Start with `p=none` and a `rua` address so you see who sends as your domain. Move to `quarantine` and `reject` once every legitimate source passes. A DMARC record on `acme.com` also covers subdomains unless they publish their own or you set `sp=`.

**DNS records**

Zone file:

```
; DKIM: required. Selector and key come from GET /domains/{id}
<selector>._domainkey.news.acme.com.  TXT  "v=DKIM1; k=rsa; p=MIIBIjANBgkq..."

; SPF: one record per name. Merge the include into an existing record
news.acme.com.                       TXT  "v=spf1 include:<value from your records> ~all"

; DMARC: start with p=none and the rua from GET /domains/{id}/dmarc
_dmarc.news.acme.com.                TXT  "v=DMARC1; p=none; rua=<your rua>"
```

DMARC stages:

```
; 1. Monitor (2-4 weeks): read reports, fix every legitimate source
_dmarc.acme.com.  TXT  "v=DMARC1; p=none; rua=<your rua>"

; 2. Quarantine a share of failing mail, then raise pct to 100
_dmarc.acme.com.  TXT  "v=DMARC1; p=quarantine; pct=25; rua=<your rua>"

; 3. Reject everything that fails
_dmarc.acme.com.  TXT  "v=DMARC1; p=reject; rua=<your rua>"
```

## Add a subdomain for marketing mail

`POST /v1/domains`

Every From domain is verified on its own: `news.acme.com` gets its own DKIM key and records, and its reputation is tracked separately from `acme.com`.

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
curl -X POST 'https://app.zapsmtp.com/v1/domains' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "news.acme.com"
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

## Verify the records

`POST /v1/domains/{id}/verify`

Checks DKIM, SPF and DMARC live. The domain becomes `verified` once DKIM matches; `warnings` point out problems such as two SPF records.

Requires a full-access live key; test keys get 403 test_key_restricted.

`found` shows, per DNS name, what is published right now. For the root domain only SPF-type TXT values are listed; a DMARC policy inherited from the parent domain is marked “(inherited from _dmarc.<domain>)”.

### Path parameters

- `id` (string, required): Domain id

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `not_found` (HTTP 404): domain not found
- `conflict` (HTTP 409): this domain is already verified by another account

```bash
curl -X POST 'https://app.zapsmtp.com/v1/domains/019a1e9b-41c2-7a0e-b5d1-3f6c2e8a9d47/verify' \
  -H "Authorization: Bearer $ZAP_API_KEY"
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
  "dmarc_verified": false,
  "open_tracking": false,
  "click_tracking": false,
  "from_name": "",
  "tls": "opportunistic",
  "reply_tracking": false,
  "reply_domain": "",
  "reply_forward_to": "",
  "brand_updated_at": null,
  "last_checked_at": "2026-10-21T14:02:11Z",
  "verified_at": "2026-10-21T14:02:11Z",
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
      "status": "pending"
    }
  ],
  "found": {
    "zap._domainkey.acme.com": [
      "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..."
    ],
    "acme.com": [
      "v=spf1 include:_spf.zapsmtp.com ~all"
    ]
  }
}
```

## Alignment, with examples

DMARC passes when SPF or DKIM passes *and* the domain it passed for is aligned with the domain in the visible From header. Relaxed alignment (the default, `adkim=r` / `aspf=r`) accepts any domain under the same organisational domain; strict (`=s`) needs the exact domain.

**From: news@news.acme.com**

- **DKIM `d=news.acme.com`**: Aligned, relaxed and strict. This is what ZapSMTP signs, because the key belongs to the exact From domain.
- **DKIM `d=acme.com`**: Aligned in relaxed mode (same organisational domain), not in strict mode.
- **DKIM `d=mailer-provider.example`**: Not aligned. Typical for a service that signs with its own domain; DMARC fails unless SPF aligns.
- **SPF for Return-Path `bounces.acme.com`**: Aligned in relaxed mode.
- **SPF for a ZapSMTP bounce domain**: Passes, but not aligned with your From domain. ZapSMTP keeps the Return-Path on its own domain so it can process bounces for you; DMARC relies on DKIM alignment, which is always present.

> Forwarding and mailing lists often break SPF but keep DKIM intact. Mail that is aligned through DKIM, as ZapSMTP mail is, survives forwarding better than mail that relies on SPF alone.

## Read your DMARC reports

`GET /v1/domains/{id}/dmarc`

Aggregate reports from Gmail, Yahoo, Microsoft and other receivers, summed per day and per sending IP. `record` is a suggested DMARC record that already contains your `rua` address.

Requires a full-access key.

Add `rua` to your DMARC record (keep your policy). Providers send one report a day; reports are kept 400 days. `ours` marks ZapSMTP sending IPs: another IP that fails DMARC is a service you have not set up (add its DKIM/SPF) or someone spoofing your domain.

### Path parameters

- `id` (string): Domain id.

### Query parameters

- `days` (integer): 1-180. Limits: 422 invalid_parameter otherwise. Default `30`.

### Errors

- `restricted_api_key` (HTTP 403)
- `not_found` (HTTP 404): Not a domain of this account.
- `invalid_parameter` (HTTP 422): a query parameter is out of range or not one of its values

```bash
curl 'https://app.zapsmtp.com/v1/domains/019a1e9b-41c2-7a0e-b5d1-3f6c2e8a9d47/dmarc?days=30' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "dmarc_summary",
  "domain": "acme.com",
  "days": 30,
  "since": "2026-09-26T00:00:00Z",
  "rua": "mailto:dmarc-k7x2m4q9p3a5b6c8@mail.zapsmtp.com",
  "record": {
    "type": "TXT",
    "name": "_dmarc.acme.com",
    "value": "v=DMARC1; p=none; rua=mailto:dmarc-k7x2m4q9p3a5b6c8@mail.zapsmtp.com"
  },
  "reports": 42,
  "totals": {
    "messages": 18240,
    "passed": 18015,
    "dkim_passed": 18001,
    "spf_passed": 17890,
    "quarantined": 190,
    "rejected": 35
  },
  "sources": [
    {
      "ip": "192.0.2.10",
      "messages": 18000,
      "passed": 17990,
      "dkim_passed": 17985,
      "spf_passed": 17880,
      "quarantined": 10,
      "rejected": 0,
      "reporters": [
        "Yahoo",
        "google.com"
      ],
      "ours": true
    },
    {
      "ip": "203.0.113.5",
      "messages": 240,
      "passed": 25,
      "dkim_passed": 16,
      "spf_passed": 10,
      "quarantined": 180,
      "rejected": 35,
      "reporters": [
        "google.com"
      ],
      "ours": false
    }
  ],
  "reporters": [
    {
      "org": "google.com",
      "reports": 30,
      "messages": 15400
    },
    {
      "org": "Yahoo",
      "reports": 12,
      "messages": 2840
    }
  ],
  "series": [
    {
      "day": "2026-10-24T00:00:00Z",
      "messages": 640,
      "passed": 632,
      "dkim_passed": 632,
      "spf_passed": 628,
      "quarantined": 6,
      "rejected": 2
    }
  ]
}
```

## One-click unsubscribe

Gmail and Yahoo require RFC 8058 one-click unsubscribe on marketing and subscribed mail from bulk senders: a `List-Unsubscribe` header with an HTTPS URL plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The provider shows an Unsubscribe button and sends a POST to the URL; you must stop mailing within two days. Transactional mail (receipts, password resets) does not need it.

**What ZapSMTP does**

- **`stream: "broadcast"`**: Adds both headers with a URL signed for the recipient, when the email has exactly one recipient (after suppressed addresses are dropped) and you did not set `List-Unsubscribe` yourself. Send one recipient per email; use [batch](https://zapsmtp.com/docs/emails/send-batch/) for up to 100 at a time.
- **`{{{zap:unsubscribe_url}}}`**: In `html` or `text`, templated or not, on any stream: replaced at send time with the recipient’s signed unsubscribe link. It is never wrapped by click tracking.
- **One-click POST**: Adds the address to your suppressions with reason `unsubscribe`, immediately. Later `broadcast` mail to it is suppressed; transactional mail still goes out.
- **Link opened in a browser**: Shows a confirmation page with an Unsubscribe button, so link scanners that only follow links cannot unsubscribe anyone.
- **SMTP relay**: Headers are not added and the tag is not replaced: set `List-Unsubscribe` and `List-Unsubscribe-Post` in your mailer.

> An unsubscribe stops `broadcast` mail only. Someone who unsubscribes through a ZapSMTP link (or whom you add with reason `unsubscribe`) no longer gets your marketing mail, but receipts, password resets and other `transactional` mail still reach them, so send marketing on `broadcast`. Hard bounces, complaints and `manual` suppressions stop every stream. Unsubscribes are account-wide: if you need opt-outs per list, set your own `List-Unsubscribe` headers that point at your endpoint, and keep the preference in your own database.

## Send a newsletter with one-click unsubscribe

`POST /v1/emails`

On the `broadcast` stream ZapSMTP adds `List-Unsubscribe` and `List-Unsubscribe-Post`, and `{{{zap:unsubscribe_url}}}` in the body becomes the same signed link for this recipient.

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
  "from": "Acme News <news@news.acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "October product update",
  "stream": "broadcast",
  "html": "<p>Hi Ann, here is what shipped in October.</p><p><a href=\"{{{zap:unsubscribe_url}}}\">Unsubscribe</a></p>",
  "text": "Hi Ann, here is what shipped in October.\n\nUnsubscribe: {{{zap:unsubscribe_url}}}",
  "tags": [
    {
      "name": "campaign",
      "value": "october-update"
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

## Use your own unsubscribe endpoint

`POST /v1/emails`

When you set `List-Unsubscribe` yourself, ZapSMTP keeps your headers and adds nothing. Your endpoint must accept the one-click POST.

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
  "from": "Acme News <news@news.acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "October product update",
  "stream": "broadcast",
  "html": "<p>Hi Ann, here is what shipped in October.</p><p><a href=\"https://acme.com/u/8f3a2c\">Unsubscribe</a></p>",
  "text": "Hi Ann, here is what shipped in October.\n\nUnsubscribe: https://acme.com/u/8f3a2c",
  "headers": {
    "List-Unsubscribe": "<https://acme.com/u/8f3a2c>, <mailto:unsubscribe@acme.com?subject=8f3a2c>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
  }
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## Separate transactional and marketing mail

A complaint about a newsletter should never delay a password reset. Separate them on three levels:

- **Stream.** `stream: "transactional"` (the default) or `"broadcast"` on the API, `X-Zap-Stream` on SMTP. On shared IPs each stream has its own pool, so marketing reputation does not spill into transactional delivery. Accounts with dedicated IPs send both streams from them.
- **Subdomain.** Send marketing from `news.acme.com` and transactional from `acme.com` or `notify.acme.com`. Providers track reputation per domain as well, and [metrics](https://zapsmtp.com/docs/stats/metrics/) group by From domain.
- **API keys.** Restrict each key to a stream and a domain, so the marketing system cannot send as the transactional domain by mistake (`403 restricted_api_key`).

## Warm up a new domain or IP

Providers judge new domains and IPs by their first weeks of traffic. Start with your most engaged recipients (people who signed up or opened recently), raise volume gradually, and only increase when bounce and complaint rates stay low and deferrals are rare.

### A new domain on shared IPs

Shared IPs are already warm, but your domain is not. ZapSMTP does not cap a new domain, so pace it yourself. A typical plan for a list of 100,000:

**Suggested domain ramp**

- **Days 1–3**: 500–1,000 a day, recipients active in the last 30 days.
- **Days 4–7**: 2,000–5,000 a day, active in the last 60 days.
- **Week 2**: 10,000–20,000 a day, active in the last 90 days.
- **Week 3**: 30,000–50,000 a day.
- **Week 4**: Full list, if the previous week was clean. Hold or step back at the first wave of deferrals.

### Dedicated IPs

ZapSMTP warms dedicated IPs for you over 30 days. Each day the IP takes up to that day’s cap; anything above it goes out through the stream’s shared pool, so the IP’s warm-up does not hold your email back. In the rare case that the shared pool is warming too and has used its day, further sends are refused until 00:00 UTC (`429 daily_quota_exceeded` from the API, `452 4.2.2` over SMTP), and the message says it is the platform’s warm-up limit, not your plan. After day 30 the IP becomes `active` with no cap.

**Daily cap per dedicated IP (messages)**

- **Days 1–7**: 50 · 100 · 200 · 400 · 700 · 1,000 · 1,500
- **Days 8–14**: 2,000 · 3,000 · 4,000 · 5,000 · 7,000 · 9,000 · 12,000
- **Days 15–21**: 15,000 · 20,000 · 25,000 · 30,000 · 40,000 · 50,000 · 60,000
- **Days 22–28**: 75,000 · 90,000 · 110,000 · 130,000 · 150,000 · 175,000 · 200,000
- **Days 29–30**: 250,000 · 300,000

While an IP warms up, ZapSMTP checks it every 10 minutes against its last 6 hours of traffic (once it has at least 50 attempts) and pauses it when more than 5% bounce or more than 30% are deferred. A paused IP sends nothing; its traffic goes through the shared pool.

## Follow a dedicated IP’s warm-up

`GET /v1/dedicated-ips`

Each dedicated IP shows its status, warm-up day, today’s cap and current blocklist listings.

Requires a full-access key.

`status` is `warming`, `active` or `paused`. During warm-up, `warmup_day` and `daily_cap` show the current day and today’s volume limit. `blocklists` lists current listings of the IP.

### Errors

- `restricted_api_key` (HTTP 403)

```bash
curl 'https://app.zapsmtp.com/v1/dedicated-ips' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": false,
  "data": [
    {
      "address": "203.0.113.25",
      "hostname": "mta25.zapsmtp.com",
      "status": "warming",
      "warmup_day": 9,
      "warmup_days": 30,
      "warmup_progress": 0.3,
      "daily_cap": 3000,
      "blocklists": []
    }
  ]
}
```

## Keep bounces and complaints low

ZapSMTP suppresses addresses automatically. A suppressed address is skipped on every later send it applies to, reported as `email.suppressed`, and not charged. An `unsubscribe` applies to the `broadcast` stream only; every other reason applies to both streams. A later bounce, complaint or `manual` suppression replaces an `unsubscribe` entry for the same address (an unsubscribe never replaces a stronger one), and removing an address clears it entirely.

**What adds an address to suppressions**

- **`hard_bounce`**: A permanent bounce with subType `MailboxDoesNotExist`, `DomainDoesNotExist` or `MailboxInactive`.
- **`complaint`**: A spam report delivered through a provider’s feedback loop.
- **`unsubscribe`**: A one-click unsubscribe or the confirmation button, or an address you add with this reason. Stops `broadcast` mail only.
- **`manual`**: Added by you, with this reason (the default).
- **Never**: Full mailboxes, temporary failures, and rejections caused by the sender side (`SpamBlocked`, `IPBlocked`, `PolicyRejected`): the recipient is valid, so it is not suppressed.

- **Collect consent properly.** Use double opt-in for marketing lists: it removes typos and spam traps before they cost you. Never buy or rent lists.
- **Sunset inactive recipients.** Stop marketing to people who have not opened or clicked in 6–12 months, or send them one re-engagement email first. Apple Mail Privacy Protection inflates opens (its proxy opens are flagged with `open.machine: true` on `email.opened` and left out of `human_open_rate`), so use human opens or, better, clicks for this.
- **Act on reply opt-outs.** With reply tracking, a reply that only says “unsubscribe” or “stop” arrives as `email.replied` with `reply.type: "unsubscribe"`. It is reported, not applied: add the address to suppressions yourself.
- **Migrating?** Import your previous provider’s bounces and unsubscribes before the first send.

> Gmail does not report individual complaints to senders, so ZapSMTP cannot see or suppress them. Your Gmail spam rate is only visible in [Google Postmaster Tools](https://postmaster.google.com/): add your domains there.

## List suppressed addresses

`GET /v1/suppressions`

Every address ZapSMTP will not send to, with the reason and the email that caused it.

Requires a full-access key.

`reason` is `hard_bounce`, `complaint`, `unsubscribe` or `manual`; `source_id` is the email that caused it (`null` when added by hand). Pass `next_cursor` as `after` for the next page.

`unsubscribe` stops only broadcast email (`stream: broadcast`); transactional email to the address still goes out. Every other reason stops all email to it.

### Query parameters

- `limit` (integer): 1-1000. Limits: 422 invalid_parameter otherwise. Default `100`.
- `after` (string): Opaque cursor from next_cursor. Limits: 422 invalid_parameter "invalid after cursor"
- `before` (string): Legacy: RFC 3339 timestamp; returns entries created before it. Ignored when after is set. Limits: 422 invalid_parameter "before must be RFC3339"

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422)

```bash
curl 'https://app.zapsmtp.com/v1/suppressions?limit=100' \
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

## Suppress an address yourself

`POST /v1/suppressions`

For opt-outs you collect elsewhere (a preference centre, a support request, a reply that says “stop”). Reason `unsubscribe` stops broadcast mail only; `manual` stops every stream.

Requires a full-access live key; test keys get 403 test_key_restricted.

Idempotent: an existing entry keeps its reason, except that an `unsubscribe` entry becomes `manual` when you add it as manual (a later bounce or complaint upgrades it the same way). The response echoes the requested reason with 201.

### Body parameters

- `email` (string, required): Address (stored lowercased). Limits: 422 invalid_parameter "invalid email"
- `reason` (string): `manual`: no email at all; `unsubscribe`: no broadcast email (transactional email still goes out). Limits: 422 invalid_parameter "reason must be manual or unsubscribe" One of `manual`, `unsubscribe`. Default `manual`.

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `invalid_parameter` (HTTP 422)

```bash
curl -X POST 'https://app.zapsmtp.com/v1/suppressions' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "email": "former-customer@example.com",
  "reason": "unsubscribe"
}'
```

**Response `201 Created`**

```json
{
  "email": "someone@example.org",
  "reason": "manual"
}
```

## Import your old provider’s suppressions

`POST /v1/suppressions/batch`

Up to 1,000 addresses per call. Import past bounces and unsubscribes before the first send, so you do not mail them again.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Body parameters

- `emails` (string[], required): 1–1,000 addresses.
- `reason` (string): `manual`: no email at all; `unsubscribe`: no broadcast email (transactional email still goes out). One of `manual`, `unsubscribe`. Default `manual`.

### Errors

- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `invalid_parameter` (HTTP 422): Empty or over 1,000 addresses, an invalid address, or an unknown reason.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/suppressions/batch' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "emails": [
    "ann@example.com",
    "bob@example.com"
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

## Receive bounces and complaints

`POST /v1/webhooks`

Sync suppressions into your own database so your app stops queueing mail to addresses that will never receive it.

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
    "email.bounced",
    "email.complained",
    "email.suppressed"
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

**Mirror suppressions in your app**

Node.js:

```javascript
// After verifying Zap-Signature (see Webhook events):
app.post('/hooks/zapsmtp', express.json(), async (req, res) => {
  const { type, data } = req.body;
  if (type === 'email.complained') {
    await db.contacts.update({ email: data.to }, { marketing: false, reason: 'complaint' });
  }
  if (type === 'email.bounced' && data.bounce?.suppressed) {
    await db.contacts.update({ email: data.to }, { status: 'invalid' });
  }
  res.sendStatus(200);
});
```

Python:

```python
# After verifying Zap-Signature (see Webhook events):
@app.post("/hooks/zapsmtp")
def zapsmtp_hook():
    event = request.get_json()
    data = event["data"]
    if event["type"] == "email.complained":
        contacts.update(data["to"], marketing=False, reason="complaint")
    if event["type"] == "email.bounced" and (data.get("bounce") or {}).get("suppressed"):
        contacts.update(data["to"], status="invalid")
    return "", 200
```

## Content guidelines

- **Always send a text part.** HTML-only mail costs points with spam filters (`MIME_HTML_ONLY`). An API send with `html` and no `text` gets a text part generated from the HTML; write your own `text` when you want to control it. SMTP relay messages are sent exactly as given, so add the text part in your mailer.
- **Keep the HTML under 102 KB.** Gmail clips larger messages and hides the rest, including your unsubscribe link and the open-tracking pixel.
- **Balance text and images.** A single large image with little text looks like spam. Give every image `alt` text; many clients block images by default.
- **Link to your own domains.** Links should point at the domain in From or one you clearly own. Do not use public URL shorteners: they are shared with spammers and often listed on domain blocklists.
- **Click tracking rewrites links** to ZapSMTP’s link host. Where link domains matter more than click data, turn it off per email with `tracking: {"clicks": false}` or per domain.
- **Write like a person.** A recognisable From name, an honest subject, no ALL CAPS or strings of exclamation marks. Put the physical address and the unsubscribe link in marketing footers.
- **Attachments.** Prefer links over large attachments in bulk mail; executables and macro documents are rejected by many providers (`AttachmentRejected`).

## Spam-check before you send

The spam check runs SpamAssassin (headline `score`, spam at 5) and a second spam filter, and returns `verdict`: `good`, `needs_work`, `spam` or `rejected`, the worse of the two. Infrastructure problems come back separately in `issues`, so you do not rewrite good copy because of an IP listing:

**issues[].kind**

- **`not_signed`**: The From domain is not verified, so the message is not DKIM-signed and fails DMARC.
- **`ip_listed`**: The checked sending IP (a representative IP of your account) is on a blocklist.
- **`domain_listed`**: A domain in the message (sender or links) is on a domain blocklist.
- **`new_domain`**: A domain in the message was registered recently; it has no reputation yet.

## Spam-check a draft before a campaign

`POST /v1/emails/spam-check`

Scores the message as a receiving server sees it: DKIM-signed with your key, from a representative IP of your account (a dedicated IP first, else the stream’s shared pool), against live blocklists. Nothing is sent.

Requires a full-access or sending-access key.

Body: from missing or both html and text empty → 422 missing_required_field "from and html or text are required". Only these six fields are accepted (others → 400).

### Body parameters

- `from` (string, required): From address; when its domain is verified by the account the draft is DKIM-signed with the real key.
- `to` (string | string[]): Recipient(s); the first is used as envelope recipient. Limits: 422 invalid_parameter "to must be a string or an array of strings" Default `recipient@example.com`.
- `subject` (string)
- `html` (string): At least one of html and text is required.
- `text` (string)
- `stream` (string): Selects the shared pool used to pick the egress IP when the account has no dedicated IP. Default `transactional`.

### Errors

- `missing_required_field` (HTTP 422)
- `invalid_parameter` (HTTP 422)
- `rate_limit_exceeded` (HTTP 429): spam checks are limited to 30 per minute
- `service_unavailable` (HTTP 503): spam checks are busy, try again shortly
- `scanner_unavailable` (HTTP 503): the spam scanners are temporarily unavailable, try again

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails/spam-check' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme News <news@news.acme.com>",
  "subject": "October product update",
  "stream": "broadcast",
  "html": "<p>Hi Ann, here is what shipped in October.</p><p><a href=\"https://acme.com/changelog\">Read the changelog</a></p>",
  "text": "Hi Ann, here is what shipped in October.\n\nRead the changelog: https://acme.com/changelog"
}'
```

**Response `200 OK`**

```json
{
  "object": "spam_check",
  "score": 1.3,
  "threshold": 5,
  "verdict": "good",
  "engines": [
    {
      "engine": "spamassassin",
      "score": 1.3,
      "threshold": 5,
      "verdict": "good",
      "rules": [
        {
          "name": "HTML_MESSAGE",
          "score": 0.001,
          "description": "HTML included in message"
        },
        {
          "name": "MIME_HTML_ONLY",
          "score": 1.1,
          "description": "Message only has text/html MIME parts"
        }
      ]
    }
  ],
  "dkim_signed": true,
  "sending_ip": "203.0.113.25",
  "issues": [],
  "note": "Scored as a receiving server sees it: DKIM-signed with your key, from a representative egress IP of your account, checked against live DNS blocklists. SpamAssassin is the headline score (≥ 5 = spam); a second filter is shown alongside."
}
```

## Spam-check an email that was already sent

`POST /v1/emails/{id}/spam-check`

Re-scores a sent email from its stored content (within your plan’s log retention), useful when one message landed in spam.

Requires a full-access key.

Always scored with the transactional pool's IP when the account has no dedicated IP. Availability follows GET /emails/{id}/content (plan log retention), although the 404 message says 7 days.

### Path parameters

- `id` (string, required): Email id

### Errors

- `restricted_api_key` (HTTP 403)
- `not_found` (HTTP 404): content not available (kept for 7 days)
- `rate_limit_exceeded` (HTTP 429)
- `service_unavailable` (HTTP 503)
- `scanner_unavailable` (HTTP 503)

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails/019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23/spam-check' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "spam_check",
  "score": 6.2,
  "threshold": 5,
  "verdict": "spam",
  "engines": [
    {
      "engine": "spamassassin",
      "score": 6.2,
      "threshold": 5,
      "verdict": "spam",
      "rules": [
        {
          "name": "URIBL_BLOCKED",
          "score": 0.001,
          "description": "ADMINISTRATOR NOTICE: The query to URIBL was blocked"
        }
      ]
    }
  ],
  "dkim_signed": false,
  "sending_ip": "203.0.113.25",
  "issues": [
    {
      "kind": "not_signed",
      "message": "The From domain is not verified, so the message is not DKIM-signed and fails DMARC. Verify the domain before sending."
    }
  ],
  "note": "Scored as a receiving server sees it: DKIM-signed with your key, from a representative egress IP of your account, checked against live DNS blocklists. SpamAssassin is the headline score (≥ 5 = spam); a second filter is shown alongside.",
  "email_id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## Monitor

**Thresholds to watch**

- **`complaint_rate`**: Aim below 0.1%; act above 0.1%; never reach 0.3% (Gmail and Yahoo limit). Rate of delivered mail.
- **`bounce_rate`**: Healthy below 2%; above 5% means a list problem. Rate of sent mail.
- **`delayed`**: A sudden rise at one provider means throttling: lower volume there.
- **DMARC `passed`**: Close to 100% of messages from `ours: true` sources. Failing unknown sources mean an unconfigured service or spoofing.
- **Blocklists**: Should be empty. ZapSMTP checks its sending IPs every 15 minutes and verified domains every 6 hours.

Metrics are kept for 400 days and exclude test-mode mail. The [dashboard](https://zapsmtp.com/docs/dashboard/) shows the same numbers.

## Bounce and complaint rates per provider

`GET /v1/metrics`

Rates per mailbox provider for the broadcast stream over the last 7 days. `bounce_rate` is of sent, `complaint_rate` of delivered.

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
curl 'https://app.zapsmtp.com/v1/metrics?dimension=provider&stream=broadcast' \
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

## Compare your sending domains

`GET /v1/metrics`

One row per From domain, so a problem on `news.acme.com` does not hide inside your total.

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
curl 'https://app.zapsmtp.com/v1/metrics?dimension=domain&granularity=day' \
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

## Check your domain against blocklists

`GET /v1/domains/{id}/reputation`

The domain’s status on Spamhaus DBL, SURBL and URIBL, with listing and delisting events. `worst` is empty when nothing is listed.

Requires a full-access key.

Customer domains are checked automatically every 6 hours (operator-configurable). The exact JSON for codes/labels when empty (null vs []) depends on the stored arrays; not verified.

### Path parameters

- `id` (string (UUID), required): Domain id

### Errors

- `restricted_api_key` (HTTP 403)
- `not_found` (HTTP 404): domain not found

```bash
curl 'https://app.zapsmtp.com/v1/domains/019a1e9b-41c2-7a0e-b5d1-3f6c2e8a9d47/reputation' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "domain_reputation",
  "domain": "acme.com",
  "worst": "",
  "lists": [
    {
      "target": "acme.com",
      "kind": "domain",
      "list": "spamhaus-dbl",
      "name": "Spamhaus DBL",
      "listed": false,
      "severity": null,
      "codes": [],
      "labels": [],
      "detail": "",
      "error": null,
      "listed_since": null,
      "checked_at": "2026-10-21T12:00:03Z",
      "removal_url": "https://check.spamhaus.org/"
    },
    {
      "target": "acme.com",
      "kind": "domain",
      "list": "surbl",
      "name": "SURBL",
      "listed": false,
      "severity": null,
      "codes": [],
      "labels": [],
      "detail": "",
      "error": null,
      "listed_since": null,
      "checked_at": "2026-10-21T12:00:03Z",
      "removal_url": "https://www.surbl.org/surbl-analysis"
    },
    {
      "target": "acme.com",
      "kind": "domain",
      "list": "uribl",
      "name": "URIBL",
      "listed": false,
      "severity": null,
      "codes": [],
      "labels": [],
      "detail": "",
      "error": null,
      "listed_since": null,
      "checked_at": "2026-10-21T12:00:03Z",
      "removal_url": "https://admin.uribl.com/"
    }
  ],
  "events": [
    {
      "id": "019a1e00-0a1b-7c2d-8e3f-4a5b6c7d8e9f",
      "target": "acme.com",
      "kind": "domain",
      "list": "uribl",
      "name": "URIBL",
      "event": "delisted",
      "severity": null,
      "codes": [],
      "detail": "",
      "at": "2026-10-19T06:00:02Z"
    }
  ]
}
```

## Re-check right after a delisting

`POST /v1/domains/{id}/reputation/check`

Runs the domain lookups now instead of waiting for the next scheduled check. At most once a minute.

Requires a full-access live key; test keys get 403 test_key_restricted.

At most once per minute per domain name. No Retry-After header is set.

### Path parameters

- `id` (string (UUID), required): Domain id

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `not_found` (HTTP 404): domain not found
- `rate_limit_exceeded` (HTTP 429): this domain was checked less than a minute ago

```bash
curl -X POST 'https://app.zapsmtp.com/v1/domains/019a1e9b-41c2-7a0e-b5d1-3f6c2e8a9d47/reputation/check' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

Response `200`.

## Troubleshooting

**Symptom, likely cause, what to do**

- **Bounces with subType `PolicyRejected`, replies mention DMARC, SPF or “unauthenticated”**: The From domain is not verified, DKIM is missing, or a strict DMARC policy rejects mail from a source you have not set up.Run verify and check `warnings`. In the DMARC summary, look for sources with `ours: false`.
- **Gmail replies `421 4.7.28` or `550 5.7.28`, Yahoo defers with `TSS04`**: Volume rose faster than the domain’s or IP’s reputation allows, or recipients complain.Slow down and follow the warm-up curve. ZapSMTP keeps retrying deferrals. Send only to engaged recipients until the deferrals stop.
- **Bounces with subType `IPBlocked`**: The provider refuses the sending IP (for example Microsoft S3150 or a blocklist).The recipient is not suppressed. A permanent refusal from a major provider pauses the IP at once; temporary refusals pause it after 5 within an hour; refusals from other destinations need several destinations of several accounts within the hour. The last sending IP of a shared pool is not paused. Mail from a paused IP moves to other IPs. Check dedicated IPs for listings.
- **Bounces with subType `SpamBlocked` or `ContentRejected`**: The content or a linked domain is filtered.Run a spam check on the sent email. Remove listed or shortened links, add a text part, reduce images.
- **Delivered, but lands in the spam folder**: Content, low engagement or a new domain without reputation.Spam-check the message. Look at `issues`: `new_domain` fades with steady clean volume. Check Google Postmaster Tools.
- **`complaint_rate` above 0.1%**: Recipients do not expect the mail: old list, unclear sender, no visible unsubscribe link.Pause the campaign, send to recent openers and clickers only, add a visible unsubscribe link and name the brand in From.
- **`bounce_rate` above 2%**: An old or purchased list, or typos at signup.Stop importing the list. Use double opt-in. Hard bounces are suppressed automatically; do not remove them from suppressions.
- **Recipients get `email.suppressed` instead of mail**: The address bounced hard or complained earlier (every stream), or unsubscribed (broadcast mail only).Look it up. Remove it only when the person asked you to, for example after they re-subscribed.
- **Gmail shows “[Message clipped]”**: The HTML is over about 102 KB.Inline less CSS, remove comments and hidden blocks, link to long content.
- **Unsubscribe link opens “invalid unsubscribe link”**: The link was altered (for example cut off or rewritten by another tool), so its signature no longer checks.Use `{{{zap:unsubscribe_url}}}` unchanged. The link is signed for one recipient: a forwarded or copied link stays valid, but it always unsubscribes the original recipient, not the person who opens it.
- **A dedicated IP is `paused`**: During warm-up: more than 5% bounces or 30% deferrals over 6 hours. Any time: a provider block or a critical blocklist listing.Mail continues through other IPs. Fix the list or content first; contact support to resume the IP.

Bounce subtypes are listed in [Bounce classification](https://zapsmtp.com/docs/testing/#bounces). Every recipient’s exact SMTP reply is in [GET /emails/{id}](https://zapsmtp.com/docs/emails/get-email/).

## Pre-launch checklist

- Each From domain is added and `verified`; `verify` returns no `warnings`.
- SPF has one record per name with the ZapSMTP include, under 10 lookups.
- DMARC is published with the `rua` from the DMARC summary; a plan exists to move to `quarantine`.
- Marketing goes out on `stream: "broadcast"` from its own subdomain, one recipient per email.
- Every marketing email has a visible `{{{zap:unsubscribe_url}}}` link, or your own `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
- API keys are restricted per stream and domain.
- Suppressions from your previous provider are imported.
- A webhook receives `email.bounced`, `email.complained` and `email.suppressed` and your app records them.
- The campaign draft scores `good` in the spam check with empty `issues`, has a text part and is under 102 KB.
- The domains are registered in Google Postmaster Tools.
- The first sends follow the warm-up ramp, starting with your most engaged recipients.
- Someone watches `complaint_rate`, `bounce_rate` and blocklists during the first weeks.
