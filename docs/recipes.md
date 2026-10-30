# Recipes

> Copy-paste ZapSMTP recipes: password resets, receipts with PDFs, drip series, newsletters, bounce webhooks, support inbox, magic links, retries.

Source: https://zapsmtp.com/docs/recipes/

Complete, end-to-end solutions to the jobs most apps need email for. Each recipe gives the API calls (sends, previews and reads run here with a test key; creating templates, domains, webhooks, inbound domains, API keys and thread metadata needs a full-access live key, since test keys get `403 test_key_restricted`) and the application code in Node.js, Python and Go or PHP. Keys always come from environment variables and every call runs on your server.

**On this page**

- Setup: one helper per language
- 1. Password reset with a template and an idempotency key
- 2. Order confirmation with line items and a PDF invoice
- 3. Welcome series: send now, day 2 and day 7, cancel on churn
- 4. Weekly newsletter: broadcast stream, one-click unsubscribe, batching
- 5. Bounces and complaints: webhooks, user flags, Slack alerts
- 6. Support inbox: receive, open a ticket, reply in the thread
- 7. Magic-link sign-in and CI tests with simulator addresses
- 8. Sending for many client domains (agencies)
- 9. Retries with exponential backoff and Retry-After
- 10. Next.js, Express, Django and Laravel

## Setup: one helper per language

