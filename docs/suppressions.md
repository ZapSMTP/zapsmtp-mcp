# Suppressions API

> Addresses ZapSMTP will not send to: hard bounces, complaints, unsubscribes.

Source: https://zapsmtp.com/docs/suppressions/

Permanent mailbox or domain failures, complaints and one-click unsubscribes add an address here automatically. Sends to a suppressed address are skipped and reported as `email.suppressed`. An unsubscribe stops only broadcast email; transactional email to that address still goes out.

- [List suppressions](https://zapsmtp.com/docs/suppressions/list-suppressions/): GET
- [Retrieve a suppression](https://zapsmtp.com/docs/suppressions/get-suppression/): GET
- [Add a suppression](https://zapsmtp.com/docs/suppressions/add-suppression/): POST
- [Add suppressions in bulk](https://zapsmtp.com/docs/suppressions/add-suppressions/): POST
- [Remove suppressions in bulk](https://zapsmtp.com/docs/suppressions/remove-suppressions/): POST
- [Remove a suppression](https://zapsmtp.com/docs/suppressions/delete-suppression/): DELETE
