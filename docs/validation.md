# Email validation API

> Check addresses before you send: domain, mail servers, throw-away and role addresses, typos and earlier bounces.

Source: https://zapsmtp.com/docs/validation/

A validation never sends anything to the address. It checks the syntax, the domain and its mail servers, throw-away mailbox services, role addresses (info@, support@), likely typos, your suppression list and hard bounces on ZapSMTP in the last 180 days, and returns `deliverable`, `risky`, `undeliverable` or `unknown` with the reasons.

- [Validate an address](https://zapsmtp.com/docs/validation/validate-email/): POST
- [Validate up to 100 addresses](https://zapsmtp.com/docs/validation/validate-emails/): POST
