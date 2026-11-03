# SMTP relay

> Connect any mailer to ZapSMTP over SMTP: host, ports, TLS, credentials and examples for Node.js, Python, PHP, Go, Ruby, Laravel and Django.

Source: https://zapsmtp.com/docs/smtp/

Point any application, CMS or mail library at ZapSMTP. SMTP and the API share one pipeline: the same email log, events, webhooks, suppressions and limits.

> The SMTP relay is included from the Pro plan. On Free, send with the [Email API](https://zapsmtp.com/docs/sending/): a login on a Free account is refused with `550 5.7.1`.

**Settings**

- **Host**: `mail.zapsmtp.com`
- **Ports**: `587` or `2525` with STARTTLS, `465` with TLS
- **Encryption**: TLS 1.2 or newer. Authentication is refused on an unencrypted connection.
- **Authentication**: `PLAIN` or `LOGIN`
- **Plans**: Pro, Scale and Enterprise (10 credentials on Pro, unlimited on Scale)
- **Limits**: 40 MB per message, 50 recipients per message

## Credentials

Create an SMTP credential for each application in the dashboard or with [the API](https://zapsmtp.com/docs/keys/create-smtp-credential/). Its username looks like `smtp_k3f9x2m7q1ab` and it has its own password, shown once. Credentials can only send; they never work with the HTTP API, and you can revoke one without touching the others.

An API key also works as the password with any username that does not start with `smtp_` (for example `zapsmtp`). Test keys work too: the message runs the whole pipeline and is not delivered.

Choose the stream per message with the header `X-Zap-Stream: broadcast` (default `transactional`).

Turn [reply tracking](https://zapsmtp.com/docs/inbound-guide/#reply-tracking-intro) on or off for one message with `X-Zap-Reply-Tracking: on` or `off`; without the header the From domain’s default applies. Any other value is refused with `550 5.6.0`.

**Send over SMTP**

Node.js:

```javascript
import nodemailer from 'nodemailer';

const transport = nodemailer.createTransport({
  host: 'mail.zapsmtp.com',
  port: 587, // STARTTLS
  auth: { user: process.env.ZAP_SMTP_USER, pass: process.env.ZAP_SMTP_PASSWORD },
});

await transport.sendMail({
  from: 'Acme <hello@acme.com>',
  to: 'delivered@simulator.zapsmtp.com',
  subject: 'Hello over SMTP',
  html: '<p>It works.</p>',
});
```

Python:

```python
import os
import smtplib
from email.message import EmailMessage

msg = EmailMessage()
msg["From"] = "Acme <hello@acme.com>"
msg["To"] = "delivered@simulator.zapsmtp.com"
msg["Subject"] = "Hello over SMTP"
msg.set_content("It works.")

with smtplib.SMTP("mail.zapsmtp.com", 587) as smtp:
    smtp.starttls()
    smtp.login(os.environ["ZAP_SMTP_USER"], os.environ["ZAP_SMTP_PASSWORD"])
    smtp.send_message(msg)
```

PHP:

```php
<?php
use PHPMailer\PHPMailer\PHPMailer;

$mail = new PHPMailer(true);
$mail->isSMTP();
$mail->Host = 'mail.zapsmtp.com';
$mail->Port = 587;
$mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
$mail->SMTPAuth = true;
$mail->Username = getenv('ZAP_SMTP_USER');
$mail->Password = getenv('ZAP_SMTP_PASSWORD');

$mail->setFrom('hello@acme.com', 'Acme');
$mail->addAddress('delivered@simulator.zapsmtp.com');
$mail->Subject = 'Hello over SMTP';
$mail->Body = 'It works.';
$mail->send();
```

Go:

```go
package main

import (
	"net/smtp"
	"os"
)

func main() {
	auth := smtp.PlainAuth("", os.Getenv("ZAP_SMTP_USER"), os.Getenv("ZAP_SMTP_PASSWORD"), "mail.zapsmtp.com")
	msg := []byte("From: Acme <hello@acme.com>\r\n" +
		"To: delivered@simulator.zapsmtp.com\r\n" +
		"Subject: Hello over SMTP\r\n\r\nIt works.\r\n")
	// net/smtp upgrades to TLS with STARTTLS before authenticating
	err := smtp.SendMail("mail.zapsmtp.com:587", auth, "hello@acme.com",
		[]string{"delivered@simulator.zapsmtp.com"}, msg)
	if err != nil {
		panic(err)
	}
}
```

Ruby:

```ruby
require 'net/smtp'

msg = <<~MAIL
  From: Acme <hello@acme.com>
  To: delivered@simulator.zapsmtp.com
  Subject: Hello over SMTP

  It works.
MAIL

Net::SMTP.start('mail.zapsmtp.com', 587, starttls: :always,
                user: ENV.fetch('ZAP_SMTP_USER'), secret: ENV.fetch('ZAP_SMTP_PASSWORD'),
                authtype: :plain) do |smtp|
  smtp.send_message(msg, 'hello@acme.com', 'delivered@simulator.zapsmtp.com')
end
```

Laravel:

```
MAIL_MAILER=smtp
MAIL_HOST=mail.zapsmtp.com
MAIL_PORT=587
MAIL_ENCRYPTION=tls
MAIL_USERNAME=smtp_xxxxxxxxxxxx
MAIL_PASSWORD="your SMTP credential password"
MAIL_FROM_ADDRESS=hello@acme.com
```

Django:

```
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = "mail.zapsmtp.com"
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.environ["ZAP_SMTP_USER"]
EMAIL_HOST_PASSWORD = os.environ["ZAP_SMTP_PASSWORD"]
```

swaks:

```
swaks --server mail.zapsmtp.com:587 --tls \
  --auth-user "$ZAP_SMTP_USER" --auth-password "$ZAP_SMTP_PASSWORD" \
  --from hello@acme.com --to delivered@simulator.zapsmtp.com \
  --header "Subject: Hello over SMTP" --body "It works."
```

## Reply codes

`250` after `DATA` means the message was accepted, not delivered; delivery results arrive as [webhook events](https://zapsmtp.com/docs/webhook-events/). A `4xx` reply is temporary: your mailer keeps the message and retries. A `5xx` reply is permanent: retrying the same message fails the same way.

**SMTP replies**

- **`550 5.6.0` (permanent)**: The message failed validation (for example an unparsable From, a bad header or attachment); the reply says what.
- **`550 5.7.1` (permanent)**: The account is on the Free plan or a promo plan, which send through the Email API only (`SMTP relay is not included in this plan`); the From domain is not verified; the credential or key is restricted to another domain or to another stream, or the account is suspended.
- **`550 5.1.1` (permanent)**: Every recipient is on your suppression list: nothing is sent.
- **`535 5.7.8` (permanent)**: Authentication failed, or the credential was revoked or expired after you logged in (`Credentials no longer valid`).
- **`451 4.7.0` (temporary)**: Over your per-second rate limit.
- **`452 4.2.2` (temporary)**: Monthly or daily quota reached, or (rarely) the shared IP pool’s warm-up limit for the day; the reply text says which. The mailer keeps retrying; a quota resets or your plan changes, the warm-up limit resets at 00:00 UTC.
- **`452 4.5.3` (temporary)**: More than 50 recipients in one message. The extra recipients are refused; send them in another message.
- **`451 4.3.1` (temporary)**: Server busy: too many large messages in flight.
- **`451 4.3.0` (temporary)**: Overloaded, the MTA is briefly unavailable, or an internal error. Retry shortly.
- **`454 4.7.0` (temporary)**: Too many failed logins from your IP (20 in 10 minutes), a temporary authentication failure, or `Account moved`: your account is served by another cell, named with its URL in the reply. Point the mailer at that host.
