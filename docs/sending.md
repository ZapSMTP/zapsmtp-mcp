# Sending email

> Send email with the ZapSMTP API: addresses, HTML and text, attachments, headers, tags, idempotency, scheduling, batches, streams and retries.

Source: https://zapsmtp.com/docs/sending/

Everything [POST /emails](https://zapsmtp.com/docs/emails/send-email/) can do, with a working example for each. The examples send to the simulator: paste a test key and press **Try it** (the attachment-by-URL example points at a placeholder URL and has no Try it). Field names follow Resend, so an existing Resend integration only needs a new base URL and key.

> Base URL `https://app.zapsmtp.com/v1`. Send `Authorization: Bearer <key>` and a JSON body. Unknown fields are rejected with `400 validation_error`, so a misspelled field name is not silently ignored. The whole request, attachments included, may be up to 40 MB.

## Senders and recipients

Addresses use the RFC 5322 format: a bare `jane@example.org` or a display name with the address in angle brackets, `Jane Doe <jane@example.org>`. Put a display name that contains a comma or other punctuation in double quotes. Non-ASCII names are encoded for you.

**Address fields**

- **`from` (required)**: One address. With a live key its domain must be verified in your account (`403 domain_not_verified` otherwise); a test key accepts any domain. When you send only an address, the domain’s brand `from_name` becomes the display name. May be omitted when the template defines a sender.
- **`to` (required)**: A string or an array. At least one address.
- **`cc`, `bcc`**: A string or an array. Bcc addresses receive the email but are never written into its headers.
- **`reply_to`**: A string or an array: where replies go instead of `from`.
- **Limit**: At most 50 addresses across `to`, `cc` and `bcc` combined (`422 invalid_parameter`, “too many recipients (max 50)”). Recipients are lowercased and duplicates are sent once.
- **Invalid address**: `422 invalid_parameter` naming the field and the address, e.g. `invalid to address "jane@"`.

One email to several recipients is one message: everyone sees the same `To` and `Cc` headers. To send each person their own copy, use a batch with one recipient per email.

## Display names, cc, bcc and reply_to

`POST /v1/emails`

`to`, `cc`, `bcc` and `reply_to` take a string or an array; `from` takes one string. Display names are optional; Bcc recipients get the email but are not written into its headers.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "Jane Doe <delivered+jane@simulator.zapsmtp.com>"
  ],
  "cc": "\"Doe, John\" <delivered+john@simulator.zapsmtp.com>",
  "bcc": [
    "delivered+audit@simulator.zapsmtp.com"
  ],
  "reply_to": "Acme Support <support@acme.com>",
  "subject": "Your order has shipped",
  "text": "Your order A-1042 is on its way."
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## HTML and text

Send `html`, `text` or both; at least one is required (`422 missing_required_field`, “html or text is required”). `subject` is required and may not be blank. Some clients and many spam filters look at the text part, so an email with `html` and no `text` gets one generated from the HTML: links become “text (url)”, and hidden elements such as the preheader, styles and scripts are left out. Send your own `text` when you want to control its wording. Messages sent through SMTP relay go out exactly as given.

**What is sent**

- **`text` only**: A single `text/plain` part (UTF-8).
- **`html` only**: `multipart/alternative` with a text part generated from the HTML, then the HTML.
- **Both**: `multipart/alternative` with the text first and the HTML second.
- **`template`**: Instead of `html` and `text`; see Templates. A template without a text body gets a generated text part too.

## Send plain text only

`POST /v1/emails`

Omit `html` and the email goes out as a single `text/plain` part.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": "delivered@simulator.zapsmtp.com",
  "subject": "Your sign-in code",
  "text": "Your sign-in code is 482913. It expires in 10 minutes."
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## Send HTML with a text alternative

`POST /v1/emails`

With both bodies the email is `multipart/alternative`: clients that cannot show HTML show the text.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Welcome to Acme",
  "html": "<h1>Welcome, Jane</h1><p>Your workspace is ready. <a href=\"https://acme.com/start\">Get started</a>.</p>",
  "text": "Welcome, Jane\n\nYour workspace is ready. Get started: https://acme.com/start"
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## Templates

