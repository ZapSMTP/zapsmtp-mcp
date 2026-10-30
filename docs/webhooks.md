# Webhooks API

> Receive signed delivery events, inspect attempts, replay and rotate secrets.

Source: https://zapsmtp.com/docs/webhooks/

Register an HTTPS endpoint and choose events. Every request is signed; see [Webhook events](https://zapsmtp.com/docs/webhook-events/) for payloads and signature verification. `filter.actions` narrows `email.clicked` to some [click actions](https://zapsmtp.com/docs/click-actions/).

- [List webhooks](https://zapsmtp.com/docs/webhooks/list-webhooks/): GET
- [Create a webhook](https://zapsmtp.com/docs/webhooks/create-webhook/): POST
- [Retrieve a webhook](https://zapsmtp.com/docs/webhooks/get-webhook/): GET
- [Update a webhook](https://zapsmtp.com/docs/webhooks/update-webhook/): PATCH
- [Send a test event](https://zapsmtp.com/docs/webhooks/test-webhook/): POST
- [List delivery attempts](https://zapsmtp.com/docs/webhooks/webhook-deliveries/): GET
- [List events](https://zapsmtp.com/docs/webhooks/list-webhook-events/): GET
- [Retrieve an event](https://zapsmtp.com/docs/webhooks/get-webhook-event/): GET
- [Replay an event](https://zapsmtp.com/docs/webhooks/replay-event/): POST
- [Rotate the signing secret](https://zapsmtp.com/docs/webhooks/rotate-secret/): POST
- [Delete a webhook](https://zapsmtp.com/docs/webhooks/delete-webhook/): DELETE
