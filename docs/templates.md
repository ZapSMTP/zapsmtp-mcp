# Templates API

> Store email templates with Mustache variables and render previews.

Source: https://zapsmtp.com/docs/templates/

Edit a draft, then publish it: sends always use the published version, so changes go live only when you say so. Templates use logic-less Mustache: `{{name}}` is escaped, `{{{html}}}` is raw, sections repeat over lists. Send with `template: {id, variables}` on [Send an email](https://zapsmtp.com/docs/emails/send-email/); `variable_schema` declares each variable’s type, whether a send must give it and its default (see [Variables](https://zapsmtp.com/docs/templating/#variables)). Every save is kept in the version history (the newest 50), ready to restore.

- [List templates](https://zapsmtp.com/docs/templates/list-templates/): GET
- [Create a template](https://zapsmtp.com/docs/templates/create-template/): POST
- [Retrieve a template](https://zapsmtp.com/docs/templates/get-template/): GET
- [Update a template](https://zapsmtp.com/docs/templates/update-template/): PATCH
- [Publish a template](https://zapsmtp.com/docs/templates/publish-template/): POST
- [Duplicate a template](https://zapsmtp.com/docs/templates/duplicate-template/): POST
- [Render a template](https://zapsmtp.com/docs/templates/render-template/): POST
- [Render unsaved source](https://zapsmtp.com/docs/templates/render-source/): POST
- [List versions](https://zapsmtp.com/docs/templates/list-template-versions/): GET
- [Retrieve a version](https://zapsmtp.com/docs/templates/get-template-version/): GET
- [Restore a version](https://zapsmtp.com/docs/templates/restore-template-version/): POST
- [Delete a template](https://zapsmtp.com/docs/templates/delete-template/): DELETE
