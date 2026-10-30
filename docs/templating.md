# Templates and variables

> ZapSMTP template language: escaping, sections, lists, typed variables with defaults, global variables, previews, publishing, versions and sending by template id or alias.

Source: https://zapsmtp.com/docs/templating/

Store the subject, HTML and plain text of an email once, then send it with a template id and a JSON object of variables. Templates use logic-less Mustache, the same syntax as Postmark, Mailgun and MailerSend templates: no code runs, so it is safe for any input.

> This guide is for developers working through the API. To design templates visually, write HTML with a live preview or browse the gallery, see the [Email template editor](https://zapsmtp.com/docs/template-editor/). Both edit the same templates.

## Syntax at a glance

Subject, HTML and text are each a template. Spaces inside a tag are ignored: `{{ name }}` equals `{{name}}`.

**Tags**

- **`{{name}}`**: Value of `name`. HTML-escaped in the HTML body; inserted as is in the subject and the text body.
- **`{{{name}}}`**: Raw value, never escaped. `{{& name}}` is the same.
- **`{{user.first_name}}`**: Dotted name: walks into nested objects.
- **`{{#name}}…{{/name}}`**: Section. A list repeats the block once per item; an object or any other truthy value renders it once with that value as context; a falsy or absent value skips it.
- **`{{^name}}…{{/name}}`**: Inverted section: renders only when the value is falsy, an empty list, or absent.
- **`{{.}}`**: The current item, for lists of strings or numbers.
- **`{{! note }}`**: Comment, removed from the output.
- **`{{{zap:unsubscribe_url}}}`**: Filled in at send time with the recipient’s unsubscribe link. Never a missing variable.
- **`{{global.key}}`**: One of the account’s global variables, such as `{{global.company_name}}`.

There is nothing else: no partials (`{{> footer}}`), no helpers or filters, no expressions, no custom delimiters. Saving a template checks every tag: one that is not a variable name, such as `{{first name}}`, `{{#each items}}` or `{{> footer}}`, is refused with `422 template_render_error` *html: line L, column C: {{…}} is not a variable name: letters, digits, _ and - (no spaces), parts joined with dots*. Anything you would compute, such as a formatted price, a plural or a date in the reader’s time zone, is computed in your code and passed as a variable.

## Escaping

In the HTML body, `{{x}}` escapes `< > & ' "`, so text from your users cannot inject markup. Use `{{{x}}}` only for HTML you produced yourself. The subject and the text body are not HTML, so nothing is escaped there.

**Escaped and raw**

HTML template:

```
<p>Hi {{name}}, your note: {{note}}</p>
<p>{{{signature_html}}}</p>
```

Variables:

```json
{
  "name": "Ann & \"Bob\"",
  "note": "<b>it's urgent</b>",
  "signature_html": "<em>The Acme team</em>"
}
```

HTML output:

```
<p>Hi Ann &amp; &#34;Bob&#34;, your note: &lt;b&gt;it&#39;s urgent&lt;/b&gt;</p>
<p><em>The Acme team</em></p>
```

Text output:

```
Hi Ann & "Bob", your note: <b>it's urgent</b>
```

## How values print

Variables are JSON. Strings print as they are; numbers print in their shortest form, so `19.90` becomes `19.9`. Pass money, dates and anything with a fixed format as strings.

**JSON value → output and truthiness**

- **Value**: **Prints as** · **In a section**
- **`"Ann"`**: Ann · true unless ""
- **`19.90`**: 19.9 · true unless 0
- **`2`**: 2 · true unless 0
- **`true / false`**: true / false · as is
- **`null`**: (empty) · false
- **`[…]`**: not useful: use a section · true unless []
- **`{…}`**: not useful: use a section or a dotted name · always true, even {}

**Numbers and booleans**

Template:

```
Price {{price}}, qty {{qty}}, paid {{paid}}
```

Variables:

```json
{
  "price": 19.9,
  "qty": 2,
  "paid": true
}
```

Output:

```
Price 19.9, qty 2, paid true
```

## Dotted names and context

`{{customer.address.city}}` walks into nested objects. Inside a section the current item is searched first, then each enclosing context out to the top-level variables, so a list item can use values defined outside the list, such as a currency.

**Nested objects**

Template:

```json
{{#shipping}}<p>{{name}}<br>{{address.line1}}<br>{{address.postcode}} {{address.city}}</p>{{/shipping}}
{{#items}}<p>{{name}}: {{price}} {{currency}}</p>{{/items}}
```

Variables:

```json
{
  "currency": "EUR",
  "shipping": {
    "name": "Ann Lee",
    "address": {
      "line1": "Rua Augusta 10",
      "postcode": "1100-053",
      "city": "Lisbon"
    }
  },
  "items": [
    {
      "name": "Grinder",
      "price": "89.00"
    }
  ]
}
```

Output:

```
<p>Ann Lee<br>Rua Augusta 10<br>1100-053 Lisbon</p>
<p>Grinder: 89.00 EUR</p>
```

Inside `{{#items}}`, `{{name}}` is the item’s name. If an item lacked `name`, the outer `shipping.name` would not be used (it is nested), but a top-level `name` would. Give every item every field it uses.

## Sections: lists, objects, conditions

What a section does depends on its value: a non-empty list repeats the block per item; an object renders it once with the object as context (so `{{code}}` means `coupon.code`); `true`, a non-empty string or a non-zero number renders it once. For a list of plain values, `{{.}}` is the item.

**List of strings and a string condition**

Template:

```
Tags: {{#labels}}{{.}}; {{/labels}}
{{#greeting}}<p>{{.}}</p>{{/greeting}}
```

Variables:

```json
{
  "labels": [
    "billing",
    "urgent"
  ],
  "greeting": "Welcome back!"
}
```

Output:

```
Tags: billing; urgent;
<p>Welcome back!</p>
```

Sections nest up to 32 levels. A render stops with an error when the output would pass 10 MB or the work grows past a fixed bound, Every tag visited and every list item counts towards that bound, so it is reached by lists nested inside each other, and also by one long flat list: the bound is about a million steps, one per list item plus one per tag or text run rendered.

## Inverted sections and empty states

`{{^x}}…{{/x}}` renders when `x` is `false`, `null`, `""`, `0`, `[]` or absent. Pair it with a section for if/else.

**Empty cart**

Template:

```json
{{#items}}<li>{{name}}</li>{{/items}}{{^items}}<p>Your cart is empty. <a href="{{shop_url}}">Keep shopping</a></p>{{/items}}
```

Variables:

```json
{
  "items": [],
  "shop_url": "https://acme.com/shop"
}
```

Output:

```
<p>Your cart is empty. <a href="https://acme.com/shop">Keep shopping</a></p>
```

**Zero as the else branch**

Template:

```json
{{#count}}You have {{count}} new messages.{{/count}}{{^count}}No new messages.{{/count}}
```

Variables (count 0):

```json
{
  "count": 0
}
```

Output:

```
No new messages.
```

## Line breaks around tags

Text outside tags is copied exactly, including the line break after a section tag that sits on its own line. In HTML that is invisible; in the plain-text body it adds blank lines. Put the opening tag at the start of the repeated line and the closing tag right after its line break.

**Plain-text list**

Tags on their own lines:

```
Your order {{order_id}}:
{{#items}}
- {{quantity}} x {{name}}: {{price}}
{{/items}}
Total: {{total}}
```

Output:

```
Your order A-1042:

- 2 x Coffee beans: $24.00

- 1 x Grinder: $89.00

Total: $113.00
```

Tight tags:

```
Your order {{order_id}}:
{{#items}}- {{quantity}} x {{name}}: {{price}}
{{/items}}Total: {{total}}
```

Tight output:

```
Your order A-1042:
- 2 x Coffee beans: $24.00
- 1 x Grinder: $89.00
Total: $113.00
```

## Missing variables: preview vs send

A variable is missing when `{{x}}` or `{{{x}}}` names something absent from the variables (for dotted names, any step of the path). The two paths treat it differently:

**Missing variables**

- **Preview**: `POST /templates/render` and `POST /templates/{id}/render` render it as empty text and list it in `missing_variables`, e.g. `plan.name`.
- **Send**: `POST /emails` and batches first apply the published variable schema: defaults fill gaps, optional variables without a default render empty, and a required one still missing is refused with `422 template_variables_missing`. Anything the template renders that is still absent then fails with `422 template_render_error` *missing template variables: …*. A half-filled email never goes out.
- **Not missing**: A section or inverted section whose name is absent: it counts as false, so section conditions may be omitted. Variables inside a section that is skipped are never evaluated, so they are not required either. Also any `zap:` tag, and a variable set to `null` or `""`. Send `null` to deliberately leave a value empty.

## See what is missing

`POST /v1/templates/render`

A preview never fails on missing variables: they render as empty text and are listed in `missing_variables`. A send with the same variables is refused.

Requires a full-access key.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates/render' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "subject": "Hi {{first_name}}",
  "text": "Hi {{first_name}} {{last_name}}, your plan: {{plan.name}}",
  "variables": {
    "first_name": "Ann",
    "plan": {}
  }
}'
```

**Response `200 OK`**

```json
{
  "subject": "Hi Ann",
  "html": "",
  "text": "Hi Ann , your plan: ",
  "missing_variables": [
    "last_name",
    "plan.name"
  ],
  "variable_names": [
    "first_name",
    "last_name",
    "plan"
  ]
}
```

`variable_names` in responses lists the names used at the top level, section names included, and only the first part of a dotted name (`customer` for `{{customer.first_name}}`). Names used only inside a section are not listed.

## Unsubscribe links

`{{{zap:unsubscribe_url}}}` (or `{{zap:unsubscribe_url}}`) passes through rendering untouched and is replaced at send time with a signed one-click unsubscribe link for the recipient, in the HTML and the text body. It works in any email, templated or not, and is never wrapped by click tracking. When an email has several recipients, the link belongs to the first one, so send marketing mail one recipient per email. Broadcast-stream mail to a single recipient also gets `List-Unsubscribe` headers automatically unless you set your own.

**Footer**

Template:

```
<p>{{! shown in every newsletter }}You get this because you subscribed to {{list_name}}.
<a href="{{{zap:unsubscribe_url}}}">Unsubscribe</a></p>
```

After rendering:

```
<p>You get this because you subscribed to Acme news.
<a href="{{{zap:unsubscribe_url}}}">Unsubscribe</a></p>
```

As delivered:

```
<p>You get this because you subscribed to Acme news.
<a href="(signed link for this recipient)">Unsubscribe</a></p>
```

## Worked examples

## Order receipt with line items

The receipt used in the rest of this guide: a nested customer object, a loop over line items with prices passed as strings, and an optional coupon. Note the tight section tags, so the text body has no stray blank lines.

**Receipt**

HTML:

```html
<p>Hi {{customer.first_name}},</p>
<p>Thanks for order {{order_id}}.</p>
<table>
{{#items}}<tr><td>{{quantity}} × {{name}}</td><td>{{price}}</td></tr>
{{/items}}</table>
<p>Total: <strong>{{total}}</strong></p>
{{#coupon}}<p>Use <strong>{{code}}</strong> for {{percent}}% off your next order.</p>
{{/coupon}}
```

Text:

```
Hi {{customer.first_name}},

Thanks for order {{order_id}}.
{{#items}}- {{quantity}} x {{name}}: {{price}}
{{/items}}Total: {{total}}
{{#coupon}}
Use {{code}} for {{percent}}% off your next order.
{{/coupon}}
```

Variables:

```json
{
  "order_id": "A-1042",
  "customer": {
    "first_name": "Ann"
  },
  "items": [
    {
      "name": "Coffee beans",
      "quantity": 2,
      "price": "$24.00"
    },
    {
      "name": "Grinder",
      "quantity": 1,
      "price": "$89.00"
    }
  ],
  "total": "$113.00",
  "coupon": {
    "code": "THANKS15",
    "percent": 15
  }
}
```

HTML output:

```
<p>Hi Ann,</p>
<p>Thanks for order A-1042.</p>
<table>
<tr><td>2 × Coffee beans</td><td>$24.00</td></tr>
<tr><td>1 × Grinder</td><td>$89.00</td></tr>
</table>
<p>Total: <strong>$113.00</strong></p>
<p>Use <strong>THANKS15</strong> for 15% off your next order.</p>
```

Text output:

```
Hi Ann,

Thanks for order A-1042.
- 2 x Coffee beans: $24.00
- 1 x Grinder: $89.00
Total: $113.00

Use THANKS15 for 15% off your next order.
```

## Preview unsaved source

`POST /v1/templates/render`

Render subject, HTML and text with variables before saving anything. Syntax errors come back as `template_render_error`; missing variables are listed, not fatal. Reference: [Render unsaved source](https://zapsmtp.com/docs/templates/render-source/).

Requires a full-access key.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates/render' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "subject": "Your Acme receipt {{order_id}}",
  "html": "<p>Hi {{customer.first_name}},</p>\n<p>Thanks for order {{order_id}}.</p>\n<table>\n{{#items}}<tr><td>{{quantity}} × {{name}}</td><td>{{price}}</td></tr>\n{{/items}}</table>\n<p>Total: <strong>{{total}}</strong></p>\n{{#coupon}}<p>Use <strong>{{code}}</strong> for {{percent}}% off your next order.</p>\n{{/coupon}}",
  "text": "Hi {{customer.first_name}},\n\nThanks for order {{order_id}}.\n{{#items}}- {{quantity}} x {{name}}: {{price}}\n{{/items}}Total: {{total}}\n{{#coupon}}\nUse {{code}} for {{percent}}% off your next order.\n{{/coupon}}",
  "variables": {
    "order_id": "A-1042",
    "customer": {
      "first_name": "Ann"
    },
    "items": [
      {
        "name": "Coffee beans",
        "quantity": 2,
        "price": "$24.00"
      },
      {
        "name": "Grinder",
        "quantity": 1,
        "price": "$89.00"
      }
    ],
    "total": "$113.00",
    "coupon": {
      "code": "THANKS15",
      "percent": 15
    }
  }
}'
```

**Response `200 OK`**

```json
{
  "subject": "Your Acme receipt A-1042",
  "html": "<p>Hi Ann,</p>\n<p>Thanks for order A-1042.</p>\n<table>\n<tr><td>2 × Coffee beans</td><td>$24.00</td></tr>\n<tr><td>1 × Grinder</td><td>$89.00</td></tr>\n</table>\n<p>Total: <strong>$113.00</strong></p>\n<p>Use <strong>THANKS15</strong> for 15% off your next order.</p>\n",
  "text": "Hi Ann,\n\nThanks for order A-1042.\n- 2 x Coffee beans: $24.00\n- 1 x Grinder: $89.00\nTotal: $113.00\n\nUse THANKS15 for 15% off your next order.\n",
  "missing_variables": [],
  "variable_names": [
    "coupon",
    "customer",
    "items",
    "order_id",
    "total"
  ]
}
```

## Conditional coupon block

An object is a condition and a context at once: when `coupon` is an object, the block renders with its fields; when it is `null`, `false` or absent, the block disappears and no variable is reported missing.

**Coupon**

Template:

```
<p>Thanks for your order.</p>{{#coupon}}<p>Use <strong>{{code}}</strong> for {{percent}}% off your next order.</p>{{/coupon}}
```

With coupon:

```json
{"coupon":{"code":"THANKS15","percent":15}}
```

Output with coupon:

```
<p>Thanks for your order.</p><p>Use <strong>THANKS15</strong> for 15% off your next order.</p>
```

Without coupon:

```json
{"coupon":null}
```

Output without coupon:

```
<p>Thanks for your order.</p>
```

> An empty object `{}` is still true and renders the block with empty fields. Send `null`, not `{}`, when there is no coupon.

## Plurals

There are no helpers, so decide the form in your code and pass a boolean. This works for any language’s plural rules: pass one flag per form you need.

**One or many**

Template:

```
You have {{count}} {{#one}}message{{/one}}{{^one}}messages{{/one}}.
```

Variables:

```json
{"count": 1, "one": true}
{"count": 3, "one": false}
```

Output:

```
You have 1 message.
You have 3 messages.
```

Your code (JS):

```
const count = inbox.unread;
const variables = {count, one: count === 1};
```

## One template per language

Keep one template per locale with the same variables and aliases such as `receipt`, `receipt-de`, `receipt-fr`. Your code picks the alias; the variables stay the same.

## Add a translation

`POST /v1/templates`

One template per language, same variables, aliases that share a prefix. Needs a full-access *live* key: test keys get `403 test_key_restricted`.

Requires a full-access live key; test keys get 403 test_key_restricted.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "Receipt (de)",
  "alias": "receipt-de",
  "from": "Acme <billing@acme.com>",
  "subject": "Ihre Acme-Rechnung {{order_id}}",
  "text": "Hallo {{customer.first_name}},\n\nvielen Dank für Ihre Bestellung {{order_id}}.\n{{#items}}- {{quantity}} x {{name}}: {{price}}\n{{/items}}Summe: {{total}}\n",
  "variables": {
    "order_id": "A-1042",
    "customer": {
      "first_name": "Ann"
    },
    "items": [
      {
        "name": "Coffee beans",
        "quantity": 2,
        "price": "$24.00"
      },
      {
        "name": "Grinder",
        "quantity": 1,
        "price": "$89.00"
      }
    ],
    "total": "$113.00",
    "coupon": {
      "code": "THANKS15",
      "percent": 15
    }
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
      "name": "customer",
      "type": "object",
      "required": true
    },
    {
      "name": "items",
      "type": "list",
      "required": true
    },
    {
      "name": "total",
      "type": "string",
      "required": true
    }
  ],
  "publish": true
}'
```

**Response `201 Created`**

```json
{
  "object": "template",
  "alias": "receipt-de",
  "status": "published",
  "variable_names": [
    "customer",
    "items",
    "order_id",
    "total"
  ]
}
```

**Choose the alias**

```javascript
const alias = ['de', 'fr'].includes(user.locale) ? 'receipt-' + user.locale : 'receipt';
await fetch('https://api.zapsmtp.com/v1/emails', {
  method: 'POST',
  headers: {Authorization: 'Bearer ' + process.env.ZAP_API_KEY, 'Content-Type': 'application/json'},
  body: JSON.stringify({to: [user.email], template: {id: alias, variables}}),
});
```

## Managing templates

## Create a template

`name` is required (up to 200 characters) and at least one of `html` and `text`. `alias` is optional: lowercase letters, digits, `-` and `_`, starting with a letter or digit, up to 63 characters, unique in the account; it works wherever an id does. `from` is the default sender, `variables` are sample values for previews (they are never used for sending). `variable_schema` declares each variable’s type, whether a send must give it and its default; see Variable schema. A request body may be up to 4 MB. Creating, updating, publishing and restoring need a full-access live key; test keys (`zap_test_…`) may only read templates and call the two render endpoints, and get `403 test_key_restricted` otherwise.

Templates made in the visual editor also carry `design`, the editor’s document. Changing the HTML value through the API without sending `design` drops it (sending the same HTML again keeps it) and turns the template into a code template; see the [editor guide](https://zapsmtp.com/docs/template-editor/).

## Create the receipt template

`POST /v1/templates`

Store the source with an alias, a default From, sample variables and the variable schema. `publish: true` makes it sendable at once; leave it out to keep a draft. Reference: [Create a template](https://zapsmtp.com/docs/templates/create-template/). Needs a full-access *live* key: test keys get `403 test_key_restricted`.

Requires a full-access live key; test keys get 403 test_key_restricted.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "name": "Receipt",
  "alias": "receipt",
  "from": "Acme <billing@acme.com>",
  "subject": "Your Acme receipt {{order_id}}",
  "html": "<p>Hi {{customer.first_name}},</p>\n<p>Thanks for order {{order_id}}.</p>\n<table>\n{{#items}}<tr><td>{{quantity}} × {{name}}</td><td>{{price}}</td></tr>\n{{/items}}</table>\n<p>Total: <strong>{{total}}</strong></p>\n{{#coupon}}<p>Use <strong>{{code}}</strong> for {{percent}}% off your next order.</p>\n{{/coupon}}",
  "text": "Hi {{customer.first_name}},\n\nThanks for order {{order_id}}.\n{{#items}}- {{quantity}} x {{name}}: {{price}}\n{{/items}}Total: {{total}}\n{{#coupon}}\nUse {{code}} for {{percent}}% off your next order.\n{{/coupon}}",
  "variables": {
    "order_id": "A-1042",
    "customer": {
      "first_name": "Ann"
    },
    "items": [
      {
        "name": "Coffee beans",
        "quantity": 2,
        "price": "$24.00"
      },
      {
        "name": "Grinder",
        "quantity": 1,
        "price": "$89.00"
      }
    ],
    "total": "$113.00",
    "coupon": {
      "code": "THANKS15",
      "percent": 15
    }
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
      "name": "customer",
      "type": "object",
      "required": true
    },
    {
      "name": "items",
      "type": "list",
      "required": true
    },
    {
      "name": "total",
      "type": "string",
      "required": true
    },
    {
      "name": "coupon",
      "type": "object",
      "required": false
    }
  ],
  "publish": true
}'
```

**Response `201 Created`**

```json
{
  "id": "019a1f23-7f80-7192-8b3c-4d5e6f7a8b9c",
  "name": "Receipt",
  "alias": "receipt",
  "subject": "Your Acme receipt {{order_id}}",
  "html": "<p>Hi {{customer.first_name}},</p>\n<p>Thanks for order {{order_id}}.</p>\n<table>\n{{#items}}<tr><td>{{quantity}} × {{name}}</td><td>{{price}}</td></tr>\n{{/items}}</table>\n<p>Total: <strong>{{total}}</strong></p>\n{{#coupon}}<p>Use <strong>{{code}}</strong> for {{percent}}% off your next order.</p>\n{{/coupon}}",
  "text": "Hi {{customer.first_name}},\n\nThanks for order {{order_id}}.\n{{#items}}- {{quantity}} x {{name}}: {{price}}\n{{/items}}Total: {{total}}\n{{#coupon}}\nUse {{code}} for {{percent}}% off your next order.\n{{/coupon}}",
  "from": "Acme <billing@acme.com>",
  "variables": {
    "order_id": "A-1042",
    "customer": {
      "first_name": "Ann"
    },
    "items": [
      {
        "name": "Coffee beans",
        "quantity": 2,
        "price": "$24.00"
      },
      {
        "name": "Grinder",
        "quantity": 1,
        "price": "$89.00"
      }
    ],
    "total": "$113.00",
    "coupon": {
      "code": "THANKS15",
      "percent": 15
    }
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
      "name": "customer",
      "type": "object",
      "required": true
    },
    {
      "name": "items",
      "type": "list",
      "required": true
    },
    {
      "name": "total",
      "type": "string",
      "required": true
    },
    {
      "name": "coupon",
      "type": "object",
      "required": false
    }
  ],
  "created_at": "2026-10-21T16:10:00Z",
  "updated_at": "2026-10-21T16:10:00Z",
  "object": "template",
  "variable_names": [
    "coupon",
    "customer",
    "items",
    "order_id",
    "total"
  ],
  "status": "published",
  "has_unpublished_changes": false,
  "published_at": "2026-10-21T16:10:00Z",
  "published": {
    "subject": "Your Acme receipt {{order_id}}",
    "html": "<p>Hi {{customer.first_name}},</p>\n<p>Thanks for order {{order_id}}.</p>\n<table>\n{{#items}}<tr><td>{{quantity}} × {{name}}</td><td>{{price}}</td></tr>\n{{/items}}</table>\n<p>Total: <strong>{{total}}</strong></p>\n{{#coupon}}<p>Use <strong>{{code}}</strong> for {{percent}}% off your next order.</p>\n{{/coupon}}",
    "text": "Hi {{customer.first_name}},\n\nThanks for order {{order_id}}.\n{{#items}}- {{quantity}} x {{name}}: {{price}}\n{{/items}}Total: {{total}}\n{{#coupon}}\nUse {{code}} for {{percent}}% off your next order.\n{{/coupon}}",
    "from": "Acme <billing@acme.com>",
    "variable_schema": [
      {
        "name": "order_id",
        "type": "string",
        "required": true,
        "example": "A-1042",
        "description": "Order number shown to the customer"
      },
      {
        "name": "customer",
        "type": "object",
        "required": true
      },
      {
        "name": "items",
        "type": "list",
        "required": true
      },
      {
        "name": "total",
        "type": "string",
        "required": true
      },
      {
        "name": "coupon",
        "type": "object",
        "required": false
      }
    ]
  }
}
```

## Drafts and publishing

Each template has a draft (its top-level fields) and a published version (`published`). Edits always change the draft; sends always use the published version. So you can change a live template, preview it, and switch over in one step.

**Status fields**

- **`status`**: `draft` until the first publish, then `published`. Sending with a never-published template fails.
- **`has_unpublished_changes`**: `true` when the draft’s subject, HTML, text, From, design or variable schema differ from the published version.
- **`published_at`**: Time of the last publish.
- **`publish: true`**: On create or update, saves and publishes in one call.

## Edit the draft

`PATCH /v1/templates/{id}`

Partial update: omitted fields stay as they are. The change lands in the draft; sends keep using the published version and the response shows `has_unpublished_changes: true`. Reference: [Update a template](https://zapsmtp.com/docs/templates/update-template/). Needs a full-access *live* key: test keys get `403 test_key_restricted`.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Path parameters

- `id` (string, required): Template id or alias

```bash
curl -X PATCH 'https://api.zapsmtp.com/v1/templates/receipt' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "subject": "Receipt {{order_id}} from Acme"
}'
```

**Response `200 OK`**

```json
{
  "object": "template",
  "id": "019a1f23-7f80-7192-8b3c-4d5e6f7a8b9c",
  "alias": "receipt",
  "subject": "Receipt {{order_id}} from Acme",
  "status": "published",
  "has_unpublished_changes": true,
  "published": {
    "subject": "Your Acme receipt {{order_id}}",
    "html": "<p>Hi {{customer.first_name}},</p>\n<p>Thanks for order {{order_id}}.</p>\n<table>\n{{#items}}<tr><td>{{quantity}} × {{name}}</td><td>{{price}}</td></tr>\n{{/items}}</table>\n<p>Total: <strong>{{total}}</strong></p>\n{{#coupon}}<p>Use <strong>{{code}}</strong> for {{percent}}% off your next order.</p>\n{{/coupon}}",
    "text": "Hi {{customer.first_name}},\n\nThanks for order {{order_id}}.\n{{#items}}- {{quantity}} x {{name}}: {{price}}\n{{/items}}Total: {{total}}\n{{#coupon}}\nUse {{code}} for {{percent}}% off your next order.\n{{/coupon}}",
    "from": "Acme <billing@acme.com>"
  }
}
```

## Publish the draft

`POST /v1/templates/{id}/publish`

Copies the current draft to `published`. From this moment every send with `receipt` uses it. Reference: [Publish a template](https://zapsmtp.com/docs/templates/publish-template/). Needs a full-access *live* key: test keys get `403 test_key_restricted`.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Path parameters

- `id` (string, required): Template id or alias.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates/receipt/publish' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "template",
  "id": "019a1f23-7f80-7192-8b3c-4d5e6f7a8b9c",
  "alias": "receipt",
  "subject": "Receipt {{order_id}} from Acme",
  "status": "published",
  "has_unpublished_changes": false,
  "published_at": "2026-10-22T09:00:00Z",
  "published": {
    "subject": "Receipt {{order_id}} from Acme",
    "html": "<p>Hi {{customer.first_name}},</p>\n<p>Thanks for order {{order_id}}.</p>\n<table>\n{{#items}}<tr><td>{{quantity}} × {{name}}</td><td>{{price}}</td></tr>\n{{/items}}</table>\n<p>Total: <strong>{{total}}</strong></p>\n{{#coupon}}<p>Use <strong>{{code}}</strong> for {{percent}}% off your next order.</p>\n{{/coupon}}",
    "text": "Hi {{customer.first_name}},\n\nThanks for order {{order_id}}.\n{{#items}}- {{quantity}} x {{name}}: {{price}}\n{{/items}}Total: {{total}}\n{{#coupon}}\nUse {{code}} for {{percent}}% off your next order.\n{{/coupon}}",
    "from": "Acme <billing@acme.com>"
  }
}
```

## Versions and restore

Every create, update, publish and restore records the draft as a version with its `kind` (`saved`, `published` or `restored`) and `author` (a user’s email, or `API key`). Only the newest 50 are kept.

## List versions

`GET /v1/templates/{id}/versions`

Every save, publish and restore is recorded; the newest 50 are kept, newest first. The list carries no bodies: fetch one with `GET /templates/{id}/versions/{vid}`.

Requires a full-access key.

### Path parameters

- `id` (string, required): Template id or alias

```bash
curl 'https://api.zapsmtp.com/v1/templates/receipt/versions' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "list",
  "has_more": false,
  "data": [
    {
      "id": "019a1f61-2b3c-7d4e-8f5a-6b7c8d9e0f1a",
      "kind": "published",
      "author": "API key",
      "name": "Receipt",
      "subject": "Receipt {{order_id}} from Acme",
      "created_at": "2026-10-22T09:00:00Z"
    },
    {
      "id": "019a1f60-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
      "kind": "saved",
      "author": "API key",
      "name": "Receipt",
      "subject": "Receipt {{order_id}} from Acme",
      "created_at": "2026-10-22T08:58:00Z"
    },
    {
      "id": "019a1f23-7f81-7192-8b3c-4d5e6f7a8b9d",
      "kind": "published",
      "author": "API key",
      "name": "Receipt",
      "subject": "Your Acme receipt {{order_id}}",
      "created_at": "2026-10-21T16:10:00Z"
    }
  ]
}
```

## Restore a version

`POST /v1/templates/{id}/versions/{vid}/restore`

Copies the version’s name, subject, HTML, text, From and design into the draft (alias and sample variables are kept). Publishing stays a separate step, so a restore never changes what is being sent. Needs a full-access *live* key: test keys get `403 test_key_restricted`.

Requires a full-access key.

### Path parameters

- `id` (string, required): Template id or alias
- `vid` (string, required): Version id from the list

### Errors

- `not_found` (HTTP 404): template not found / version not found

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates/receipt/versions/019a1f23-7f81-7192-8b3c-4d5e6f7a8b9d/restore' \
  -H "Authorization: Bearer $ZAP_API_KEY"
```

**Response `200 OK`**

```json
{
  "object": "template",
  "id": "019a1f23-7f80-7192-8b3c-4d5e6f7a8b9c",
  "alias": "receipt",
  "subject": "Your Acme receipt {{order_id}}",
  "status": "published",
  "has_unpublished_changes": true
}
```

## Preview before you publish

Render a stored template’s draft to check a change, or render unsaved source to validate it. Both return the rendered subject, HTML and text, the missing variables and the variable names. Neither sends anything.

## Preview a stored template

`POST /v1/templates/{id}/render`

Renders the *draft* with the variables you pass, or with its sample variables when `variables` is omitted. Here `coupon` is `null`, so the coupon block disappears. Reference: [Render a template](https://zapsmtp.com/docs/templates/render-template/).

Requires a full-access key.

### Path parameters

- `id` (string, required): Template id or alias

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates/receipt/render' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "variables": {
    "order_id": "A-1042",
    "customer": {
      "first_name": "Ann"
    },
    "items": [
      {
        "name": "Coffee beans",
        "quantity": 2,
        "price": "$24.00"
      },
      {
        "name": "Grinder",
        "quantity": 1,
        "price": "$89.00"
      }
    ],
    "total": "$113.00",
    "coupon": null
  }
}'
```

**Response `200 OK`**

```json
{
  "subject": "Receipt A-1042 from Acme",
  "html": "<p>Hi Ann,</p>\n<p>Thanks for order A-1042.</p>\n<table>\n<tr><td>2 × Coffee beans</td><td>$24.00</td></tr>\n<tr><td>1 × Grinder</td><td>$89.00</td></tr>\n</table>\n<p>Total: <strong>$113.00</strong></p>\n",
  "text": "Hi Ann,\n\nThanks for order A-1042.\n- 2 x Coffee beans: $24.00\n- 1 x Grinder: $89.00\nTotal: $113.00\n",
  "missing_variables": [],
  "variable_names": [
    "coupon",
    "customer",
    "items",
    "order_id",
    "total"
  ]
}
```

## Catch a syntax error

`POST /v1/templates/render`

Unclosed or mismatched tags are reported with the field, line and column (1-based). The same check runs when a template is created or updated, so a broken template cannot be saved.

Requires a full-access key.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/templates/render' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "html": "<ul>\n  {{#items}}\n  <li>{{name}}</li>\n</ul>",
  "variables": {
    "items": []
  }
}'
```

**Response `422 `**

```json
{
  "statusCode": 422,
  "name": "template_render_error",
  "message": "html: line 2, column 3: unclosed section {{#items}}",
  "error": {
    "code": "template_render_error",
    "message": "html: line 2, column 3: unclosed section {{#items}}",
    "type": "invalid_request_error"
  }
}
```

## Variables

## Three kinds of variables

Every name in a template belongs to one of three kinds. [`GET /variables`](https://zapsmtp.com/docs/variables/list-variables/) lists them all in one catalogue, with the templates that use each.

**Kinds**

- **Kind**: **Written as** · **Value comes from** · **Editable**
- **System**: `{{{zap:unsubscribe_url}}}` · ZapSMTP, at send time · No
- **Global**: `{{global.company_name}}` · The account (`PUT /variables/global/{key}`) · Yes, never by a send
- **Template**: `{{order_id}}, {{customer.first_name}}` · `template.variables` in the send, else the declared default · Per template

## Variable schema

A template declares its own variables in `variable_schema`: a list of entries with `name`, `type`, `required`, `default`, `example` and `description`. Send it on [create](https://zapsmtp.com/docs/templates/create-template/) or [update](https://zapsmtp.com/docs/templates/update-template/); it replaces the declared list. Names are letters, digits, `_` and `-`, starting with a letter or `_`, up to 64; `global` is reserved. A default and an example must be of the variable’s type. Up to 200 entries.

**Types**

- **`string`**: A JSON string.
- **`number`**: A JSON number.
- **`boolean`**: `true` or `false`.
- **`url`**: A string: an `http://` or `https://` URL with a host, or a `mailto:` or `tel:` link.
- **`date`**: A string: an RFC 3339 time (`2026-11-28T23:59:59Z`) or a date (`2026-11-28`).
- **`list`**: A JSON array: for sections that repeat.
- **`object`**: A JSON object: for dotted names and sections that render once.
- **`any`**: Any JSON value, not checked. Discovery on save gives this type to names you have not declared.

**Discovery on save.** Every save compares the schema with the source. A top-level name the source uses but the schema lacks is added, with its sample value from `variables` as `example`, and never stricter than sends were before schemas: a section (`{{#items}}`, `{{^vip}}`) as an optional `any` (left out, it is skipped), a dotted name (`{{customer.first_name}}`) as a required `object`, and any other name as a required `any`. Declare a type (`string`, `number`, `list` and so on) to have sends checked against it. A declared name the source no longer uses is kept and marked `unused: true`, never dropped silently.

The schema has a draft and a published copy like the rest of the template, and sends use the published one (`published.variable_schema`).

## Defaults and errors at send time

For each declared variable, in this order:

1. A value in `template.variables` (other than `null`) is used and must be of its type; otherwise the send fails with `422 template_variables_invalid`, listing the names.
2. Without a value, the default is used.
3. Without a default, a required variable fails the send with `422 template_variables_missing`, listing the names; an optional one is `null`, so it renders empty and its section is skipped.

Wrong types are reported first. Values the schema does not declare are passed through untouched. Global variables are added next, then the template is rendered: a field missing inside an object (`customer.first_name`) or a global variable with no value still fails with `422 template_render_error`.

> A template last published before variable schemas existed has `published.variable_schema: null` and keeps the old rule: every variable it renders must be given, or the send fails with `template_render_error`. Save it, so its schema is stored, then publish it to switch to the schema.

## A required variable is missing

`POST /v1/emails`

The receipt declares `customer` and `total` as required with no default. Without them the send is refused and nothing is queued.

Requires a full-access or sending-access key. Live keys: From domain must be verified by the account. Test keys: any From domain, nothing delivered, monthly quota not charged.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "template": {
    "id": "receipt",
    "variables": {
      "order_id": "A-1042",
      "items": [
        {
          "name": "Coffee beans",
          "quantity": 2,
          "price": "$24.00"
        },
        {
          "name": "Grinder",
          "quantity": 1,
          "price": "$89.00"
        }
      ]
    }
  }
}'
```

**Response `422 `**

```json
{
  "statusCode": 422,
  "name": "template_variables_missing",
  "message": "missing required template variables: customer, total",
  "error": {
    "code": "template_variables_missing",
    "message": "missing required template variables: customer, total",
    "type": "invalid_request_error"
  }
}
```

## Global variables

Company name, postal address, support URL, social links: values every template shares are set once for the account and written `{{global.key}}`. Keys follow the rules for variable names; values are strings of up to 10 KB, with an optional description of up to 500 bytes. A change applies to every template that uses the key from the next send on, with no publish needed.

- A send cannot override them: `template.variables.global` is refused with `422 invalid_parameter`, and `global` cannot be declared in a schema.
- A global variable a template uses but the account has not set is missing: sends fail with `template_render_error`, and the catalogue lists it without a value so you can set it.
- Values are escaped in HTML like any other: use `{{{global.address_html}}}` only for HTML you wrote.

## Set a global variable

`PUT /v1/variables/global/{key}`

Creates or replaces `{{global.company_name}}` for every template of the account, from the next send on. Reference: [Set a global variable](https://zapsmtp.com/docs/variables/put-global-variable/). Needs a full-access *live* key: test keys get `403 test_key_restricted`.

Requires a full-access live key; test keys get 403 test_key_restricted.

### Path parameters

- `key` (string, required): The key, used as `{{global.key}}`: letters, digits, `_` and `-`, starting with a letter or `_`, up to 64; `global` is reserved. Limits: other keys → 422 invalid_parameter

```bash
curl -X PUT 'https://api.zapsmtp.com/v1/variables/global/company_name' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "value": "Acme Inc.",
  "description": "Legal name for footers"
}'
```

**Response `200 OK`**

```json
{
  "object": "variable",
  "name": "global.company_name",
  "kind": "global",
  "type": "string",
  "key": "company_name",
  "value": "Acme Inc.",
  "description": "Legal name for footers",
  "updated_at": "2026-10-27T10:30:00Z",
  "templates": []
}
```

## Previews

`POST /templates/{id}/render` renders the draft with, for each variable, the value you pass, else its `example`, else its `default`; without a `variables` object it takes the template’s sample `variables`. `POST /templates/render` uses only the values you pass. Both add the account’s global variables, and neither checks types or required variables: what is missing is listed in `missing_variables`.

## Sending

## Sending with a template

Pass `template.id` and the variables instead of `subject`, `html` and `text`. `template.id` takes either of two names for the same template:

**template.id**

- **Template id**: The UUID, e.g. `019a1f23-7f80-7192-8b3c-4d5e6f7a8b9c`. Shown with a copy button in the dashboard’s template list and editor header, and returned as `id` by the API. It never changes.
- **Alias**: Your readable name, e.g. `receipt`, if the template has one. Unique in the account and works wherever an id does. You can change it; if you do, update the code that sends with it.

Sends always use the **published** version: subject, HTML, text, From and variable schema. Draft changes have no effect until you publish them, and a template that was never published cannot be sent (`422 invalid_parameter`). Previews render the draft.

## Send rules

**template on POST /emails**

- **`template.id`**: Template id or alias. Required.
- **`template.variables`**: Object of values for the template’s own variables, checked against the published variable schema (types, required, defaults). Values the schema does not declare are passed through. Every `{{x}}` or `{{{x}}}` that is actually rendered must end up with a value; tags inside skipped sections are not checked. The key `global` is reserved.
- **`html`, `text`**: Not allowed together with `template`.
- **`subject`**: Optional; overrides the template’s subject and is used as written, without rendering.
- **`from`**: Optional when the template has a From; overrides it when given. Live keys still need a verified domain.
- **Everything else**: `cc`, `bcc`, `reply_to`, `headers`, `attachments`, `tags`, `metadata`, `tracking`, `stream`, `scheduled_at` and `tls` work as in any send.

## Send with a template

`POST /v1/emails`

Pass `template.id` (id or alias) and its `variables` instead of `subject`, `html` and `text`. From comes from the template here. Reference: [Send an email](https://zapsmtp.com/docs/emails/send-email/).

Requires a full-access or sending-access key. Live keys: From domain must be verified by the account. Test keys: any From domain, nothing delivered, monthly quota not charged.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "template": {
    "id": "receipt",
    "variables": {
      "order_id": "A-1042",
      "customer": {
        "first_name": "Ann"
      },
      "items": [
        {
          "name": "Coffee beans",
          "quantity": 2,
          "price": "$24.00"
        },
        {
          "name": "Grinder",
          "quantity": 1,
          "price": "$89.00"
        }
      ],
      "total": "$113.00",
      "coupon": {
        "code": "THANKS15",
        "percent": 15
      }
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

## Override From and subject

`POST /v1/emails`

`from` and `subject` in the request win over the template’s. The request subject is used as written: it is not rendered, so it cannot contain variables.

Requires a full-access or sending-access key. Live keys: From domain must be verified by the account. Test keys: any From domain, nothing delivered, monthly quota not charged.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "from": "Acme Orders <orders@acme.com>",
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "subject": "Receipt A-1042 (copy)",
  "template": {
    "id": "receipt",
    "variables": {
      "order_id": "A-1042",
      "customer": {
        "first_name": "Ann"
      },
      "items": [
        {
          "name": "Coffee beans",
          "quantity": 2,
          "price": "$24.00"
        },
        {
          "name": "Grinder",
          "quantity": 1,
          "price": "$89.00"
        }
      ],
      "total": "$113.00",
      "coupon": {
        "code": "THANKS15",
        "percent": 15
      }
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

## Templates with tags, metadata and scheduling

`POST /v1/emails`

Every other send field works as usual. The template is rendered when the request is accepted: a scheduled email keeps that content even if the template is published again before it goes out.

Requires a full-access or sending-access key. Live keys: From domain must be verified by the account. Test keys: any From domain, nothing delivered, monthly quota not charged.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/emails' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Idempotency-Key: order-A-1042-receipt' \
  -H 'Content-Type: application/json' \
  -d '{
  "to": [
    "delivered@simulator.zapsmtp.com"
  ],
  "template": {
    "id": "receipt",
    "variables": {
      "order_id": "A-1042",
      "customer": {
        "first_name": "Ann"
      },
      "items": [
        {
          "name": "Coffee beans",
          "quantity": 2,
          "price": "$24.00"
        },
        {
          "name": "Grinder",
          "quantity": 1,
          "price": "$89.00"
        }
      ],
      "total": "$113.00",
      "coupon": null
    }
  },
  "tags": [
    {
      "name": "category",
      "value": "receipt"
    }
  ],
  "metadata": {
    "order_id": "A-1042",
    "customer_id": "C-77"
  },
  "scheduled_at": "in 2 hours"
}'
```

**Response `200 OK`**

```json
{
  "id": "019a1f2e-7c3b-7d41-9a52-0c4b8e6f1a23"
}
```

## Send a batch from one template

`POST /v1/emails/batch`

Each item of a batch carries its own variables. With the default `x-batch-validation: strict`, one item with missing variables stops the whole batch; with `permissive` it is reported in `errors` and the others go out. Reference: [Send a batch](https://zapsmtp.com/docs/emails/send-batch/).

Requires a full-access or sending-access key. Test keys follow the same rules as for sending.

```bash
curl -X POST 'https://api.zapsmtp.com/v1/emails/batch' \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '[
  {
    "to": [
      "delivered@simulator.zapsmtp.com"
    ],
    "template": {
      "id": "receipt",
      "variables": {
        "order_id": "A-1042",
        "customer": {
          "first_name": "Ann"
        },
        "items": [
          {
            "name": "Coffee beans",
            "quantity": 2,
            "price": "$24.00"
          },
          {
            "name": "Grinder",
            "quantity": 1,
            "price": "$89.00"
          }
        ],
        "total": "$113.00",
        "coupon": {
          "code": "THANKS15",
          "percent": 15
        }
      }
    }
  },
  {
    "to": [
      "delivered+bob@simulator.zapsmtp.com"
    ],
    "template": {
      "id": "receipt",
      "variables": {
        "order_id": "A-1043",
        "customer": {
          "first_name": "Bob"
        },
        "items": [
          {
            "name": "Filters",
            "quantity": 3,
            "price": "$6.00"
          }
        ],
        "total": "$6.00",
        "coupon": null
      }
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
      "index": 1,
      "id": "019a1f2e-7c3c-7a10-8b21-4d5e6f7a8b9c"
    }
  ],
  "errors": []
}
```

## Errors

Errors use the standard [error shape](https://zapsmtp.com/docs/conventions/). In a batch, the same codes appear per item in `errors[]`.

**Template errors**

- **`template_variables_missing` (HTTP 422)**: `missing required template variables: customer, total` Send: required variables of the published schema have no value and no default. Sorted by name.
- **`template_variables_invalid` (HTTP 422)**: `template variables of the wrong type: items` Send: values that do not match their declared type. Checked before missing ones. Sorted by name.
- **`template_render_error` (HTTP 422)**: `missing template variables: last_name, plan.name` Send: a variable the template renders is still absent: a field inside an object, a global variable with no value, or any variable of a template published before variable schemas. Names come in no particular order.
- **`invalid_parameter` (HTTP 422)**: `template.variables.global is reserved: global variables are set in the account (PUT /v1/variables/global/{key})` Send: `template.variables` has a `global` key.
- **`invalid_parameter` (HTTP 422)**: `variable_schema: items: type must be one of string, number, boolean, url, date, list, object, any` Create, update: a bad schema entry. Also: a bad or reserved name, a name declared twice, a default or example not of its type, a description over 500 bytes, more than 200 entries.
- **`template_render_error` (HTTP 422)**: `html: line 2, column 3: unclosed section {{#items}}` Create, update, render: syntax error in subject, html or text.
- **`template_render_error` (HTTP 422)**: `html: line 4, column 1: {{#each items}} is not a variable name: letters, digits, _ and - (no spaces), parts joined with dots` Create, update: a tag that names no variable, such as `{{first name}}`, Handlebars `{{#each items}}` or a partial `{{> footer}}`. Templates saved before this check still send.
- **`template_render_error` (HTTP 422)**: `html: template output too large (lists nested too deep or too long)` Render or send: the output would exceed 10 MB or the work limit.
- **`invalid_parameter` (HTTP 422)**: `template receipt not found` Send: no template with this id or alias in the account.
- **`invalid_parameter` (HTTP 422)**: `template receipt is not published (POST /v1/templates/<id>/publish)` Send: the template has never been published.
- **`invalid_parameter` (HTTP 422)**: `html/text cannot be combined with template` Send: the request has both a body and a template.
- **`missing_required_field` (HTTP 422)**: `template.id is required` Send: `template` without `id`.
- **`missing_required_field` (HTTP 422)**: `html or text is required` Create, update: both bodies empty.
- **`invalid_parameter` (HTTP 422)**: `alias must match [a-z0-9][a-z0-9_-]{0,62}` Create, update: bad alias.
- **`conflict` (HTTP 409)**: `a template with this alias already exists` Create, update: aliases are unique per account.
- **`not_found` (HTTP 404)**: `template not found` Template endpoints: unknown id or alias.
- **`test_key_restricted` (HTTP 403)**: `test-mode keys can send test email and read, not change the account: use a live key` Create, update, publish, duplicate, restore, delete with a test key.

```json
{
  "statusCode": 422,
  "name": "template_render_error",
  "message": "missing template variables: total",
  "error": {
    "code": "template_render_error",
    "message": "missing template variables: total",
    "type": "invalid_request_error"
  }
}
```

> To catch missing variables before production, render with the exact variables your code builds: `POST /templates/{id}/render` and fail your test when `missing_variables` is not empty. Note that it renders the draft, while sends use the published version.
