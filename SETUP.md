# Set up your own Signal Desk

This guide takes you from an empty account to a working Signal Desk: a private website where
you review startup signals and approve outreach, plus a background runner that researches
contacts, sends approved emails and follow-ups, books meetings from replies, and keeps your
CRM up to date.

Each install is one workspace for one person. If two people need Signal Desk, do this twice.

## How it fits together

```
 you ── browser ──▶  Website (Cloudflare Worker + D1 database)
                          ▲  jobs & status over HTTPS (/api/runner, shared runner key)
                          │
                     Runner (Linux VM, systemd) ──▶ Claude (research, drafts, extraction)
                                                 ──▶ Slashy (your Gmail + Google Calendar)
                                                 ──▶ Attio (outreach state + Investment CRM)
                                                 ──▶ Crustdata (optional company discovery)
```

The website never holds your mailbox or Attio credentials. The runner does all outbound work
and only acts on jobs the website queues.

## What you need

| Item | Notes |
|---|---|
| A Cloudflare account | Free plan works. You'll use `wrangler` (installed with the project). |
| A small Linux VM | e.g. Google Cloud `e2-small`, Debian/Ubuntu. Runs 24/7. |
| Node.js 22.13+ and git | On your laptop and on the VM. |
| A Slashy account | With the Gmail inbox you will send from and its Google Calendar connected in Slashy. |
| An Attio workspace | You need admin rights to create an API key and attributes. |
| Claude access | Either an Anthropic API key (entered in the website), or a Claude subscription signed in on the VM. |
| Crustdata API key | Optional; improves company discovery in Signals. |

## 1. Get the code

On your laptop:

```bash
git clone https://github.com/vibhusings/signal-desk.git
cd signal-desk
npm ci
npm test
(cd ui && npm run install:ci && npm run build && npm run test:signals)
```

All tests should pass before you continue.

## 2. Decide who sends

Pick the Gmail address that outreach will come from (the one connected to your Slashy
account) and the name to sign with. Set that Gmail account's display name to the same name
(Gmail → Settings → Accounts → Send mail as); recipients see it as the sender. Gmail adds your
signature to new emails automatically, so remove or shorten it if the drafts already sign off.

## 3. Create the website on Cloudflare

From the `ui/` folder:

```bash
cd ui
npx wrangler login
npx wrangler d1 create signal-desk
```

`d1 create` prints a `database_name` and `database_id`. Open `ui/wrangler.cloudflare.jsonc` and:

- set `"name"` to a name for your site (it becomes `https://<name>.<your-subdomain>.workers.dev`);
- replace `database_name` and `database_id` with the values just printed.

Create the database tables, then build and deploy:

```bash
for f in drizzle/*.sql; do
  npx wrangler d1 execute signal-desk --remote --config wrangler.cloudflare.jsonc --file "$f"
done
npm run build
npx wrangler deploy --config wrangler.cloudflare.jsonc
```

Note the `https://…workers.dev` address that `deploy` prints. The site loads, but nobody can
sign in yet. That is intentional until step 4.

## 4. Generate the secrets

From the repo root on your laptop:

```bash
node scripts/setup-secrets.mjs --url https://<name>.<your-subdomain>.workers.dev --push
```

This:

- creates your **access code** in `.runtime/pilot-access-code.txt` (you sign in with it);
- stores three secrets in the Cloudflare Worker: `OUTREACH_RUNNER_SECRET`,
  `PILOT_SESSION_SECRET`, `PILOT_ACCESS_CODE_SHA256` (only a hash of the access code is stored);
- writes `.runtime/bridge-config.json`, which the runner uses to reach the site.

Everything in `.runtime/` is git-ignored and owner-only. Never commit or share it. Without
`--push` the script prints the three `wrangler secret put` commands to run yourself. It refuses
to overwrite an existing setup unless you add `--force`.

Open the site and sign in with the access code to check it works.

## 5. Prepare Attio

1. In Attio, go to Workspace settings → Developers and create an API key with read and write
   access to records and object configuration. To import recorded meetings later, also allow
   reading meetings and call recordings.
2. Create the outreach fields on Companies and the Investment CRM object (run from the repo root;
   drop `--write` first to preview what would change):

   ```bash
   ATTIO_API_KEY=<key> npm run setup:attio -- --write
   CRM_ATTIO_API_KEY=<key> node --import tsx scripts/setup-investment-crm.ts --write
   ```

3. Optional: add the outreach attributes (`sequence_status`, `next_touch_at`, `review_note`, …)
   to a Companies view so you can watch campaigns in Attio. See `docs/attio-setup.md`.

## 6. Set up the runner VM

On the VM (as the user that will run the service):

```bash
# Node.js 22+ (NodeSource shown; any method works) and git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# The Claude Code CLI, which the runner uses for every AI step
sudo npm install -g @anthropic-ai/claude-code
command -v claude            # note this path for CLAUDE_BIN

git clone https://github.com/vibhusings/signal-desk.git
cd signal-desk
npm ci
npm test
mkdir -p .runtime && chmod 700 .runtime
```

