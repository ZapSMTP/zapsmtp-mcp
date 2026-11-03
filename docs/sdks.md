# SDKs and OpenAPI

> Official ZapSMTP libraries for Node.js, Python, PHP, Laravel, Go, Ruby, Java and .NET, and the OpenAPI 3.1 description of the whole API.

Source: https://zapsmtp.com/docs/sdks/

Official libraries for seven languages, Laravel and Rails. Every one covers the whole API and behaves the same way: it retries safely, walks every page of a list, raises typed errors and verifies webhook signatures.

> The packages are being published to their registries. Until they are, every example in the [API reference](https://zapsmtp.com/docs/) calls the HTTP API directly, and the [OpenAPI description](https://zapsmtp.com/openapi.json) is available now.

## Libraries

### Node.js

`npm install zapsmtp`

TypeScript types for every request and response; ESM and CommonJS; no dependencies.

Node.js 18+, Bun, Deno

### Python

`pip install zapsmtp`

Sync and async clients, typed models, httpx underneath.

Python 3.9+

### PHP

`composer require zapsmtp/zapsmtp-php`

PSR-18 HTTP client, Guzzle by default; typed models with array access.

PHP 8.1+

### Laravel

`composer require zapsmtp/zapsmtp-laravel`

A mail transport for your Mailables, a facade for the API and verified webhook events.

Laravel 12.60+, 13

### Go

`go get github.com/zapsmtp/zapsmtp-go`

Standard library only; context on every call; range over every page.

Go 1.23+

### Ruby

`gem install zapsmtp`

Standard library only; an ActionMailer delivery method for Rails.

Ruby 3.0+

### Java

`implementation("com.zapsmtp:zapsmtp-java:0.1.6")`

Builders for every request, immutable models, java.net.http underneath.

Java 11+

### .NET

`dotnet add package ZapSMTP`

Async API with cancellation, dependency injection, IAsyncEnumerable paging.

.NET 8, .NET Standard 2.0

## Send your first email

Create a test key in the dashboard (`zap_test_…`) and put it in `ZAP_API_KEY`. Test keys deliver nothing, and the simulator address acts out a delivery.

**Send an email**

Node.js:

```javascript
import { ZapSMTP } from 'zapsmtp';

const zap = new ZapSMTP(); // reads ZAP_API_KEY

const { id } = await zap.emails.send({
  from: 'Acme <hello@acme.com>',
  to: 'delivered@simulator.zapsmtp.com',
  subject: 'Hello from ZapSMTP',
  html: '<p>It works.</p>',
});
console.log(id);
```

Python:

```python
from zapsmtp import ZapSMTP

zap = ZapSMTP()  # reads ZAP_API_KEY

email = zap.emails.send(
    from_="Acme <hello@acme.com>",  # from is a Python keyword
    to="delivered@simulator.zapsmtp.com",
    subject="Hello from ZapSMTP",
    html="<p>It works.</p>",
)
print(email.id)
```

PHP:

```php
<?php
require 'vendor/autoload.php';

$zap = new \ZapSMTP\Client(); // reads ZAP_API_KEY

$email = $zap->emails->send([
    'from' => 'Acme <hello@acme.com>',
    'to' => 'delivered@simulator.zapsmtp.com',
    'subject' => 'Hello from ZapSMTP',
    'html' => '<p>It works.</p>',
]);
echo $email->id;
```

Go:

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/zapsmtp/zapsmtp-go"
)

