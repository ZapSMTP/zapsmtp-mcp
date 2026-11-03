# Errors, limits and paging

> ZapSMTP API conventions: API keys, error format and codes, rate limits, quotas, idempotency and pagination.

Source: https://zapsmtp.com/docs/conventions/

The rules every endpoint shares. Base URL `https://app.zapsmtp.com/v1`, JSON in and out, timestamps in RFC 3339 (UTC), ids are time-ordered UUIDv7 strings.

## API keys

Send the key as `Authorization: Bearer <key>`. The full key is shown once, when you create it; we store only a hash.

**Key types**

- **`zap_…` (live)**: Delivers email. The From domain must be verified in your account.
- **`zap_test_…` (test)**: Full validation, email log, events and webhooks, but nothing is delivered and the monthly quota is not charged (the per-second limit still applies). Any From domain is accepted. Events carry `test: true`; list them with `GET /emails?mode=test`.
- **`full_access` (permission)**: Every endpoint of this reference, `GET` and `PATCH /account` included. Live keys only for changes (see test keys above). The signed-in person, billing and team management need a dashboard session (`403 session_required`).
- **`sending_access` (permission)**: Only sending: `POST /emails`, `/emails/batch`, `/emails/spam-check`, rescheduling and canceling. Can also be limited to one domain and one stream.

## Errors

Errors use HTTP status codes and always carry both a flat shape (`statusCode`, `name`, `message`) and a nested one. `name` equals `error.code`. Every response has an `X-Request-Id` header; include it when you contact support.

```json
{
  "statusCode": 422,
  "name": "missing_required_field",
  "message": "subject is required",
  "error": {
    "code": "missing_required_field",
    "message": "subject is required",
    "type": "invalid_request_error"
  }
}
```

**Codes**

