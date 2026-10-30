# API keys & SMTP credentials API

> Create and revoke API keys and per-application SMTP credentials.

Source: https://zapsmtp.com/docs/keys/

Use separate keys per application and environment. Test keys (`zap_test_…`) run the full pipeline without delivering. SMTP credentials have their own username and password and never authorize the HTTP API.

- [List API keys](https://zapsmtp.com/docs/keys/list-api-keys/): GET
- [Create an API key](https://zapsmtp.com/docs/keys/create-api-key/): POST
- [Update an API key](https://zapsmtp.com/docs/keys/update-api-key/): PATCH
- [Revoke an API key](https://zapsmtp.com/docs/keys/revoke-api-key/): DELETE
- [List SMTP credentials](https://zapsmtp.com/docs/keys/list-smtp-credentials/): GET
- [Create SMTP credentials](https://zapsmtp.com/docs/keys/create-smtp-credential/): POST
- [Revoke SMTP credentials](https://zapsmtp.com/docs/keys/revoke-smtp-credential/): DELETE
