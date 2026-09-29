# gtm-workflow

Using the hosted app? Start with the [Signal Desk setup and user guide](docs/signal-desk-user-guide.md),
including the new-user checklist, every workspace tab, Signals, outreach, meetings,
inbox CRM, Granola, Attio, and troubleshooting. The terminal instructions below
describe the underlying workflow; new pilot users do not need to install it locally.

Deterministic outreach scheduler. **Attio is the state machine; the LLM only writes copy.**

Apollo's MCP and Slashy's agent reminders are both chat-scoped — close the window and
nothing happens. That is why follow-ups went silent after two weeks and why re-triggering
them by hand fired ~200 emails at once. So the schedule does not live in an agent: it lives
in Attio fields, and a cron job reads them, caps the batch, and writes back immediately.

## Try it now, without credentials

```bash
npm install
npm run demo     # in-memory store, no network
npm test         # scheduler, sourcing, and raw send-evidence checks
```

## Real run

1. Create the Attio attributes — `docs/attio-setup.md`
2. `cp config/.env.example .env` and fill in `ATTIO_API_KEY`
3. Auth for the send leg — prefer your subscription over pay-per-token:
   ```bash
   claude setup-token   # needs Pro/Max/Team/Enterprise; prints a 1-year token
   ```
   Put the printed value in `.env` as `CLAUDE_CODE_OAUTH_TOKEN`. No subscription?
   Set `ANTHROPIC_API_KEY` instead (pay-per-token; console.anthropic.com).
4. `bash scripts/phase0-spike.sh` — must pass before any real send
4. `npm run run:scheduler` with `DRY_RUN=1` (the default) and read the log
5. Set `DRY_RUN=0`, then `bash scripts/install-launchd.sh 300`

For an always-on Linux VM, use `deploy/signal-desk-runner.service` and
`scripts/install-systemd.sh`. Keep `RUNNER_SEND_ENABLED=0` during migration. The
installer deliberately installs the service without starting it so the Mac and
cloud runners cannot claim the same work at the same time. Copy `.runtime` only
after stopping the old runner, then start the service with `systemctl`.

## Inbox threading test

Set `TEST_ONLY_RECORD_ID` and `TEST_RECIPIENT` to restrict sending to one Attio
record and its exact recipient. `TEST_INTERVALS_MINUTES=1,1,1` overrides the gaps
only while that restriction is enabled; keep `INTERVALS_MINUTES=4320,5760,10080`
for normal outreach. The record must be active, due, and have the verified Gmail
`thread_id` before testing follow-ups in an existing conversation.

The sender logs raw Slashy tool calls/results and accepts only a matched
`send_email` success response with a queued/sent/delivered status. Queued means
accepted by Slashy, not delivered to the inbox. In the September 10 test, Slashy
returned a 59-second undo delay and a temporary draft thread ID; the real Gmail
thread ID was obtained from sent-mail search after delivery. A failed final Claude
response does not override an already observed successful queue result.

For a short test, `bash scripts/install-launchd.sh 30` checks due records every
30 seconds; email gaps remain one minute. Actual arrival times also include
composition time and Slashy's delivery delay. Restore polling afterward with
`bash scripts/install-launchd.sh 300`. Remove the test environment settings only
when ready to allow other active records to send.

To keep a scraped address visible in Attio while safely routing the test message
to your own inbox, run:

```bash
npm run prepare:test -- --email=the-address-found@example.com --deliver-to=you@example.com --touches=1
npm run run:scheduler
npm run show:record -- <record-id-printed-by-prepare>
```

The preparation command requires exactly one matching Attio record, resets that
record to stage 0, makes it due, and locks the scheduler to its record ID and stored
email. `TEST_DELIVERY_RECIPIENT` changes only the actual delivery address. With
`--touches=1`, the record stops after the first confirmed send. Use `--touches=4`
to demonstrate four messages one minute apart, all delivered to the safe inbox.
Test mode changes routing and cadence only; the subject and body still use the
real company context and the selected outreach sequence.
The next scheduler pass automatically resolves the delivered Gmail thread ID and
writes it to Attio, including for a stopped one-touch test. `npm run verify:test --
<record-id>` remains available only as an immediate diagnostic if you do not want
to wait for the next launchd pass.

## Sourcing: turning a document into candidate records

```bash
npm run ingest -- "/path/to/some-pitch-deck.pdf"              # dry run, no writes
npm run ingest -- "/path/to/some-pitch-deck.pdf" --write       # writes to Attio as `queued`
```

