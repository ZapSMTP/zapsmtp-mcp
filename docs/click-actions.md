# Click actions

> Name the buttons and links in ZapSMTP emails: tell clicks apart with data-zap-action, receive email.clicked with the action, send each action to its own webhook endpoint.

Source: https://zapsmtp.com/docs/click-actions/

An action is a named button or link. Mark *Confirm order* with `confirm_order` and every click on it reaches your webhook as `email.clicked` with `click.action: "confirm_order"` and the email’s metadata, such as the order id. No parsing URLs to tell one button from another.

## Mark a link

In HTML, whether a code template or `html` in a send, add `data-zap-action` to the link. In the visual editor, every Button block and every link in text has an *Action* field: pick an action the account already has, or type a new name.

**Two actions in a receipt**

HTML:

```html
<p>Thanks for order {{order_id}}. Please confirm it:</p>
<a href="https://acme.com/orders/{{order_id}}/confirm" data-zap-action="confirm_order">Confirm order</a>
<a href="https://acme.com/orders/{{order_id}}/track" data-zap-action="track_parcel">Track parcel</a>
```

Send:

```json
{
  "from": "Acme <orders@acme.com>",
  "to": [
    "ann@example.com"
  ],
  "template": {
    "id": "receipt",
    "variables": {
      "order_id": "A-1042"
    }
  },
  "metadata": {
    "order_id": "A-1042"
  }
}
```

**Rules**

- **Names**: Lowercase letters, digits, `_`, `.` and `-`, starting with a letter or digit, up to 64 characters: `confirm_order`, `plan.upgrade`. A link whose name does not fit is treated as an ordinary link, without an action.
- **Which links**: An `<a>` whose `href` is an absolute `http://` or `https://` URL, in the HTML part. The attribute may stand anywhere in the tag, quoted with `"` or `'`.
- **Click tracking off**: A link with an action is tracked anyway, whether click tracking is off for the domain or for the send (`tracking.clicks: false`). Other links follow the usual setting.
- **`data-zap-notrack`**: Wins: a link with both attributes is left alone, so no click is reported.
- **Forgery**: The action and the destination are signed into the link, so a recipient cannot change the action or point it elsewhere. The browser is redirected to your `href`.
- **Declaring**: Not needed. Any valid name works the moment an email carries it, and it appears in the catalogue as not described.

