# Dashboard tour

> A tour of the ZapSMTP dashboard: sending health, every email with its delivery timeline, domains, API keys, webhooks, inbound email and suppressions.

Source: https://zapsmtp.com/docs/dashboard/

Everything the API does, you can see and do in the dashboard: how your mail lands, what happened to each message, and the settings behind it. The screenshots show a fictional store, Halden Outfitters, after a week of sending. [Create an account](https://app.zapsmtp.com/signup) to follow along.

## Sending health

*Overview* answers one question: is my mail getting through? Sent, delivery, bounce and complaint rates for the last 24 hours, 7 or 30 days, each marked against the thresholds mailbox providers use (bounces under 2%, complaints under 0.08%). Below them: activity over time, opens and clicks, the top links, results per sending domain, stream, tag and mailbox provider, and why mail bounced.

![The Overview page: sent, delivery rate 99.3%, bounce rate 0.52%, complaint rate 0.022%, and a week of email activity](https://zapsmtp.com/docs/img/overview-light.webp)

Overview: rates against provider thresholds and a week of activity.

## Every email, every event

*Emails* lists every message sent through the API or SMTP, with its current status. Filter by status (delivered, bounced, opened, clicked, complained, scheduled and more), stream and time range, or search by recipient, subject or id.

![The Emails list with recipients, subjects, statuses such as Delivered, Opened, Clicked and Bounced, and send times](https://zapsmtp.com/docs/img/emails-light.webp)

Open a message to see its timeline: when ZapSMTP accepted it, the receiving server's exact reply with its MX, IP and TLS version, opens and clicks, and for a bounce, why it failed and whether the address was suppressed. The message itself, its metadata and a spam check are on the same page.

![An email's page: recipients, metadata, a rendered preview and an event timeline from acceptance to delivery, open and click](https://zapsmtp.com/docs/img/email-detail-light.webp)

An email's timeline: the receiving server's exact reply for every attempt.

## Domains

Add the domain you send from and publish the records shown: a DKIM key we generate for it, plus SPF and DMARC. ZapSMTP checks DNS every minute until the domain verifies, then keeps watching it, along with the domain's reputation on public blocklists. The same page sets open and click tracking, TLS for outgoing mail and your brand in the inbox (BIMI).

![A verified domain with its DKIM, SPF and DMARC records, each marked Found, and a copy button for each value](https://zapsmtp.com/docs/img/domain-light.webp)

## API keys

Create a key per application or environment. A key can be limited to sending, to one domain and to one stream (transactional or broadcast); a test key goes through validation, logging and webhooks without delivering anything. A key is shown once, when you create it.

![API keys for the storefront, the order service, a newsletter tool, admin scripts and CI tests, with their permissions and last use](https://zapsmtp.com/docs/img/api-keys-light.webp)

## Webhooks

Point an endpoint at your server and pick the events it receives. Each endpoint shows its signing secret with verification code, a test button that sends a sample event, and the last 100 deliveries with your server's answer, so a failing endpoint is obvious and any delivery can be replayed. See [Webhook events](https://zapsmtp.com/docs/webhook-events/) for payloads.

![A webhook endpoint with its signing secret, a send-test-event form and recent deliveries with HTTP status codes and timings](https://zapsmtp.com/docs/img/webhook-light.webp)

## Inbound email

*Inbound* receives mail for your domains or a free ZapSMTP address, parses it to JSON and passes it to your webhook, with spam scores and SPF, DKIM and DMARC results. Replies and follow-ups are grouped into conversations, so a support inbox is a few API calls away.

![Inbound messages from customers, each received and routed to a webhook, and one rejected as spam](https://zapsmtp.com/docs/img/inbound-light.webp)

![A conversation about a tent pole replacement: two customer messages and one reply, with participants and the ticket id](https://zapsmtp.com/docs/img/thread-light.webp)

A conversation: messages in both directions, with your own metadata such as a ticket id.

## Suppressions

Hard bounces, spam complaints and unsubscribes are added automatically, so you never mail an address that hurts your reputation. An unsubscribe stops broadcast mail only; the other reasons stop every stream. Search the list, see what caused each entry, add addresses or remove one when a customer asks.

![The suppression list with hard bounces, an unsubscribe and a complaint, each with its source](https://zapsmtp.com/docs/img/suppressions-light.webp)

## Account and security settings

In Settings, rename the account, change your password or *Sign out everywhere*. A new password needs at least 10 characters; changing it signs out your other devices and keeps this one. *Sign out everywhere* ends every dashboard session, this one included. Each password change is confirmed by email.

## Promo codes

An owner enters a promo code in Plan & billing, under *Promo code*. A code for a free plan switches the account to it at once; a code for a paid plan adds that plan to the list to choose and pay for. If the account pays for a plan now, cancel it in *Manage billing* first, then enter the code again.

On the Free plan and on plans that come with a promo code, every email the account sends ends with a small “Sent with ZapSMTP” line with our logo, and it cannot be removed. Paid plans send your email as it is.

## Delete an account

An owner can delete the account in Settings: type its name and your password. Sending stops at once (API, SMTP, scheduled emails and forwarding answer `403 account_closing`), every member gets an email (and a reminder 3 days before the end), and for 7 days an owner can cancel it in Settings and carry on as before.

After 7 days everything in the account is erased for good: email logs and stored messages, received mail and attachments, templates and images, domains and their DKIM keys, API keys and SMTP credentials, webhooks, suppressions and the team. A paid plan ends with a final invoice. People who belonged to no other account are removed as well. Other accounts you belong to are not touched.

Accounts are also deleted when they are abandoned: a Free account that nobody used for 30 days (no sign-in, API request or SMTP login), and an account whose payment has been overdue for 30 days. Every member gets an email 14 days before and a last one 3 days before, and sending keeps working meanwhile. Using the account cancels the first; paying the overdue invoice cancels the second.

## On your phone

The whole dashboard works on a phone: lists become cards, and the template editor edits in the mobile view with its panels as sheets.

![The Emails list on a phone, each message a card with its status](https://zapsmtp.com/docs/img/phone-emails-light.webp)

![The visual template editor on a phone](https://zapsmtp.com/docs/img/phone-editor-light.webp)
