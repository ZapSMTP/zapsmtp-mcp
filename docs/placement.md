# Inbox placement API

> See whether a message lands in the inbox, a Gmail tab or spam at Gmail, Outlook, Yahoo and others.

Source: https://zapsmtp.com/docs/placement/

A placement test sends your message to seed mailboxes at the big providers (or hands you their addresses to send to yourself) and reads each one to see where the copy landed, with the provider’s own SPF, DKIM and DMARC verdict.

- [Start a placement test](https://zapsmtp.com/docs/placement/create-placement-test/): POST
- [List placement tests](https://zapsmtp.com/docs/placement/list-placement-tests/): GET
- [Retrieve a placement test](https://zapsmtp.com/docs/placement/get-placement-test/): GET