Everything else about [click tracking](https://zapsmtp.com/docs/analytics/#click-tracking) applies: links work for 365 days after the send, a repeated click on the same link from the same network within 10 minutes still redirects but is not reported again, and links in the plain-text part are not rewritten.

## What the webhook receives

A click on a marked link is an ordinary [`email.clicked`](https://zapsmtp.com/docs/webhook-events/) event, with two more fields in `click`:

**data.click**

- **`link`**: The destination, as the browser followed it.
- **`action`**: The link’s action. Absent for links without one.
- **`unique`**: Present on every click: `true` on the first click of that action by that recipient of that email, `false` on later clicks and on links without an action. Use it for “confirm once” flows.
- **`ip_address`, `user_agent`**: Of the click.

The event, like `email.opened`, carries the email’s `metadata` and `tags` when each fits in 200 bytes (metadata as JSON, tags URL-encoded), so keep the ids you need there short: `{"order_id": "A-1042"}`. For click events, `from` holds only the sending domain and there is no `subject`. When an email has several recipients, its links belong to the first `to` address, so send one recipient per email when the action is a person’s answer.

```json
{
  "id": "evt_7a1d0c3e9b2f4a6c8e5d1b07",
  "type": "email.clicked",
  "created_at": "2026-10-27T08:41:05.214Z",
  "data": {
    "email_id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23",
    "from": "<@acme.com>",
    "to": "ann@example.com",
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
      "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
    }
  }
}
```

> `unique` is a convenience, not a lock. In rare cases, such as a failure of our internal cache, a repeat click may also arrive with `unique: true`. Make the work behind it idempotent on your side: confirming an order twice should change nothing.

**Confirm an order once**

Node.js:

```javascript
// after verifying Zap-Signature (see Webhook events)
const event = JSON.parse(req.body);
if (event.type === 'email.clicked' && event.data.click?.action === 'confirm_order') {
  const orderId = event.data.metadata?.order_id;
  if (event.data.click.unique) {
    await orders.confirm(orderId); // make this idempotent too
  }
}
res.sendStatus(200);
```

Python:

```python
event = request.get_json()
click = event["data"].get("click") or {}
if event["type"] == "email.clicked" and click.get("action") == "confirm_order":
    order_id = (event["data"].get("metadata") or {}).get("order_id")
    if click.get("unique"):
        orders.confirm(order_id)  # make this idempotent too
return "", 200
```

## Send actions to their own endpoints

A webhook endpoint takes an optional `filter`. With `filter.actions` set, it receives `email.clicked` only for links with one of those actions; every other event type it subscribes to is unaffected. Without a filter, or with an empty list, it receives every click, as before. Use one endpoint per action, or one for several: up to 50 actions per endpoint.

## Send one button to its own endpoint

`POST /v1/webhooks`

This endpoint receives `email.clicked` only for links marked `confirm_order`. Reference: [Create a webhook](https://zapsmtp.com/docs/webhooks/create-webhook/).

Requires a full-access live key; test keys get 403 test_key_restricted.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/webhooks' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "url": "https://acme.com/hooks/confirm-order",
  "events": [
    "email.clicked"
  ],
  "filter": {
    "actions": [
      "confirm_order"
    ]
  }
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1c55-0d6e-7f21-8b3a-5e9d4c7b2a10",
  "url": "https://acme.com/hooks/confirm-order",
  "secret": "whsec_Q7v2Lk9Xp4Rb1Tz8Mw3Nc6Hy0Fd5Gs2J",
  "events": [
    "email.clicked"
  ],
  "enabled": true,
  "include_content": false,
  "batch": false,
  "filter": {
    "actions": [
      "confirm_order"
    ]
  },
  "disabled_reason": null,
  "created_at": "2026-10-27T08:00:00Z"
}
```

## Add an action to an endpoint

`PATCH /v1/webhooks/{id}`

`filter` is replaced as a whole: send the full list. `{"actions": []}` removes the filter, and the endpoint receives every click again. Reference: [Update a webhook](https://zapsmtp.com/docs/webhooks/update-webhook/).

Requires a full-access live key; test keys get 403 test_key_restricted.

### Path parameters

- `id` (string, required): Webhook id

```bash
curl -X PATCH 'https://api.zapsmtp.com/v1/webhooks/019a1c55-0d6e-7f21-8b3a-5e9d4c7b2a10' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "filter": {
    "actions": [
      "confirm_order",
      "cancel_order"
    ]
  }
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1c55-0d6e-7f21-8b3a-5e9d4c7b2a10",
  "url": "https://acme.com/hooks/confirm-order",
  "events": [
    "email.clicked"
  ],
  "enabled": true,
  "include_content": false,
  "batch": false,
  "filter": {
    "actions": [
      "confirm_order",
      "cancel_order"
    ]
  },
  "disabled_reason": null,
  "created_at": "2026-10-27T08:00:00Z"
}
```

## The catalogue

The *Actions* page in the dashboard and `GET /actions` show each action with its description, clicks over 7 and 30 days, unique clickers over 30 days, the last click, how many templates use it and the webhook endpoints filtered on it. `declared: false` marks an action that links use but nobody described. In the dashboard, *New action* can also create a webhook for it, or add it to an existing endpoint’s filter, in the same step.

Deleting an action removes only its description. Links that name it keep working, and webhooks filtered on it keep receiving its clicks.

## Read the catalogue

`GET /v1/actions`

Every action the account declared, every action links named in the last 30 days, and every action a template or webhook filter uses, with activity. Reference: [List actions](https://zapsmtp.com/docs/actions/list-actions/).

Requires a full-access key.

```bash
curl 'https://api.zapsmtp.com/v1/actions' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": false,
  "data": [
    {
      "object": "action",
      "name": "confirm_order",
      "description": "Customer confirms the order from the receipt",
      "declared": true,
      "created_at": "2026-10-24T09:12:00Z",
      "updated_at": "2026-10-24T09:12:00Z",
      "clicks_7d": 42,
      "clicks_30d": 180,
      "unique_clickers_30d": 171,
      "last_click_at": "2026-10-27T08:41:05Z",
      "templates": 1,
      "webhooks": [
        "019a1c55-0d6e-7f21-8b3a-5e9d4c7b2a10"
      ]
    },
    {
      "object": "action",
      "name": "track_parcel",
      "description": "",
      "declared": false,
      "created_at": null,
      "updated_at": null,
      "clicks_7d": 12,
      "clicks_30d": 64,
      "unique_clickers_30d": 60,
      "last_click_at": "2026-10-26T19:02:44Z",
      "templates": 2,
      "webhooks": []
    }
  ]
}
```

## Describe an action

`POST /v1/actions`

Optional: a link works with any valid name. Declaring one gives it a description your team sees in the dashboard. `PATCH /actions/{name}` changes it later, and declares an action that links already use. Reference: [Declare an action](https://zapsmtp.com/docs/actions/create-action/).

Requires a full-access live key; test keys get 403 test_key_restricted.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/actions' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "confirm_order",
  "description": "Customer confirms the order from the receipt"
}'
```

**Response `201 Created`**

```json
{
  "object": "action",
  "name": "confirm_order",
  "description": "Customer confirms the order from the receipt",
  "declared": true,
  "created_at": "2026-10-24T09:12:00Z",
  "updated_at": "2026-10-24T09:12:00Z",
  "clicks_7d": 0,
  "clicks_30d": 0,
  "unique_clickers_30d": 0,
  "last_click_at": null,
  "templates": 0,
  "webhooks": []
}
```