- **`validation_error` (HTTP 400)**: Malformed JSON or a field the endpoint does not know (unknown fields are rejected, so typos never pass silently).
- **`invalid_idempotency_key` (HTTP 400)**: Idempotency-Key longer than 256 bytes.
- **`missing_api_key` (HTTP 401)**: No Authorization header.
- **`invalid_api_key` (HTTP 401)**: Unknown, revoked or expired key.
- **`restricted_api_key` (HTTP 403)**: The key has sending access only, or is limited to another domain or stream.
- **`domain_not_verified` (HTTP 403)**: Live key sending from a domain that is not verified.
- **`account_suspended` (HTTP 403)**: The account is suspended.
- **`account_closing` (HTTP 403)**: The account is scheduled for deletion and sends nothing. An owner can cancel the deletion in Settings.
- **`plan_limit_reached` (HTTP 403)**: Your plan’s limit for domains or SMTP credentials is reached.
- **`test_key_restricted` (HTTP 403)**: A test key (`zap_test_…`) tried to change the account: test keys may send test email, render templates and read. Use a live key.
- **`key_restricted` (HTTP 403)**: A restricted key creating or changing keys tried to give them more than it has: an expiry later than its own, or another stream.
- **`email_unverified` (HTTP 403)**: Confirm your account email address first; we sent a link to it.
- **`session_required` (HTTP 403)**: The signed-in person (`GET /me`), billing, and team and account management need a dashboard session, not an API key.
- **`not_found` (HTTP 404)**: No such resource in your account (or outside your plan’s log retention).
- **`method_not_allowed` (HTTP 405)**: The path exists, but not with this HTTP method.
- **`idempotency_key_reused` (HTTP 409)**: The Idempotency-Key was used with a different body.
- **`idempotency_request_in_progress` (HTTP 409)**: The first request with this key is still running.
- **`not_cancellable` (HTTP 409)**: The scheduled email was already dispatched or canceled.
- **`conflict` (HTTP 409)**: The resource already exists.
- **`not_ready` (HTTP 409)**: The received email is still being stored; retry the erasure in a few seconds.
- **`link_expired` (HTTP 410)**: The download link has expired; request a new one from the API.
- **`payload_too_large` (HTTP 413)**: The body is over the endpoint’s size limit (see Limits).
- **`misdirected_cell` (HTTP 421)**: Your account is served by another cell of ZapSMTP. The message names the cell and its URL, and the Zap-Cell header names the cell. Send to that URL; retrying here fails the same way.
- **`missing_required_field` (HTTP 422)**: A required field is missing.
- **`invalid_parameter` (HTTP 422)**: A field has an invalid value; the message says which.
- **`invalid_attachment` (HTTP 422)**: An attachment could not be decoded or fetched.
- **`template_render_error` (HTTP 422)**: A template variable is missing, the template is invalid, or (on save) a tag is not a variable name.
- **`template_variables_missing` (HTTP 422)**: A send with a template lacks required variables that have no default; the message lists them (see [Variables](https://zapsmtp.com/docs/templating/#variable-errors)).
- **`template_variables_invalid` (HTTP 422)**: A send with a template gives variables of the wrong type for the template’s variable schema; the message lists them.
- **`reserved_domain` (HTTP 422)**: The domain is reserved and cannot be added.
- **`invalid_logo` (HTTP 422)**: The brand logo SVG could not be used (PUT /domains/{id}/brand); the message says why.
- **`invalid_certificate` (HTTP 422)**: The brand certificate (VMC) PEM is not valid (PUT /domains/{id}/brand).
- **`automated_message` (HTTP 422)**: The email you reply to is automated (an auto-reply, a bounce, a list); answering it can start a mail loop. Pass `allow_automated: true` to reply anyway.
- **`limit_exceeded` (HTTP 422)**: A per-account limit is reached, such as 20 forward destinations.
- **`quota_exceeded` (HTTP 422)**: The image library is full (2,000 images or 1 GB): delete unused images first.
- **`invalid_image` (HTTP 422)**: An uploaded image could not be used; the message says why.
- **`rejected` (HTTP 422)**: The MTA refused the message; the message gives its reason. Not retryable as is.
- **`rate_limit_exceeded` (HTTP 429)**: Over the per-second limit (Retry-After: 1), or too many failed authentications.
- **`monthly_quota_exceeded` (HTTP 429)**: Free plan or spending cap reached for this month.
- **`daily_quota_exceeded` (HTTP 429)**: Daily limit reached (Free plan: 100 emails a day, resets at 00:00 UTC).
- **`overloaded` (HTTP 429)**: The server is at capacity (Retry-After: 1), or a send could not be taken because the event pipeline is backed up (Retry-After: 5). Nothing was sent; retry after Retry-After with the same Idempotency-Key.
- **`thread_reply_limit` (HTTP 429)**: Too many replies in one conversation in the last hour (a mail loop?). Retry-After: 3600.
- **`internal_error` (HTTP 500)**: Something failed on our side. Safe to retry with the same Idempotency-Key.
- **`service_unavailable` (HTTP 503)**: Temporarily unable to accept, for example while a backing service fails over after a node loss (Retry-After: 2), or while the MTA is unavailable, the suppression list is loading or too many large bodies are in flight (Retry-After: 5). Safe to retry with the same Idempotency-Key.
- **`scanner_unavailable` (HTTP 503)**: The spam checkers are temporarily unavailable (spam checks); try again.
- **`storage_unavailable` (HTTP 503)**: Object storage is not configured on this deployment, so images cannot be uploaded.
- **`inbound_not_configured` (HTTP 503)**: Inbound email is not enabled on this deployment.

## Rate limits and quotas

Sending responses report your budget in headers. Back off on `429` and honor `Retry-After`.

**Response headers on sends**

- **`RateLimit-Limit`**: Recipients per second for your account.
- **`RateLimit-Remaining`**: Recipients left in the current second.
- **`RateLimit-Reset`**: Seconds until the budget refills (always `1`).
- **`Zap-Quota-Monthly-Limit`**: Emails included this month, or `unlimited` on paid plans without a spending cap (extra email is billed as overage).
- **`Zap-Quota-Monthly-Remaining`**: Emails left this month; omitted when the limit is `unlimited`.

**Limits**

- **Recipients per email**: 50 across to, cc and bcc
- **Emails per batch**: 100
- **Request size**: Sends and replies: 40 MB, base64 attachments included. Templates (create, update): 4 MB. Rendering a saved template: 1 MB; rendering unsaved source: 2 MB. Over the limit: `413 payload_too_large`.
- **Free plan**: 3,000 emails a month, at most 100 a day
- **Spam checks**: 30 a minute per account

## Idempotency

Send `Idempotency-Key: <1–256 bytes>` with `POST /emails` and `POST /emails/batch` to retry without sending twice. Keys belong to the API key and are kept for 24 hours together with a fingerprint of the request.

**What happens on a retry**

- **Same key, same body, finished**: The original response is returned with `Idempotent-Replayed: true`.
- **Same key, different body**: `409 idempotency_key_reused`
- **Same key, first request still running**: `409 idempotency_request_in_progress`
- **First attempt got 429 or 5xx**: The key is released; retry with the same key.

## Pagination

Lists return `{"object": "list", "has_more": false, "data": [...]}`, newest first.

- `GET /emails` and `GET /emails/receiving`: `limit` 1–100 (default 20); pass the last id (or an RFC 3339 time) as `before` for older items, `after` for newer ones.
- `GET /suppressions`: `limit` 1–1000 (default 100); pass `next_cursor` back as `after` while `has_more` is true.
- `GET /logs`: `limit` 1–100 (default 20); pass the last log id as `before` for older entries, `after` for newer ones.
- `GET /threads`: `limit` 1–100 (default 20); for the next page pass the last conversation’s `last_message_at` as `before` and its id as `before_id`. `GET /threads/{id}` returns up to 500 messages, oldest first, with `has_more`.
- Lists that do not take `limit` return every item in one response; each endpoint’s page in this reference names its paging parameters.

## Email statuses

An email’s `status` is the latest event: `queued`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed`, `opened`, `clicked`, `replied` (reply tracking) or `suppressed`. Scheduled emails show `scheduled` until they are sent, or `canceled`.

## Streams

`transactional` (default) and `broadcast` leave from separate IP pools, so a newsletter never slows down a password reset. Broadcast emails to one recipient get RFC 8058 one-click unsubscribe headers automatically; an unsubscribe adds the address to your suppressions and stops broadcast mail to it, while transactional mail still goes out. Bounces, complaints and manual suppressions stop both streams.
