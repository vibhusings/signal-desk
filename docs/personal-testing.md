# Personal subscription testing

An administrator enables `RUNNER_PERSONAL_TESTING=1` on the worker. Sign in as the
same operating-system user that runs the service with `claude auth login`.
Complete Anthropic's own browser authorization. Do not paste OAuth tokens into
Signal Desk. `claude auth status --json` must report a Claude account subscription.

Open Settings → Claude connection → Claude mode and select Personal testing with
Claude subscription. Refresh connection after the current job finishes. The saved
API key is retained for switching back, but is not passed to subscription jobs.
This mode covers research, contact discovery, email/calendar tools and CRM
extraction. Slashy still needs its own connection, and Crustdata credits are separate.

This is one shared pilot: the mode applies to every job, including existing
scheduled work. Use the mode only for the signed-in subscriber's own testing.
Subscription limits or an expired login stop jobs; there is no API fallback.
Switch back to Anthropic API key when personal testing is complete.

Signing in on your Mac does not sign in the cloud worker. The cloud service uses
`/home/vibhusingh` as its home. Run the login there as `vibhusingh`, not root.
The worker checks login status approximately every 30 seconds when idle.

The switch does not change the sender, recipients, campaign approvals, calendar,
or Attio destination. It does not send a test message automatically.
