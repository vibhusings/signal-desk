# Single-tester public pilot

This mode keeps one isolated tester workspace on a publicly reachable ChatGPT
Site. The access-code session replaces ChatGPT login, while the cloud runner
continues to perform background work.

## Site configuration

Configure these Site secrets before publishing:

- `PILOT_ACCESS_CODE_SHA256`: lowercase SHA-256 of a high-entropy access code
- `PILOT_SESSION_SECRET`: at least 32 random bytes, encoded as hex or base64

Set the Site audience to **Anyone on the internet**. The application still
requires the access code before exposing workspace data or controls. Do not use
a memorable password; generate at least 16 random bytes.

The tester enters their Anthropic API key in Settings. Web Crypto encrypts it
with the runner's RSA-OAEP public key. D1 stores only the ciphertext. The runner
private key is generated at `.runtime/bridge/byok-private.pem` with mode `0600`,
and the decrypted API key remains in runner memory.

## Runner cutover

Keep `RUNNER_SEND_ENABLED=0` throughout setup.

1. Stop the runner.
2. Archive the operator's `.runtime/bridge/state.json` and `.runtime/replies`.
3. Start the tester with empty bridge and reply state.
4. Set `RUNNER_BYOK_REQUIRED=1` in `/etc/signal-desk/runner.env`.
5. Disconnect the operator's Google inbox from Slashy and connect the tester's
   inbox. Avoid leaving both connected: Slashy MCP can access every connected
   inbox and calendar.
6. Update `SENDER_INBOX` and `SENDER_NAME` for the tester.
7. Apply the Site database migration and publish the Site.
8. Start the runner and have the tester enter the access code and Claude key.
9. Verify a read-only signal scan.
10. Send only to the tester's own inbox during the controlled email test.

Only enable sending after the tester confirms the sender inbox, calendar,
read-only scan, and self-addressed delivery.

## Restoring the operator workspace

Stop the runner, restore the archived bridge and reply state, reconnect the
operator's Slashy inbox, restore sender settings, and disable pilot mode by
removing the two Site pilot secrets. Never merge tester and operator reply
state.