The recipes share two small functions: `zap()` sends one API request and throws an error carrying the HTTP status, the error `code` (for example `rate_limit_exceeded`) and `Retry-After`; `verifyZapSignature()` checks a webhook’s `Zap-Signature` header as described in [Webhook events](https://zapsmtp.com/docs/webhook-events/#signatures). Save the file for your language next to your code.

**Environment**

- **`ZAP_API_KEY`**: A live key (`zap_…`) in production, a test key (`zap_test_…`) in development and CI. Test keys run the whole pipeline, accept any From domain and never deliver, but they can only send, preview templates, reply to received mail and read: one-time setup (templates, domains, webhooks, inbound domains, API keys, thread metadata, suppressions) needs a full-access live key. See [API keys](https://zapsmtp.com/docs/conventions/#keys).
- **`ZAP_WEBHOOK_SECRET`**: The `whsec_…` secret of your webhook endpoint, only where you receive webhooks.

**zap helper**

Node.js:

```javascript
// zap.mjs: Node.js 18+ (built-in fetch). Server-side only.
import crypto from 'node:crypto';

const API = 'https://api.zapsmtp.com/v1';

export class ZapError extends Error {
  constructor(status, body, headers) {
    super(`${status} ${body?.name ?? 'error'}: ${body?.message ?? ''}`);
    this.status = status;
    this.code = body?.name;
    this.retryAfter = Number(headers.get('Retry-After')) || 0; // seconds
    this.requestId = headers.get('X-Request-Id');
  }
}

export async function zap(method, path, body, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.ZAP_API_KEY}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new ZapError(res.status, data, res.headers);
  return data;
}

// Webhooks: HMAC-SHA256 of "<t>.<raw body>", keyed with the whole whsec_ secret.
export function verifyZapSignature(rawBody, header, secret = process.env.ZAP_WEBHOOK_SECRET) {
  const parts = String(header ?? '').split(',').map((p) => p.split('='));
  const t = parts.find(([k]) => k === 't')?.[1] ?? '';
  if (!/^\d+$/.test(t) || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  return parts.some(([k, v]) => k === 'v1' && v?.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)));
}
```

Python:

```python
# zap.py: pip install requests. Server-side only.
import hashlib, hmac, os, time
import requests

API = "https://api.zapsmtp.com/v1"

class ZapError(Exception):
    def __init__(self, status, body, headers):
        body = body or {}
        super().__init__(f"{status} {body.get('name')}: {body.get('message')}")
        self.status, self.code = status, body.get("name")
        self.retry_after = float(headers.get("Retry-After") or 0)  # seconds
        self.request_id = headers.get("X-Request-Id")

def zap(method, path, body=None, headers=None):
    res = requests.request(method, API + path, json=body, timeout=30, headers={
        "Authorization": f"Bearer {os.environ['ZAP_API_KEY']}", **(headers or {})})
    try:
        data = res.json() if res.content else None
    except ValueError:
        data = None
    if not res.ok:
        raise ZapError(res.status_code, data, res.headers)
    return data

def verify_zap_signature(raw_body: bytes, header: str, secret: str | None = None) -> bool:
    secret = secret or os.environ["ZAP_WEBHOOK_SECRET"]
    parts = [p.split("=", 1) for p in (header or "").split(",") if "=" in p]
    t = next((v for k, v in parts if k == "t"), "")
    if not t.isdigit() or abs(time.time() - int(t)) > 300:
        return False
    expected = hmac.new(secret.encode(), t.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return any(k == "v1" and hmac.compare_digest(v, expected) for k, v in parts)
```

Go:

```go
// Package zap: a minimal ZapSMTP client. Server-side only.
package zap

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const API = "https://api.zapsmtp.com/v1"

type Error struct {
	Status     int
	Code       string
	Message    string
	RetryAfter time.Duration
}

func (e *Error) Error() string { return fmt.Sprintf("%d %s: %s", e.Status, e.Code, e.Message) }

// Do sends one request; out (may be nil) receives the JSON answer.
func Do(ctx context.Context, method, path string, body any, headers map[string]string, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, API+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("ZAP_API_KEY"))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		var e struct{ Name, Message string }
		json.Unmarshal(data, &e)
		secs, _ := strconv.Atoi(res.Header.Get("Retry-After"))
		return &Error{res.StatusCode, e.Name, e.Message, time.Duration(secs) * time.Second}
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

// VerifySignature checks Zap-Signature: HMAC-SHA256 of "<t>.<raw body>".
func VerifySignature(body []byte, header, secret string) bool {
	var t string
	var sigs []string
	for _, part := range strings.Split(header, ",") {
		k, v, _ := strings.Cut(part, "=")
		switch k {
		case "t":
			t = v
		case "v1":
			sigs = append(sigs, v)
		}
	}
	ts, err := strconv.ParseInt(t, 10, 64)
	if err != nil || time.Since(time.Unix(ts, 0)).Abs() > 5*time.Minute {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(t + "."))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	for _, s := range sigs {
		if hmac.Equal([]byte(s), []byte(expected)) {
			return true
		}
	}
	return false
}
```

PHP:

```php
<?php
// zap.php: PHP 8.1+ with ext-curl. Server-side only.
const ZAP_API = 'https://api.zapsmtp.com/v1';

final class ZapError extends RuntimeException
{
    public function __construct(public int $status, public string $zapCode, string $message, public float $retryAfter = 0)
    {
        parent::__construct("$status $zapCode: $message");
    }
}

function zap(string $method, string $path, ?array $body = null, array $headers = []): ?array
{
    $h = ['Authorization: Bearer ' . getenv('ZAP_API_KEY')];
    if ($body !== null) $h[] = 'Content-Type: application/json';
    foreach ($headers as $k => $v) $h[] = "$k: $v";
    $retryAfter = 0;
    $ch = curl_init(ZAP_API . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $h,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$retryAfter) {
            if (stripos($line, 'Retry-After:') === 0) $retryAfter = (float) trim(substr($line, 12));
            return strlen($line);
        },
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $raw = curl_exec($ch);
    if ($raw === false) throw new ZapError(0, 'network_error', curl_error($ch));
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $data = $raw === '' ? null : json_decode($raw, true);
    if ($status >= 300) throw new ZapError($status, $data['name'] ?? '', $data['message'] ?? '', $retryAfter);
    return $data;
}

function verify_zap_signature(string $body, string $header, ?string $secret = null): bool
{
    $secret ??= getenv('ZAP_WEBHOOK_SECRET');
    $t = '';
    $sigs = [];
    foreach (explode(',', $header) as $part) {
        [$k, $v] = array_pad(explode('=', $part, 2), 2, '');
        if ($k === 't') $t = $v;
        if ($k === 'v1') $sigs[] = $v;
    }
    if (!ctype_digit($t) || abs(time() - (int) $t) > 300) return false;
    $expected = hash_hmac('sha256', $t . '.' . $body, $secret);
    foreach ($sigs as $s) if (hash_equals($expected, $s)) return true;
    return false;
}
```

## 1. Password reset with a template and an idempotency key

**What you build:** a “forgot password” flow that emails a single-use, 30-minute link and can be retried safely after a timeout without sending two emails.

1. Create and publish a `password-reset` template once. Sends always use the published version.
2. Per request, generate a random token, store only its hash with an expiry, and send the template with `Idempotency-Key: password-reset-<token id>`.
3. Turn off open and click tracking for this email so the link is not rewritten.

## Create the reset template

`POST /v1/templates`

Once, at deploy time. `publish: true` makes it usable for sending right away.

Requires a full-access live key; test keys get 403 test_key_restricted.

Syntax: {{var}} escaped, {{{var}}} raw, {{#list}}…{{/list}} sections, {{^x}}…{{/x}} inverted sections. Exact ordering of variable_names is determined by the parser; the example order is illustrative.

Body: html and text both empty → 422 missing_required_field; template syntax errors → 422 template_render_error "<field>: <error>"; a tag that is not a variable name ({{first name}}, {{#each items}}, {{> footer}}) → 422 template_render_error "html: line L, column C: {{…}} is not a variable name: …"

`variable_schema` in the response is the saved list after discovery. A send is checked against the published copy, `published.variable_schema`.

### Body parameters

- `name` (string, required): Limits: trimmed, 1-200 characters → 422 missing_required_field "name is required (max 200 chars)"
- `alias` (string): Stable handle usable instead of the id (template.id in sends, /templates/{alias}). Limits: ^[a-z0-9][a-z0-9_-]{0,62}$ → 422 invalid_parameter; duplicate → 409 conflict
- `subject` (string): Mustache source.
- `html` (string): At least one of html and text is required. Mustache source; {{var}} is HTML-escaped, {{{var}}} raw.
- `text` (string)
- `from` (string): Default From used when a send omits from.
- `variables` (object): Sample variables used by previews. Never used for sending; a variable first found in the source takes its sample as `example`.
- `variable_schema` (object[]): Declares the template’s variables (see [Variable schema](https://zapsmtp.com/docs/templating/#schema)). Replaces the declared list when given. On every save, names the source uses that the list lacks are added (their sample value as example): a section {{#x}} as optional `any`, a dotted {{x.y}} as a required `object`, any other name as a required `any`, never stricter than sends were before, and declared names the source no longer uses are kept with `unused: true`. Limits: at most 200 entries, no duplicates, defaults and examples of their type → 422 invalid_parameter "variable_schema: <reason>"
  - `name` (string, required): Variable name: letters, digits, `_` and `-`, starting with a letter or `_`, up to 64; `global` is reserved.
  - `type` (string, required): What a send must pass. One of `string`, `number`, `boolean`, `url`, `date`, `list`, `object`, `any`.
  - `required` (boolean): A send without a value (or with `null`) and without a default is refused with `template_variables_missing`. Default `false`.
  - `default` (any): Used when a send gives no value; must be of `type`.
  - `example` (any): Used by previews; must be of `type`.
  - `description` (string): For your team; at most 500 bytes.
- `design` (object | null): The visual editor’s document (a JSON object with a numeric `version`), stored with the template. `null` makes it a code template. Changing `html` without sending `design` drops the design (it no longer describes the HTML). Limits: max 1 MB → 422 invalid_parameter "design is larger than 1 MB"; not an object with a numeric version → 422 invalid_parameter
- `publish` (boolean): Publish the result in the same call. Without it the template stays a draft and is not used for sending until [published](https://zapsmtp.com/docs/templates/publish-template/). Default `false`.

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `conflict` (HTTP 409): a template with this alias already exists
- `payload_too_large` (HTTP 413): request body too large (over 4 MB)
- `missing_required_field` (HTTP 422)
- `invalid_parameter` (HTTP 422)
- `template_render_error` (HTTP 422): template syntax error: "<field>: <error>"
- `template_render_error` (HTTP 422): a tag that is not a variable name, e.g. {{first name}}, {{#each items}}, {{> footer}}: "html: line L, column C: {{…}} is not a variable name: letters, digits, _ and - (no spaces), parts joined with dots"

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "Password reset",
  "alias": "password-reset",
  "from": "Acme <security@acme.com>",
  "subject": "Reset your Acme password",
  "html": "<p>Hi {{first_name}},</p><p><a href=\"{{reset_url}}\">Choose a new password</a>. The link works once, for {{expires_minutes}} minutes.</p><p>Did not ask for this? Ignore this email; your password stays the same.</p>",
  "text": "Hi {{first_name}},\n\nChoose a new password: {{reset_url}}\nThe link works once, for {{expires_minutes}} minutes.\n\nDid not ask for this? Ignore this email.",
  "publish": true
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f23-7f80-7192-8b3c-4d5e6f7a8b9c",
  "name": "Receipt",
  "alias": "receipt",
  "subject": "Your receipt for {{order_id}}",
  "html": "<p>Hi {{name}}, thanks for order {{order_id}}.</p>",
  "text": "Hi {{name}}, thanks for order {{order_id}}.",
  "from": "Acme <billing@acme.com>",
  "variables": {
    "name": "Jane",
    "order_id": "A-1042"
  },
  "variable_schema": [
    {
      "name": "order_id",
      "type": "string",
      "required": true,
      "example": "A-1042",
      "description": "Order number shown to the customer"
    },
    {
      "name": "name",
      "type": "string",
      "required": false,
      "default": "there",
      "example": "Jane"
    }
  ],
  "design": null,
  "created_at": "2026-10-21T16:10:00Z",
  "updated_at": "2026-10-21T16:10:00Z",
  "object": "template",
  "variable_names": [
    "order_id",
    "name"
  ],
  "status": "draft",
  "has_unpublished_changes": false,
  "published_at": null,
  "published": null
}
```

## Send the reset email

`POST /v1/emails`

One call per reset request. The `Idempotency-Key` is tied to the reset token, so a retry after a timeout returns the first answer instead of sending a second email.

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
  -H 'Idempotency-Key: password-reset-5b1e0c9a-2f7d-4c3e-9a10-6d8e7f2a1b34' \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <security@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "template": {
    "id": "password-reset",
    "variables": {
      "first_name": "Ann",
      "reset_url": "https://acme.com/reset?id=5b1e0c9a&token=Xk2…",
      "expires_minutes": 30
    }
  },
  "tracking": {
    "opens": false,
    "clicks": false
  },
  "tags": [
    {
      "name": "category",
      "value": "password-reset"
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

**Send a password reset**

Node.js:

```javascript
import crypto from 'node:crypto';
import { zap } from './zap.mjs';

// db is your own data layer.
export async function sendPasswordReset(email) {
  const user = await db.users.findByEmail(email);
  if (!user) return; // answer the caller the same way: never reveal who has an account

  const tokenId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  await db.passwordResets.insert({
    id: tokenId,
    userId: user.id,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'), // store only the hash
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });

  return zap('POST', '/emails', {
    from: 'Acme <security@acme.com>',
    to: [user.email],
    template: {
      id: 'password-reset',
      variables: {
        first_name: user.firstName,
        reset_url: `https://acme.com/reset?id=${tokenId}&token=${token}`,
        expires_minutes: 30,
      },
    },
    tracking: { opens: false, clicks: false }, // keep the link exactly as generated
    tags: [{ name: 'category', value: 'password-reset' }],
    metadata: { user_id: String(user.id) },
  }, { 'Idempotency-Key': `password-reset-${tokenId}` });
}
```

Python:

```python
import hashlib, secrets, uuid
from datetime import datetime, timedelta, timezone
from zap import zap

def send_password_reset(email: str):
    user = db.users.find_by_email(email)  # db is your own data layer
    if user is None:
        return  # same answer either way: never reveal who has an account

    token_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    db.password_resets.insert(
        id=token_id, user_id=user.id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    return zap("POST", "/emails", {
        "from": "Acme <security@acme.com>",
        "to": [user.email],
        "template": {"id": "password-reset", "variables": {
            "first_name": user.first_name,
            "reset_url": f"https://acme.com/reset?id={token_id}&token={token}",
            "expires_minutes": 30,
        }},
        "tracking": {"opens": False, "clicks": False},
        "tags": [{"name": "category", "value": "password-reset"}],
        "metadata": {"user_id": str(user.id)},
    }, headers={"Idempotency-Key": f"password-reset-{token_id}"})
```

Go:

```go
func SendPasswordReset(ctx context.Context, u User) error {
	tokenID := uuid.NewString() // github.com/google/uuid
	raw := make([]byte, 32)
	rand.Read(raw) // crypto/rand
	token := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(token))
	if err := db.SavePasswordReset(ctx, tokenID, u.ID, hex.EncodeToString(sum[:]), time.Now().Add(30*time.Minute)); err != nil {
		return err
	}
	body := map[string]any{
		"from": "Acme <security@acme.com>",
		"to":   []string{u.Email},
		"template": map[string]any{
			"id": "password-reset",
			"variables": map[string]any{
				"first_name":      u.FirstName,
				"reset_url":       "https://acme.com/reset?id=" + tokenID + "&token=" + token,
				"expires_minutes": 30,
			},
		},
		"tracking": map[string]bool{"opens": false, "clicks": false},
		"tags":     []map[string]string{{"name": "category", "value": "password-reset"}},
	}
	return zap.Do(ctx, "POST", "/emails", body, map[string]string{"Idempotency-Key": "password-reset-" + tokenID}, nil)
}
```

> The same key with a different body answers `409 idempotency_key_reused`; a key whose first attempt got a 429 or 5xx is released and can be retried. Keys are kept for 24 hours. The email log stores the sent content for your plan’s retention, so keep reset links short-lived and single-use.

## 2. Order confirmation with line items and a PDF invoice

**What you build:** a receipt whose table repeats over the order’s items, with the invoice attached as a PDF.

1. Create a template with a section, `{{#items}}…{{/items}}`, that repeats per item. Optional blocks such as a gift note use a section too and render only when the value is present.
2. Format money as strings in your code: templates are logic-less and print numbers as they are.
3. Preview with real data, then send with the PDF base64-encoded in `attachments[].content` and the order id as the idempotency key.

## Create the order template

`POST /v1/templates`

`{{#items}}…{{/items}}` repeats once per line item; inside it, names resolve against the item first. `{{#gift_note}}` renders only when the value is present and not empty.

Requires a full-access live key; test keys get 403 test_key_restricted.

Syntax: {{var}} escaped, {{{var}}} raw, {{#list}}…{{/list}} sections, {{^x}}…{{/x}} inverted sections. Exact ordering of variable_names is determined by the parser; the example order is illustrative.

Body: html and text both empty → 422 missing_required_field; template syntax errors → 422 template_render_error "<field>: <error>"; a tag that is not a variable name ({{first name}}, {{#each items}}, {{> footer}}) → 422 template_render_error "html: line L, column C: {{…}} is not a variable name: …"

`variable_schema` in the response is the saved list after discovery. A send is checked against the published copy, `published.variable_schema`.

### Body parameters

- `name` (string, required): Limits: trimmed, 1-200 characters → 422 missing_required_field "name is required (max 200 chars)"
- `alias` (string): Stable handle usable instead of the id (template.id in sends, /templates/{alias}). Limits: ^[a-z0-9][a-z0-9_-]{0,62}$ → 422 invalid_parameter; duplicate → 409 conflict
- `subject` (string): Mustache source.
- `html` (string): At least one of html and text is required. Mustache source; {{var}} is HTML-escaped, {{{var}}} raw.
- `text` (string)
- `from` (string): Default From used when a send omits from.
- `variables` (object): Sample variables used by previews. Never used for sending; a variable first found in the source takes its sample as `example`.
- `variable_schema` (object[]): Declares the template’s variables (see [Variable schema](https://zapsmtp.com/docs/templating/#schema)). Replaces the declared list when given. On every save, names the source uses that the list lacks are added (their sample value as example): a section {{#x}} as optional `any`, a dotted {{x.y}} as a required `object`, any other name as a required `any`, never stricter than sends were before, and declared names the source no longer uses are kept with `unused: true`. Limits: at most 200 entries, no duplicates, defaults and examples of their type → 422 invalid_parameter "variable_schema: <reason>"
  - `name` (string, required): Variable name: letters, digits, `_` and `-`, starting with a letter or `_`, up to 64; `global` is reserved.
  - `type` (string, required): What a send must pass. One of `string`, `number`, `boolean`, `url`, `date`, `list`, `object`, `any`.
  - `required` (boolean): A send without a value (or with `null`) and without a default is refused with `template_variables_missing`. Default `false`.
  - `default` (any): Used when a send gives no value; must be of `type`.
  - `example` (any): Used by previews; must be of `type`.
  - `description` (string): For your team; at most 500 bytes.
- `design` (object | null): The visual editor’s document (a JSON object with a numeric `version`), stored with the template. `null` makes it a code template. Changing `html` without sending `design` drops the design (it no longer describes the HTML). Limits: max 1 MB → 422 invalid_parameter "design is larger than 1 MB"; not an object with a numeric version → 422 invalid_parameter
- `publish` (boolean): Publish the result in the same call. Without it the template stays a draft and is not used for sending until [published](https://zapsmtp.com/docs/templates/publish-template/). Default `false`.

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `conflict` (HTTP 409): a template with this alias already exists
- `payload_too_large` (HTTP 413): request body too large (over 4 MB)
- `missing_required_field` (HTTP 422)
- `invalid_parameter` (HTTP 422)
- `template_render_error` (HTTP 422): template syntax error: "<field>: <error>"
- `template_render_error` (HTTP 422): a tag that is not a variable name, e.g. {{first name}}, {{#each items}}, {{> footer}}: "html: line L, column C: {{…}} is not a variable name: letters, digits, _ and - (no spaces), parts joined with dots"

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "Order confirmation",
  "alias": "order-confirmation",
  "from": "Acme Shop <orders@acme.com>",
  "subject": "Order {{order_id}} confirmed",
  "html": "<h1>Thanks, {{customer.first_name}}!</h1><p>Order {{order_id}}</p><table>{{#items}}<tr><td>{{name}} × {{quantity}}</td><td align=\"right\">{{price}}</td></tr>{{/items}}</table><p>Total: <strong>{{total}}</strong></p>{{#gift_note}}<p>Gift note: {{gift_note}}</p>{{/gift_note}}<p>Your invoice is attached.</p>",
  "text": "Thanks, {{customer.first_name}}!\nOrder {{order_id}}\n{{#items}}- {{name}} x {{quantity}}: {{price}}\n{{/items}}Total: {{total}}",
  "publish": true
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f23-7f80-7192-8b3c-4d5e6f7a8b9c",
  "name": "Receipt",
  "alias": "receipt",
  "subject": "Your receipt for {{order_id}}",
  "html": "<p>Hi {{name}}, thanks for order {{order_id}}.</p>",
  "text": "Hi {{name}}, thanks for order {{order_id}}.",
  "from": "Acme <billing@acme.com>",
  "variables": {
    "name": "Jane",
    "order_id": "A-1042"
  },
  "variable_schema": [
    {
      "name": "order_id",
      "type": "string",
      "required": true,
      "example": "A-1042",
      "description": "Order number shown to the customer"
    },
    {
      "name": "name",
      "type": "string",
      "required": false,
      "default": "there",
      "example": "Jane"
    }
  ],
  "design": null,
  "created_at": "2026-10-21T16:10:00Z",
  "updated_at": "2026-10-21T16:10:00Z",
  "object": "template",
  "variable_names": [
    "order_id",
    "name"
  ],
  "status": "draft",
  "has_unpublished_changes": false,
  "published_at": null,
  "published": null
}
```

## Preview it with real data

`POST /v1/templates/{id}/render`

Renders the template without sending. A variable the template needs but the data lacks is reported here; a send would fail with `422 template_variables_missing` for a required variable (`template_render_error` only for a template published before variable schemas, or a field missing inside an object).

Requires a full-access key.

Missing variables do not fail the preview; they are listed in missing_variables.

### Path parameters

- `id` (string, required): Template id or alias

### Body parameters

- `variables` (object): Variables to render with; when omitted the template's stored sample variables are used.

### Errors

- `restricted_api_key` (HTTP 403)
- `not_found` (HTTP 404): template not found
- `template_render_error` (HTTP 422)

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates/order-confirmation/render' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "variables": {
    "customer": {
      "first_name": "Ann"
    },
    "order_id": "A-1042",
    "items": [
      {
        "name": "Desk lamp",
        "quantity": 1,
        "price": "$49.00"
      },
      {
        "name": "LED bulb",
        "quantity": 2,
        "price": "$24.00"
      }
    ],
    "total": "$73.00"
  }
}'
```

**Response `200 OK`**

```json
{
  "subject": "Your receipt for A-1042",
  "html": "<p>Hi Jane, thanks for order A-1042.</p>",
  "text": "Hi Jane, thanks for order A-1042.",
  "missing_variables": [],
  "variable_names": [
    "order_id",
    "name"
  ],
  "design": null
}
```

## Send it with the invoice

`POST /v1/emails`

Attachments are base64 in `content` (or an HTTPS URL in `path` that ZapSMTP downloads). The whole JSON request is capped at 40 MB, base64 included (base64 adds about a third), so the files themselves can total only about 30 MB; a batch shares one 40 MB request. Larger requests get `413 payload_too_large`.

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
  -H 'Idempotency-Key: order-A-1042-confirmation' \
  -H 'Content-Type: application/json' \
  -d '{
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "template": {
    "id": "order-confirmation",
    "variables": {
      "customer": {
        "first_name": "Ann"
      },
      "order_id": "A-1042",
      "items": [
        {
          "name": "Desk lamp",
          "quantity": 1,
          "price": "$49.00"
        },
        {
          "name": "LED bulb",
          "quantity": 2,
          "price": "$24.00"
        }
      ],
      "total": "$73.00"
    }
  },
  "attachments": [
    {
      "filename": "invoice-A-1042.pdf",
      "content": "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMTAwXS9SZXNvdXJjZXM8PD4+L0NvbnRlbnRzIDQgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDA+PgpzdHJlYW0KCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTQgMDAwMDAgbiAKMDAwMDAwMDEwNSAwMDAwMCBuIAowMDAwMDAwMTk5IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA1L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMjQ2CiUlRU9GCg==",
      "content_type": "application/pdf"
    }
  ],
  "tags": [
    {
      "name": "category",
      "value": "order"
    }
  ],
  "metadata": {
    "order_id": "A-1042"
  }
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

**Send an order confirmation**

Node.js:

```javascript
import { readFile } from 'node:fs/promises';
import { zap } from './zap.mjs';

const money = (cents, currency) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

export async function sendOrderConfirmation(order) {
  const pdf = await readFile(order.invoicePath); // or render it in memory
  return zap('POST', '/emails', {
    to: [order.customer.email],
    template: {
      id: 'order-confirmation', // its from and subject are used
      variables: {
        customer: { first_name: order.customer.firstName },
        order_id: order.id,
        items: order.items.map((i) => ({
          name: i.name, quantity: i.quantity, price: money(i.totalCents, order.currency),
        })),
        total: money(order.totalCents, order.currency),
        ...(order.giftNote && { gift_note: order.giftNote }),
      },
    },
    attachments: [{
      filename: `invoice-${order.id}.pdf`,
      content: pdf.toString('base64'),
      content_type: 'application/pdf',
    }],
    tags: [{ name: 'category', value: 'order' }],
    metadata: { order_id: order.id },
  }, { 'Idempotency-Key': `order-${order.id}-confirmation` });
}
```

Python:

```python
import base64
from babel.numbers import format_currency  # pip install babel, or format money your way
from zap import zap

def send_order_confirmation(order):
    with open(order.invoice_path, "rb") as f:
        pdf = base64.b64encode(f.read()).decode()
    variables = {
        "customer": {"first_name": order.customer.first_name},
        "order_id": order.id,
        "items": [{"name": i.name, "quantity": i.quantity,
                   "price": format_currency(i.total_cents / 100, order.currency, locale="en_US")}
                  for i in order.items],
        "total": format_currency(order.total_cents / 100, order.currency, locale="en_US"),
    }
    if order.gift_note:
        variables["gift_note"] = order.gift_note
    return zap("POST", "/emails", {
        "to": [order.customer.email],
        "template": {"id": "order-confirmation", "variables": variables},
        "attachments": [{"filename": f"invoice-{order.id}.pdf", "content": pdf,
                         "content_type": "application/pdf"}],
        "tags": [{"name": "category", "value": "order"}],
        "metadata": {"order_id": order.id},
    }, headers={"Idempotency-Key": f"order-{order.id}-confirmation"})
```

PHP:

```php
<?php
require_once 'zap.php';

function send_order_confirmation(array $order): array
{
    $fmt = new NumberFormatter('en_US', NumberFormatter::CURRENCY); // ext-intl
    $money = fn (int $cents) => $fmt->formatCurrency($cents / 100, $order['currency']);
    $variables = [
        'customer' => ['first_name' => $order['customer']['first_name']],
        'order_id' => $order['id'],
        'items' => array_map(fn ($i) => [
            'name' => $i['name'], 'quantity' => $i['quantity'], 'price' => $money($i['total_cents']),
        ], $order['items']),
        'total' => $money($order['total_cents']),
    ];
    if (!empty($order['gift_note'])) $variables['gift_note'] = $order['gift_note'];

    return zap('POST', '/emails', [
        'to' => [$order['customer']['email']],
        'template' => ['id' => 'order-confirmation', 'variables' => $variables],
        'attachments' => [[
            'filename' => "invoice-{$order['id']}.pdf",
            'content' => base64_encode(file_get_contents($order['invoice_path'])),
            'content_type' => 'application/pdf',
        ]],
        'tags' => [['name' => 'category', 'value' => 'order']],
        'metadata' => ['order_id' => $order['id']],
    ], ['Idempotency-Key' => "order-{$order['id']}-confirmation"]);
}
```

> A required variable the data does not contain fails the send with `422 template_variables_missing` and names it (a field missing inside an object, or any variable of a template published before variable schemas, fails with `422 template_render_error`). A section whose value is missing simply renders nothing. `from` and `subject` come from the template unless you pass them.

## 3. Welcome series: send now, day 2 and day 7, cancel on churn

**What you build:** three onboarding emails queued at signup, and a function that removes the unsent ones when the user unsubscribes or leaves.

1. At signup, send one batch: the first email without `scheduled_at`, the others with `"in 2 days"` and `"in 7 days"`.
2. Store the returned ids on the user.
3. On unsubscribe or churn, cancel each id; treat `409 not_cancellable` as done.

## Queue the whole series in one call

`POST /v1/emails/batch`

Each email in a batch can carry its own `scheduled_at`. In the default strict mode an email that fails validation stops the whole batch before anything is sent. Sending and scheduling then run per email, so a send-time failure (such as `rate_limit_exceeded`) affects only that email and is reported in `errors[]`: handle it.

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
  -H 'Idempotency-Key: welcome-user-8812' \
  -H 'Content-Type: application/json' \
  -d '[
  {
    "from": "Acme <hello@acme.com>",
    "to": [
      "delivered@simulator.zapsmtp.com"
    ],
    "template": {
      "id": "welcome",
      "variables": {
        "first_name": "Ann"
      }
    },
    "tags": [
      {
        "name": "series",
        "value": "welcome"
      }
    ],
    "metadata": {
      "user_id": "8812"
    }
  },
  {
    "from": "Acme <hello@acme.com>",
    "to": [
      "delivered@simulator.zapsmtp.com"
    ],
    "template": {
      "id": "welcome-day-2",
      "variables": {
        "first_name": "Ann"
      }
    },
    "scheduled_at": "in 2 days",
    "tags": [
      {
        "name": "series",
        "value": "welcome"
      }
    ],
    "metadata": {
      "user_id": "8812"
    }
  },
  {
    "from": "Acme <hello@acme.com>",
    "to": [
      "delivered@simulator.zapsmtp.com"
    ],
    "template": {
      "id": "welcome-day-7",
      "variables": {
        "first_name": "Ann"
      }
    },
    "scheduled_at": "in 7 days",
    "tags": [
      {
        "name": "series",
        "value": "welcome"
      }
    ],
    "metadata": {
      "user_id": "8812"
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

## Cancel a pending step

`POST /v1/emails/{id}/cancel`

Call it for every stored id when the user unsubscribes, churns or deletes the account. `409 not_cancellable` means the email already went out (or the id is unknown): nothing left to stop.

Requires a full-access or sending-access key.

### Path parameters

- `id` (string, required): Scheduled email id

### Errors

- `restricted_api_key` (HTTP 403): this API key cannot manage this email (another domain or stream, or live mail with a test key)
- `not_cancellable` (HTTP 409): unknown id, already dispatched or already canceled

```bash
curl -X POST 'https://api.zapsmtp.com/v1/emails/019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23/cancel' \
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

**Start and stop a welcome series**

Node.js:

```javascript
import { zap } from './zap.mjs';

const STEPS = [
  { template: 'welcome' },                                 // now
  { template: 'welcome-day-2', scheduled_at: 'in 2 days' },
  { template: 'welcome-day-7', scheduled_at: 'in 7 days' }, // 7 days is the scheduling limit
];

export async function startWelcomeSeries(user) {
  const emails = STEPS.map(({ template, scheduled_at }) => ({
    from: 'Acme <hello@acme.com>',
    to: [user.email],
    template: { id: template, variables: { first_name: user.firstName } },
    ...(scheduled_at && { scheduled_at }),
    tags: [{ name: 'series', value: 'welcome' }],
    metadata: { user_id: String(user.id) },
  }));
  const res = await zap('POST', '/emails/batch', emails, { 'Idempotency-Key': `welcome-${user.id}` });
  const ids = res.data.map((d) => d.id);
  // send-time failures (e.g. rate_limit_exceeded) come back per email: send those one by one
  for (const e of res.errors ?? []) {
    const one = await zap('POST', '/emails', emails[e.index], { 'Idempotency-Key': `welcome-${user.id}-${e.index}` });
    ids.push(one.id);
  }
  await db.users.update(user.id, { welcomeEmailIds: ids });
}

// On unsubscribe, churn or account deletion.
export async function stopWelcomeSeries(user) {
  for (const id of user.welcomeEmailIds ?? []) {
    try {
      await zap('POST', `/emails/${id}/cancel`);
    } catch (err) {
      if (err.code !== 'not_cancellable') throw err; // already sent: nothing to stop
    }
  }
  await db.users.update(user.id, { welcomeEmailIds: [] });
}
```

Python:

```python
from zap import zap, ZapError

STEPS = [("welcome", None), ("welcome-day-2", "in 2 days"), ("welcome-day-7", "in 7 days")]

def start_welcome_series(user):
    emails = []
    for template, when in STEPS:
        email = {
            "from": "Acme <hello@acme.com>",
            "to": [user.email],
            "template": {"id": template, "variables": {"first_name": user.first_name}},
            "tags": [{"name": "series", "value": "welcome"}],
            "metadata": {"user_id": str(user.id)},
        }
        if when:
            email["scheduled_at"] = when
        emails.append(email)
    res = zap("POST", "/emails/batch", emails, headers={"Idempotency-Key": f"welcome-{user.id}"})
    ids = [d["id"] for d in res["data"]]
    for e in res.get("errors", []):  # send-time failures, e.g. rate_limit_exceeded
        one = zap("POST", "/emails", emails[e["index"]],
                  headers={"Idempotency-Key": f"welcome-{user.id}-{e['index']}"})
        ids.append(one["id"])
    db.users.update(user.id, welcome_email_ids=ids)

def stop_welcome_series(user):
    for email_id in user.welcome_email_ids or []:
        try:
            zap("POST", f"/emails/{email_id}/cancel")
        except ZapError as e:
            if e.code != "not_cancellable":  # already sent: nothing to stop
                raise
    db.users.update(user.id, welcome_email_ids=[])
```

Go:

```go
type batchResult struct {
	Data   []struct{ ID string }
	Errors []struct {
		Index int
		Code  string
	}
}

func StartWelcomeSeries(ctx context.Context, u User) error {
	steps := []struct{ template, when string }{
		{"welcome", ""}, {"welcome-day-2", "in 2 days"}, {"welcome-day-7", "in 7 days"},
	}
	emails := make([]map[string]any, 0, len(steps))
	for _, s := range steps {
		e := map[string]any{
			"from":     "Acme <hello@acme.com>",
			"to":       []string{u.Email},
			"template": map[string]any{"id": s.template, "variables": map[string]any{"first_name": u.FirstName}},
			"tags":     []map[string]string{{"name": "series", "value": "welcome"}},
			"metadata": map[string]string{"user_id": u.ID},
		}
		if s.when != "" {
			e["scheduled_at"] = s.when
		}
		emails = append(emails, e)
	}
	var res batchResult
	if err := zap.Do(ctx, "POST", "/emails/batch", emails, map[string]string{"Idempotency-Key": "welcome-" + u.ID}, &res); err != nil {
		return err
	}
	ids := make([]string, 0, len(steps))
	for _, d := range res.Data {
		ids = append(ids, d.ID)
	}
	for _, e := range res.Errors { // send-time failures: retry one by one
		var one struct{ ID string }
		key := fmt.Sprintf("welcome-%s-%d", u.ID, e.Index)
		if err := zap.Do(ctx, "POST", "/emails", emails[e.Index], map[string]string{"Idempotency-Key": key}, &one); err != nil {
			return err
		}
		ids = append(ids, one.ID)
	}
	return db.SaveWelcomeEmailIDs(ctx, u.ID, ids)
}

func StopWelcomeSeries(ctx context.Context, u User) error {
	for _, id := range u.WelcomeEmailIDs {
		err := zap.Do(ctx, "POST", "/emails/"+id+"/cancel", nil, nil, nil)
		var zerr *zap.Error
		if err != nil && !(errors.As(err, &zerr) && zerr.Code == "not_cancellable") {
			return err
		}
	}
	return db.SaveWelcomeEmailIDs(ctx, u.ID, nil)
}
```

> Emails can be scheduled at most 7 days ahead and an account can hold 10,000 waiting emails. For longer or larger sequences, keep the schedule in your own job queue and send each step when it is due. When the time comes, the key and the account are checked again: a key revoked in the meantime fails the email. Keys restricted to a domain or a stream can only cancel the emails they scheduled themselves. To move a step instead of canceling it, use [PATCH /emails/{id}](https://zapsmtp.com/docs/emails/reschedule-email/).

## 4. Weekly newsletter: broadcast stream, one-click unsubscribe, batching

**What you build:** a weekly issue sent to every subscriber from a separate IP pool, with a working unsubscribe link and header, paced to your rate limit and safe to restart.

1. Put `{{{zap:unsubscribe_url}}}` in the template’s footer.
2. Send each subscriber their own email with `stream: "broadcast"`. Broadcast emails to a single recipient also get RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post` headers, so mail apps show their own unsubscribe button.
3. Batch 100 emails per request with `x-batch-validation: permissive`. Resend the items that failed with `rate_limit_exceeded` after a pause; stop on `monthly_quota_exceeded` or `daily_quota_exceeded`.
4. Before each issue, pull new suppressions and drop those addresses from your list.

## A newsletter template with an unsubscribe link

`POST /v1/templates`

`{{{zap:unsubscribe_url}}}` becomes each recipient’s signed one-click unsubscribe link at send time. It is never reported as a missing variable.

Requires a full-access live key; test keys get 403 test_key_restricted.

Syntax: {{var}} escaped, {{{var}}} raw, {{#list}}…{{/list}} sections, {{^x}}…{{/x}} inverted sections. Exact ordering of variable_names is determined by the parser; the example order is illustrative.

Body: html and text both empty → 422 missing_required_field; template syntax errors → 422 template_render_error "<field>: <error>"; a tag that is not a variable name ({{first name}}, {{#each items}}, {{> footer}}) → 422 template_render_error "html: line L, column C: {{…}} is not a variable name: …"

`variable_schema` in the response is the saved list after discovery. A send is checked against the published copy, `published.variable_schema`.

### Body parameters

- `name` (string, required): Limits: trimmed, 1-200 characters → 422 missing_required_field "name is required (max 200 chars)"
- `alias` (string): Stable handle usable instead of the id (template.id in sends, /templates/{alias}). Limits: ^[a-z0-9][a-z0-9_-]{0,62}$ → 422 invalid_parameter; duplicate → 409 conflict
- `subject` (string): Mustache source.
- `html` (string): At least one of html and text is required. Mustache source; {{var}} is HTML-escaped, {{{var}}} raw.
- `text` (string)
- `from` (string): Default From used when a send omits from.
- `variables` (object): Sample variables used by previews. Never used for sending; a variable first found in the source takes its sample as `example`.
- `variable_schema` (object[]): Declares the template’s variables (see [Variable schema](https://zapsmtp.com/docs/templating/#schema)). Replaces the declared list when given. On every save, names the source uses that the list lacks are added (their sample value as example): a section {{#x}} as optional `any`, a dotted {{x.y}} as a required `object`, any other name as a required `any`, never stricter than sends were before, and declared names the source no longer uses are kept with `unused: true`. Limits: at most 200 entries, no duplicates, defaults and examples of their type → 422 invalid_parameter "variable_schema: <reason>"
  - `name` (string, required): Variable name: letters, digits, `_` and `-`, starting with a letter or `_`, up to 64; `global` is reserved.
  - `type` (string, required): What a send must pass. One of `string`, `number`, `boolean`, `url`, `date`, `list`, `object`, `any`.
  - `required` (boolean): A send without a value (or with `null`) and without a default is refused with `template_variables_missing`. Default `false`.
  - `default` (any): Used when a send gives no value; must be of `type`.
  - `example` (any): Used by previews; must be of `type`.
  - `description` (string): For your team; at most 500 bytes.
- `design` (object | null): The visual editor’s document (a JSON object with a numeric `version`), stored with the template. `null` makes it a code template. Changing `html` without sending `design` drops the design (it no longer describes the HTML). Limits: max 1 MB → 422 invalid_parameter "design is larger than 1 MB"; not an object with a numeric version → 422 invalid_parameter
- `publish` (boolean): Publish the result in the same call. Without it the template stays a draft and is not used for sending until [published](https://zapsmtp.com/docs/templates/publish-template/). Default `false`.

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `conflict` (HTTP 409): a template with this alias already exists
- `payload_too_large` (HTTP 413): request body too large (over 4 MB)
- `missing_required_field` (HTTP 422)
- `invalid_parameter` (HTTP 422)
- `template_render_error` (HTTP 422): template syntax error: "<field>: <error>"
- `template_render_error` (HTTP 422): a tag that is not a variable name, e.g. {{first name}}, {{#each items}}, {{> footer}}: "html: line L, column C: {{…}} is not a variable name: letters, digits, _ and - (no spaces), parts joined with dots"

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "Acme Weekly",
  "alias": "weekly-newsletter",
  "from": "Acme Weekly <news@acme.com>",
  "subject": "{{title}}",
  "html": "<h1>{{title}}</h1>{{{body_html}}}<hr><p style=\"font-size:12px;color:#6b7280\">Hi {{first_name}}, you get Acme Weekly because you subscribed at acme.com. <a href=\"{{{zap:unsubscribe_url}}}\">Unsubscribe</a></p>",
  "text": "{{title}}\n\n{{body_text}}\n\nUnsubscribe: {{{zap:unsubscribe_url}}}",
  "publish": true
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f23-7f80-7192-8b3c-4d5e6f7a8b9c",
  "name": "Receipt",
  "alias": "receipt",
  "subject": "Your receipt for {{order_id}}",
  "html": "<p>Hi {{name}}, thanks for order {{order_id}}.</p>",
  "text": "Hi {{name}}, thanks for order {{order_id}}.",
  "from": "Acme <billing@acme.com>",
  "variables": {
    "name": "Jane",
    "order_id": "A-1042"
  },
  "variable_schema": [
    {
      "name": "order_id",
      "type": "string",
      "required": true,
      "example": "A-1042",
      "description": "Order number shown to the customer"
    },
    {
      "name": "name",
      "type": "string",
      "required": false,
      "default": "there",
      "example": "Jane"
    }
  ],
  "design": null,
  "created_at": "2026-10-21T16:10:00Z",
  "updated_at": "2026-10-21T16:10:00Z",
  "object": "template",
  "variable_names": [
    "order_id",
    "name"
  ],
  "status": "draft",
  "has_unpublished_changes": false,
  "published_at": null,
  "published": null
}
```

## Send one chunk on the broadcast stream

`POST /v1/emails/batch`

One recipient per email, up to 100 emails per request. `permissive` sends the valid emails and reports the rest in `errors[]`, together with send-time failures such as `rate_limit_exceeded`.

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
  -H 'x-batch-validation: permissive' \
  -H 'Idempotency-Key: newsletter-2026-43-chunk-0-attempt-0' \
  -H 'Content-Type: application/json' \
  -d '[
  {
    "to": [
      "delivered+ann@simulator.zapsmtp.com"
    ],
    "stream": "broadcast",
    "template": {
      "id": "weekly-newsletter",
      "variables": {
        "first_name": "Ann",
        "title": "Acme Weekly #43",
        "body_html": "<p>This week: faster exports.</p>",
        "body_text": "This week: faster exports."
      }
    },
    "tags": [
      {
        "name": "issue",
        "value": "2026-43"
      }
    ]
  },
  {
    "to": [
      "suppressed@simulator.zapsmtp.com"
    ],
    "stream": "broadcast",
    "template": {
      "id": "weekly-newsletter",
      "variables": {
        "first_name": "Bob",
        "title": "Acme Weekly #43",
        "body_html": "<p>This week: faster exports.</p>",
        "body_text": "This week: faster exports."
      }
    },
    "tags": [
      {
        "name": "issue",
        "value": "2026-43"
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

## Sync unsubscribes back to your list

`GET /v1/suppressions`

Newest first. `reason` is `unsubscribe`, `complaint`, `hard_bounce` or `manual`. Requires a full-access key.

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

**Send an issue**

Node.js:

```javascript
import { zap } from './zap.mjs';

const CHUNK = 100; // emails per batch request (the maximum)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sendIssue(issue, subscribers) { // subscribers: [{ email, firstName }]
  for (let start = 0; start < subscribers.length; start += CHUNK) {
    let pending = subscribers.slice(start, start + CHUNK).map((s) => ({
      to: [s.email], // one recipient per email: per-recipient unsubscribe link and header
      stream: 'broadcast',
      template: {
        id: 'weekly-newsletter',
        variables: { first_name: s.firstName, title: issue.title, body_html: issue.html, body_text: issue.text },
      },
      tags: [{ name: 'issue', value: issue.slug }],
    }));
    for (let attempt = 0; pending.length > 0; attempt++) {
      // a restarted job replays the same keys: no subscriber gets the issue twice
      const res = await zap('POST', '/emails/batch', pending, {
        'x-batch-validation': 'permissive',
        'Idempotency-Key': `newsletter-${issue.slug}-${start}-${attempt}`,
      });
      const retry = [];
      for (const e of res.errors ?? []) {
        if (e.code === 'rate_limit_exceeded') retry.push(pending[e.index]);
        else if (e.code.endsWith('quota_exceeded')) throw new Error(`stopped at ${start}: ${e.code}`);
        else console.warn('skipped', pending[e.index].to[0], e.code, e.message);
      }
      for (const d of res.data ?? []) {
        if (d.suppressed) await db.subscribers.markSuppressed(d.suppressed);
      }
      pending = retry;
      if (pending.length) await sleep(1000 * Math.min(30, 2 ** attempt)); // the budget refills every second
    }
  }
}

// Run before each issue, with the time of the previous sync.
export async function syncSuppressions(since) {
  let after;
  for (;;) {
    const q = new URLSearchParams({ limit: '1000', ...(after && { after }) });
    const page = await zap('GET', '/suppressions?' + q);
    for (const s of page.data) {
      if (new Date(s.created_at) < since) return;
      await db.subscribers.markSuppressed([s.email], s.reason);
    }
    if (!page.has_more) return;
    after = page.next_cursor;
  }
}
```

Python:

```python
import time
from datetime import datetime
from zap import zap

CHUNK = 100

def send_issue(issue, subscribers):
    for start in range(0, len(subscribers), CHUNK):
        pending = [{
            "to": [s.email],
            "stream": "broadcast",
            "template": {"id": "weekly-newsletter", "variables": {
                "first_name": s.first_name, "title": issue.title,
                "body_html": issue.html, "body_text": issue.text}},
            "tags": [{"name": "issue", "value": issue.slug}],
        } for s in subscribers[start:start + CHUNK]]
        attempt = 0
        while pending:
            res = zap("POST", "/emails/batch", pending, headers={
                "x-batch-validation": "permissive",
                "Idempotency-Key": f"newsletter-{issue.slug}-{start}-{attempt}"})
            retry = []
            for e in res.get("errors", []):
                if e["code"] == "rate_limit_exceeded":
                    retry.append(pending[e["index"]])
                elif e["code"].endswith("quota_exceeded"):
                    raise RuntimeError(f"stopped at {start}: {e['code']}")
                else:
                    print("skipped", pending[e["index"]]["to"][0], e["code"], e["message"])
            for d in res.get("data", []):
                if d.get("suppressed"):
                    db.subscribers.mark_suppressed(d["suppressed"])
            pending = retry
            if pending:
                time.sleep(min(30, 2 ** attempt))
            attempt += 1

def sync_suppressions(since: datetime):
    after = None
    while True:
        page = zap("GET", "/suppressions?limit=1000" + (f"&after={after}" if after else ""))
        for s in page["data"]:
            if datetime.fromisoformat(s["created_at"].replace("Z", "+00:00")) < since:
                return
            db.subscribers.mark_suppressed([s["email"]], s["reason"])
        if not page["has_more"]:
            return
        after = page["next_cursor"]
```

Go:

```go
func SendIssue(ctx context.Context, issue Issue, subs []Subscriber) error {
	const chunk = 100
	for start := 0; start < len(subs); start += chunk {
		var pending []map[string]any
		for _, s := range subs[start:min(start+chunk, len(subs))] {
			pending = append(pending, map[string]any{
				"to":     []string{s.Email},
				"stream": "broadcast",
				"template": map[string]any{"id": "weekly-newsletter", "variables": map[string]any{
					"first_name": s.FirstName, "title": issue.Title, "body_html": issue.HTML, "body_text": issue.Text}},
				"tags": []map[string]string{{"name": "issue", "value": issue.Slug}},
			})
		}
		for attempt := 0; len(pending) > 0; attempt++ {
			var res struct {
				Data []struct {
					ID         string
					Suppressed []string
				}
				Errors []struct {
					Index         int
					Code, Message string
				}
			}
			headers := map[string]string{
				"x-batch-validation": "permissive",
				"Idempotency-Key":    fmt.Sprintf("newsletter-%s-%d-%d", issue.Slug, start, attempt),
			}
			if err := zap.Do(ctx, "POST", "/emails/batch", pending, headers, &res); err != nil {
				return err
			}
			var retry []map[string]any
			for _, e := range res.Errors {
				switch {
				case e.Code == "rate_limit_exceeded":
					retry = append(retry, pending[e.Index])
				case strings.HasSuffix(e.Code, "quota_exceeded"):
					return fmt.Errorf("stopped at %d: %s", start, e.Code)
				default:
					log.Printf("skipped %v: %s %s", pending[e.Index]["to"], e.Code, e.Message)
				}
			}
			for _, d := range res.Data {
				if len(d.Suppressed) > 0 {
					db.MarkSuppressed(ctx, d.Suppressed)
				}
			}
			pending = retry
			if len(pending) > 0 {
				time.Sleep(time.Duration(min(30, 1<<attempt)) * time.Second)
			}
		}
	}
	return nil
}
```

> Your per-second budget counts recipients and is reported on send responses in `RateLimit-Limit` and `RateLimit-Remaining` (when your account has one); it refills every second. Unsubscribes go on the account’s suppression list with reason `unsubscribe` and stop broadcast mail only: someone who unsubscribes from the newsletter still gets receipts and password resets. Complaints and hard bounces stop every stream. Unsubscribes are not per list: if you need opt-outs per list, set your own `List-Unsubscribe` and `List-Unsubscribe-Post` headers pointing at your endpoint (ZapSMTP then leaves them as they are), do not use `zap:unsubscribe_url`, and keep the preference in your database.

## 5. Bounces and complaints: webhooks, user flags, Slack alerts

**What you build:** a webhook endpoint that flags bad addresses and complainers in your user table, and a scheduled check that posts to Slack when bounce or complaint rates climb.

1. Create a webhook for `email.bounced`, `email.complained` and `email.suppressed`.
2. Verify every request, skip `Zap-Event-Id`s you have handled, then act: `bounce.suppressed: true` means the address is dead; a complaint means stop marketing to it.
3. Every 15 minutes, read `GET /metrics` for the last 6 hours by stream and alert above your thresholds.

## Subscribe to the events that matter

`POST /v1/webhooks`

The response carries the `whsec_…` signing secret: put it in `ZAP_WEBHOOK_SECRET`.

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
    "actions": []
  }
}
```

**Handle bounce and complaint events**

Node.js:

```javascript
import express from 'express';
import { verifyZapSignature } from './zap.mjs';

const app = express();
// the signature covers the exact bytes: keep the raw body
app.post('/hooks/zapsmtp', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!verifyZapSignature(req.body, req.get('Zap-Signature'))) return res.sendStatus(400);
  const eventId = req.get('Zap-Event-Id'); // the same on every retry and replay
  if (await db.webhookEvents.seen(eventId)) return res.sendStatus(200);

  const { type, data } = JSON.parse(req.body);
  if (!data.test) { // events from test keys carry test: true
    const b = data.bounce; // { type, subType, message, suppressed }
    switch (type) {
      case 'email.bounced':
        // suppressed: a permanent mailbox or domain failure. Otherwise the problem is
        // on the sending side (SpamBlocked, PolicyRejected...) and the address is fine.
        if (b?.suppressed) await db.users.markEmailInvalid(data.to, b.subType);
        else console.warn('bounce, address kept', data.to, b?.subType, b?.message);
        break;
      case 'email.complained':
        await db.users.optOutOfMarketing(data.to);
        break;
      case 'email.suppressed': // we tried to email an address already on the list
        await db.users.markEmailInvalid(data.to, 'Suppressed');
        break;
    }
  }
  await db.webhookEvents.markSeen(eventId);
  res.sendStatus(200);
});
```

Python:

```python
import json
from flask import Flask, request
from zap import verify_zap_signature

app = Flask(__name__)

@app.post("/hooks/zapsmtp")
def zapsmtp_events():
    if not verify_zap_signature(request.get_data(), request.headers.get("Zap-Signature", "")):
        return "", 400
    event_id = request.headers["Zap-Event-Id"]  # stable across retries
    if db.webhook_events.seen(event_id):
        return "", 200
    event = json.loads(request.get_data())
    data, bounce = event["data"], event["data"].get("bounce") or {}
    if not data.get("test"):
        if event["type"] == "email.bounced":
            if bounce.get("suppressed"):
                db.users.mark_email_invalid(data["to"], bounce.get("subType"))
            else:
                app.logger.warning("bounce, address kept: %s %s", data["to"], bounce.get("subType"))
        elif event["type"] == "email.complained":
            db.users.opt_out_of_marketing(data["to"])
        elif event["type"] == "email.suppressed":
            db.users.mark_email_invalid(data["to"], "Suppressed")
    db.webhook_events.mark_seen(event_id)
    return "", 200
```

PHP:

```php
<?php
require_once 'zap.php';

$body = file_get_contents('php://input');
if (!verify_zap_signature($body, $_SERVER['HTTP_ZAP_SIGNATURE'] ?? '')) {
    http_response_code(400);
    exit;
}
$eventId = $_SERVER['HTTP_ZAP_EVENT_ID'];
if (!$db->webhookEventSeen($eventId)) {
    $event = json_decode($body, true);
    $data = $event['data'];
    $bounce = $data['bounce'] ?? [];
    if (empty($data['test'])) {
        match ($event['type']) {
            'email.bounced' => !empty($bounce['suppressed'])
                ? $db->markEmailInvalid($data['to'], $bounce['subType'])
                : error_log("bounce, address kept: {$data['to']} " . ($bounce['subType'] ?? '')),
            'email.complained' => $db->optOutOfMarketing($data['to']),
            'email.suppressed' => $db->markEmailInvalid($data['to'], 'Suppressed'),
            default => null,
        };
    }
    $db->markWebhookEventSeen($eventId);
}
http_response_code(200);
```

## Read the rates for alerting

`GET /v1/metrics`

Bounce rate is of `sent`, complaint rate of `delivered`. Test-mode mail is excluded. `dimension=stream` gives one row per stream, so a bad newsletter does not hide behind good receipts.

Requires a full-access key.

Counts are recipients, except `delayed`, `opened` and `clicked`: unique emails. Delivery and bounce rates are of `sent`; complaint, open and click rates of `delivered`. Test-mode mail is excluded. Kept for 400 days.

An out-of-band bounce (a later bounce email from the remote server) has no sending domain: it is grouped under an empty `value`.

Totals and the series count each email once whatever the dimension; with `dimension=tag` an email with several tags appears in each of its tags' groups.

### Query parameters

- `from` (string): RFC 3339 start. At most 400 days before `to`. Default `7 days ago`.
- `to` (string): RFC 3339 end (exclusive). Default `now`.
- `granularity` (string): `hour` (ranges up to 31 days) or `day` for `series`. Default `hour up to 48 hours, else day`.
- `dimension` (string): `domain`, `stream`, `tag` or `provider`: adds `groups`, one row per value, busiest first.
- `domain` (string): Only this sending (From) domain.
- `stream` (string): `transactional` or `broadcast`.
- `provider` (string): Gmail, Microsoft, Yahoo, Apple or Other.
- `tag` (string): Only emails with this tag, as `name=value`. Cannot be combined with domain, stream or provider, and groups only by `tag`.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): Bad time, range, granularity or dimension, or a tag combined with another filter.

```bash
curl 'https://api.zapsmtp.com/v1/metrics?from=2026-10-26T06%3A00%3A00Z&to=2026-10-26T12%3A00%3A00Z&dimension=stream' \
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

**Alert Slack when rates rise**

Node.js:

```javascript
// Run every 15 minutes (cron, a scheduled job). Needs a full-access key.
import { zap } from './zap.mjs';

const LIMITS = { bounce_rate: 0.04, complaint_rate: 0.001 }; // pick your own thresholds
const MIN_SENT = 200; // ignore tiny samples

export async function checkRates() {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 3600_000);
  const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), dimension: 'stream' });
  const m = await zap('GET', '/metrics?' + q);
  const alerts = m.groups
    .filter((g) => g.sent >= MIN_SENT)
    .flatMap((g) => Object.entries(LIMITS)
      .filter(([rate, max]) => g[rate] > max)
      .map(([rate, max]) => `${g.value}: ${rate} ${(g[rate] * 100).toFixed(2)}% (limit ${max * 100}%), ${g.sent} sent in 6 h`));
  if (alerts.length) {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'ZapSMTP rates over the limit:\n' + alerts.join('\n') }),
    });
  }
}
```

Python:

```python
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
import requests
from zap import zap

LIMITS = {"bounce_rate": 0.04, "complaint_rate": 0.001}
MIN_SENT = 200

def check_rates():
    to = datetime.now(timezone.utc).replace(microsecond=0)
    q = urlencode({"from": (to - timedelta(hours=6)).isoformat(), "to": to.isoformat(), "dimension": "stream"})
    m = zap("GET", "/metrics?" + q)
    alerts = [
        f"{g['value']}: {rate} {g[rate] * 100:.2f}% (limit {limit * 100}%), {g['sent']} sent in 6 h"
        for g in m["groups"] if g["sent"] >= MIN_SENT
        for rate, limit in LIMITS.items() if g[rate] > limit
    ]
    if alerts:
        requests.post(os.environ["SLACK_WEBHOOK_URL"], timeout=10,
                      json={"text": "ZapSMTP rates over the limit:\n" + "\n".join(alerts)})
```

PHP:

```php
<?php
require_once 'zap.php';

$limits = ['bounce_rate' => 0.04, 'complaint_rate' => 0.001];
$to = new DateTimeImmutable('now', new DateTimeZone('UTC'));
$q = http_build_query([
    'from' => $to->modify('-6 hours')->format(DATE_RFC3339),
    'to' => $to->format(DATE_RFC3339),
    'dimension' => 'stream',
]);
$m = zap('GET', '/metrics?' . $q);
$alerts = [];
foreach ($m['groups'] as $g) {
    if ($g['sent'] < 200) continue;
    foreach ($limits as $rate => $max) {
        if ($g[$rate] > $max) {
            $alerts[] = sprintf('%s: %s %.2f%% (limit %s%%), %d sent in 6 h', $g['value'], $rate, $g[$rate] * 100, $max * 100, $g['sent']);
        }
    }
}
if ($alerts) {
    $ch = curl_init(getenv('SLACK_WEBHOOK_URL'));
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode(['text' => "ZapSMTP rates over the limit:\n" . implode("\n", $alerts)]),
        CURLOPT_RETURNTRANSFER => true,
    ]);
    curl_exec($ch);
}
```

> One event is sent per recipient, so `data.to` is a single address. ZapSMTP already suppresses hard-bounced and complaining addresses for you; the handler keeps your own records in step. Answer with a 2xx quickly. Network errors, timeouts, 5xx, 408 and 429 are retried for about 28 hours; any other 4xx ends delivery of that event at once, so do not answer 4xx for a temporary problem on your side. The 4% and 0.1% thresholds above are examples; choose your own. Details: [Webhook events](https://zapsmtp.com/docs/webhook-events/), [bounce classification](https://zapsmtp.com/docs/testing/#bounces).

## 6. Support inbox: receive, open a ticket, reply in the thread

**What you build:** customers write to `support@help.acme.com`; each new conversation becomes a ticket with an automatic acknowledgement; follow-ups attach to the same ticket; agents answer from your UI and the customer sees one email thread.

1. Add `help.acme.com` as an inbound domain and publish its MX record.
2. Create a webhook for `thread.created` and `thread.replied`.
3. On `thread.created`: create the ticket, store `thread_id` and `email_id`, tag the conversation with the ticket id and send an acknowledgement with `auto_reply: true`.
4. On `thread.replied`: add `reply_text` (the new text without the quoted history) to the ticket.
5. Agents answer with `POST /emails/receiving/{id}/reply` on the latest received email.

## Receive on a subdomain

`POST /v1/inbound/domains`

Your own domain (or its parent) must already be verified for sending. Publish the MX record from the response and call [verify](https://zapsmtp.com/docs/inbound/verify-inbound-domain/). For a quick test, `{"managed": true}` gives an instant address with no DNS.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Body parameters

- `managed` (boolean): true: create an instant managed domain <10 random lowercase chars>.<inbound zone>; no DNS needed; name is ignored. Default `False`.
- `name` (string): Required unless managed is true. Your own domain. It (or a parent) must be verified for sending by the account. Then publish MX 10 <inbound host> and call verify. Limits: invalid → 422 invalid_parameter "invalid domain name"; ZapSMTP-owned names → 422 reserved_domain; not verified for sending → 403 domain_not_verified
- `reject_spam` (boolean): Refuse messages flagged as spam at SMTP time instead of delivering them with is_spam: true. Default `False`.
- `require_tls` (boolean): Accept encrypted mail only: senders without STARTTLS are refused with 530 5.7.0.

### Errors

- `domain_not_verified` (HTTP 403): verify <name> (or its parent domain) for sending first; inbound reuses that proof of ownership
- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `conflict` (HTTP 409): this domain already receives mail on ZapSMTP
- `invalid_parameter` (HTTP 422): invalid domain name
- `reserved_domain` (HTTP 422): this domain is reserved by ZapSMTP; use a managed address or your own domain
- `inbound_not_configured` (HTTP 503)

```bash
curl -X POST 'https://api.zapsmtp.com/v1/inbound/domains' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "help.acme.com"
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f20-4c5d-7e6f-8a9b-0c1d2e3f4a5b",
  "name": "k3f9x2m7q1.in.zapsmtp.com",
  "managed": true,
  "reject_spam": false,
  "mx_verified": true,
  "last_checked_at": "2026-10-21T15:00:00Z",
  "created_at": "2026-10-21T15:00:00Z",
  "records": [],
  "example_address": "anything@k3f9x2m7q1.in.zapsmtp.com"
}
```

## Subscribe to conversation events

`POST /v1/webhooks`

`thread.created` fires for a message that answers nothing (a new ticket), `thread.replied` for an answer in an existing conversation. Neither fires for bounces, out-of-office, auto-replies or auto-generated notifications. Bulk and mailing-list mail (`Precedence: bulk`, `List-Id`, `List-Unsubscribe`) is classified as automated but still produces these events: check `automated.type === "bulk"` if newsletters should not open tickets.

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
  "url": "https://acme.com/hooks/support",
  "events": [
    "thread.created",
    "thread.replied"
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

## Link the conversation to the ticket

`PATCH /v1/threads/{id}`

Conversation metadata shows in the dashboard inbox and in `GET /threads`, so anyone can jump from an email to the ticket.

Requires a full-access live key; test keys get 403 test_key_restricted.

Omitted fields are kept.

### Path parameters

- `id` (string (UUID), required): Thread id

### Body parameters

- `read` (boolean): `true` sets `read_at` to now (unread again once a new email arrives); `false` clears it.
- `metadata` (object): Your own key-value pairs (a ticket id, a CRM deal), replacing the previous ones. Limits: at most 20 keys matching [A-Za-z0-9_-]{1,40}, values up to 500 bytes (UTF-8) (422 invalid_parameter).

### Errors

- `validation_error` (HTTP 400): invalid JSON / unknown field
- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `not_found` (HTTP 404): thread not found
- `invalid_parameter` (HTTP 422): metadata limits

```bash
curl -X PATCH 'https://api.zapsmtp.com/v1/threads/3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "metadata": {
    "ticket": "T-1042"
  }
}'
```

**Response `200 OK`**

```json
{
  "object": "thread",
  "id": "3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13",
  "subject": "Where is my order?",
  "participants": [
    "jane@example.org",
    "support@acme.com"
  ],
  "message_count": 3,
  "inbound_count": 2,
  "outbound_count": 1,
  "has_attachments": false,
  "first_message_at": "2026-10-21T15:10:02.904Z",
  "last_message_at": "2026-10-21T16:02:13.540Z",
  "last_inbound_at": "2026-10-21T16:02:13.540Z",
  "last_message": {
    "id": "019a1f52-0c1d-7f2e-8a3b-4c5d6e7f8091",
    "direction": "inbound",
    "from": "jane@example.org",
    "subject": "Re: Where is my order?"
  },
  "awaiting_reply": true,
  "unread": false,
  "read_at": "2026-10-21T16:05:00.000Z",
  "metadata": {
    "ticket": "T-1042"
  }
}
```

## Acknowledge in the same thread

`POST /v1/emails/receiving/{id}/reply`

Recipients, `Re:` subject and `In-Reply-To`/`References` default from the received email. Replying from another address sets `reply_to` to the receiving one, so the customer’s answer comes back to the inbox. `auto_reply: true` marks the message as automatic (RFC 3834).

Requires a full-access key. Live keys: the From domain must be verified for sending.

Our Message-ID of the reply names its thread, so the customer's answer joins the conversation even from a mail client that keeps only `In-Reply-To`.

Every other rule of `POST /emails` applies: suppressions, quotas, tracking, test keys.

Loop protection: replies to automated email need `allow_automated`, and one conversation takes at most 20 replies an hour.

### Path parameters

- `id` (string (UUID), required): Received email id

### Headers

- `Idempotency-Key` (string): optional, 1-256 bytes (see [Idempotency](https://zapsmtp.com/docs/conventions/#idempotency))

### Body parameters

- `text` (string): Plain-text body. Either text or html (or a template) is required.
- `html` (string): HTML body.
- `from` (string): Default: the address that received the email (e.g. `support@acme.com`), which must be on a verified sending domain. Required when the email came to a managed `*.in.zapsmtp.com` address (those only receive): 422 missing_required_field.
- `to` (string | string[]): Default: the email's Reply-To, else its From. Limits: 422 missing_required_field when the email has neither.
- `reply_all` (boolean): Also copy everyone on the email's To and Cc, except the receiving address, the sender you reply from and anyone already addressed. Default `false`.
- `allow_automated` (boolean): Answer an automated email anyway (see `automated` on the received email). Without it a reply to a bounce, out-of-office, auto-reply or notification is refused with 422 automated_message: two auto-responders answering each other is a mail loop. Bulk mail can be answered without it. Default `false`.
- `auto_reply` (boolean): This answer is itself automatic (an acknowledgement, a ticket receipt): adds `Auto-Submitted: auto-replied` and `X-Auto-Response-Suppress: All` (RFC 3834), so other auto-responders do not answer it. Default `false`.
- `cc` (string | string[]): Added to the Cc (reply_all adds the email's recipients after these).
- `bcc` (string | string[]): Bcc recipients.
- `reply_to` (string | string[]): Default: the receiving address when you reply from another one, so the customer's answer comes back to the same inbox.
- `subject` (string): Default: `Re: ` + the email's subject (kept as is when it already starts with Re:).
- `headers` (object): Custom headers. `In-Reply-To` and `References` are set for you (RFC 5322 threading); a value you give wins.
- `attachments, tags, metadata, stream, tracking, template, scheduled_at`: As in [POST /emails](https://zapsmtp.com/docs/emails/send-email/).

### Errors

- `validation_error` (HTTP 400): invalid JSON / unknown field
- `invalid_idempotency_key` (HTTP 400): Idempotency-Key must be 1 to 256 bytes
- `domain_not_verified` (HTTP 403): sender domain is not verified for this account
- `restricted_api_key` (HTTP 403)
- `not_found` (HTTP 404): email not found
- `idempotency_key_reused` (HTTP 409)
- `idempotency_request_in_progress` (HTTP 409)
- `missing_required_field` (HTTP 422): from (managed receiving address), to (no sender on the email), or the body
- `automated_message` (HTTP 422): the email is a bounce, out-of-office, auto-reply or notification; pass allow_automated: true
- `rate_limit_exceeded` (HTTP 429)
- `thread_reply_limit` (HTTP 429): too many replies in this conversation in the last hour (a mail loop?); at most 20 per hour; Retry-After: 3600
- `inbound_not_configured` (HTTP 503)

```bash
curl -X POST 'https://api.zapsmtp.com/v1/emails/receiving/019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d/reply' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Idempotency-Key: ack-019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d' \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme Support <support@acme.com>",
  "text": "Thanks for writing. Your ticket is T-1042; a person will answer within one business day.",
  "auto_reply": true
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f41-8b2c-7e3d-9f40-5a6b7c8d9e0f",
  "thread_id": "3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13"
}
```

**Turn conversations into tickets**

Node.js:

```javascript
import express from 'express';
import { zap, verifyZapSignature } from './zap.mjs';

const app = express();
app.post('/hooks/support', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!verifyZapSignature(req.body, req.get('Zap-Signature'))) return res.sendStatus(400);
  const eventId = req.get('Zap-Event-Id');
  if (await db.webhookEvents.seen(eventId)) return res.sendStatus(200);
  const { type, data } = JSON.parse(req.body);

  if (type === 'thread.created') {
    const ticket = await tickets.create({
      threadId: data.thread_id, subject: data.subject, customer: data.from,
      body: data.reply_text, lastEmailId: data.email_id,
    });
    await zap('PATCH', `/threads/${data.thread_id}`, { metadata: { ticket: ticket.id } });
    await zap('POST', `/emails/receiving/${data.email_id}/reply`, {
      from: 'Acme Support <support@acme.com>',
      text: `Thanks for writing. Your ticket is ${ticket.id}; a person will answer within one business day.`,
      auto_reply: true,
    }, { 'Idempotency-Key': `ack-${data.email_id}` });
  } else if (type === 'thread.replied') {
    const ticket = await tickets.findByThread(data.thread_id);
    await tickets.addMessage(ticket.id, { from: data.from, body: data.reply_text, emailId: data.email_id });
  }
  await db.webhookEvents.markSeen(eventId);
  res.sendStatus(200);
});

// An agent answers from your helpdesk UI.
export function answerTicket(ticket, agent, text) {
  return zap('POST', `/emails/receiving/${ticket.lastEmailId}/reply`, {
    from: `${agent.name} at Acme <support@acme.com>`,
    text,
  }, { 'Idempotency-Key': `ticket-${ticket.id}-msg-${ticket.messageCount}` });
}
```

Python:

```python
import json
from flask import Flask, request
from zap import zap, verify_zap_signature

app = Flask(__name__)

@app.post("/hooks/support")
def support_events():
    if not verify_zap_signature(request.get_data(), request.headers.get("Zap-Signature", "")):
        return "", 400
    event_id = request.headers["Zap-Event-Id"]
    if db.webhook_events.seen(event_id):
        return "", 200
    event = json.loads(request.get_data())
    data = event["data"]
    if event["type"] == "thread.created":
        ticket = tickets.create(thread_id=data["thread_id"], subject=data["subject"],
                                customer=data["from"], body=data["reply_text"],
                                last_email_id=data["email_id"])
        zap("PATCH", f"/threads/{data['thread_id']}", {"metadata": {"ticket": ticket.id}})
        zap("POST", f"/emails/receiving/{data['email_id']}/reply", {
            "from": "Acme Support <support@acme.com>",
            "text": f"Thanks for writing. Your ticket is {ticket.id}; a person will answer within one business day.",
            "auto_reply": True,
        }, headers={"Idempotency-Key": f"ack-{data['email_id']}"})
    elif event["type"] == "thread.replied":
        ticket = tickets.find_by_thread(data["thread_id"])
        tickets.add_message(ticket.id, sender=data["from"], body=data["reply_text"], email_id=data["email_id"])
    db.webhook_events.mark_seen(event_id)
    return "", 200

def answer_ticket(ticket, agent, text):
    return zap("POST", f"/emails/receiving/{ticket.last_email_id}/reply",
               {"from": f"{agent.name} at Acme <support@acme.com>", "text": text},
               headers={"Idempotency-Key": f"ticket-{ticket.id}-msg-{ticket.message_count}"})
```

Go:

```go
type threadEvent struct {
	Type string
	Data struct {
		ThreadID  string `json:"thread_id"`
		EmailID   string `json:"email_id"`
		From      string
		Subject   string
		ReplyText string `json:"reply_text"`
	}
}

func SupportHook(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	if !zap.VerifySignature(body, r.Header.Get("Zap-Signature"), os.Getenv("ZAP_WEBHOOK_SECRET")) {
		http.Error(w, "bad signature", http.StatusBadRequest)
		return
	}
	ctx, eventID := r.Context(), r.Header.Get("Zap-Event-Id")
	if db.EventSeen(ctx, eventID) {
		return // 200
	}
	var ev threadEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	d := ev.Data
	var err error
	switch ev.Type {
	case "thread.created":
		t, err2 := tickets.Create(ctx, d.ThreadID, d.Subject, d.From, d.ReplyText, d.EmailID)
		if err = err2; err == nil {
			err = zap.Do(ctx, "PATCH", "/threads/"+d.ThreadID, map[string]any{"metadata": map[string]string{"ticket": t.ID}}, nil, nil)
		}
		if err == nil {
			err = zap.Do(ctx, "POST", "/emails/receiving/"+d.EmailID+"/reply", map[string]any{
				"from":       "Acme Support <support@acme.com>",
				"text":       "Thanks for writing. Your ticket is " + t.ID + "; a person will answer within one business day.",
				"auto_reply": true,
			}, map[string]string{"Idempotency-Key": "ack-" + d.EmailID}, nil)
		}
	case "thread.replied":
		err = tickets.AddMessage(ctx, d.ThreadID, d.From, d.ReplyText, d.EmailID)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError) // ZapSMTP retries
		return
	}
	db.MarkEventSeen(ctx, eventID)
}
```

> The webhook carries metadata and `reply_text`; fetch the full body, headers and attachments with [GET /emails/receiving/{id}](https://zapsmtp.com/docs/receiving/get-received/). Replies to automated mail are refused with `422 automated_message` unless you pass `allow_automated: true`, and one conversation takes at most 20 replies an hour (`429 thread_reply_limit`), so two auto-responders cannot loop. A reply’s `from` defaults to the receiving address, which must then be on a verified sending domain; the recipe sends from `support@acme.com` instead.

## 7. Magic-link sign-in and CI tests with simulator addresses

**What you build:** passwordless sign-in with a 10-minute single-use link, plus CI tests that send real requests and check delivery and bounces without emailing anyone.

1. Store a hashed token with a short expiry; send the link with tracking off and the token id as the idempotency key.
2. In CI, use a `zap_test_` key and simulator recipients: `delivered+<label>@simulator.zapsmtp.com` delivers, `bounced@simulator.zapsmtp.com` bounces, `complained@simulator.zapsmtp.com` complains.
3. Poll the email until it reaches the expected status, then read its content and check the link.

## Send the sign-in link

`POST /v1/emails`

Plain HTML and text, no template needed. Open and click tracking are off so the link reaches the user exactly as you generated it.

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
  -H 'Idempotency-Key: magic-link-9c4f7a10-1d2e-4b3a-8c5d-6e7f8a9b0c1d' \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme <login@acme.com>",
  "to": [
    "delivered+ci@simulator.zapsmtp.com"
  ],
  "subject": "Your Acme sign-in link",
  "html": "<p><a href=\"https://acme.com/login/verify?id=9c4f7a10&token=Qm…\">Sign in to Acme</a></p><p>The link works once, for 10 minutes.</p>",
  "text": "Sign in to Acme: https://acme.com/login/verify?id=9c4f7a10&token=Qm…\n\nThe link works once, for 10 minutes.",
  "tracking": {
    "opens": false,
    "clicks": false
  },
  "tags": [
    {
      "name": "category",
      "value": "magic-link"
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

**Send a magic link**

Node.js:

```javascript
import crypto from 'node:crypto';
import { zap } from './zap.mjs';

const TTL_MINUTES = 10;

export async function sendMagicLink(email) {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  await db.magicLinks.insert({
    id, email,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000), // single use: delete on success
  });
  const url = `https://acme.com/login/verify?id=${id}&token=${token}`;
  return zap('POST', '/emails', {
    from: 'Acme <login@acme.com>',
    to: [email],
    subject: 'Your Acme sign-in link',
    html: `<p><a href="${url}">Sign in to Acme</a></p><p>The link works once, for ${TTL_MINUTES} minutes.</p>`,
    text: `Sign in to Acme: ${url}\n\nThe link works once, for ${TTL_MINUTES} minutes.`,
    tracking: { opens: false, clicks: false },
    tags: [{ name: 'category', value: 'magic-link' }],
  }, { 'Idempotency-Key': `magic-link-${id}` });
}
```

Python:

```python
import hashlib, secrets, uuid
from datetime import datetime, timedelta, timezone
from zap import zap

TTL_MINUTES = 10

def send_magic_link(email: str):
    link_id, token = str(uuid.uuid4()), secrets.token_urlsafe(32)
    db.magic_links.insert(id=link_id, email=email,
                          token_hash=hashlib.sha256(token.encode()).hexdigest(),
                          expires_at=datetime.now(timezone.utc) + timedelta(minutes=TTL_MINUTES))
    url = f"https://acme.com/login/verify?id={link_id}&token={token}"
    return zap("POST", "/emails", {
        "from": "Acme <login@acme.com>",
        "to": [email],
        "subject": "Your Acme sign-in link",
        "html": f'<p><a href="{url}">Sign in to Acme</a></p><p>The link works once, for {TTL_MINUTES} minutes.</p>',
        "text": f"Sign in to Acme: {url}\n\nThe link works once, for {TTL_MINUTES} minutes.",
        "tracking": {"opens": False, "clicks": False},
        "tags": [{"name": "category", "value": "magic-link"}],
    }, headers={"Idempotency-Key": f"magic-link-{link_id}"})
```

Go:

```go
const ttl = 10 * time.Minute

func SendMagicLink(ctx context.Context, email string) (string, error) {
	id := uuid.NewString()
	raw := make([]byte, 32)
	rand.Read(raw)
	token := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(token))
	if err := db.SaveMagicLink(ctx, id, email, hex.EncodeToString(sum[:]), time.Now().Add(ttl)); err != nil {
		return "", err
	}
	url := "https://acme.com/login/verify?id=" + id + "&token=" + token
	var res struct{ ID string }
	err := zap.Do(ctx, "POST", "/emails", map[string]any{
		"from":     "Acme <login@acme.com>",
		"to":       []string{email},
		"subject":  "Your Acme sign-in link",
		"html":     `<p><a href="` + url + `">Sign in to Acme</a></p><p>The link works once, for 10 minutes.</p>`,
		"text":     "Sign in to Acme: " + url + "\n\nThe link works once, for 10 minutes.",
		"tracking": map[string]bool{"opens": false, "clicks": false},
		"tags":     []map[string]string{{"name": "category", "value": "magic-link"}},
	}, map[string]string{"Idempotency-Key": "magic-link-" + id}, &res)
	return res.ID, err
}
```

## CI: wait for the outcome

`GET /v1/emails/{id}`

Poll until `recipients[0].status` is the status the simulator address produces (`delivered`, `bounced`…). Test keys may read, so CI never needs a live key.

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

## CI: read what was sent

`GET /v1/emails/{id}/content`

Returns the HTML and text you sent, each truncated to 256 KiB in the archive; extract the link and drive your sign-in flow with it.

Requires a full-access key.

`source` is `api` or `smtp`; `tags` is the URL-encoded tag string. Content is kept for your plan’s log retention.

### Path parameters

- `id` (string, required): Email id

### Errors

- `restricted_api_key` (HTTP 403)
- `not_found` (HTTP 404): content not available (past your plan's log retention)

```bash
curl 'https://api.zapsmtp.com/v1/emails/019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23/content' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "source": "api",
  "from": "Acme <hello@acme.com>",
  "to": [
    "jane@example.org"
  ],
  "cc": [],
  "bcc": [],
  "subject": "Your receipt",
  "html": "<p>Thanks for your order!</p>",
  "text": "Thanks for your order!",
  "raw": "",
  "tags": "category=receipt",
  "size": 2481
}
```

**Test it in CI**

Node.js:

```javascript
// magic-link.test.mjs: node --test. ZAP_API_KEY is a zap_test_ key with full access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zap } from './zap.mjs';
import { sendMagicLink } from './magic-link.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForStatus(id, status) {
  for (let i = 0; i < 30; i++) {
    const email = await zap('GET', `/emails/${id}`);
    if (email.recipients[0]?.status === status) return email;
    await sleep(1000);
  }
  throw new Error(`email ${id} never reached ${status}`);
}

test('the sign-in link arrives and is well formed', async () => {
  assert.match(process.env.ZAP_API_KEY, /^zap_test_/); // never run CI against a live key
  const run = process.env.GITHUB_RUN_ID ?? Date.now();
  const { id } = await sendMagicLink(`delivered+ci-${run}@simulator.zapsmtp.com`);
  await waitForStatus(id, 'delivered');
  const { html } = await zap('GET', `/emails/${id}/content`);
  const link = html.match(/href="([^"]+)"/)[1];
  assert.match(link, /^https:\/\/acme\.com\/login\/verify\?id=/);
});

test('a bounce is reported', async () => {
  const { id } = await sendMagicLink('bounced@simulator.zapsmtp.com');
  const email = await waitForStatus(id, 'bounced');
  assert.equal(email.recipients[0].status, 'bounced');
});
```

Python:

```python
# test_magic_link.py: pytest. ZAP_API_KEY is a zap_test_ key with full access.
import os, re, time
from zap import zap
from magic_link import send_magic_link

def wait_for_status(email_id, status):
    for _ in range(30):
        email = zap("GET", f"/emails/{email_id}")
        if email["recipients"] and email["recipients"][0]["status"] == status:
            return email
        time.sleep(1)
    raise AssertionError(f"email {email_id} never reached {status}")

def test_link_arrives():
    assert os.environ["ZAP_API_KEY"].startswith("zap_test_")
    run = os.environ.get("GITHUB_RUN_ID", str(int(time.time())))
    sent = send_magic_link(f"delivered+ci-{run}@simulator.zapsmtp.com")
    wait_for_status(sent["id"], "delivered")
    html = zap("GET", f"/emails/{sent['id']}/content")["html"]
    link = re.search(r'href="([^"]+)"', html).group(1)
    assert link.startswith("https://acme.com/login/verify?id=")

def test_bounce_is_reported():
    sent = send_magic_link("bounced@simulator.zapsmtp.com")
    wait_for_status(sent["id"], "bounced")
```

Go:

```go
// magiclink_test.go: go test. ZAP_API_KEY is a zap_test_ key with full access.
func waitForStatus(t *testing.T, id, status string) {
	t.Helper()
	for i := 0; i < 30; i++ {
		var e struct{ Recipients []struct{ Status string } }
		if err := zap.Do(context.Background(), "GET", "/emails/"+id, nil, nil, &e); err != nil {
			t.Fatal(err)
		}
		if len(e.Recipients) > 0 && e.Recipients[0].Status == status {
			return
		}
		time.Sleep(time.Second)
	}
	t.Fatalf("email %s never reached %s", id, status)
}

func TestMagicLink(t *testing.T) {
	if !strings.HasPrefix(os.Getenv("ZAP_API_KEY"), "zap_test_") {
		t.Fatal("use a zap_test_ key in CI")
	}
	id, err := SendMagicLink(context.Background(), fmt.Sprintf("delivered+ci-%d@simulator.zapsmtp.com", time.Now().Unix()))
	if err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, id, "delivered")
	var c struct{ HTML string }
	if err := zap.Do(context.Background(), "GET", "/emails/"+id+"/content", nil, nil, &c); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.HTML, `href="https://acme.com/login/verify?id=`) {
		t.Fatalf("no sign-in link in %q", c.HTML)
	}
}

func TestMagicLinkBounce(t *testing.T) {
	id, err := SendMagicLink(context.Background(), "bounced@simulator.zapsmtp.com")
	if err != nil {
		t.Fatal(err)
	}
	waitForStatus(t, id, "bounced")
}
```

> Expiry is enforced by your application, not by the email: check the stored expiry and delete the token on first use. Some corporate mail filters open links to scan them, so let the link open a page whose button completes the sign-in. Test-key email carries `test: true` in webhooks and does not count against your monthly quota. All scenarios: [Testing & simulator](https://zapsmtp.com/docs/testing/).

## 8. Sending for many client domains (agencies)

**What you build:** one integration that sends for many clients, each from its own domain, without one client’s key ever sending as another.

**Two ways to separate clients**

- **One account per client**: Full separation: own domains, keys, webhooks, suppressions, logs, reputation and plan. Create client accounts from the account menu in the dashboard (there is no API for creating accounts), invite the client with a role, and use that account’s own key in the client’s integration. See [Teams & client accounts](https://zapsmtp.com/docs/teams/).
- **One account, a key per domain**: Your account holds every client domain; each client gets a `sending_access` key restricted with `domain_id`. Domains, quota, suppression list, webhooks and logs are shared, and only your full-access key can read logs and stats.

Pick separate accounts when clients need their own dashboard, billing or reputation; pick restricted keys when you run everything yourself. The code below automates the second option.

## Add the client’s domain

`POST /v1/domains`

The response lists the DNS records (DKIM required, SPF and DMARC recommended) to hand to the client. Then call [verify](https://zapsmtp.com/docs/domains/verify-domain/) until `status` is `verified`. Requires a full-access live key.

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
  "name": "mail.client-shop.com"
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

## Issue a key that can only send from that domain

`POST /v1/api-keys`

`domain_id` works with `sending_access` only. The key cannot read logs, change settings or send from any other domain (`403 restricted_api_key`). The token is shown once.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Body parameters

- `name` (string, required): Limits: 1-100 characters (not trimmed) → 422 invalid_parameter "name is required (max 100 chars)"
- `permission` (string): One of `full_access`, `sending_access`. Default `full_access`.
- `domain_id` (string): Restrict sending to one of the account's domains. Only with sending_access. Limits: 422 "domain_id can only be used with sending_access" / "unknown domain_id"
- `mode` (string): test creates a zap_test_ key (see [API keys](https://zapsmtp.com/docs/conventions/#keys)). One of `live`, `test`. Default `live`.
- `stream` (string): Restrict the key to one message stream. One of `transactional`, `broadcast`.
- `expires_at` (string (RFC 3339)): Limits: must be in the future → 422 "expires_at must be in the future"
- `expires_in_days` (integer): Alternative to expires_at; when > 0 it overrides expires_at.

### Errors

- `key_restricted` (HTTP 403): this API key expires, so the keys it manages must expire no later than it does | this API key is limited to the <stream> stream, and so are the keys it manages
- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `invalid_parameter` (HTTP 422): name, permission, domain_id, mode, stream or expiry invalid

```bash
curl -X POST 'https://api.zapsmtp.com/v1/api-keys' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "client-shop",
  "permission": "sending_access",
  "mode": "live",
  "domain_id": "019a1e9b-41c2-7a0e-b5d1-3f6c2e8a9d47"
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f05-3c4d-7e5f-8a6b-7c8d9e0f1a2b",
  "token": "zap_8fK2mQ9xLr3TzV7bN1cW5yHjP0aS4dE6gU2iO9kX",
  "key": {
    "id": "019a1f05-3c4d-7e5f-8a6b-7c8d9e0f1a2b",
    "name": "Production",
    "prefix": "zap_8fK2mQ",
    "permission": "sending_access",
    "mode": "live",
    "stream": null,
    "expires_at": null,
    "domain_id": "019a1f10-8a10-7b22-8c31-5d2e9f0a4b17",
    "last_used_at": null,
    "created_at": "2026-10-21T15:30:00Z"
  }
}
```

**Onboard a client domain**

Node.js:

```javascript
import { zap } from './zap.mjs'; // ZAP_API_KEY: your full-access agency key

export async function onboardClient(client) {
  const domain = await zap('POST', '/domains', { name: client.sendingDomain });
  await sendDnsInstructions(client, domain.records); // [{ type, name, value, required }]
  await db.clients.update(client.id, { zapDomainId: domain.id });
}

// From a job, until it succeeds (DNS can take a while).
export async function activateClient(client) {
  const domain = await zap('POST', `/domains/${client.zapDomainId}/verify`);
  if (domain.status !== 'verified') return false;
  const { token, key } = await zap('POST', '/api-keys', {
    name: `client-${client.slug}`,
    permission: 'sending_access',
    mode: 'live',
    domain_id: client.zapDomainId,
  });
  await secrets.put(`zapsmtp/${client.slug}`, token); // your secret manager: shown once
  await db.clients.update(client.id, { zapKeyId: key.id });
  return true;
}

// Offboarding: the key stops working on the next request.
export const offboardClient = (client) => zap('DELETE', `/api-keys/${client.zapKeyId}`);
```

Python:

```python
from zap import zap  # ZAP_API_KEY: your full-access agency key

def onboard_client(client):
    domain = zap("POST", "/domains", {"name": client.sending_domain})
    send_dns_instructions(client, domain["records"])
    db.clients.update(client.id, zap_domain_id=domain["id"])

def activate_client(client) -> bool:
    domain = zap("POST", f"/domains/{client.zap_domain_id}/verify")
    if domain["status"] != "verified":
        return False
    created = zap("POST", "/api-keys", {
        "name": f"client-{client.slug}",
        "permission": "sending_access",
        "mode": "live",
        "domain_id": client.zap_domain_id,
    })
    secrets.put(f"zapsmtp/{client.slug}", created["token"])  # shown once
    db.clients.update(client.id, zap_key_id=created["key"]["id"])
    return True

def offboard_client(client):
    zap("DELETE", f"/api-keys/{client.zap_key_id}")
```

PHP:

```php
<?php
require_once 'zap.php'; // ZAP_API_KEY: your full-access agency key

function onboard_client(array $client): void
{
    $domain = zap('POST', '/domains', ['name' => $client['sending_domain']]);
    send_dns_instructions($client, $domain['records']);
    db_update_client($client['id'], ['zap_domain_id' => $domain['id']]);
}

function activate_client(array $client): bool
{
    $domain = zap('POST', "/domains/{$client['zap_domain_id']}/verify");
    if ($domain['status'] !== 'verified') return false;
    $created = zap('POST', '/api-keys', [
        'name' => "client-{$client['slug']}",
        'permission' => 'sending_access',
        'mode' => 'live',
        'domain_id' => $client['zap_domain_id'],
    ]);
    secrets_put("zapsmtp/{$client['slug']}", $created['token']); // shown once
    db_update_client($client['id'], ['zap_key_id' => $created['key']['id']]);
    return true;
}

function offboard_client(array $client): void
{
    zap('DELETE', "/api-keys/{$client['zap_key_id']}");
}
```

> Restricted keys can also be limited to one stream (`stream`) and given an expiry (`expires_at` or `expires_in_days`). Change a key’s restrictions later with [PATCH /api-keys/{id}](https://zapsmtp.com/docs/keys/update-api-key/); the token stays the same.

## 9. Retries with exponential backoff and Retry-After

**What you build:** a wrapper that retries exactly the failures worth retrying, waits at least as long as the server asks, and never sends an email twice.

**What to retry**

- **Retry**: Network errors and timeouts; `429 rate_limit_exceeded` (`Retry-After: 1`); `429 overloaded`, the server at capacity (`Retry-After: 1` or `5`); `503 service_unavailable` (`Retry-After: 2` while a backing store fails over, `5` otherwise: the MTA unavailable, the suppression list loading, too many large bodies in flight); other 5xx; `409 idempotency_request_in_progress` (the first attempt is still running).
- **Do not retry**: `429 monthly_quota_exceeded` and `daily_quota_exceeded` (wait for the reset or upgrade); `421 misdirected_cell`: send to the URL the message names instead; every other 4xx: fix the request.
- **Never retry a 200**: A response with `unconfirmed: true` counts as sent; its events tell the outcome. `failed_recipients` lists addresses that were refused and not charged.

**Retry with backoff**

Node.js:

```javascript
import crypto from 'node:crypto';
import { zap } from './zap.mjs';

// Worth retrying: network errors, 5xx, the per-second rate limit and a duplicate in flight.
// Not worth it: monthly_quota_exceeded, daily_quota_exceeded and every other 4xx.
const RETRY_CODES = new Set(['rate_limit_exceeded', 'idempotency_request_in_progress']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withRetry(call, { attempts = 6, baseMs = 500, maxMs = 30_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const retry = err.status === undefined || err.status >= 500 || RETRY_CODES.has(err.code);
      if (!retry || attempt >= attempts) throw err;
      const backoff = Math.random() * Math.min(maxMs, baseMs * 2 ** attempt); // full jitter
      await sleep(Math.max(backoff, (err.retryAfter || 0) * 1000));          // never sooner than Retry-After
    }
  }
}

// The key is created once, outside the loop: every attempt is the same request.
export function sendEmail(email, idempotencyKey = crypto.randomUUID()) {
  return withRetry(() => zap('POST', '/emails', email, { 'Idempotency-Key': idempotencyKey }));
}
```

Python:

```python
import random, time, uuid
import requests
from zap import zap, ZapError

RETRY_CODES = {"rate_limit_exceeded", "idempotency_request_in_progress"}

def with_retry(call, attempts=6, base=0.5, cap=30.0):
    for attempt in range(1, attempts + 1):
        try:
            return call()
        except requests.RequestException:  # network error, timeout
            if attempt == attempts:
                raise
            wait = 0.0
        except ZapError as e:
            if not (e.status >= 500 or e.code in RETRY_CODES) or attempt == attempts:
                raise
            wait = e.retry_after
        time.sleep(max(wait, random.uniform(0, min(cap, base * 2 ** attempt))))

def send_email(email: dict, idempotency_key: str | None = None):
    key = idempotency_key or str(uuid.uuid4())
    return with_retry(lambda: zap("POST", "/emails", email, headers={"Idempotency-Key": key}))
```

Go:

```go
var retryCodes = map[string]bool{"rate_limit_exceeded": true, "idempotency_request_in_progress": true}

func WithRetry(ctx context.Context, attempts int, call func() error) error {
	for attempt := 1; ; attempt++ {
		err := call()
		var zerr *zap.Error
		isZap := errors.As(err, &zerr)
		retry := err != nil && (!isZap || zerr.Status >= 500 || retryCodes[zerr.Code])
		if !retry || attempt >= attempts {
			return err
		}
		wait := time.Duration(rand.Int64N(int64(min(30*time.Second, 500*time.Millisecond<<attempt)))) // math/rand/v2
		if isZap && zerr.RetryAfter > wait {
			wait = zerr.RetryAfter
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
}

func SendEmail(ctx context.Context, email map[string]any, out any) error {
	key := uuid.NewString() // one key for every attempt
	return WithRetry(ctx, 6, func() error {
		return zap.Do(ctx, "POST", "/emails", email, map[string]string{"Idempotency-Key": key}, out)
	})
}
```

PHP:

```php
<?php
require_once 'zap.php';

function zap_with_retry(callable $call, int $attempts = 6): mixed
{
    for ($attempt = 1; ; $attempt++) {
        try {
            return $call();
        } catch (ZapError $e) {
            $retry = $e->status === 0 || $e->status >= 500
                || in_array($e->zapCode, ['rate_limit_exceeded', 'idempotency_request_in_progress'], true);
            if (!$retry || $attempt >= $attempts) throw $e;
            $backoff = mt_rand(0, min(30000, 500 * 2 ** $attempt)) / 1000;
            usleep((int) (max($backoff, $e->retryAfter) * 1e6));
        }
    }
}

$key = bin2hex(random_bytes(16)); // one key for every attempt
$sent = zap_with_retry(fn () => zap('POST', '/emails', [
    'from' => 'Acme <hello@acme.com>',
    'to' => ['delivered@simulator.zapsmtp.com'],
    'subject' => 'Hello',
    'text' => 'Hi there!',
], ['Idempotency-Key' => $key]));
```

> Create the `Idempotency-Key` once per logical email and reuse it on every attempt: if a timed-out attempt actually succeeded, the retry returns its response with `Idempotent-Replayed: true`. In a batch, per-email failures such as `rate_limit_exceeded` come back in `errors[]` of a 200 response; resend only those emails with a new key, as in recipe 4.

## 10. Next.js, Express, Django and Laravel

**What you build:** a send endpoint and a webhook endpoint in your framework, with the key read from the environment on the server.

- Call ZapSMTP only from server code: Route Handlers or Server Actions in Next.js, never a client component.
- Webhook routes need the raw body for the signature, and no CSRF check (the signature replaces it).
- Answer webhooks with a 2xx quickly and dedupe on `Zap-Event-Id`.

**Framework integration**

Next.js:

```
// app/api/welcome/route.ts: a Route Handler runs on the server only.
// .env.local: ZAP_API_KEY=zap_...   Never prefix it with NEXT_PUBLIC_.
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId, email, firstName } = await req.json(); // authenticate the caller first
  const res = await fetch('https://api.zapsmtp.com/v1/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.ZAP_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `welcome-${userId}`,
    },
    body: JSON.stringify({
      from: 'Acme <hello@acme.com>',
      to: [email],
      template: { id: 'welcome', variables: { first_name: firstName } },
    }),
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data.name }, { status: 502 });
  return NextResponse.json({ id: data.id });
}

// app/api/hooks/zapsmtp/route.ts: read the raw text before parsing.
import { verifyZapSignature } from '@/lib/zap'; // from Setup

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyZapSignature(raw, req.headers.get('Zap-Signature'))) {
    return new Response('bad signature', { status: 400 });
  }
  const event = JSON.parse(raw); // dedupe on req.headers.get('Zap-Event-Id')
  return new Response(null, { status: 200 });
}
```

Express:

```
// server.mjs: ZAP_API_KEY and ZAP_WEBHOOK_SECRET come from the environment.
import express from 'express';
import { zap, verifyZapSignature } from './zap.mjs';

const app = express();

// webhooks before express.json(): they need the raw body
app.post('/hooks/zapsmtp', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verifyZapSignature(req.body, req.get('Zap-Signature'))) return res.sendStatus(400);
  const event = JSON.parse(req.body);
  res.sendStatus(200);
});