func main() {
	client := zapsmtp.NewClient("") // "" reads ZAP_API_KEY
	email, err := client.Emails.Send(context.Background(), &zapsmtp.SendEmailParams{
		From:    zapsmtp.String("Acme <hello@acme.com>"),
		To:      []string{"delivered@simulator.zapsmtp.com"},
		Subject: zapsmtp.String("Hello from ZapSMTP"),
		HTML:    zapsmtp.String("<p>It works.</p>"),
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(email.ID)
}
```

Ruby:

```ruby
require "zapsmtp"

zap = ZapSMTP::Client.new # reads ZAP_API_KEY

email = zap.emails.send(
  from: "Acme <hello@acme.com>",
  to: "delivered@simulator.zapsmtp.com",
  subject: "Hello from ZapSMTP",
  html: "<p>It works.</p>"
)
puts email.id
```

Java:

```java
import com.zapsmtp.ZapSMTP;
import com.zapsmtp.params.SendEmailParams;

ZapSMTP zap = ZapSMTP.fromEnv(); // reads ZAP_API_KEY

var email = zap.emails().send(SendEmailParams.builder()
    .from("Acme <hello@acme.com>")
    .to("delivered@simulator.zapsmtp.com")
    .subject("Hello from ZapSMTP")
    .html("<p>It works.</p>")
    .build());
System.out.println(email.getId());
```

.NET:

```csharp
using ZapSMTP;

var zap = new ZapSMTPClient(); // reads ZAP_API_KEY

var email = await zap.Emails.SendAsync(new SendEmailParams
{
    From = "Acme <hello@acme.com>",
    To = new[] { "delivered@simulator.zapsmtp.com" },
    Subject = "Hello from ZapSMTP",
    Html = "<p>It works.</p>",
});
Console.WriteLine(email.Id);
```

## What every SDK does

- **The whole API.** Every endpoint in the reference, with types for its parameters and response. The libraries are generated from the same description as these pages, so a new endpoint reaches every language at once.
- **Safe retries.** Rate limits (`429`, except quota and reply-limit errors), `408`, `500`, `502`, `503`, `504` and lost connections are retried twice by default, waiting as `Retry-After` says or backing off exponentially. Sends always carry an `Idempotency-Key`, so a retried send never goes out twice; pass your own key to tie a send to your order or event.
- **Every page.** List methods return one page; each SDK can also iterate every item of every page.
- **Typed errors.** Authentication, permission, not found, conflict, validation, rate limit, server and connection errors are separate classes carrying the status, the error `code` and the request id (in Go one `*zapsmtp.Error` with `errors.As` and helpers such as `IsRateLimit`). See [Errors, limits & paging](https://zapsmtp.com/docs/conventions/).
- **Webhook verification.** One call checks the `Zap-Signature` header in constant time, rejects signatures older than five minutes and accepts both secrets during a rotation.
- **Configuration.** The key comes from `ZAP_API_KEY` and the base URL from `ZAP_BASE_URL` when not passed in code. Timeouts, retries and extra headers can be set per client or per request.

## Verify a webhook

Pass the body exactly as it arrived, before parsing it. The call returns the event or throws. The payloads are described in [Webhook events](https://zapsmtp.com/docs/webhook-events/).

**Verify the signature**

Node.js:

```javascript
import { verifyWebhook } from 'zapsmtp';

// the raw body, before any JSON parsing
const event = verifyWebhook(rawBody, req.headers, process.env.ZAP_WEBHOOK_SECRET);
```

Python:

```python
import os
from zapsmtp import verify_webhook

event = verify_webhook(request.get_data(), request.headers, os.environ["ZAP_WEBHOOK_SECRET"])
```

PHP:

```php
$event = \ZapSMTP\Webhook::verify(
    file_get_contents('php://input'),
    getallheaders(),
    getenv('ZAP_WEBHOOK_SECRET'),
);
```

Go:

```go
body, _ := io.ReadAll(r.Body)
event, err := zapsmtp.VerifyWebhook(body, r.Header.Get("Zap-Signature"), os.Getenv("ZAP_WEBHOOK_SECRET"))
```

Ruby:

```ruby
event = ZapSMTP::Webhook.verify(request.raw_post, request.headers, ENV.fetch("ZAP_WEBHOOK_SECRET"))
```

Java:

```java
import com.zapsmtp.WebhookEvent;
import com.zapsmtp.Webhooks;

WebhookEvent event = Webhooks.verify(rawBody, headers, System.getenv("ZAP_WEBHOOK_SECRET"));
```

.NET:

```csharp
var body = await new StreamReader(Request.Body).ReadToEndAsync();
var evt = Webhooks.Verify(body, Request.Headers["Zap-Signature"].ToString(),
    Environment.GetEnvironmentVariable("ZAP_WEBHOOK_SECRET"));
```

## Laravel and Rails

**Laravel.** Set `MAIL_MAILER=zapsmtp` and your Mailables go through the API: attachments, inline images, tags and metadata included. The package also gives a `ZapSMTP` facade for the whole API and a webhook route that checks signatures and fires Laravel events.

**Rails.** Set `config.action_mailer.delivery_method = :zapsmtp` and Action Mailer sends through the API. Pass tags, metadata or a template with `mail(zapsmtp: { tags: [...] })`. The gem includes a Rack middleware that verifies webhooks.

## OpenAPI

The whole API as an [OpenAPI 3.1 description](https://zapsmtp.com/openapi.json): every operation with its parameters, request and response schemas and documented errors. Import it into Postman or Insomnia, or generate a client for a language without an SDK (Rust, Elixir, Dart, Swift) with [OpenAPI Generator](https://openapi-generator.tech). Each operation's `x-sdk-method` names the SDK method that calls it.

## Other clients

Any SMTP library works too: [SMTP relay](https://zapsmtp.com/docs/smtp/). Moving from another provider: [Migrating to ZapSMTP](https://zapsmtp.com/docs/migration/).
