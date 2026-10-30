# Webhook events

> ZapSMTP webhook event types, payloads, retries and HMAC-SHA256 signature verification with code for Node.js, Python, PHP, Go and Ruby.

Source: https://zapsmtp.com/docs/webhook-events/

ZapSMTP POSTs a JSON event to your endpoint for every recipient and every change. Answer with any 2xx within a few seconds; do the work afterwards.

![A webhook endpoint in the dashboard: its signing secret with verification code, a test-event form and the last deliveries with status codes and timings](https://zapsmtp.com/docs/img/webhook-light.webp)

Add endpoints under Webhooks in the dashboard: send a test event, watch every delivery and replay any of them.

**Event types**

- **`email.sent`**: Accepted for delivery.
- **`email.delivered`**: The receiving server accepted the message.
- **`email.delivery_delayed`**: A temporary failure; we keep retrying.
- **`email.bounced`**: Permanently rejected, or retries ran out.
- **`email.complained`**: The recipient marked it as spam.
- **`email.failed`**: Rejected before sending.
- **`email.opened`**: The tracking pixel loaded (open tracking on).
- **`email.clicked`**: A tracked link was clicked (click tracking on, or a link with a click action).
- **`email.suppressed`**: Not sent: the recipient is on your suppression list.
- **`email.received`**: An inbound email arrived. Metadata only, unless the endpoint has include_content: then text, html, headers and 24-hour download links for attachments and the raw message (cut at 1 MB, truncated: true).
- **`thread.created`**: A new conversation: a received email that answers nothing. Not sent for automated mail.
- **`thread.replied`**: A customer answered in a conversation. Not sent for auto-replies, bounces and notifications.
- **`email.replied`**: Someone answered an email sent with reply tracking. Sent for every tracked reply, automated ones included; data.reply.type tells them apart.

## Payload

One event per recipient: `data.to` is a single address. `bounce` appears on bounced, delayed, failed and suppressed events; `click` and `open` carry the link, IP and user agent; `click.action` names a link marked with a [click action](https://zapsmtp.com/docs/click-actions/), and `click.unique`, present on every click, is `true` on the first click of that action by that recipient of that email and `false` on later clicks and on links without an action; `email.opened` and `email.clicked` carry the email’s `metadata` and `tags` when each fits in 200 bytes; and `open.machine` is `true` when Apple Mail Privacy Protection loaded the pixel (such opens may not be a person reading; they still count as opens, and metrics split them out as `human_opened` / `human_open_rate`); `test` is `true` for test keys. `tls` (`version`, e.g. `TLSv1_3`, and `cipher`) appears when the attempt reached the receiving server over TLS.

`email.replied` carries `reply`: `email_id` (the received reply, readable with [GET /emails/receiving/{id}](https://zapsmtp.com/docs/receiving/get-received/); `data.email_id` is the email that was answered), `from`, `from_name`, `subject`, `text` (the reply without the quoted email, at most 2,000 characters), `type` (`human`, `unsubscribe`, `out_of_office`, `auto_reply`, `auto_generated`, `bounce` or `bulk`), `is_spam`, `sender_matches_recipient` (the replier was one of the email’s To or Cc recipients; `data.to` then names them, otherwise it is empty) and `forward`: `{to, status, reason}`, where `status` is `queued` or `skipped` and `reason` is `spam`, `automated`, `unsubscribe`, `not_allowed` or `no_destination`.

`email.received`, `thread.created` and `thread.replied` have their own `data` (see [Receiving email](https://zapsmtp.com/docs/inbound-guide/)) and no top-level `id`: dedupe them on the `Zap-Event-Id` header.

```json
{
  "id": "evt_5f0c2a9b7d1e4c3a8b6f2e10",
  "type": "email.bounced",
  "created_at": "2026-10-21T15:04:12.381Z",
  "data": {
    "email_id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
    "from": "Acme <hello@acme.com>",
    "to": "jane@example.org",
    "subject": "Your receipt",
    "tags": {
      "category": "receipt"
    },
    "metadata": {
      "order_id": "A-1042"
    },
    "stream": "transactional",
    "thread_id": "3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13",
    "attempts": 1,
    "response": {
      "code": 550,
      "message": "5.1.1 The email account that you tried to reach does not exist"
    },
    "bounce": {
      "type": "Permanent",
      "subType": "MailboxDoesNotExist",
      "message": "5.1.1 The email account that you tried to reach does not exist",
      "suppressed": true
    }
  }
}
```

An `email.clicked` event:

```json
{
  "id": "evt_7a1d0c3e9b2f4a6c8e5d1b07",
  "type": "email.clicked",
  "created_at": "2026-10-27T08:41:05.214Z",
  "data": {
    "email_id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
    "from": "<@acme.com>",
    "to": "jane@example.org",
    "tags": {
      "category": "receipt"
    },
    "metadata": {
      "order_id": "A-1042"
    },
    "stream": "transactional",
    "click": {
      "link": "https://acme.com/orders/A-1042/confirm",
      "action": "confirm_order",
      "unique": true,
      "ip_address": "203.0.113.24",
      "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15"
    }
  }
}
```

An endpoint with `filter.actions` receives `email.clicked` only for those actions; see [Send actions to their own endpoints](https://zapsmtp.com/docs/click-actions/#webhooks).

**Headers**

- **`Zap-Signature`**: `t=<unix seconds>,v1=<hex HMAC-SHA256>`. After you rotate the secret, both secrets sign for 24 hours and the header carries two `v1` values.
- **`Zap-Event-Id`**: Stable across retries and replays. Store it and skip events you have already processed.
- **`Zap-Webhook-Id`**: The endpoint that this delivery is for.

## Verify signatures

Compute HMAC-SHA256 with your endpoint’s secret (the whole string, including `whsec_`) over `<t>.<raw body>` and compare it, in constant time, with each `v1` value. Reject timestamps older than five minutes. Always use the raw request body: re-serialized JSON will not match.

**Verify Zap-Signature**

Node.js:

```javascript
import crypto from 'node:crypto';
import express from 'express';

const app = express();
// keep the raw body: the signature covers the exact bytes
app.post('/hooks/zapsmtp', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('Zap-Signature') ?? '';
  const parts = header.split(',').map((p) => p.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  const expected = crypto.createHmac('sha256', process.env.ZAP_WEBHOOK_SECRET)
    .update(`${t}.${req.body}`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  const ok = fresh && sigs.some((s) => s.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return res.sendStatus(400);

  const event = JSON.parse(req.body);
  // dedupe on req.get('Zap-Event-Id'): retries repeat the same id
  res.sendStatus(200);
});
```

Python:

```python
import hashlib, hmac, os, time
from flask import Flask, request, abort

app = Flask(__name__)

@app.post("/hooks/zapsmtp")
def zapsmtp():
    parts = [p.split("=", 1) for p in request.headers.get("Zap-Signature", "").split(",")]
    t = next((v for k, v in parts if k == "t"), "0")
    sigs = [v for k, v in parts if k == "v1"]
    expected = hmac.new(os.environ["ZAP_WEBHOOK_SECRET"].encode(),
                        f"{t}.".encode() + request.get_data(), hashlib.sha256).hexdigest()
    if abs(time.time() - int(t)) > 300 or not any(hmac.compare_digest(s, expected) for s in sigs):
        abort(400)
    event = request.get_json()
    return "", 200
```

PHP:

```php
<?php
$body = file_get_contents('php://input');
$t = null; $sigs = [];
foreach (explode(',', $_SERVER['HTTP_ZAP_SIGNATURE'] ?? '') as $part) {
    [$k, $v] = array_pad(explode('=', $part, 2), 2, '');
    if ($k === 't') $t = $v;
    if ($k === 'v1') $sigs[] = $v;
}
$expected = hash_hmac('sha256', $t . '.' . $body, getenv('ZAP_WEBHOOK_SECRET'));
$valid = abs(time() - (int) $t) < 300
    && count(array_filter($sigs, fn ($s) => hash_equals($expected, $s))) > 0;
if (!$valid) {
    http_response_code(400);
    exit;
}
$event = json_decode($body, true);
http_response_code(200);
```

Go:

```go
func zapsmtp(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var t string
	var sigs []string
	for _, part := range strings.Split(r.Header.Get("Zap-Signature"), ",") {
		k, v, _ := strings.Cut(part, "=")
		switch k {
		case "t":
			t = v
		case "v1":
			sigs = append(sigs, v)
		}
	}
	mac := hmac.New(sha256.New, []byte(os.Getenv("ZAP_WEBHOOK_SECRET")))
	mac.Write([]byte(t + "."))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	ts, _ := strconv.ParseInt(t, 10, 64)
	ok := false
	for _, s := range sigs {
		ok = ok || hmac.Equal([]byte(s), []byte(expected))
	}
	if !ok || time.Since(time.Unix(ts, 0)).Abs() > 5*time.Minute {
		http.Error(w, "bad signature", http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusOK)
}
```

Ruby:

```ruby
require 'openssl'
require 'rack/utils'

post '/hooks/zapsmtp' do
  body = request.body.read
  parts = request.env['HTTP_ZAP_SIGNATURE'].to_s.split(',').map { |p| p.split('=', 2) }
  t = parts.find { |k, _| k == 't' }&.last.to_s
  sigs = parts.select { |k, _| k == 'v1' }.map(&:last)
  expected = OpenSSL::HMAC.hexdigest('SHA256', ENV.fetch('ZAP_WEBHOOK_SECRET'), "#{t}.#{body}")
  fresh = (Time.now.to_i - t.to_i).abs < 300
  halt 400 unless fresh && sigs.any? { |s| Rack::Utils.secure_compare(s, expected) }
  event = JSON.parse(body)
  200
end
```

### Check a signature here

Paste a secret and a body to get the header we would send, or paste a received header to check it. Everything runs in your browser.

## Batched delivery

For high volumes, turn on `batch` when you [create](https://zapsmtp.com/docs/webhooks/create-webhook/) or [update](https://zapsmtp.com/docs/webhooks/update-webhook/) an endpoint. Events then arrive up to 100 per request, or whatever arrived within a second, as a JSON array of the usual event objects. The array is signed as one body, exactly like a single event. `Zap-Event-Id` is the batch’s id, the same on every retry. Each event in it keeps its own `id`, so dedupe per event (`email.received` and thread events have no `id`: dedupe those on `type` plus `data.email_id`). A failed batch is retried as it was, with the same schedule as single events. `email.received` with `include_content` still arrives on its own.

How fast ZapSMTP sends adapts to your endpoint. Requests in flight start at 32. They grow while your endpoint answers quickly, and halve when it times out or answers 5xx or 429. A slow endpoint is not flooded, and a fast one is not held back.

## Retries

Network errors, timeouts, 5xx, 408 and 429 are retried after 5 s, 5 min, 30 min, 2 h, 5 h, 10 h and 10 h — eight attempts over about 28 hours. Other 4xx answers are final. An endpoint that keeps failing is paused for a minute without losing attempts, and is disabled if five events exhaust their retries within 24 hours (re-enable it with [PATCH](https://zapsmtp.com/docs/webhooks/update-webhook/)). The last 100 attempts are kept: [list them](https://zapsmtp.com/docs/webhooks/webhook-deliveries/) and [replay](https://zapsmtp.com/docs/webhooks/replay-event/) any event.