app.use(express.json());
app.post('/api/contact', async (req, res, next) => {
  try {
    const { name, email, message } = req.body; // validate these
    const { id } = await zap('POST', '/emails', {
      from: 'Acme Website <website@acme.com>',
      to: ['sales@acme.com'],
      reply_to: email,
      subject: `Contact form: ${name}`,
      text: message,
    });
    res.json({ id });
  } catch (err) {
    next(err);
  }
});

app.listen(3000);
```

Django:

```
# settings.py
ZAP_WEBHOOK_SECRET = os.environ["ZAP_WEBHOOK_SECRET"]  # zap.py reads ZAP_API_KEY itself

# views.py
import json
from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from .zap import zap, verify_zap_signature, ZapError

@require_POST
def contact(request):
    form = json.loads(request.body)  # validate these
    try:
        sent = zap("POST", "/emails", {
            "from": "Acme Website <website@acme.com>",
            "to": ["sales@acme.com"],
            "reply_to": form["email"],
            "subject": f"Contact form: {form['name']}",
            "text": form["message"],
        })
    except ZapError as e:
        return JsonResponse({"error": e.code}, status=502)
    return JsonResponse({"id": sent["id"]})

@csrf_exempt  # ZapSMTP signs its requests instead
@require_POST
def zapsmtp_webhook(request):
    if not verify_zap_signature(request.body, request.headers.get("Zap-Signature", ""),
                                settings.ZAP_WEBHOOK_SECRET):
        return HttpResponse(status=400)
    event = json.loads(request.body)
    return HttpResponse(status=200)
