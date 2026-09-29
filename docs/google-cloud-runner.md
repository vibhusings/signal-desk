# Google Cloud runner

The hosted Signal Desk UI talks to one trusted background runner, installed as the
`signal-desk-runner.service` systemd unit. This page covers moving an existing runner to a
Google Cloud VM; for a new install follow [SETUP.md](../SETUP.md).

## Safety state during migration

- Keep the Mac LaunchAgent running until the cloud checks pass.
- Keep the cloud service disabled and stopped while the Mac runner is active.
- Keep `RUNNER_SEND_ENABLED=0` in `/etc/signal-desk/runner.env` during cutover.
- The disabled cloud runner will advertise `sending: false` and reject launch
  jobs. Scheduled outreach also remains off.
- Never run both bridge processes at the same time. They share a runner key and
  could otherwise race to claim the same work.

## Pre-cutover checks

Run on the VM:

```bash
cd ~/signal-desk
npm test
npm run build
claude mcp list
sudo systemctl is-active signal-desk-runner.service
```

`slashy` must report `Connected`, and a read-only collector smoke test must
return tool results instead of an authentication, subscription, or usage-limit
error. A connected OAuth session alone does not prove that the Slashy account
has active tool access.

## Cutover

1. Confirm the bridge state has no pending completion or in-progress request.
2. Stop the Mac LaunchAgent.
3. Copy `.runtime/bridge/state.json` and `.runtime/replies/` to the VM, preserving
   owner-only permissions. Copy the state only after the Mac process has stopped.
4. Start the VM service with sending still disabled:

   ```bash
   sudo systemctl enable --now signal-desk-runner.service
   sudo systemctl status signal-desk-runner.service
   sudo journalctl -u signal-desk-runner.service -n 100 --no-pager
   ```

5. Verify the hosted UI shows the runner online and a read-only signal scan
   completes.
6. Validate a single test recipient routed to the owner's inbox before changing
   `RUNNER_SEND_ENABLED` to `1` and restarting the service.

If any check fails, stop the cloud unit before restarting the Mac LaunchAgent.

## Updating code

Copy source without credentials, dependencies, or live state, then reinstall and
test before restarting the service:

```bash
npm ci
npm test
npm run build
sudo systemctl restart signal-desk-runner.service
```

Do not replace `.runtime` during a normal code update.