Pass `template: {"id": "welcome", "variables": {"first_name": "Jane"}}` to render a stored template by id or alias instead of sending `html` or `text` (combining them returns `422 invalid_parameter`). Sends always use the published version. Every variable the template uses must be supplied, otherwise `422 template_render_error` lists the missing ones. A `subject` or `from` in the request overrides the template’s. See [Templates](https://zapsmtp.com/docs/templates/) and the [template editor](https://zapsmtp.com/docs/template-editor/).

## Attachments

Each item in `attachments` carries the file either inline in `content` or as a URL in `path`, never both.

**Attachment fields**

- **`filename` (required)**: The name the recipient sees. With `path` it may be omitted: the last segment of the URL is used.
- **`content`**: The file, standard base64 with padding.
- **`path`**: An `http(s)` URL we download when you send. The download must answer `200` within 20 seconds. Private and internal addresses are refused.
- **`content_type`**: MIME type. When omitted it comes from the file extension, or from the server’s `Content-Type` for a `path`.
- **`content_id`**: Makes the file inline: reference it in the HTML as `cid:<content_id>`. In an email without `html` it is sent as an ordinary attachment.
- **Size**: The request body is limited to 40 MB (`413 payload_too_large`); base64 makes a file about a third larger, so plan on roughly 30 MB of files. Files fetched by `path` may add up to 40 MB per request, a batch included.
- **Errors**: `422 invalid_attachment` with the index, e.g. `attachments[0]: content must be base64`, `filename is required`, `set either content or path, not both`, `fetching path returned HTTP 404`.

Receiving servers often refuse messages over 20–25 MB, whatever we accept. For large files, send a link instead. Attachments of a sent email can be read back with [GET /emails/{id}/attachments](https://zapsmtp.com/docs/emails/list-sent-attachments/).

**Base64-encode a file**

Node.js:

```javascript
import { readFile } from 'node:fs/promises';

const content = (await readFile('invoice.pdf')).toString('base64');
const attachment = { filename: 'invoice.pdf', content };
```

Python:

```python
import base64

with open("invoice.pdf", "rb") as f:
    content = base64.b64encode(f.read()).decode("ascii")
attachment = {"filename": "invoice.pdf", "content": content}
```

PHP:

```php
$attachment = [
    'filename' => 'invoice.pdf',
    'content'  => base64_encode(file_get_contents('invoice.pdf')),
];
```

Go:

```go
data, err := os.ReadFile("invoice.pdf")
if err != nil {
    return err
}
attachment := map[string]string{
    "filename": "invoice.pdf",
    "content":  base64.StdEncoding.EncodeToString(data),
}
```

Ruby:

```ruby
require "base64"

attachment = {
  filename: "invoice.pdf",
  content: Base64.strict_encode64(File.binread("invoice.pdf")),
}
```

## Attach a file

`POST /v1/emails`

Put the file in `content` as standard base64 (with padding). `content_type` is optional: it is detected from the file name.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Your export",
  "text": "The export you asked for is attached.",
  "attachments": [
    {
      "filename": "orders.csv",
      "content": "b3JkZXIsdG90YWwKQS0xMDQyLDQyLjAwCg==",
      "content_type": "text/csv"
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

## Attach a file by URL

`POST /v1/emails`

Set `path` instead of `content` and we download the file when you send. Without a `filename`, the last segment of the URL is used.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Invoice A-1042",
  "html": "<p>Your invoice is attached.</p>",
  "attachments": [
    {
      "path": "https://acme.com/invoices/A-1042.pdf",
      "filename": "invoice-A-1042.pdf"
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

## Embed an inline image

`POST /v1/emails`

Give the attachment a `content_id` and reference it from the HTML as `cid:<content_id>`. The image travels with the email, so it shows even when the client blocks remote images.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Inline image",
  "html": "<p><img src=\"cid:logo\" width=\"120\" alt=\"Acme\"></p><p>Thanks for signing up.</p>",
  "attachments": [
    {
      "filename": "logo.png",
      "content": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "content_type": "image/png",
      "content_id": "logo"
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

## Custom headers

`headers` is an object of header names to string values. Headers that we build or that receivers trust for authentication cannot be set and return `422 invalid_parameter` (“header … cannot be set”):

- `From`, `To`, `Cc`, `Bcc`, `Reply-To`, `Subject`, `Date`, `Message-ID`, `MIME-Version`, `Content-Type`, `Content-Transfer-Encoding`: use the body fields instead.
- `DKIM-Signature`, `Return-Path`, `Received`, `Sender`, `Authentication-Results`, `ARC-Seal`, `ARC-Message-Signature`, `ARC-Authentication-Results`, `Received-SPF`, `Resent-*`.
- Any `X-Zap-*` header.

Setting `In-Reply-To` and `References` to the `Message-ID` of the email you answer keeps the conversation together in the recipient’s client, and the response’s `thread_id` then names that conversation. On the broadcast stream, a `List-Unsubscribe` header of your own replaces the one we add.

## Add custom headers

`POST /v1/emails`

Header names are printable ASCII without spaces or colons; values may contain any text and are encoded for you.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Re: Delivery window",
  "text": "Tuesday works for us.",
  "headers": {
    "X-Entity-Ref-ID": "ticket-1042",
    "In-Reply-To": "<CAF1x8@mail.example.org>",
    "References": "<CAF1x8@mail.example.org>"
  }
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## Tags and metadata

**Tags and metadata**

- **`tags`**: An array of `{"name", "value"}`. Both match `^[A-Za-z0-9_-]{1,256}$`; at most 20 per email. Use them for categories you report on: they come back in webhooks as an object (`data.tags`, e.g. `{"category": "receipt"}`). On `email.opened` and `email.clicked` they are left out when the email’s tags, encoded, exceed 200 bytes and split delivery numbers in [GET /metrics?tag=category=receipt](https://zapsmtp.com/docs/stats/metrics/).
- **`metadata`**: An object of strings: at most 10 keys, keys match `^[A-Za-z0-9_-]{1,40}$`, values up to 500 bytes (UTF-8). Use it for your own ids. It comes back in delivery webhooks (`data.metadata`), on `email.opened` and `email.clicked` when its JSON fits in 200 bytes (not on reply events), and on `GET /emails/{id}`, and filters the email list with `GET /emails?metadata[key]=value`.

Invalid tags or metadata return `422 invalid_parameter`.

## Tag an email and attach your own data

`POST /v1/emails`

Tags group email in metrics; metadata ties an email to your own records. Both come back on the email’s delivery webhooks; see the table above for the exceptions.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Your receipt",
  "html": "<p>Thanks for your order.</p>",
  "tags": [
    {
      "name": "category",
      "value": "receipt"
    },
    {
      "name": "plan",
      "value": "pro"
    }
  ],
  "metadata": {
    "order_id": "A-1042",
    "customer_id": "cus_8812"
  }
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## Find emails by metadata

`GET /v1/emails`

Exact match on a metadata value. Repeat the parameter to match several keys.

### Query parameters

- `metadata[order_id]` (string): Exact match on the `order_id` metadata value.

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

## Idempotency

A timeout does not tell you whether the email was sent. Send an `Idempotency-Key` header (1–256 bytes) with `POST /emails` or `POST /emails/batch`, and a retry with the same key within 24 hours returns the first result instead of sending again. Keys are scoped to your API key and kept for 24 hours, together with a fingerprint of the request.

**A second request with the same key**

- **Same body, first request finished**: The original status and body come back, with the header `Idempotent-Replayed: true`. Nothing is sent again.
- **Different body**: `409 idempotency_key_reused`
- **First request still running**: `409 idempotency_request_in_progress`: wait briefly and retry.
- **First request got `429` or a `5xx`**: The key is released, so a retry with it is processed as new.
- **Key over 256 bytes**: `400 invalid_idempotency_key`

Use a key that names the email in your system, such as `order-1042-receipt`, not a random value created per attempt. Errors from the send itself (for example `422` or `403`) are stored under the key too: after fixing the request, use a new key. Errors found before the key is checked, such as malformed JSON, an unknown field, a body over 40 MB or an invalid batch size or `x-batch-validation`, are not stored.

## Send exactly once

`POST /v1/emails`

Derive the key from your own record, so every retry of the same email carries the same key.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Idempotency-Key: order-1042-receipt' \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Your receipt",
  "text": "Thanks for your order A-1042."
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
  "thread_id": "3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13"
}
```

## Scheduling

Add `scheduled_at` and the email waits until then. The request is checked when you make it: addresses, content, headers, tags, metadata, stream and the sender domain, so those errors come back at once. Rate limits, quotas and suppressions are applied when the email is dispatched: a rate-limited dispatch is retried later, while other dispatch failures, such as an exhausted monthly quota, mark the email `failed` with the reason, and suppressed recipients are skipped as for an immediate send.

**scheduled_at**

- **RFC 3339**: `2026-10-28T09:00:00Z` or with an offset, `2026-10-28T11:00:00+02:00`.
- **Relative**: `in <n> <unit>`, unit `min`, `mins`, `minute`, `minutes`, `h`, `hour`, `hours`, `d`, `day` or `days`: `in 30 minutes`, `in 2 hours`, `in 1 day`. Other phrases (“tomorrow at 9am”) are not understood.
- **In the past**: Sent immediately.
- **Limits**: Up to 7 days ahead (`422 invalid_parameter`, “scheduled_at must be within 7 days”). At most 10,000 emails, 256 MB in total, may wait per account.
- **At send time**: The account and the API key are checked again: a suspended account or a revoked or expired key fails the email, and `GET /emails/{id}` shows `failed` with the reason.

While it waits, `GET /emails/{id}` returns `status: "scheduled"` with its `scheduled_at`, and `GET /emails?status=scheduled` lists waiting emails, soonest first: up to `limit` of them (default 20, at most 100). That list has no further pages (`has_more` is always `false`), so with more waiting emails than the limit you see only the soonest. Rescheduling and canceling work until the email is dispatched; after that, and for unknown ids, they return `409 not_cancellable`. A key restricted to a domain or stream can only manage its own scheduled emails, and a test key cannot touch live ones (`403 restricted_api_key`).

## Schedule an email

`POST /v1/emails`

The response returns the id at once; nothing is sent until the time comes.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Your trial ends tomorrow",
  "text": "Your Acme trial ends tomorrow. Upgrade any time from Settings.",
  "scheduled_at": "in 1 hour"
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f40-2b3c-7d4e-8f5a-6b7c8d9e0f12",
  "thread_id": "3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13"
}
```

## Move a scheduled email

`PATCH /v1/emails/{id}`

Only `scheduled_at` can change. The new time follows the same rules as when scheduling.

### Path parameters

- `id` (string, required): Scheduled email id

```bash
curl -X PATCH 'https://app.zapsmtp.com/v1/emails/019a1f40-2b3c-7d4e-8f5a-6b7c8d9e0f12' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "scheduled_at": "2026-10-28T09:00:00Z"
}'
```

**Response `200 OK`**

```json
{
  "object": "email",
  "id": "019a1f40-2b3c-7d4e-8f5a-6b7c8d9e0f12",
  "status": "scheduled",
  "last_event": "scheduled",
  "scheduled_at": "2026-10-23T09:00:00Z",
  "from": "Acme <hello@acme.com>",
  "to": [
    "jane@example.org"
  ],
  "subject": "Your weekly digest",
  "created_at": "2026-10-21T16:20:05.114Z"
}
```

## Cancel a scheduled email

`POST /v1/emails/{id}/cancel`

The email is never sent and its status becomes `canceled`.

### Path parameters

- `id` (string, required): Scheduled email id

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails/019a1f40-2b3c-7d4e-8f5a-6b7c8d9e0f12/cancel' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "email",
  "id": "019a1f40-2b3c-7d4e-8f5a-6b7c8d9e0f12",
  "status": "canceled"
}
```

## Batch sending

[POST /emails/batch](https://zapsmtp.com/docs/emails/send-batch/) takes an array of 1 to 100 emails (`422 invalid_parameter` otherwise), each with the fields of a single send, and sends them concurrently. The 40 MB body limit applies to the whole batch. One `Idempotency-Key` covers the whole request.

**x-batch-validation**

- **`strict` (default)**: Every email is validated first. If any is invalid, nothing is sent and the response is `422 validation_error` with an `errors` array of `{index, code, message}`.
- **`permissive`**: Valid emails are sent; invalid ones appear in `errors` and the response is `200`.

A `200` response holds `data`, one `{index, id}` per accepted email (plus `suppressed` when some of its recipients were skipped), and `errors`. `index` is the email’s position in your array. Failures that happen at send time, such as `rate_limit_exceeded` or `monthly_quota_exceeded`, are reported inside `errors` in either mode rather than as the HTTP status, so always read `errors`. To retry only the failed emails, send them in a new batch with a new Idempotency-Key: repeating the old key replays the old response.

## Send a batch

`POST /v1/emails/batch`

Up to 100 emails in one request. Each item is a complete email and may use its own sender, stream or `scheduled_at`.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails/batch' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Idempotency-Key: digest-2026-10-26-chunk-1' \
  -H 'Content-Type: application/json' \
  -d '[
  {
    "from": "Acme <hello@acme.com>",
    "to": [
      "delivered+ann@simulator.zapsmtp.com"
    ],
    "subject": "Your weekly digest",
    "text": "Hi Ann, here is your week.",
    "tags": [
      {
        "name": "category",
        "value": "digest"
      }
    ]
  },
  {
    "from": "Acme <hello@acme.com>",
    "to": [
      "delivered+bob@simulator.zapsmtp.com"
    ],
    "subject": "Your weekly digest",
    "text": "Hi Bob, here is your week.",
    "tags": [
      {
        "name": "category",
        "value": "digest"
      }
    ]
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
      "index": 1,
      "id": "019a1f2e-7c3c-7a10-8b21-4d5e6f7a8b9c"
    }
  ],
  "errors": []
}
```

## Send the valid emails, report the rest

`POST /v1/emails/batch`

With `x-batch-validation: permissive` the valid emails are sent and each invalid one is reported by its index.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails/batch' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'x-batch-validation: permissive' \
  -H 'Content-Type: application/json' \
  -d '[
  {
    "from": "Acme <hello@acme.com>",
    "to": [
      "delivered+ann@simulator.zapsmtp.com"
    ],
    "subject": "Hello Ann",
    "text": "Hi Ann!"
  },
  {
    "from": "Acme <hello@acme.com>",
    "to": [
      "delivered+bob@simulator.zapsmtp.com"
    ],
    "text": "Hi Bob!"
  },
  {
    "from": "Acme <hello@acme.com>",
    "to": [
      "suppressed@simulator.zapsmtp.com"
    ],
    "subject": "Hello Cy",
    "text": "Hi Cy!"
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
        "suppressed@simulator.zapsmtp.com"
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

## Streams

`stream` is `transactional` (the default) or `broadcast`. On shared IPs the two leave from separate pools, so newsletter traffic does not slow down or weigh on the reputation of your password resets. An account with a dedicated IP pool sends both streams from it. Any other value returns `422 invalid_parameter`. A key restricted to one stream sends on it by default and gets `403 restricted_api_key` when asked for the other.

A broadcast email to a single recipient gets RFC 8058 one-click unsubscribe headers (`List-Unsubscribe` and `List-Unsubscribe-Post`) unless you set your own; an unsubscribe adds the address to your suppressions with reason `unsubscribe`, which stops later broadcast mail to it but not transactional mail. Hard bounces, complaints and `manual` suppressions apply to both streams. For a link in the body, write `{{{zap:unsubscribe_url}}}` in the HTML or text: it becomes the recipient’s signed unsubscribe link when the email is sent, with or without a template.

`tracking: {"opens": true, "clicks": true}` overrides the From domain’s open and click tracking for one email. `tls: "required"` delivers only over TLS and `tls: "verified"` also requires a valid certificate on the receiving server; either raises the domain’s TLS policy and never lowers it.

## Send on the broadcast stream

`POST /v1/emails`

Marketing and bulk mail goes on `broadcast`. The one-click unsubscribe headers are added for you; the body link below is optional.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme News <news@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "What shipped in October",
  "stream": "broadcast",
  "html": "<p>Three new features this month.</p><p><a href=\"{{{zap:unsubscribe_url}}}\">Unsubscribe</a></p>",
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

## Test keys and the simulator

Keys that start with `zap_test_` go through the same validation, email log, events and webhooks as live keys, accept any From domain, deliver nothing and do not count against your monthly plan (the per-second limit still applies). Addresses at `simulator.zapsmtp.com` act out outcomes with live and test keys alike: `delivered@`, `bounced@`, `full@`, `blocked@`, `delayed@`, `complained@`, `suppressed@`, and `bounce+<code>@` for any reply you need. They accept `+labels` and never touch your suppression list or reputation. See [Testing & simulator](https://zapsmtp.com/docs/testing/).

## Exercise the failure paths

`POST /v1/emails`

One request, three outcomes: each simulator recipient produces its own events and webhooks within seconds.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <hello@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com",
    "bounced@simulator.zapsmtp.com",
    "delayed@simulator.zapsmtp.com"
  ],
  "subject": "Simulator run",
  "text": "Testing every path."
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## The response and what to store

A `200` means the email was accepted, not that it was delivered. Store `id` with your record: the email’s delivery webhooks carry it as `data.email_id`, and [GET /emails/{id}](https://zapsmtp.com/docs/emails/get-email/) returns its status and timeline. Delivery results arrive by [webhook](https://zapsmtp.com/docs/webhook-events/).

**Response fields**

- **`id`**: The email’s id, a time-ordered UUIDv7. Also part of the `Message-ID` header.
- **`thread_id`**: The conversation the email belongs to. Replies to it carry the same `thread_id`.
- **`suppressed`**: Recipients skipped because they are on your suppression list. Each gets an `email.suppressed` event. If every recipient is suppressed the request still succeeds: there is nothing to retry.
- **`failed_recipients`**: Recipients refused while the others were taken. They are not sent and not charged.
- **`unconfirmed`**: `true` when the message was handed over but the confirmation was lost. It counts as sent; do not retry it. Its events tell the outcome. ZapSMTP checks these sends itself: recipients the MTA never logged receiving are sent again once that MTA node has been back for 10 minutes, or after it has been down for an hour in a row. A rare duplicate is possible. A loss is extremely unlikely: ZapSMTP keeps the message to check it, and only if object storage stays unavailable for minutes is a send left unchecked (we count those).

Responses to immediate sends usually report your budget: `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` for recipients per second, and `Zap-Quota-Monthly-Limit` and `Zap-Quota-Monthly-Remaining` for the month. On paid plans without a spending cap, `Zap-Quota-Monthly-Limit` is `unlimited` and the remaining header is omitted. Scheduling responses, and accounts without a per-second limit, carry none of these headers. Every response carries an `X-Request-Id`; log it and include it when you contact support.

## Check what happened

`GET /v1/emails/{id}`

Per-recipient status and the full event timeline, including the receiving server’s reply.

### Path parameters

- `id` (string, required): Email id

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

## Errors and retries

Errors carry the HTTP status plus `name` (the error code) and `message`; the full list is in [Errors, limits & paging](https://zapsmtp.com/docs/conventions/#errors). Retry only what can succeed unchanged, always with the same Idempotency-Key, and back off exponentially when there is no `Retry-After`.

**Should you retry?**

- **`rate_limit_exceeded` (HTTP 429)**: Yes. Wait for `Retry-After` (1 second).
- **`overloaded` (HTTP 429)**: Yes. The server is at capacity or briefly backed up and nothing was sent: wait for `Retry-After` (1 or 5 seconds).
- **`service_unavailable` (HTTP 503)**: Yes. Wait for `Retry-After` (2–5 seconds).
- **`internal_error` (HTTP 500)**: Yes, with backoff and the same Idempotency-Key.
- **`idempotency_request_in_progress` (HTTP 409)**: Yes, after a short pause: the first request with this key is still running.
- **`Network error or timeout` (no response)**: Yes, with the same Idempotency-Key: you cannot tell whether the first attempt was accepted.
- **`daily_quota_exceeded` (HTTP 429)**: Not until the limit resets at 00:00 UTC.
- **`monthly_quota_exceeded` (HTTP 429)**: No. The Free plan or your spending cap is reached for the month.
- **`misdirected_cell` (HTTP 421)**: Not here. Your account is served by another cell: send to the URL named in the message (the `Zap-Cell` header names the cell).
- **`idempotency_key_reused` (HTTP 409)**: No. The key was used for a different body: fix the key, not the timing.
- **`400, 401, 403, 413, 422` (HTTP 4xx)**: No. The request itself has to change; the message says what is wrong.

The per-second limit counts recipients across all your requests. If you send in bursts, spread them using `RateLimit-Remaining` rather than waiting for `429`s.

**Retry safely**

Node.js:

```javascript
const API = 'https://app.zapsmtp.com/v1';
// Safe to repeat with the same Idempotency-Key: the email is sent at most once.
const RETRYABLE = new Set(['rate_limit_exceeded', 'overloaded', 'idempotency_request_in_progress', 'internal_error', 'service_unavailable']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function send(email, idempotencyKey) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.ZAP_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(email),
      });
    } catch (networkError) {
      if (attempt >= 5) throw networkError;
      await sleep(2 ** attempt * 500); // no answer: retry with the same key
      continue;
    }
    const body = await res.json();
    if (res.ok) return body; // store body.id
    if (!RETRYABLE.has(body.name) || attempt >= 5) {
      throw new Error(`${res.status} ${body.name}: ${body.message}`);
    }
    const retryAfter = Number(res.headers.get('Retry-After'));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500);
  }
}
```

Python:

```python
import os, time, requests

API = "https://app.zapsmtp.com/v1"
RETRYABLE = {"rate_limit_exceeded", "overloaded", "idempotency_request_in_progress", "internal_error", "service_unavailable"}

def send(email: dict, idempotency_key: str) -> dict:
    for attempt in range(6):
        try:
            res = requests.post(
                f"{API}/emails",
                json=email,
                headers={
                    "Authorization": f"Bearer {os.environ['ZAP_API_KEY']}",
                    "Idempotency-Key": idempotency_key,
                },
                timeout=30,
            )
        except requests.RequestException:
            time.sleep(2 ** attempt * 0.5)  # no answer: retry with the same key
            continue
        body = res.json()
        if res.ok:
            return body  # store body["id"]
        if body.get("name") not in RETRYABLE:
            raise RuntimeError(f"{res.status_code} {body.get('name')}: {body.get('message')}")
        time.sleep(float(res.headers.get("Retry-After") or 2 ** attempt * 0.5))
    raise RuntimeError("gave up after 6 attempts")
```

## SMTP instead of the API

If your application or platform already speaks SMTP, point it at the ZapSMTP relay with SMTP credentials. Messages sent that way get the same suppression checks, events, webhooks and email log. The API is the better fit when you want attachments by URL, templates, tags and metadata, scheduling, batches and idempotency. See [SMTP relay](https://zapsmtp.com/docs/smtp/).
