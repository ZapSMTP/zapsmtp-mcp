# Receiving email

> Receive email with ZapSMTP: managed or own-domain addresses, routes, signed webhooks, parsed replies, attachments, conversations and replies.

Source: https://zapsmtp.com/docs/inbound-guide/

Give your app an inbox. ZapSMTP accepts mail for your addresses, checks SPF, DKIM, DMARC and spam, strips the quoted reply, groups messages into conversations and tells your server with a signed `email.received` webhook. You answer through the API, from the right address, in the same thread.

![The Inbound page of the dashboard: receiving domains with their MX status, routes in priority order and the latest received emails with spam and authentication verdicts](https://zapsmtp.com/docs/img/inbound-light.webp)

Everything on this page is also in the dashboard under Inbound.

**The path of a received email**

- **1. Accept**: Mail for an unknown domain is refused during the SMTP conversation, so ZapSMTP never sends backscatter. On your domains every local part is accepted: `anything@`, `support+1234@`.
- **2. Check**: SPF, DKIM, DMARC and ARC are evaluated and the message gets a spam score. Clear spam is refused; likely spam is flagged (Spam).
- **3. Route**: Your routes decide: webhook, store, forward or reject.
- **4. Store**: The sender gets `250` only after the message is stored durably. Any trouble on our side answers with a temporary `451`, so the sending server retries and nothing is lost.
- **5. Notify**: `email.received`, plus `thread.created` or `thread.replied`, go to your webhook endpoints.

## Get an address

There are two kinds of inbound domain, and an account can have several of each.

> Setting up inbound changes your account, so the setup requests on this page (domains, routes, forward destinations, webhooks, `PATCH /threads`, spam reports, redeliver and erase) need a full-access live key. A test key gets `403 test_key_restricted` for them; it can still read and reply (test replies are never delivered).

**Inbound domains**

- **Managed**: A random name under `in.zapsmtp.com`, such as `k3f9x2m7q1.in.zapsmtp.com`. Ready the moment you create it, no DNS. Receive-only: you reply from one of your own sending domains.
- **Your own domain**: Any domain you verified for sending, or a subdomain of it (`support.acme.com`, `reply.acme.com`): that verification already proves you control its DNS. You add one MX record. Replies are checked against the exact From domain: to answer from `support@support.acme.com`, verify `support.acme.com` for sending too, or reply with a From on a domain you already verified, such as `support@acme.com`.

## Create a managed address

`POST /v1/inbound/domains`

An instant receiving domain on ZapSMTP: no DNS, every local part works.

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
curl -X POST 'https://app.zapsmtp.com/v1/inbound/domains' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "managed": true
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

## Receive on your own domain

`POST /v1/inbound/domains`

Use a domain (or subdomain) of a domain you already verified for sending, then publish the MX record from `records`.

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
curl -X POST 'https://app.zapsmtp.com/v1/inbound/domains' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "support.acme.com",
  "reject_spam": true,
  "require_tls": false
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

## The MX record

The response lists the record to publish under `records`. It is the only record inbound needs:

**DNS for support.acme.com**

- **Type**: `MX`
- **Name**: `support.acme.com` (in many DNS panels: `support`)
- **Priority**: `10`
- **Value**: `mail.zapsmtp.com`

> Publishing an MX record moves all mail of that name to ZapSMTP. To keep your existing mailboxes on `acme.com`, receive on a subdomain such as `support.acme.com` or `reply.acme.com`.

Then ask for a check. `mx_verified` turns `true` as soon as any MX record of the name points to `mail.zapsmtp.com`; `mx_found` shows what DNS returns today.

## Check the MX record

`POST /v1/inbound/domains/{id}/verify`

Check the domain's MX record now.

Requires a full-access live key; test keys get 403 test_key_restricted.

`mx_verified` becomes `true` as soon as any MX record of the domain points to our inbound host.

### Path parameters

- `id` (string (UUID), required): Inbound domain id

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `not_found` (HTTP 404): inbound domain not found

```bash
curl -X POST 'https://app.zapsmtp.com/v1/inbound/domains/019a1f21-5d6e-7f80-9a1b-2c3d4e5f6a7b/verify' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "domain": {
    "id": "019a1f21-5d6e-7f80-9a1b-2c3d4e5f6a7b",
    "name": "reply.acme.com",
    "managed": false,
    "reject_spam": true,
    "mx_verified": true,
    "last_checked_at": "2026-10-21T15:05:00Z",
    "created_at": "2026-10-20T11:30:00Z",
    "records": [
      {
        "record": "MX",
        "type": "MX",
        "name": "reply.acme.com",
        "value": "10 mail.zapsmtp.com",
        "required": true,
        "status": "verified"
      }
    ],
    "example_address": "anything@reply.acme.com"
  },
  "mx_found": [
    "mail.zapsmtp.com"
  ]
}
```

## Routes

Routes are rules you set per account (up to 100). They are tried in `priority` order, lowest first, then oldest first; the first enabled route whose conditions all match decides. A message that matches no route takes the default path: it is stored and sent to every endpoint subscribed to `email.received`.

**Conditions (all must match; empty matches anything)**

- **`match_recipient`**: The receiving address, for example `support+*@acme.com`.
- **`match_sender`**: The envelope sender (`MAIL FROM`), which can differ from the From header.
- **`match_header` + `match_header_value`**: A header name (any case) and a pattern for its value. A message without that header does not match.

Patterns are case-insensitive globs where `*` is any run of characters and `?` one character, or a regular expression between slashes, such as `/^(sales|billing)@acme\.com$/`. Regular expressions use RE2 syntax, which runs in linear time; lookarounds and backreferences are not supported. Each pattern is at most 512 bytes (UTF-8) and must compile.

**Actions**

- **`webhook`**: Stored, and `email.received` goes only to `webhook_id`, even when that endpoint does not subscribe to it. Other endpoints do not see the message.
- **`store`**: Stored and readable through the API and the dashboard. No webhook.
- **`forward`**: Stored, and a copy is relayed to the confirmed destination `forward_id` (Forwarding). No webhook.
- **`reject`**: Refused during SMTP with `550 5.7.1`. Nothing is stored; the message is listed with `status: "rejected"`.

The received email records what happened in `route_id` and `action` (`default` when no route matched).

## Send support mail to one endpoint

`POST /v1/inbound/routes`

Every address `support+…@acme.com` goes to a single webhook endpoint, whatever events that endpoint subscribes to.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Body parameters

- `name` (string): Label (trimmed).
- `priority` (integer): Lower runs first; first match wins. Default `100`.
- `match_recipient` (string): Glob (case-insensitive, * and ?) e.g. support+*@acme.com, or /regex/ (RE2, case-insensitive). Empty matches all. Limits: max 512 chars; must compile (422 invalid_parameter)
- `match_sender` (string): Same syntax, matched against the envelope sender. Limits: max 512 chars; must compile
- `match_header` (string): Header name to test.
- `match_header_value` (string): Glob or /regex/ for that header's value. Limits: max 512 chars; must compile
- `action` (string, required): webhook: deliver email.received only to webhook_id; store: keep without webhook; forward: keep and forward to forward_id (a confirmed forward destination); reject: refuse with 550 at SMTP time. Limits: 422 invalid_parameter "action must be webhook, store, reject or forward" One of `webhook`, `store`, `forward`, `reject`.
- `webhook_id` (string | null): Required when action is webhook. A webhook of this account. Cleared for store/reject. Limits: 422 "webhook_id is required for action webhook" / "webhook_id does not belong to this account"
- `forward_id` (string | null): A confirmed forward destination of this account (action forward). Cleared for other actions. Limits: 422 "forward_id is required for action forward" / "forward_id does not belong to this account" / "... is not confirmed yet"
- `enabled` (boolean): Default `True`.

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `invalid_parameter` (HTTP 422): validation failures or "at most 100 routes per account"

```bash
curl -X POST 'https://app.zapsmtp.com/v1/inbound/routes' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "Support tickets",
  "priority": 10,
  "match_recipient": "support+*@acme.com",
  "action": "webhook",
  "webhook_id": "019a1f22-6e7f-7091-8a2b-3c4d5e6f7a8b"
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f31-0b2c-7d3e-8f4a-5b6c7d8e9f01",
  "name": "Support tickets",
  "priority": 10,
  "match_recipient": "support+*@acme.com",
  "match_sender": "",
  "match_header": "",
  "match_header_value": "",
  "action": "webhook",
  "webhook_id": "019a1f22-6e7f-7091-8a2b-3c4d5e6f7a8b",
  "enabled": true,
  "created_at": "2026-10-21T15:20:00Z"
}
```

## Refuse a sender at SMTP time

`POST /v1/inbound/routes`

A `/regex/` on the envelope sender; matching mail is refused with 550 and never stored.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Body parameters

- `name` (string): Label (trimmed).
- `priority` (integer): Lower runs first; first match wins. Default `100`.
- `match_recipient` (string): Glob (case-insensitive, * and ?) e.g. support+*@acme.com, or /regex/ (RE2, case-insensitive). Empty matches all. Limits: max 512 chars; must compile (422 invalid_parameter)
- `match_sender` (string): Same syntax, matched against the envelope sender. Limits: max 512 chars; must compile
- `match_header` (string): Header name to test.
- `match_header_value` (string): Glob or /regex/ for that header's value. Limits: max 512 chars; must compile
- `action` (string, required): webhook: deliver email.received only to webhook_id; store: keep without webhook; forward: keep and forward to forward_id (a confirmed forward destination); reject: refuse with 550 at SMTP time. Limits: 422 invalid_parameter "action must be webhook, store, reject or forward" One of `webhook`, `store`, `forward`, `reject`.
- `webhook_id` (string | null): Required when action is webhook. A webhook of this account. Cleared for store/reject. Limits: 422 "webhook_id is required for action webhook" / "webhook_id does not belong to this account"
- `forward_id` (string | null): A confirmed forward destination of this account (action forward). Cleared for other actions. Limits: 422 "forward_id is required for action forward" / "forward_id does not belong to this account" / "... is not confirmed yet"
- `enabled` (boolean): Default `True`.

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `invalid_parameter` (HTTP 422): validation failures or "at most 100 routes per account"

```bash
curl -X POST 'https://app.zapsmtp.com/v1/inbound/routes' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "Block a scraper",
  "priority": 1,
  "match_sender": "/@(.+\\.)?example\\.net$/",
  "action": "reject"
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f31-0b2c-7d3e-8f4a-5b6c7d8e9f01",
  "name": "Support tickets",
  "priority": 10,
  "match_recipient": "support+*@acme.com",
  "match_sender": "",
  "match_header": "",
  "match_header_value": "",
  "action": "webhook",
  "webhook_id": "019a1f22-6e7f-7091-8a2b-3c4d5e6f7a8b",
  "enabled": true,
  "created_at": "2026-10-21T15:20:00Z"
}
```

## Keep mailing-list mail without a webhook

`POST /v1/inbound/routes`

Match on any header: here mail that carries a `List-Id` is stored and stays readable through the API, but no webhook fires.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Body parameters

- `name` (string): Label (trimmed).
- `priority` (integer): Lower runs first; first match wins. Default `100`.
- `match_recipient` (string): Glob (case-insensitive, * and ?) e.g. support+*@acme.com, or /regex/ (RE2, case-insensitive). Empty matches all. Limits: max 512 chars; must compile (422 invalid_parameter)
- `match_sender` (string): Same syntax, matched against the envelope sender. Limits: max 512 chars; must compile
- `match_header` (string): Header name to test.
- `match_header_value` (string): Glob or /regex/ for that header's value. Limits: max 512 chars; must compile
- `action` (string, required): webhook: deliver email.received only to webhook_id; store: keep without webhook; forward: keep and forward to forward_id (a confirmed forward destination); reject: refuse with 550 at SMTP time. Limits: 422 invalid_parameter "action must be webhook, store, reject or forward" One of `webhook`, `store`, `forward`, `reject`.
- `webhook_id` (string | null): Required when action is webhook. A webhook of this account. Cleared for store/reject. Limits: 422 "webhook_id is required for action webhook" / "webhook_id does not belong to this account"
- `forward_id` (string | null): A confirmed forward destination of this account (action forward). Cleared for other actions. Limits: 422 "forward_id is required for action forward" / "forward_id does not belong to this account" / "... is not confirmed yet"
- `enabled` (boolean): Default `True`.

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `invalid_parameter` (HTTP 422): validation failures or "at most 100 routes per account"

```bash
curl -X POST 'https://app.zapsmtp.com/v1/inbound/routes' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "Newsletters",
  "priority": 50,
  "match_header": "List-Id",
  "match_header_value": "*",
  "action": "store"
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f31-0b2c-7d3e-8f4a-5b6c7d8e9f01",
  "name": "Support tickets",
  "priority": 10,
  "match_recipient": "support+*@acme.com",
  "match_sender": "",
  "match_header": "",
  "match_header_value": "",
  "action": "webhook",
  "webhook_id": "019a1f22-6e7f-7091-8a2b-3c4d5e6f7a8b",
  "enabled": true,
  "created_at": "2026-10-21T15:20:00Z"
}
```

## Pause a route

`PATCH /v1/inbound/routes/{id}`

Disabled routes are skipped; the next matching route (or the default) handles the message.

Requires a full-access live key; test keys get 403 test_key_restricted.

Any subset of the POST /inbound/routes fields. Omitted fields keep their value; webhook_id: "" clears it. The resulting route must still be valid (e.g. action webhook needs webhook_id).

### Path parameters

- `id` (string (UUID), required): Route id

### Body parameters

- `name` (string): Label (trimmed).
- `priority` (integer): Lower runs first; first match wins.
- `match_recipient` (string): Glob (case-insensitive, * and ?) e.g. support+*@acme.com, or /regex/ (RE2, case-insensitive). Empty matches all. Limits: max 512 chars; must compile (422 invalid_parameter)
- `match_sender` (string): Same syntax, matched against the envelope sender. Limits: max 512 chars; must compile
- `match_header` (string): Header name to test.
- `match_header_value` (string): Glob or /regex/ for that header's value. Limits: max 512 chars; must compile
- `action` (string): webhook: deliver email.received only to webhook_id; store: keep without webhook; forward: keep and forward to forward_id (a confirmed forward destination); reject: refuse with 550 at SMTP time. Limits: 422 invalid_parameter "action must be webhook, store, reject or forward" One of `webhook`, `store`, `forward`, `reject`.
- `webhook_id` (string | null): A webhook of this account. Cleared for store/reject. Limits: 422 "webhook_id is required for action webhook" / "webhook_id does not belong to this account"
- `forward_id` (string | null): A confirmed forward destination of this account (action forward). Cleared for other actions. Limits: 422 "forward_id is required for action forward" / "forward_id does not belong to this account" / "... is not confirmed yet"
- `enabled` (boolean)

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `not_found` (HTTP 404): route not found
- `invalid_parameter` (HTTP 422)

```bash
curl -X PATCH 'https://app.zapsmtp.com/v1/inbound/routes/019a1f31-0b2c-7d3e-8f4a-5b6c7d8e9f01' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "enabled": false
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f31-0b2c-7d3e-8f4a-5b6c7d8e9f01",
  "name": "Support tickets",
  "priority": 5,
  "match_recipient": "support+*@acme.com",
  "match_sender": "",
  "match_header": "",
  "match_header_value": "",
  "action": "store",
  "webhook_id": null,
  "enabled": true,
  "created_at": "2026-10-20T12:00:00Z"
}
```

## Forwarding

To forward to an ordinary mailbox, add it as a forward destination first. ZapSMTP emails it a confirmation link; the page behind the link asks for a click, so link scanners cannot confirm on their own. Until then `verified_at` is `null` and no route may forward there. An account can have 20 destinations; a ZapSMTP receiving address cannot be one, because it would loop. A lost link can be sent again, at most once a minute, and the previous link stops working.

The forwarded copy is the original message byte for byte, so its From and DKIM signature stay intact. ZapSMTP adds an ARC seal with its authentication results and an `X-ZapSMTP-Forwarded-For` header naming the receiving address. Each forward counts as one sent email and appears in your email log. Spam is never forwarded, and neither is a message already forwarded several times or one that names the destination itself. Removing a destination makes its routes store only.

## Add a forward destination

`POST /v1/inbound/forward-destinations`

Add a forward destination: we email it a confirmation link; routes can forward there once its owner confirms.

Requires a full-access live key; test keys get 403 test_key_restricted.

The confirmation page asks for a click, so mail scanners that follow links cannot confirm. Forwarded mail keeps its original From and DKIM, is ARC-signed by us, counts as one sent email and appears in the email log; spam is never forwarded.

### Body parameters

- `email` (string, required): A plain address. Not a ZapSMTP receiving address (it would loop).

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `conflict` (HTTP 409): <email> is already a forward destination
- `invalid_parameter` (HTTP 422): "email must be a plain address (name@example.com)" | "cannot forward to a ZapSMTP receiving address (it would loop)"
- `limit_exceeded` (HTTP 422): at most 20 forward destinations per account
- `rate_limit_exceeded` (HTTP 429): at most 20 forward destinations can be added a day
- `service_unavailable` (HTTP 503): the destination was added but its confirmation email could not be sent; resend it

```bash
curl -X POST 'https://app.zapsmtp.com/v1/inbound/forward-destinations' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "email": "oncall@acme.com"
}'
```

**Response `201 Created`**

```json
{
  "id": "0199f0b2-0000-7000-8000-00000000f001",
  "email": "team@acme.com",
  "confirmation_sent_at": "2026-10-25T10:00:00Z",
  "verified_at": null,
  "created_at": "2026-10-25T10:00:00Z"
}
```

## Forward to a confirmed destination

`POST /v1/inbound/routes`

Keep the message and relay a copy to the destination once its owner has confirmed it.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Body parameters

- `name` (string): Label (trimmed).
- `priority` (integer): Lower runs first; first match wins. Default `100`.
- `match_recipient` (string): Glob (case-insensitive, * and ?) e.g. support+*@acme.com, or /regex/ (RE2, case-insensitive). Empty matches all. Limits: max 512 chars; must compile (422 invalid_parameter)
- `match_sender` (string): Same syntax, matched against the envelope sender. Limits: max 512 chars; must compile
- `match_header` (string): Header name to test.
- `match_header_value` (string): Glob or /regex/ for that header's value. Limits: max 512 chars; must compile
- `action` (string, required): webhook: deliver email.received only to webhook_id; store: keep without webhook; forward: keep and forward to forward_id (a confirmed forward destination); reject: refuse with 550 at SMTP time. Limits: 422 invalid_parameter "action must be webhook, store, reject or forward" One of `webhook`, `store`, `forward`, `reject`.
- `webhook_id` (string | null): Required when action is webhook. A webhook of this account. Cleared for store/reject. Limits: 422 "webhook_id is required for action webhook" / "webhook_id does not belong to this account"
- `forward_id` (string | null): A confirmed forward destination of this account (action forward). Cleared for other actions. Limits: 422 "forward_id is required for action forward" / "forward_id does not belong to this account" / "... is not confirmed yet"
- `enabled` (boolean): Default `True`.

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `invalid_parameter` (HTTP 422): validation failures or "at most 100 routes per account"

```bash
curl -X POST 'https://app.zapsmtp.com/v1/inbound/routes' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "Billing to on-call",
  "priority": 20,
  "match_recipient": "billing@acme.com",
  "action": "forward",
  "forward_id": "0199f0b2-0000-7000-8000-00000000f001"
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f31-0b2c-7d3e-8f4a-5b6c7d8e9f01",
  "name": "Support tickets",
  "priority": 10,
  "match_recipient": "support+*@acme.com",
  "match_sender": "",
  "match_header": "",
  "match_header_value": "",
  "action": "webhook",
  "webhook_id": "019a1f22-6e7f-7091-8a2b-3c4d5e6f7a8b",
  "enabled": true,
  "created_at": "2026-10-21T15:20:00Z"
}
```

## The email.received webhook

One event per received message and receiving address: mail sent to two of your addresses arrives as two emails, each with its own `email_id`. Events are signed and retried like every other event ([Webhook events](https://zapsmtp.com/docs/webhook-events/)); the event id is in the `Zap-Event-Id` header and stays the same across retries.

By default the event carries metadata only, so a 40 MB message never hits a request size limit on your side. Fetch the body when you need it, or turn on `include_content` for the endpoint.

## Subscribe an endpoint

`POST /v1/webhooks`

Ask for `email.received` and the conversation events. `include_content` adds the message itself to `email.received`.

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
  "url": "https://acme.com/hooks/inbound",
  "events": [
    "email.received",
    "thread.created",
    "thread.replied"
  ],
  "include_content": true
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

## Payload

```json
{
  "type": "email.received",
  "created_at": "2026-10-21T15:10:03.418Z",
  "data": {
    "email_id": "019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d",
    "created_at": "2026-10-21T15:10:02.904Z",
    "from": "jane@example.org",
    "from_name": "Jane Doe",
    "to": [
      "support+1234@acme.com"
    ],
    "cc": [],
    "bcc": [],
    "reply_to": [],
    "received_for": [
      "support+1234@acme.com"
    ],
    "message_id": "<CAF=abc123@mail.example.org>",
    "subject": "Re: Ticket #1234",
    "attachments": [
      {
        "id": "5b0f8f7e-2a1c-5d3e-9f4a-6b7c8d9e0f1a",
        "filename": "screenshot.png",
        "content_type": "image/png",
        "content_disposition": "attachment",
        "content_id": null,
        "size": 48213
      }
    ],
    "envelope": {
      "from": "jane@example.org",
      "to": "support+1234@acme.com"
    },
    "mailbox_hash": "1234",
    "reply_text": "Thanks, that fixed it!",
    "in_reply_to_email_id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
    "thread_id": "3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13",
    "automated": null,
    "authentication": {
      "spf": "pass",
      "dkim": "pass",
      "dmarc": "pass",
      "arc": "gray"
    },
    "spam": {
      "score": 1.2,
      "is_spam": false
    },
    "route_id": "019a1f31-0b2c-7d3e-8f4a-5b6c7d8e9f01",
    "size": 61877
  }
}
```

**data**

- **`email_id`**: The received email: `GET /emails/receiving/{id}`.
- **`from`, `from_name`**: The From header’s address and display name.
- **`to`, `cc`, `reply_to`**: As written in the headers. `bcc` is always empty: Bcc never appears in a delivered message.
- **`received_for`**: The one address of yours this copy was delivered to; it may not appear in `to` (a Bcc, a mailing list).
- **`envelope`**: The SMTP envelope: `from` is the return path, `to` the receiving address.
- **`mailbox_hash`**: The part after `+` in the receiving address: `support+1234@acme.com` gives `1234`. Put a ticket or order id there in the Reply-To of what you send.
- **`reply_text`**: Only the new text of a reply (below).
- **`in_reply_to_email_id`**: The email you sent through ZapSMTP that this message answers, or `null`.
- **`thread_id`**: The conversation.
- **`automated`**: `null` when a person wrote it, otherwise `{type, reason}` (below).
- **`authentication`**: SPF, DKIM, DMARC and ARC verdicts (below).
- **`spam`**: `score` and `is_spam`.
- **`attachments`**: Metadata of every part that is not the text or HTML body, inline images included.
- **`route_id`, `size`**: The route that matched (empty for none) and the message size in bytes.

### With include_content

The same event also carries the message. Text and HTML share a 1 MB budget after the headers; beyond it they are cut on a character boundary and `truncated` is `true`, and the API still serves them whole. Download links in the webhook work for 24 hours, so they survive every retry. If the message cannot be read at delivery time, `content_error` says to fetch it from the API instead.

```json
{
  "text": "Thanks, that fixed it!\n\nOn Tue, Oct 21, 2026 Acme Support <support@acme.com> wrote:\n> ...",
  "html": "<p>Thanks, that fixed it!</p><blockquote>...</blockquote>",
  "headers": {
    "from": "Jane Doe <jane@example.org>",
    "to": "support+1234@acme.com",
    "subject": "Re: Ticket #1234",
    "in-reply-to": "<019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23@…>"
  },
  "truncated": false,
  "attachments": [
    {
      "id": "5b0f8f7e-2a1c-5d3e-9f4a-6b7c8d9e0f1a",
      "filename": "screenshot.png",
      "content_type": "image/png",
      "content_disposition": "attachment",
      "content_id": null,
      "size": 48213,
      "download_url": "https://app.zapsmtp.com/v1/files/eyJ0Ijoi....aGk",
      "expires_at": "2026-10-22T15:10:03Z"
    }
  ],
  "raw": {
    "download_url": "https://app.zapsmtp.com/v1/files/eyJ0Ijoi....Qm9n",
    "expires_at": "2026-10-22T15:10:03Z"
  }
}
```

## Conversation events

Subscribe to `thread.created` to hear about new conversations (a message that answers nothing) and to `thread.replied` for answers in an existing one. Both skip bounces, out-of-office notices, auto-replies and notifications, and both are skipped when you redeliver. They use the same endpoints as `email.received`: messages handled by a `store`, `forward` or `reject` route produce none, and a `webhook` route sends them only to its endpoint, if that endpoint subscribes.

```json
{
  "type": "thread.replied",
  "created_at": "2026-10-21T15:10:03.420Z",
  "data": {
    "thread_id": "3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13",
    "email_id": "019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d",
    "created_at": "2026-10-21T15:10:02.904Z",
    "from": "jane@example.org",
    "from_name": "Jane Doe",
    "to": [
      "support+1234@acme.com"
    ],
    "subject": "Re: Ticket #1234",
    "received_for": [
      "support+1234@acme.com"
    ],
    "mailbox_hash": "1234",
    "reply_text": "Thanks, that fixed it!",
    "in_reply_to_email_id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
    "automated": null
  }
}
```

## Send a test email.received

`POST /v1/webhooks/{id}/test`

Send a signed sample event to the endpoint now and report the result.

Requires a full-access live key; test keys get 403 test_key_restricted.

Test events are not retried. delivery.error is present when the attempt failed (e.g. "HTTP 500"); status_code is 0 on network errors. The test attempt is recorded in the delivery log.

### Path parameters

- `id` (string, required): Webhook id

### Body parameters

- `type` (string): Limits: 422 invalid_parameter "unknown event type" One of `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.opened`, `email.clicked`, `email.suppressed`, `email.received`, `thread.created`, `thread.replied`, `email.replied`, `email.opened_unique`, `email.clicked_unique`, `email.unsubscribed`, `email.forward_failed`, `domain.verified`, `domain.reputation_changed`, `email.scheduled`, `suppression.added`, `suppression.removed`, `domain.created`, `domain.deleted`. Default `email.delivered`.

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `not_found` (HTTP 404): webhook not found
- `invalid_parameter` (HTTP 422)

```bash
curl -X POST 'https://app.zapsmtp.com/v1/webhooks/019a1f22-6e7f-7091-8a2b-3c4d5e6f7a8b/test' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "type": "email.received"
}'
```

**Response `200 OK`**

```json
{
  "ok": true,
  "delivery": {
    "event_id": "evt_test_9Gk2Lq7Xv1Rb4Tz8",
    "event_type": "email.delivered",
    "attempt": 1,
    "status_code": 200,
    "duration_ms": 143,
    "at": "2026-10-21T15:50:00.123Z",
    "body": {
      "id": "evt_test_9Gk2Lq7Xv1Rb4Tz8",
      "type": "email.delivered",
      "created_at": "2026-10-21T15:50:00.120Z",
      "data": {
        "email_id": "00000000-0000-0000-0000-000000000000",
        "from": "Test <test@example.com>",
        "to": "recipient@example.com",
        "subject": "ZapSMTP webhook test",
        "response": {
          "code": 250,
          "message": "OK (test event)"
        }
      }
    }
  },
  "payload": {
    "id": "evt_test_9Gk2Lq7Xv1Rb4Tz8",
    "type": "email.delivered",
    "created_at": "2026-10-21T15:50:00.120Z",
    "data": {
      "email_id": "00000000-0000-0000-0000-000000000000",
      "from": "Test <test@example.com>",
      "to": "recipient@example.com",
      "subject": "ZapSMTP webhook test",
      "response": {
        "code": 250,
        "message": "OK (test event)"
      }
    }
  }
}
```

## Read the message

The API returns the parsed message with its bodies, headers and verdicts, plus a link to the original. `html_format` picks how inline images come back: `data_uri` (the default) embeds them as `data:` URIs so the HTML renders on its own, `cid` keeps the `cid:` references as received. When the inline images are larger than 2 MB together they stay `cid` and the response says so in `html_format`.

## Retrieve the whole message

`GET /v1/emails/receiving/{id}`

Retrieve a received email with bodies, headers, authentication results and download links.

Requires a full-access key.

`automated` is null for mail a person wrote, else `{type, reason}`: `bounce` (delivery status notification), `out_of_office`, `auto_reply`, `auto_generated` (notifications, null sender) or `bulk` (mailing lists). Detected from Auto-Submitted, X-Autoreply, Precedence, List-Id, multipart/report and well-known subjects; `reason` names the evidence.

`tls`: the TLS version the sending server used (e.g. `TLSv1_3`); empty when the message was not encrypted.

A message refused at SMTP (`status: rejected`: spam or a `reject` route) is listed but its content was never kept: it returns the listing fields, with `html`, `text` and `raw` null and `headers` empty. Its attachments, redelivery, spam reports and replies are 404; DELETE erases it.

### Path parameters

- `id` (string (UUID), required): Received email id

### Query parameters

- `html_format` (string): cid: return html as received (cid: references to inline parts). Any other value: inline images are embedded as data: URIs (html_format in the response reports what was returned). One of `data_uri`, `cid`. Default `data_uri`.

### Errors

- `restricted_api_key` (HTTP 403)
- `not_found` (HTTP 404): unknown/non-UUID id or past plan retention
- `inbound_not_configured` (HTTP 503)

```bash
curl 'https://app.zapsmtp.com/v1/emails/receiving/019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "email",
  "id": "019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d",
  "created_at": "2026-10-21T15:10:02.904Z",
  "from": "jane@example.org",
  "to": [
    "support@acme.com"
  ],
  "cc": [],
  "bcc": [],
  "reply_to": [],
  "received_for": [
    "support+1234@acme.com"
  ],
  "subject": "Re: Ticket #1234",
  "message_id": "<CAF=abc123@mail.example.org>",
  "html": "<p>Thanks, that fixed it!</p><blockquote>...</blockquote>",
  "html_format": "data_uri",
  "text": "Thanks, that fixed it!\n\nOn Tue, Oct 21, 2026 Acme wrote:\n> ...",
  "headers": {
    "Subject": "Re: Ticket #1234",
    "From": "Jane Doe <jane@example.org>",
    "To": "support@acme.com"
  },
  "authentication": {
    "spf": "pass",
    "dkim": "pass",
    "dmarc": "pass"
  },
  "raw": {
    "download_url": "https://app.zapsmtp.com/v1/files/eyJ0Ijoi....Qm9n",
    "expires_at": "2026-10-21T16:12:00Z"
  },
  "attachments": [
    {
      "object": "attachment",
      "id": "5b0f8f7e-2a1c-5d3e-9f4a-6b7c8d9e0f1a",
      "filename": "screenshot.png",
      "content_type": "image/png",
      "content_disposition": "attachment",
      "content_id": null,
      "size": 48213
    }
  ],
  "from_name": "Jane Doe",
  "reply_text": "Thanks, that fixed it!",
  "mailbox_hash": "1234",
  "in_reply_to_email_id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
  "thread_id": "3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13",
  "automated": null,
  "envelope": {
    "from": "jane@example.org",
    "to": "support+1234@acme.com"
  },
  "spam": {
    "score": 1.2,
    "is_spam": false,
    "action": "no action"
  },
  "arc": "unknown",
  "route_id": "019a1f31-0b2c-7d3e-8f4a-5b6c7d8e9f01",
  "action": "webhook",
  "status": "received",
  "size": 61877,
  "peer_ip": "198.51.100.7",
  "helo": "mail.example.org"
}
```

## Reply text

`reply_text` is the text body with the quoted original and the signature removed: everything from the quote header on (“On … wrote:”, “-----Original Message-----”, Outlook’s From/Sent block, and the German, French, Spanish and Russian equivalents), lines starting with `>`, and everything after a `-- ` signature line. It is a heuristic, because mail clients quote in many ways; `text` and `html` always hold the full message. In the webhook `reply_text` is at most 16 KB.

**Example**

- **`text`**: `Thanks, that fixed it!-- JaneOn Tue, Oct 21, 2026 Acme Support <support@acme.com> wrote:> Please try again now.`
- **`reply_text`**: `Thanks, that fixed it!`

## Headers

`headers` is an object of every header with lower-case names. A header that appears more than once (`received`, for example) has its values joined with `", "`. For the exact original, download the raw message.

## Authentication

Each check reports one of these values. The API returns `arc` next to `authentication`; the webhook has it inside. A From address is only trustworthy when DMARC is `pass`: SPF and DKIM alone can pass for a different domain than the one in From.

**spf, dkim, dmarc, arc**

- **`pass`**: The check passed.
- **`fail`**: The check failed (for DMARC: the sender’s policy said reject, quarantine or fail).
- **`gray`**: No verdict: SPF softfail or neutral, or nothing to check (no SPF record, no signature, no DMARC policy).
- **`processing_failed`**: A temporary or permanent DNS error stopped the check.
- **`unknown`**: The message could not be scanned; it was accepted anyway.

The API also returns `tls`, the TLS version the sending server used (for example `TLSv1_3`, empty when the message was not encrypted), and the sender’s `peer_ip` and `helo`.

## Automated mail

ZapSMTP recognises mail no person wrote from the standard headers (Auto-Submitted, X-Autoreply, Precedence, List-Id, multipart/report, a null sender) and from well-known subjects. `reason` names the evidence, for example `Auto-Submitted: auto-replied`. Never auto-answer these: two auto-responders replying to each other is a mail loop.

**automated.type**

- **`bounce`**: A delivery status notification (multipart/report, or a mailer-daemon with a bounce subject).
- **`out_of_office`**: An out-of-office notice.
- **`auto_reply`**: Any other automatic reply (Auto-Submitted: auto-replied, X-Autoreply…).
- **`auto_generated`**: Notifications and mail with a null envelope sender.
- **`bulk`**: Mailing lists and bulk mail (List-Id, Precedence: bulk/list). Unlike the others, you may reply to it without allow_automated, and it opens or continues conversations.

## List what people wrote

`GET /v1/emails/receiving`

Received emails, newest first, without bounces, out-of-office notices and other automated mail.

Requires a full-access key.

`action` is `default`, `webhook`, `store`, `reject` or `spam_reject`. `in_reply_to_email_id` appears only when the message replies to an email you sent through ZapSMTP.

### Query parameters

- `limit` (integer): 1-100. Limits: 422 invalid_parameter otherwise. Default `20`.
- `before` (string): Cursor: an email id or RFC 3339 time; returns messages received before it. An email id gives an exact page boundary. Limits: 422 invalid_parameter "before must be an email id or RFC 3339 time"
- `after` (string): Email id or RFC 3339 time. Limits: 422 invalid_parameter "after must be an email id or RFC 3339 time"
- `q` (string): Case-insensitive substring of sender, recipient or subject, or an exact id.
- `status` (string): One of `received`, `rejected`.
- `domain` (string): Inbound domain name (exact).
- `thread_id` (string (UUID)): Only emails of this conversation (see `GET /threads/{id}`).
- `automated` (string): `false`: only emails a person wrote; `true`: only automated ones; or one type: `bounce`, `out_of_office`, `auto_reply`, `auto_generated`, `bulk`. Limits: 422 invalid_parameter for other values.

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422)
- `inbound_not_configured` (HTTP 503): inbound email is not enabled on this deployment

```bash
curl 'https://app.zapsmtp.com/v1/emails/receiving?automated=false&domain=acme.com&limit=20' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": false,
  "data": [
    {
      "object": "email",
      "id": "019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d",
      "from": "jane@example.org",
      "from_name": "Jane Doe",
      "to": [
        "support@acme.com"
      ],
      "cc": [],
      "bcc": [],
      "reply_to": [],
      "received_for": [
        "support+1234@acme.com"
      ],
      "subject": "Re: Ticket #1234",
      "message_id": "<CAF=abc123@mail.example.org>",
      "created_at": "2026-10-21T15:10:02.904Z",
      "attachments": [
        {
          "id": "5b0f8f7e-2a1c-5d3e-9f4a-6b7c8d9e0f1a",
          "filename": "screenshot.png",
          "content_type": "image/png",
          "content_disposition": "attachment",
          "content_id": null,
          "size": 48213
        }
      ],
      "status": "received",
      "action": "webhook",
      "is_spam": false,
      "spam_score": 1.2,
      "size": 61877,
      "in_reply_to_email_id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
    }
  ]
}
```

## Attachments

Every part that is not the text or HTML body is an attachment, inline images included (they have a `content_id` and usually `content_disposition: "inline"`). A part without a file name is called `attachment-1`, `attachment-2` and so on. Attachment ids are stable: the same message always gives the same ids.

The listing adds a signed `download_url` to each. It needs no API key, so you can hand it to a browser or a background job, and it works for one hour (`expires_at`); list again for a fresh link. Files are always served as downloads, and HTML, SVG, XML and JavaScript as binary, so they never run in a browser.

## List attachments with download links

`GET /v1/emails/receiving/{id}/attachments`

List a received email's attachments with signed download links.

Requires a full-access key.

Each `download_url` works for one hour without an API key. Files are always served as downloads; HTML, SVG, XML and JavaScript are served as binary so they can never run in a browser.

### Path parameters

- `id` (string (UUID), required): Received email id

### Query parameters

- `limit` (integer): 1-100; when omitted all attachments are returned. Limits: 422 invalid_parameter otherwise.
- `after` (string): Attachment id; returns attachments after it (ignored if unknown).
- `before` (string): Attachment id; returns attachments before it (used only when after is absent).

### Errors

- `restricted_api_key` (HTTP 403)
- `not_found` (HTTP 404): email not found
- `inbound_not_configured` (HTTP 503)
- `invalid_parameter` (HTTP 422): a query parameter is out of range or not one of its values

```bash
curl 'https://app.zapsmtp.com/v1/emails/receiving/019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d/attachments' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": false,
  "data": [
    {
      "object": "attachment",
      "id": "5b0f8f7e-2a1c-5d3e-9f4a-6b7c8d9e0f1a",
      "filename": "screenshot.png",
      "content_type": "image/png",
      "content_disposition": "attachment",
      "content_id": null,
      "size": 48213,
      "download_url": "https://app.zapsmtp.com/v1/files/eyJ0Ijoi....aGk",
      "expires_at": "2026-10-21T16:12:00Z"
    }
  ]
}
```

## Raw message

`raw.download_url` on the received email is the original `.eml` exactly as it arrived, with the same one-hour link rules. Keep it for archiving, or parse it with your own MIME library when you need something the parsed fields do not give.

**Download attachments and the .eml**

Node.js:

```javascript
// download_url needs no API key and works for an hour (24 hours in a webhook)
const res = await fetch(API + '/emails/receiving/' + emailId + '/attachments', {
  headers: { Authorization: 'Bearer ' + process.env.ZAP_API_KEY },
});
const { data } = await res.json();
for (const a of data) {
  const file = await fetch(a.download_url);
  await fs.promises.writeFile('./files/' + a.id, Buffer.from(await file.arrayBuffer()));
}
```

Python:

```python
# download_url needs no API key and works for an hour (24 hours in a webhook)
r = requests.get(f"{API}/emails/receiving/{email_id}/attachments",
                 headers={"Authorization": f"Bearer {os.environ['ZAP_API_KEY']}"})
for a in r.json()["data"]:
    with requests.get(a["download_url"], stream=True) as f, open(f"files/{a['id']}", "wb") as out:
        for chunk in f.iter_content(65536):
            out.write(chunk)
```

Shell:

```
# the original message, byte for byte, as an .eml file
curl -s 'https://app.zapsmtp.com/v1/emails/receiving/019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d' \
  -H "Authorization: Bearer $ZAP_API_KEY" | jq -r .raw.download_url \
  | xargs curl -s -o message.eml
```

## Conversations

Every received email, every `email.received` event and every send response carries a `thread_id`. It comes from the standard `Message-ID`, `In-Reply-To` and `References` headers, so there is nothing to set up: a customer’s first message starts a conversation, your reply joins it, and their answer joins it too. The Message-ID of every email you send names its conversation, so an answer threads correctly even from a mail client that keeps only `In-Reply-To`. A conversation you start by sending an email appears in the inbox once the customer answers.

![A conversation in the dashboard: the customer's messages and the team's replies in order, with the reply box below](https://zapsmtp.com/docs/img/thread-light.webp)

The dashboard shows each conversation with both sides of it.

**Conversation state**

- **`awaiting_reply`**: The customer wrote last: the latest email that is not automated mail is an inbound one. An incoming out-of-office or bounce never changes it. Any email you send in the conversation clears it, including an acknowledgement sent with `auto_reply: true`.
- **`unread`, `read_at`**: Something arrived after your read mark. Set or clear the mark with `PATCH /threads/{id}`.
- **`metadata`**: Your own key-value pairs, such as a ticket or CRM id: up to 20 keys of letters, digits, `_` and `-` (40 characters at most), values up to 500 bytes of UTF-8. A PATCH replaces them all.
- **Counts and times**: `message_count`, `inbound_count`, `outbound_count`, `has_attachments`, `first_message_at`, `last_message_at`, `last_inbound_at`, `last_message`.

## Your helpdesk inbox

`GET /v1/threads`

Conversations waiting for an answer, most recently active first.

Requires a full-access key.

Served from a per-conversation summary kept up to date as emails arrive: a page costs the same however much email you have.

A conversation you started (your first email) is counted once the customer answers it.

### Query parameters

- `limit` (integer): 1-100. Limits: 422 invalid_parameter otherwise. Default `20`.
- `before` (string): Cursor: the `last_message_at` of the last conversation you have (RFC 3339). Limits: 422 invalid_parameter otherwise.
- `before_id` (string): With before: the id of the last conversation you have, so conversations active at the same instant are neither skipped nor repeated.
- `awaiting_reply` (boolean): `true`: only conversations whose last human email came in. Limits: 422 invalid_parameter unless true or false.
- `unread` (boolean): `true`: only conversations with an email received after their read mark. Limits: 422 invalid_parameter unless true or false.
- `participant` (string): Only conversations this address took part in (case-insensitive).

### Errors

- `restricted_api_key` (HTTP 403)
- `invalid_parameter` (HTTP 422): before must be an RFC 3339 time

```bash
curl 'https://app.zapsmtp.com/v1/threads?awaiting_reply=true&limit=25' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": false,
  "data": [
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
      "unread": true,
      "read_at": null,
      "metadata": {
        "ticket": "T-1042"
      }
    }
  ]
}
```

## Open a conversation

`GET /v1/threads/{id}`

A conversation: its state (participants, counts, last message, awaiting_reply, unread, metadata) and its received and sent emails, oldest first.

Requires a full-access key.

`awaiting_reply`: the last email a person wrote came in (automated mail does not count). `unread`: something was received after `read_at` (set with `PATCH /threads/{id}`).

Threads are derived from the standard In-Reply-To / References headers: no setup. Every received email, webhook `email.received` and send response carries its `thread_id`.

Refused messages are not part of a thread. At most 500 emails are listed (`has_more`); fetch bodies with `GET /emails/receiving/{id}` and `GET /emails/{id}/content`.

Emails received before 2026-10-23 have a thread id but are not listed here.

### Path parameters

- `id` (string (UUID), required): Thread id (`thread_id` of any email in it)

### Errors

- `restricted_api_key` (HTTP 403)
- `not_found` (HTTP 404): thread not found (or past your plan's log retention)

```bash
curl 'https://app.zapsmtp.com/v1/threads/3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13' \
  -H "Authorization: Bearer $ZAP_API_KEY"
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
  "unread": true,
  "read_at": null,
  "metadata": {
    "ticket": "T-1042"
  },
  "has_more": false,
  "data": [
    {
      "object": "email",
      "direction": "inbound",
      "id": "019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d",
      "created_at": "2026-10-21T15:10:02.904Z",
      "from": "jane@example.org",
      "to": [
        "support@acme.com"
      ],
      "cc": [],
      "subject": "Where is my order?",
      "message_id": "<CAF=abc123@mail.example.org>"
    },
    {
      "object": "email",
      "direction": "outbound",
      "id": "019a1f41-8b2c-7e3d-9f40-5a6b7c8d9e0f",
      "created_at": "2026-10-21T15:20:41.112Z",
      "from": "Acme Support <support@acme.com>",
      "to": [
        "jane@example.org"
      ],
      "cc": [],
      "subject": "Re: Where is my order?"
    },
    {
      "object": "email",
      "direction": "inbound",
      "id": "019a1f52-0c1d-7f2e-8a3b-4c5d6e7f8091",
      "created_at": "2026-10-21T16:02:13.540Z",
      "from": "jane@example.org",
      "to": [
        "support@acme.com"
      ],
      "cc": [],
      "subject": "Automatic reply: Where is my order?",
      "message_id": "<CAF=def456@mail.example.org>",
      "automated": "out_of_office"
    }
  ]
}
```

## Mark read and link your ticket

`PATCH /v1/threads/{id}`

Mark a conversation read or unread and set its metadata.

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
curl -X PATCH 'https://app.zapsmtp.com/v1/threads/3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "read": true,
  "metadata": {
    "ticket": "T-1042",
    "assignee": "ann"
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

## Reply

`POST /emails/receiving/{id}/reply` fills in everything a mail client would, so the answer lands in the customer’s conversation:

**Defaults**

- **`to`**: The email’s Reply-To, otherwise its From. `reply_all: true` also copies its To and Cc, except the receiving address, the `from` you reply from, the original sender and anyone already in your `to` or `cc`. Other addresses of yours on the email are copied.
- **`from`**: The address that received the email, for example `support+1234@acme.com`. Its exact domain must be verified for sending: a receiving subdomain such as `support.acme.com` is not covered by verifying `acme.com`. Otherwise pass a `from` on a verified domain. Managed addresses only receive, so with them `from` is required.
- **`reply_to`**: When you reply from another address (`support@acme.com`), the receiving address, so the customer’s next answer comes back to the same inbox and keeps its `mailbox_hash`.
- **`subject`**: `Re: ` plus the email’s subject, unless it already starts with Re:.
- **`In-Reply-To`, `References`**: Set from the email’s Message-ID and References. A value you pass in `headers` wins.

Everything else works as in [POST /emails](https://zapsmtp.com/docs/emails/send-email/): templates, attachments, tags, scheduling, suppressions, test keys. The response has the new email’s `id` and its `thread_id`. Use an `Idempotency-Key` so a retried request never answers twice.

> Loop protection: a reply to a bounce, out-of-office notice, auto-reply or notification is refused with `422 automated_message` unless you pass `allow_automated: true`, and one conversation takes at most 20 replies an hour (`429 thread_reply_limit`). Mark your own acknowledgements with `auto_reply: true`: they then carry `Auto-Submitted: auto-replied` so other auto-responders stay quiet.

## Reply in the same conversation

`POST /v1/emails/receiving/{id}/reply`

Reply to a received email: recipients, subject, sender and threading headers default to the email's, so the answer lands in the sender's conversation.

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
- `attachments, tags, metadata, stream, tracking, template, scheduled_at, tls`: As in [POST /emails](https://zapsmtp.com/docs/emails/send-email/).

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
curl -X POST 'https://app.zapsmtp.com/v1/emails/receiving/019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d/reply' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Idempotency-Key: reply-T-1042-1' \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme Support <support@acme.com>",
  "text": "Hi Jane,\n\nGlad it works now. Your order ships today.\n\nAnn, Acme Support",
  "html": "<p>Hi Jane,</p><p>Glad it works now. Your order ships today.</p><p>Ann, Acme Support</p>"
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f41-8b2c-7e3d-9f40-5a6b7c8d9e0f",
  "thread_id": "3f1c9a52-6b0e-5d4f-8a71-2c9e0b4d6f13"
}
```

## Replies to what you send

Customers often answer your transactional email: a receipt, a shipping notice. With reply tracking, each email sent from a domain carries its own signed Reply-To on an inbound domain of yours, such as `r1-…@reply.acme.com`. An answer to it is tied to that exact email, whatever its headers say: `in_reply_to_email_id` and the conversation come from the address. These replies skip your routes, still fire `email.received` and the conversation events, and add an `email.replied` event to the original email. A reply address works for 30 days and takes up to 100 replies a day; a forged or expired one is refused.

The reply domain must be MX-verified on the same account and equal to the sending domain or a subdomain of it. `reply_forward_to` optionally sends replies a person wrote on to a mailbox of yours. A single email can opt in or out with `"tracking": {"replies": true}` on `POST /emails`.

## Track replies to what you send

`PATCH /v1/domains/{id}`

Give every email sent from `acme.com` its own signed Reply-To on your inbound domain, so each answer is tied to the exact email.

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
  "reply_domain": "reply.acme.com",
  "reply_tracking": true
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

## Spam

Every message gets a spam `score`. At 15 or more it is refused during SMTP with `550 5.7.1`. From 6 it is accepted with `is_spam: true`, so you can filter it in your handler, or refused as well when the domain has `reject_spam` on. Spam is never forwarded. The API’s `spam.action` shows the scanner’s decision: `no action`, `add header`, `rewrite subject`, `reject`, or `unknown` when the message could not be scanned (it is accepted rather than lost).

Reporting messages trains a spam filter of your own account: each account learns separately, so your reports never change anyone else’s filter. It starts scoring after it has learned 20 messages of each kind; until then reports have no effect on scores. Report spam that got through with `spam: true` and wanted mail that was flagged with `spam: false`. `learned: false` means the message has too few words to learn from.

## Teach your spam filter

`POST /v1/emails/receiving/{id}/spam`

Report a received email as spam or not spam: your account's spam filter learns from it.

Requires a full-access live key; test keys get 403 test_key_restricted.

Each account has its own statistics: your reports never change another account's filter. The filter starts scoring once it has learned 20 emails of each kind. Reporting the same email twice is harmless. `learned` is false when the email has too few words to learn from.

### Path parameters

- `id` (string): Received email id.

### Body parameters

- `spam` (boolean, required): true: mail like this is spam; false: it is wanted. Limits: missing → 422 missing_required_field

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `not_found` (HTTP 404): Unknown email or past your plan's retention.
- `service_unavailable` (HTTP 503): The spam filter could not learn right now; retry.

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails/receiving/019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d/spam' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "spam": false
}'
```

**Response `200 OK`**

```json
{
  "object": "email",
  "id": "01a17204-bd5b-7691-9fca-52161a26e6d7",
  "spam": true,
  "learned": true
}
```

## Refuse spam instead of storing it

`PATCH /v1/inbound/domains/{id}`

Update an inbound domain's spam policy.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Path parameters

- `id` (string (UUID), required): Inbound domain id

### Body parameters

- `reject_spam` (boolean): Refuse flagged spam (550) instead of delivering it with is_spam: true.
- `require_tls` (boolean): Accept encrypted mail only: senders without STARTTLS are refused with 530 5.7.0.

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `not_found` (HTTP 404): inbound domain not found

```bash
curl -X PATCH 'https://app.zapsmtp.com/v1/inbound/domains/019a1f21-5d6e-7f80-9a1b-2c3d4e5f6a7b' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "reject_spam": true,
  "require_tls": true
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f21-5d6e-7f80-9a1b-2c3d4e5f6a7b",
  "name": "reply.acme.com",
  "managed": false,
  "reject_spam": true,
  "mx_verified": true,
  "last_checked_at": "2026-10-21T15:05:00Z",
  "created_at": "2026-10-20T11:30:00Z",
  "records": [
    {
      "record": "MX",
      "type": "MX",
      "name": "reply.acme.com",
      "value": "10 mail.zapsmtp.com",
      "required": true,
      "status": "verified"
    }
  ],
  "example_address": "anything@reply.acme.com"
}
```

## Redeliver and erase

Lost a webhook while your endpoint was down? Redeliver queues `email.received` again for your endpoints (not the conversation events, and nothing is forwarded again). To find what came in, list with `status`, `domain`, `q` or `thread_id`. Erasing removes the message, its attachments and its metadata for good, for example for a GDPR request.

## Redeliver to your webhooks

`POST /v1/emails/receiving/{id}/redeliver`

Re-send the email.received webhook for a stored message.

Requires a full-access live key; test keys get 403 test_key_restricted.

The event is re-queued asynchronously (hence 202).

### Path parameters

- `id` (string (UUID), required): Received email id

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `not_found` (HTTP 404): email not found
- `inbound_not_configured` (HTTP 503)

```bash
curl -X POST 'https://app.zapsmtp.com/v1/emails/receiving/019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d/redeliver' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `202 `**

```json
{
  "object": "email",
  "id": "019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d",
  "redelivered": true
}
```

## Erase a message

`DELETE /v1/emails/receiving/{id}`

Permanently erase a received email's content and metadata (GDPR erasure).

Requires a full-access live key; test keys get 403 test_key_restricted.

Idempotent: deleting an id that does not exist (but is a valid UUID) still returns 200 deleted:true.

### Path parameters

- `id` (string (UUID), required): Received email id

### Errors

- `restricted_api_key` (HTTP 403)
- `test_key_restricted` (HTTP 403): test-mode keys can send test email and read, not change the account: use a live key
- `not_found` (HTTP 404): id is not a UUID
- `not_ready` (HTTP 409): this email is still being stored; retry the erasure in a few seconds (Retry-After: 5)
- `inbound_not_configured` (HTTP 503)

```bash
curl -X DELETE 'https://app.zapsmtp.com/v1/emails/receiving/019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "email",
  "id": "019a1f30-1d4e-7a6b-8c2d-3e4f5a6b7c8d",
  "deleted": true
}
```

## Limits

**Inbound limits**

- **Message size**: 40 MB, headers and attachments included.
- **Structure**: At most 1,000 MIME parts and 100 multipart sections. A message the parser cannot read is refused with `550 5.6.0`.
- **Retention**: Your plan’s log retention: 3 days on Free, 30 on Pro, 90 on Scale. Older messages answer 404.
- **Routes**: 100 per account; patterns up to 512 bytes (UTF-8).
- **Forward destinations**: 20 per account; confirmation resent at most once a minute.
- **Webhook content**: Text and HTML share 1 MB with `include_content`; `reply_text` is cut at 16 KB in the webhook.
- **Download links**: 1 hour from the API, 24 hours in a webhook.
- **Replies**: 20 per conversation per hour.
- **Reply addresses**: 30 days, 100 replies a day each.
- **Encryption**: Optional per domain: with `require_tls`, senders that do not use STARTTLS get `530 5.7.0`.

## Walk-through: a support inbox

Put it together: customers write to `support@support.acme.com`, every conversation becomes a ticket, new tickets get an acknowledgement, and agents answer from the app.

1. Add `support.acme.com` as an inbound domain, publish its MX record and verify it (above).
2. Create an endpoint for `email.received` and keep its `whsec_…` secret as `ZAP_WEBHOOK_SECRET`.
3. Optionally route `support*@support.acme.com` to that endpoint only, and `store` mailing-list mail.
4. Deploy the handler below. It checks the signature on the raw body, skips duplicates by `Zap-Event-Id` and spam, files the message under the ticket of its `thread_id`, and acknowledges new tickets a person wrote, marked as an auto-reply and made idempotent by the email id.

**Support inbox webhook**

Node.js:

```javascript
import crypto from 'node:crypto';
import express from 'express';
import { db } from './db.js'; // your storage

const API = 'https://app.zapsmtp.com/v1';

async function zap(method, path, body, idempotencyKey) {
  const headers = { Authorization: 'Bearer ' + process.env.ZAP_API_KEY };
  if (body) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(API + path, { method, headers, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(method + ' ' + path + ': ' + res.status + ' ' + (await res.text()));
  return res.json();
}

function verified(req) {
  const parts = (req.get('Zap-Signature') ?? '').split(',').map((p) => p.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const expected = crypto.createHmac('sha256', process.env.ZAP_WEBHOOK_SECRET)
    .update(t + '.' + req.body).digest('hex');
  return Math.abs(Date.now() / 1000 - Number(t)) < 300 &&
    parts.some(([k, v]) => k === 'v1' && v.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)));
}

const app = express();
app.post('/hooks/inbound', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!verified(req)) return res.sendStatus(400);
  const event = JSON.parse(req.body);
  const eventId = req.get('Zap-Event-Id');
  if (event.type !== 'email.received' || await db.seen(eventId)) return res.sendStatus(200);

  const m = event.data;
  if (m.spam.is_spam) return res.sendStatus(200);

  // 1. find or open the ticket for this conversation
  let ticket = await db.ticketByThread(m.thread_id);
  const isNew = !ticket;
  if (isNew) ticket = await db.createTicket({ threadId: m.thread_id, customer: m.from, subject: m.subject });

  // 2. store the message: the full body comes from the API
  const email = await zap('GET', '/emails/receiving/' + m.email_id);
  await db.addMessage(ticket.id, {
    emailId: m.email_id, from: m.from, text: m.reply_text || email.text, html: email.html,
    attachments: email.attachments.map((a) => ({ id: a.id, name: a.filename, size: a.size })),
    automated: m.automated?.type ?? null,
  });

  // 3. acknowledge new tickets that a person wrote
  if (isNew && !m.automated) {
    await zap('POST', '/emails/receiving/' + m.email_id + '/reply', {
      from: 'Acme Support <support@acme.com>',
      text: 'Thanks, we got your message. Your ticket number is ' + ticket.number + '.',
      auto_reply: true,
    }, 'ack-' + m.email_id);
  }
  await db.markSeen(eventId);
  res.sendStatus(200);
});
app.listen(3000);
```

Python:

```python
import hashlib, hmac, json, os, time
import requests
from flask import Flask, request
from myapp import db  # your storage

API = "https://app.zapsmtp.com/v1"
app = Flask(__name__)

def zap(method, path, body=None, idempotency_key=None):
    headers = {"Authorization": f"Bearer {os.environ['ZAP_API_KEY']}"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    r = requests.request(method, API + path, json=body, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()

def verified(raw: bytes) -> bool:
    parts = [p.split("=", 1) for p in request.headers.get("Zap-Signature", "").split(",") if "=" in p]
    t = next((v for k, v in parts if k == "t"), "0")
    expected = hmac.new(os.environ["ZAP_WEBHOOK_SECRET"].encode(),
                        f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    fresh = abs(time.time() - int(t)) < 300
    return fresh and any(k == "v1" and hmac.compare_digest(v, expected) for k, v in parts)

@app.post("/hooks/inbound")
def inbound():
    raw = request.get_data()
    if not verified(raw):
        return "", 400
    event = json.loads(raw)
    event_id = request.headers["Zap-Event-Id"]
    if event["type"] != "email.received" or db.seen(event_id):
        return "", 200

    m = event["data"]
    if m["spam"]["is_spam"]:
        return "", 200

    # 1. find or open the ticket for this conversation
    ticket = db.ticket_by_thread(m["thread_id"])
    is_new = ticket is None
    if is_new:
        ticket = db.create_ticket(thread_id=m["thread_id"], customer=m["from"], subject=m["subject"])

    # 2. store the message: the full body comes from the API
    email = zap("GET", f"/emails/receiving/{m['email_id']}")
    db.add_message(ticket.id, email_id=m["email_id"], sender=m["from"],
                   text=m["reply_text"] or email["text"], html=email["html"],
                   attachments=[(a["id"], a["filename"], a["size"]) for a in email["attachments"]],
                   automated=(m["automated"] or {}).get("type"))

    # 3. acknowledge new tickets that a person wrote
    if is_new and m["automated"] is None:
        zap("POST", f"/emails/receiving/{m['email_id']}/reply", {
            "from": "Acme Support <support@acme.com>",
            "text": f"Thanks, we got your message. Your ticket number is {ticket.number}.",
            "auto_reply": True,
        }, idempotency_key=f"ack-{m['email_id']}")
    db.mark_seen(event_id)
    return "", 200
```

Go:

```go
package main

import (
	"bytes"
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

const api = "https://app.zapsmtp.com/v1"

type received struct {
	Type string `json:"type"`
	Data struct {
		EmailID   string `json:"email_id"`
		From      string `json:"from"`
		Subject   string `json:"subject"`
		ThreadID  string `json:"thread_id"`
		ReplyText string `json:"reply_text"`
		Automated *struct{ Type, Reason string } `json:"automated"`
		Spam      struct{ IsSpam bool `json:"is_spam"` } `json:"spam"`
	} `json:"data"`
}

func zap(method, path string, body any, idemKey string, out any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, api+path, rd)
	req.Header.Set("Authorization", "Bearer "+os.Getenv("ZAP_API_KEY"))
	req.Header.Set("Content-Type", "application/json")
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		msg, _ := io.ReadAll(res.Body)
		return fmt.Errorf("%s %s: %d %s", method, path, res.StatusCode, msg)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(out)
}

func verified(header string, body []byte) bool {
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
	mac := hmac.New(sha256.New, []byte(os.Getenv("ZAP_WEBHOOK_SECRET")))
	mac.Write([]byte(t + "."))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	ts, _ := strconv.ParseInt(t, 10, 64)
	if time.Since(time.Unix(ts, 0)).Abs() > 5*time.Minute {
		return false
	}
	for _, s := range sigs {
		if hmac.Equal([]byte(s), []byte(expected)) {
			return true
		}
	}
	return false
}

func inbound(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	if !verified(r.Header.Get("Zap-Signature"), body) {
		http.Error(w, "bad signature", http.StatusBadRequest)
		return
	}
	var ev received
	eventID := r.Header.Get("Zap-Event-Id")
	if json.Unmarshal(body, &ev) != nil || ev.Type != "email.received" || db.Seen(eventID) {
		w.WriteHeader(http.StatusOK)
		return
	}
	m := ev.Data
	if m.Spam.IsSpam {
		w.WriteHeader(http.StatusOK)
		return
	}

	// 1. find or open the ticket for this conversation
	ticket, isNew := db.TicketByThread(m.ThreadID), false
	if ticket == nil {
		ticket, isNew = db.CreateTicket(m.ThreadID, m.From, m.Subject), true
	}

	// 2. store the message: the full body comes from the API
	var email struct {
		Text, HTML  *string
		Attachments []struct {
			ID       string `json:"id"`
			Filename string `json:"filename"`
			Size     int    `json:"size"`
		}
	}
	if err := zap("GET", "/emails/receiving/"+m.EmailID, nil, "", &email); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError) // retried by ZapSMTP
		return
	}
	db.AddMessage(ticket.ID, m.EmailID, m.From, m.ReplyText, email.Text, email.HTML)

	// 3. acknowledge new tickets that a person wrote
	if isNew && m.Automated == nil {
		ack := map[string]any{
			"from":       "Acme Support <support@acme.com>",
			"text":       fmt.Sprintf("Thanks, we got your message. Your ticket number is %d.", ticket.Number),
			"auto_reply": true,
		}
		if err := zap("POST", "/emails/receiving/"+m.EmailID+"/reply", ack, "ack-"+m.EmailID, nil); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	db.MarkSeen(eventID)
	w.WriteHeader(http.StatusOK)
}
```

PHP:

```php
<?php
// your storage: $db->seen(), ticketByThread(), createTicket(), addMessage(), markSeen()
require __DIR__ . '/db.php';

const API = 'https://app.zapsmtp.com/v1';

function zap(string $method, string $path, ?array $body = null, ?string $idemKey = null): array {
    $headers = ['Authorization: Bearer ' . getenv('ZAP_API_KEY'), 'Content-Type: application/json'];
    if ($idemKey) $headers[] = 'Idempotency-Key: ' . $idemKey;
    $ch = curl_init(API . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body),
    ]);
    $out = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if ($status >= 300) throw new RuntimeException("$method $path: $status $out");
    return json_decode($out, true);
}

$raw = file_get_contents('php://input');
$t = null; $sigs = [];
foreach (explode(',', $_SERVER['HTTP_ZAP_SIGNATURE'] ?? '') as $part) {
    [$k, $v] = array_pad(explode('=', $part, 2), 2, '');
    if ($k === 't') $t = $v;
    if ($k === 'v1') $sigs[] = $v;
}
$expected = hash_hmac('sha256', $t . '.' . $raw, getenv('ZAP_WEBHOOK_SECRET'));
$valid = abs(time() - (int) $t) < 300
    && count(array_filter($sigs, fn ($s) => hash_equals($expected, $s))) > 0;
if (!$valid) { http_response_code(400); exit; }

$event = json_decode($raw, true);
$eventId = $_SERVER['HTTP_ZAP_EVENT_ID'] ?? '';
if ($event['type'] !== 'email.received' || $db->seen($eventId)) { http_response_code(200); exit; }

$m = $event['data'];
if ($m['spam']['is_spam']) { http_response_code(200); exit; }

// 1. find or open the ticket for this conversation
$ticket = $db->ticketByThread($m['thread_id']);
$isNew = $ticket === null;
if ($isNew) $ticket = $db->createTicket($m['thread_id'], $m['from'], $m['subject']);

// 2. store the message: the full body comes from the API
$email = zap('GET', '/emails/receiving/' . $m['email_id']);
$db->addMessage($ticket['id'], $m['email_id'], $m['from'], $m['reply_text'] ?: $email['text'], $email['html'],
    array_map(fn ($a) => [$a['id'], $a['filename'], $a['size']], $email['attachments']));

// 3. acknowledge new tickets that a person wrote
if ($isNew && $m['automated'] === null) {
    zap('POST', '/emails/receiving/' . $m['email_id'] . '/reply', [
        'from' => 'Acme Support <support@acme.com>',
        'text' => 'Thanks, we got your message. Your ticket number is ' . $ticket['number'] . '.',
        'auto_reply' => true,
    ], 'ack-' . $m['email_id']);
}
$db->markSeen($eventId);
http_response_code(200);
```

When an agent answers, call reply with the id of the customer’s latest email, `from: "Acme Support <support@acme.com>"` and the agent’s text, then mark the conversation read. Build the agents’ queue from GET /threads?awaiting_reply=true: it drops a conversation as soon as you send anything in it (the acknowledgement included) and brings it back when the customer writes again. To keep new tickets in the queue until an agent answers, track that in your own ticket state or in the conversation's `metadata`.

> Answer the webhook within a few seconds. If your handler does slow work (large attachments, an AI summary), store the event and do it in a background job: a timed-out delivery is retried, and the stable `Zap-Event-Id` plus the reply’s `Idempotency-Key` keep a retry from filing or answering twice.