Copy `.runtime/bridge-config.json` from your laptop to the same place on the VM (for example
with `scp` or `gcloud compute scp`), then `chmod 600 .runtime/bridge-config.json`.

Create the runner settings from the template and fill them in:

```bash
cp config/.env.example runner.env
nano runner.env
```

Required: `SENDER_INBOX`, `SENDER_NAME`, `ATTIO_API_KEY`, `CRM_ATTIO_API_KEY`,
`CRM_ATTIO_INBOX` (same as `SENDER_INBOX`), `CLAUDE_BIN`. Keep `RUNNER_SEND_ENABLED=0` and
`RUNNER_BYOK_REQUIRED=1` for now. Put comments on their own lines; text after a value is
treated as part of the value.

**Choose how Claude is paid for:**

- **API key (simplest):** leave `RUNNER_PERSONAL_TESTING=0`. You'll paste an Anthropic API key
  into the website in step 7.
- **Claude subscription:** set `RUNNER_PERSONAL_TESTING=1` and sign the CLI in as the service
  user with `claude auth login`. Usage counts against that subscription.

Install and start the service:

```bash
bash scripts/install-systemd.sh runner.env
rm runner.env                                   # the installed copy is root-only
sudo systemctl enable --now signal-desk-runner.service
sudo journalctl -u signal-desk-runner.service -n 20 --no-pager
```

You should see `Signal Desk outreach runner started`. Run only one runner per site; two
runners would claim the same jobs.

## 7. Connect your accounts in the website

Sign in, open **Settings**, and:

1. **Claude connection:** paste an Anthropic API key, or choose "Personal testing with Claude
   subscription" if you enabled it in step 6.
2. **Slashy:** click Connect and approve access with the Slashy account whose Gmail is your
   `SENDER_INBOX`. The connection is encrypted for your runner; the website cannot read it.
3. **Crustdata** (optional): paste your key and choose "Encrypt for runner".
4. **Résumé** (only for job-application outreach): upload a PDF and wait for "confirmed".
5. **Test delivery:** enter an address you own. Until you turn this off, every approved
   email and follow-up goes there instead of to the real contact, so you can safely reply
   and watch meetings get booked.

The Launch outreach page shows "Cloud runner connected" once the runner has checked in (within about 30 seconds).

## 8. First run, safely

1. **Signals:** open Investment criteria, describe your thesis, save, and click Scan now. The
   first scan takes about 5 minutes. You can enable recurring scans after it succeeds.
2. **Turn sending on for the test:** with Test delivery set, change `RUNNER_SEND_ENABLED=1` in
   `/etc/signal-desk/runner.env` and `sudo systemctl restart signal-desk-runner.service`.
3. **Shortlist** a signal. Contact research and first-email drafts appear under Pipeline →
   the company, usually within 2–5 minutes.
4. **Approve & send** one contact's draft. It arrives at your test address within about two
   minutes.
5. **Reply** from the test address with a weekday and time in the next seven days, e.g.
   "Tuesday at 2pm Pacific works." Within a few minutes you should get a calendar invite with
   a Google Meet link and a confirmation email, and the company moves to Meeting booked.
6. **CRM:** send a test email to your sender inbox mentioning a fund or a deal, then click
   CRM → Check inbox. It should appear under Contacts with its fund or deal. Click **Sync Attio now**
   under CRM → Capture & settings and check the Investment CRM object in Attio.

With test delivery on, approve only one contact per company, because every test email goes
to the same inbox. When you are ready for real outreach, turn Test delivery off.

## Updating

```bash
# runner VM
cd signal-desk && git pull && npm ci && npm test
sudo systemctl restart signal-desk-runner.service   # when no job is running

# laptop (website)
git pull && cd ui && npm run install:ci && npm run build
npx wrangler deploy --config wrangler.cloudflare.jsonc
```

If a release adds a file under `ui/drizzle/`, apply it with the `d1 execute` command from step 3.

## Troubleshooting

| Symptom | Check |
|---|---|
| Runner shows offline | `sudo systemctl status signal-desk-runner`; `journalctl -u signal-desk-runner`. A "Missing .runtime/bridge-config.json" error means step 6's copy was skipped. |
| Site accepts no access code | The three Worker secrets from step 4 are missing: `npx wrangler secret list --config wrangler.cloudflare.jsonc`. |
| "Email sending is turned off" | `RUNNER_SEND_ENABLED` is 0, or the runner wasn't restarted after changing it. |
| Sending halted after failures | The kill switch trips after three failed scheduler passes. Fix the cause shown in Launch outreach, then Resume sending there. |
| CRM export disabled | `CRM_ATTIO_INBOX` must equal `SENDER_INBOX`, and `CRM_ATTIO_API_KEY` must be set. |
| Numbers in settings ignored | Keep comments on their own lines in `runner.env`. |

Deeper references: `docs/signal-desk-user-guide.md` (day-to-day use), `docs/attio-setup.md`,
`docs/vc-crm.md` (CRM design), `docs/crustdata.md`, `docs/google-cloud-runner.md` (moving an
existing runner between machines).
