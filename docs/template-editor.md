# Email template editor

> Design emails in the ZapSMTP visual editor or write the HTML yourself: a gallery of ready templates, drag-and-drop blocks, live preview, versions, and sending by template id.

Source: https://zapsmtp.com/docs/template-editor/

Keep your emails in ZapSMTP and send them with a template id and variables: your code stays free of HTML, and anyone on the team can change a message without a deploy. Build a template visually, or write the HTML yourself.

## Templates

*Templates* lists every template with its editor, status and the variables it uses. A template is a *draft* until you publish it; sends always use the published version, so you can edit safely while it is in use. An alias (`order-shipped`) lets your code refer to it by name.

![The Templates list: order shipped, order confirmation, password reset, welcome, abandoned cart and a receipt written in HTML, with statuses and variables](https://zapsmtp.com/docs/img/templates-light.webp)

## Start from the gallery

*New template* opens a gallery of ready designs: order and shipping updates, password resets, welcome series, promotions, newsletters, invoices and more. Every one is responsive, supports dark mode and is filled with sample data, so you see the finished email before you pick it. Start blank, or with code, from the same page.

![The template gallery with categories Quick start, Transactional, Triggers, Promo, Business and Info, and live previews of each design](https://zapsmtp.com/docs/img/gallery-light.webp)

## The visual editor

Drag rows and blocks onto the email: headings, text, images, buttons, dividers, social links, menus, lists, tables, video, countdown timers and custom HTML. Click any block to change it on the right, edit text in place, and switch between desktop and mobile views as you go. Rows can repeat for each item of a list (an order's products) or appear only when a variable is set.

![The visual editor: a palette of blocks on the left, an order-shipped email in the middle, and the selected button's settings on the right](https://zapsmtp.com/docs/img/visual-editor-light.webp)

The visual editor: blocks on the left, settings for the selected button on the right.

Variables are written as `{{name}}` and highlighted in the email. The editor keeps an undo history, saves a backup in your browser while you work, and keeps the last 50 saved versions, any of which you can preview and restore. *Preview* shows the email on desktop, on a phone, in dark mode and as plain text; *Test* sends it to your inbox; *Spam check* scores it with SpamAssassin and rspamd.

## Images, modules and timers

**Images.** The image picker uploads a file, reuses one from your account’s library, takes an external URL, or copies an external image to ZapSMTP hosting. PNG, JPEG, GIF and WebP up to 5 MB each; PNG and JPEG wider than 1,200 pixels are scaled down. The library holds up to 2,000 images and 1 GB. Deleting an image removes the file, so emails and templates that still show it lose it.

**Modules.** *Save as module* keeps a row (a header, a footer, a product card) to insert into any template from the Modules tab. An inserted module is a copy: editing or deleting the saved module leaves templates that use it unchanged.

**Countdown timers.** A countdown block is an animated GIF drawn when the email is opened, counting down to your deadline. It runs once for up to 60 seconds and then holds its last frame; it is not a live clock. After the deadline it shows zero.

## Writing HTML

Prefer your own HTML? The code editor highlights HTML and variables, completes variable names as you type `{{`, and marks a template error on its line. The preview on the right renders with your sample variables as you type. The plain-text part is one click away: *Generate from HTML*.

![The code editor: a receipt template in HTML on the left and its live preview with sample data on the right](https://zapsmtp.com/docs/img/code-editor-light.webp)

**Template syntax**

- **`{{name}}`**: The value, HTML-escaped.
- **`{{{url}}}`**: The value as is: for links and trusted HTML.
- **`{{#items}}…{{/items}}`**: Repeats for each item of a list, or shows the part when the value is set.
- **`{{^items}}…{{/items}}`**: Shows the part when the value is empty or missing.
- **`{{user.plan}}`**: A field of an object.

## Sending with a template

Pass the template's id or alias and its variables instead of a subject and HTML. The subject, the HTML and the plain text are all rendered from the published version; a missing variable is an error, so a half-filled email never goes out.

```
curl -X POST https://app.zapsmtp.com/v1/emails \
  -H "Authorization: Bearer $ZAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": ["sofia@example.com"],
    "template": {
      "id": "order-shipped",
      "variables": { "name": "Sofia", "order_id": "H-20512", "carrier": "UPS" }
    }
  }'
```

Every template has a *Send it* example with your own variables in its Details tab. The full request is in the [API reference](https://zapsmtp.com/docs/emails/send-email/).