Parses a Plug & Play-style pitch deck table (company, one-liner, raised, country,
university — each name linked to the company's own site) into structured rows, looks
up a founder/CEO contact via Apollo's REST API (not the MCP — Apollo's MCP is
chat-scoped and can't run from a script), and upserts into Attio.

Everything lands as `sequence_status: queued`, **never `active`**, even when a real
contact was found — a human reviewing the list before anything can send is a
deliberate gate, matched to a real incident (see the blast-guard tests below). Flip
records to `active` in Attio's UI once you've looked at who's actually in the list.

## The guarantees

| Guarantee | Mechanism | Test |
|---|---|---|
| Never blasts a backlog | `BATCH_CAP` applied at the query; a store that ignores it aborts the run | `BLAST GUARD` ×2 |
| Never double-sends after a crash | `claimed_at` written before the send; `last_send_key` confirms after | `CRASH IDEMPOTENCY` ×2 |
| Ambiguous sends are parked, not gambled | stale claim + no confirmation → `needs_review` | `CRASH IDEMPOTENCY` |
| Stops on reply | only `active` records are ever selected | `REPLY STOP` |
| Cannot exceed max touches | ceiling checked before every send | `CEILING` |
| A stall is visible | heartbeat file + staleness warning on the next run | — |

## Cost

The send leg pins `claude-haiku-4-5` (`SEND_MODEL`). Composing a short email does not need
a frontier model, and the default would otherwise be ~5x the price.

## Terminal application-research demo

```bash
cd ~/gtm-workflow
npm run apply -- "Bree" --max=4
# After reviewing the addresses and sources:
npm run apply -- "Bree" --max=4 --write
```

The command uses the configured Claude CLI and Slashy connection to search the
company website, job boards, hiring announcements, and professional profiles. It
searches candidate addresses and scrapes promising source pages before guessing.
No Codex chat web tool or paid email-data API is required; the existing Claude and
Slashy account requirements still apply.

Research calls appear live in the terminal. Their raw responses are saved in the
printed `.spike/discovery-*.log` file. A published address must occur in a successful
scrape of the exact cited URL; search snippets and masked addresses are insufficient.
Published does not mean deliverable, and older job listings may be stale. Guesses
remain labeled. Research results vary between runs; `--write` performs fresh research
and upserts its results as queued records, without activating outreach.

## Replies and calendar availability

The scheduler now checks the outreach thread before allowing another follow-up.
A direct reply from the recipient stops the sequence in Attio (`replied`), and an
unsubscribe request marks it `unsubscribed`. Explicit scheduling/availability
requests book a verified available slot and receive confirmation in the same thread. Rejections,
auto-replies, and ambiguous text stay stopped for human review. This is conservative
phrase matching, not a general conversation agent. When a recipient supplies a
specific date or time window, the scheduler chooses the earliest free slot inside
that window, creates an opaque calendar event with the recipient as an attendee,
marks Attio `booked`, and confirms the invitation in the existing email thread.
Without a recipient window, it books the earliest available slot.
An upcoming confirmed event with the recipient as an accepted attendee also marks
the record booked.

Recipient windows such as “Tuesday afternoon,” “tomorrow at 3 PM,” and “Monday
between 2–4 PM ET” are parsed and intersected with the connected calendar before
a slot is booked. Relative dates use the reply timestamp. Explicit PT/MT/CT/ET/UTC abbreviations are honored. When a reply
omits a timezone, `MEETING_TIMEZONE` is assumed and the timezone is printed in the
response. If no slot fits the requested window and meeting policy, booking stops for manual
review. A date outside the seven-day calendar observation range also stops for
review. Calendar coverage checks include named weekdays and times; the scheduler
never substitutes a slot outside an explicit request or claims unobserved time is busy.

Configure `SENDER_INBOX` to the connected Slashy sender. Defaults: 30 minutes,
weekdays 9–17 America/Los_Angeles, at least 24 hours' notice. `MEETING_*` settings
in `config/.env.example` override these. All selected calendars are considered;
busy-event titles, descriptions, and attendees are never copied into outreach email.
The next seven days of complete event data are required, and the code computes
weekday/timezone-aware slots itself. Missing/truncated calendar or message data
holds follow-ups. Thread searches without a unique matching outbound message
also hold rather than guessing a conversation.

```bash
npm run check:replies   # live, read-only calendar + Attio + message check
npm test               # includes simulated reply/send/crash/calendar tests
```

Reply candidates are active/replied records and completed four-touch records with
a last touch within 30 days. `REPLY_BATCH_CAP` controls a rotating batch (default 3)
so queued contacts are never treated as replies and all candidates get a turn.
Due records outside the batch or with a check older than a minute are checked again before sending.
Polling latency includes Slashy/Claude call time. A reply arriving after the final
check can still race an already queued email; there is no instant push listener.

Attio records the stopped state; `.runtime/replies` holds per-message send claims
and a cursor. Preserve this directory across restarts and deployments. A send with
an unknown outcome or interrupted `sending` claim requires manual review and is
never resent automatically. Pending calendar failures retry after the sequence
has already stopped. `.runtime/reply-tools.log` contains private raw tool evidence.
A single-host process lock prevents overlapping manual and launchd scheduler runs;
multiple independent machines against the same Attio workspace are not supported.
Set `AUTO_AVAILABILITY=0` to stop sequences on reply without generating availability
responses. Use `DRY_RUN=1` to inspect without sending or mutating Attio.

Calendar titles use `Recipient <> Sender - Purpose`; configure the purpose with
`MEETING_PURPOSE`, whose default is `Discussing opportunities at {company}`.
