# Received emails API

> Read inbound email: bodies, headers, authentication results and attachments.

Source: https://zapsmtp.com/docs/receiving/

Messages sent to your inbound addresses land here. The `email.received` webhook carries metadata only; fetch bodies and attachments with these endpoints.

- [List received emails](https://zapsmtp.com/docs/receiving/list-received/): GET
- [Retrieve a received email](https://zapsmtp.com/docs/receiving/get-received/): GET
- [List attachments](https://zapsmtp.com/docs/receiving/list-received-attachments/): GET
- [Retrieve an attachment](https://zapsmtp.com/docs/receiving/get-received-attachment/): GET
- [Redeliver to webhooks](https://zapsmtp.com/docs/receiving/redeliver-received/): POST
- [Report spam / not spam](https://zapsmtp.com/docs/receiving/report-received-spam/): POST
- [Reply to a received email](https://zapsmtp.com/docs/receiving/reply-received/): POST
- [List conversations](https://zapsmtp.com/docs/receiving/list-threads/): GET
- [Retrieve a conversation](https://zapsmtp.com/docs/receiving/get-thread/): GET
- [Mark read, set metadata](https://zapsmtp.com/docs/receiving/update-thread/): PATCH
- [Delete a received email](https://zapsmtp.com/docs/receiving/delete-received/): DELETE
