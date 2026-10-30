# Variables API

> The variable catalogue and the account’s global variables ({{global.key}}).

Source: https://zapsmtp.com/docs/variables/

One list of every variable your templates can use: ZapSMTP’s own (`{{{zap:unsubscribe_url}}}`), the account’s global ones (`{{global.company_name}}`, set here and never by a send) and each template’s own, with where each is used. See [Variables](https://zapsmtp.com/docs/templating/#variables) in the templates guide.

- [List variables](https://zapsmtp.com/docs/variables/list-variables/): GET
- [Set a global variable](https://zapsmtp.com/docs/variables/put-global-variable/): PUT
- [Delete a global variable](https://zapsmtp.com/docs/variables/delete-global-variable/): DELETE