```

Laravel:

```
<?php
// config/services.php
'zapsmtp' => [
    'key' => env('ZAP_API_KEY'),
    'webhook_secret' => env('ZAP_WEBHOOK_SECRET'),
],

// app/Http/Controllers/ContactController.php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

class ContactController extends Controller
{
    public function store(Request $request)
    {
        $data = $request->validate(['name' => 'required|string', 'email' => 'required|email', 'message' => 'required|string']);
        $res = Http::withToken(config('services.zapsmtp.key'))
            ->withHeaders(['Idempotency-Key' => (string) Str::uuid()])
            ->post('https://api.zapsmtp.com/v1/emails', [
                'from' => 'Acme Website <website@acme.com>',
                'to' => ['sales@acme.com'],
                'reply_to' => $data['email'],
                'subject' => 'Contact form: ' . $data['name'],
                'text' => $data['message'],
            ]);
        abort_unless($res->successful(), 502, (string) $res->json('name'));
        return ['id' => $res->json('id')];
    }
}

// routes/api.php: API routes skip CSRF. verify_zap_signature() is in zap.php from Setup.
Route::post('/hooks/zapsmtp', function (Request $request) {
    abort_unless(verify_zap_signature($request->getContent(), (string) $request->header('Zap-Signature'),
        config('services.zapsmtp.webhook_secret')), 400);
    $event = json_decode($request->getContent(), true);
    return response('', 200);
});
```
