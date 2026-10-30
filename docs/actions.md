# Click actions API

> Named buttons and links: tell clicks apart, describe them and see their activity.

Source: https://zapsmtp.com/docs/actions/

Mark a link with `data-zap-action="confirm_order"` and its clicks arrive as `email.clicked` with `click.action`; a webhook can take only the actions you list in `filter.actions`. Declaring an action here is optional: it gives it a description. The catalogue also lists the actions links used without one. See the [Click actions guide](https://zapsmtp.com/docs/click-actions/).

- [List actions](https://zapsmtp.com/docs/actions/list-actions/): GET
- [Declare an action](https://zapsmtp.com/docs/actions/create-action/): POST
- [Retrieve an action](https://zapsmtp.com/docs/actions/get-action/): GET
- [Describe an action](https://zapsmtp.com/docs/actions/update-action/): PATCH
- [Delete an action](https://zapsmtp.com/docs/actions/delete-action/): DELETE
