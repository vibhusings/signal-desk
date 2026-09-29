# Investment CRM

For onboarding and everyday use of every tab, start with the
[complete Signal Desk user guide](signal-desk-user-guide.md). This document is the
technical CRM setup reference for the administrator.

The CRM tab adds an independent read/import pipeline. It never registers contacts
with the outreach scheduler or sends email. Existing send safeguards remain in force.

## Data model

- Contacts are keyed by email and collected from validated inbox message participants
  or supplied meeting participants. Sent mail and meetings count as touches; received
  mail alone does not. Confirm `VC friend` on a contact once; this is not inferred.
- Funds are named investment organizations extracted with verbatim supporting quotes.
  Contacts shown beside a fund are conversation participants, not verified employees.
- Deals are grouped by company name and round; unspecified rounds remain separate.
  Every update retains its source and date. Company-name matching is intentionally
  basic; two distinct same-named companies need a future identity-resolution step.
- Weekly views use Monday 00:00 UTC and show source activity, touched contacts and deal
  updates. AI summaries are interpretations. ARR, revenue, amounts and status remain
  unknown unless the source supports the extracted value. Source quotations are
  mechanically verified; their semantic interpretation still merits human review.

## Connect and enable

1. Add Claude API credentials and connect Slashy in the existing Settings screen.
2. CRM → Capture & settings: enter the runner's configured inbox, choose lookback
   (1–90 days), save, then Check inbox. Enable daily checks if wanted.
3. Use Attio Call Intelligence as the meeting recorder (Pro/Enterprise).
4. Follow the [Attio recording delivery setup](signal-desk-user-guide.md#8-connecting-attio-meeting-recordings):
   **Call recording created → Send HTTP request**, POST mapped JSON to
   `/api/crm/attio` with a generated bearer token. No Zapier is required.
5. Verify one delivery and extraction before enabling the workflow.

The token identifies the destination workspace. Only its SHA-256 digest is stored;
rotation invalidates earlier meeting tokens. Attio sources use `attio:` IDs and
`kind: attio`; historical Granola records remain readable, but the old delivery endpoint returns HTTP 410.
Import does not enable recording or authenticate a user's Attio account. Participant
emails must come from known contacts; missing emails may be represented by an empty
array and do not create contact touches. Full mapping, payload limits and testing
steps are in the guide.

## Attio destination

### Live setup verified September 24, 2026

The existing operator Attio workspace now contains `investment_crm` with all ten
required text attributes. The Google Cloud runner uses that verified workspace,
bound to `owner@example.com` as explicitly requested. Seven-day CRM sync is
enabled. The first cloud job succeeded with zero records because no conversations
have been imported. Next scheduled sync: October 1, 2026 at 21:31 UTC.
An actual connector write/readback passed; temporary contact and weekly test records
were removed afterward. Claude and Slashy were disconnected at verification time;
daily inbox import remains disabled. Attio recording delivery still requires its
provider-side workflow. No email sending was enabled by this setup.

Provision schema for a future workspace with
`node --import tsx scripts/setup-investment-crm.ts --write`; omit `--write` to inspect.
The script uses `CRM_ATTIO_API_KEY`, falling back to the existing `ATTIO_API_KEY`.

Use a dedicated custom Attio object (for example `investment_crm`) to avoid changing
outreach records. Configure these on the GCP runner, never in browser code:

- `CRM_ATTIO_API_KEY`: key for the intended CRM workspace
- `CRM_ATTIO_OBJECT`: custom object slug
- `CRM_ATTIO_INBOX`: must equal this pilot's sender inbox
- `CRM_MODEL`: optional Claude model override; default `claude-sonnet-4-6`

The custom object needs text attributes `external_id` (unique), `name`, `record_type`,
`crm_context`, `relationship`, `contact_email`, `deal_status`, `arr`, `revenue` and
`last_updated`. `crm_context` contains structured context and source history as JSON;
source text is private CRM content. This initial connector does not provision an
Attio schema or change permissions automatically. Create filtered Attio views for
`record_type=contact` and `relationship=VC friend`, `record_type=deal`, `vc_fund`,
and `weekly`. The UI shows linked friends on deals; those links also appear in JSON
context. These are not yet native Attio record-reference attributes.

After configuring the object and restarting the runner, enable seven-day sync in
CRM settings. `Sync Attio now` uses stable external IDs, so retries upsert rather
than duplicate. Documentation for the underlying API:
https://docs.attio.com/rest-api/endpoint-reference/records/upsert-a-record

## Operations and limits

Cloud runner claims CRM work using the existing authenticated bridge. Jobs are owner
scoped; uncompleted jobs are requeued after 30 minutes. Completion is idempotent.
A changed source invalidates its old extraction. Errors appear in import activity
and can be retried. Daily and weekly scheduling is evaluated by the always-on VM;
it does not require the Mac. Missed intervals enqueue once after the VM recovers.

Inbox scans are bounded to 25 threads, 100 messages and approximately 550 KB; long
messages are excerpted to 16,000 characters. Any truncation, missing pagination
confirmation or unreadable thread marks the scan partial. A narrowed lookback is
needed for busy inboxes; this initial collector does not claim full historical
mailbox coverage or use an advancing incremental cursor. Outlook is not supported
by this Gmail-shaped Slashy adapter. UI/export reads at most 2,000 sources and refuses
an Attio sync when that bound is reached. No raw data is logged by the new extractor;
the existing Slashy tool audit continues to record tool results locally.

Before enabling real imports, confirm the Slashy account matches the configured
inbox. The read adapter rejects mismatched returned inbox IDs; OAuth still lacks a
separate proactive mailbox identity check. Sending stays disabled during onboarding.

## Validation

- Root: `npm run test:crm`, `npm run build`, existing `npm test`
- UI: `npm run test:crm`, `npm run test:signals`, `npx tsc --noEmit`, `npm run build`
- Fake tests verify mailbox isolation, no writes/sends in collection, quote grounding,
  duplicate deliveries, authorization/CSRF, owner isolation, scheduling, partial
  coverage, retries, week boundaries, and stable Attio upserts.
- Live Claude/Slashy/Granola/Attio integration tests require the user's connections.

Migration: `ui/drizzle/0006_superb_zarek.sql`. Runtime initialization uses the same
idempotent table definitions for pilots without D1 migration privileges.

## Deployment verification — September 21, 2026

Cloudflare version `66a6a606-d1b1-4408-b621-76fd4278b4c3` includes the CRM screen,
connection status, Granola intake, and the dedicated VC-friend deal view. GCP source
and dependencies were updated; the CRM tests and TypeScript build passed on the VM.
The restarted runner advertises `crm=true`, `sending=false`, `crmAttio=false`.
Live CRM API returned 200 for the authenticated pilot and 401 without authentication.
Claude and Slashy are still unconfigured. CRM settings, imports and jobs are empty.
No real inbox, Granola, or Attio end-to-end run has taken place yet.
A pre-update runner/package backup is at `/tmp/signal-desk-pre-crm-20260921.tgz` on GCP.

## Outreach enablement — September 24, 2026

At the user's request, the pilot owner's cloud runner is enabled for sending without a live
email/calendar test. BYOK remains required; launch and scheduled sending require
both the Claude credential and Slashy connection. No active registered recipients
or pending outreach jobs existed at enablement. The inherited resume attachment
was cleared; job-application launches are held until the owner's resume is configured.
Investment outreach from Signals needs no resume. This does not configure Attio
recording delivery. Sender is the pilot owner, owner@example.com; existing calendar
policy is America/Los_Angeles, weekdays 09:00–17:00, 30 minutes, two hours' notice.

## Regression and live Attio verification — September 24, 2026

- Full root regression suite passed, including 14 scheduler checks, 33 reply/calendar
  checks, duplicate/crash protection, recipient scope, and send guardrails.
- UI CRM, Signals, credential and Slashy API suites passed.
- `scripts/verify-live-attio-followups.ts --write-test` exercised the real Attio store
  through four simulated touches with 3/4/7-day gaps, status/stage/readback, immediate
  duplicate prevention and reply-stop. No email sender or calendar write was called.
- `scripts/verify-live-crm-sync.ts --write-test` verified real Attio writes and reads
  for contacts, VC friendship, funds, deals, ARR and weekly summaries. A second sync
  updated the same record IDs and changed deal status without duplicates.
- All temporary external test records were deleted. Tests use a simulated sender
  or synthetic CRM fixtures and do not register recipients with the cloud runner.
- Live weekly job remains successful, next due October 1 at 21:31 UTC. No real CRM
  conversations have been imported; Claude and Slashy remain disconnected. These
  checks do not verify the owner's mailbox permissions, actual email delivery, model
  access, or calendar writes. Those require his connections and an end-to-end test.


## Job applications (including Tsenta confirmations)

Open CRM → Applications. Save the connected inbox in Capture & settings, select a lookback, then Check inbox. Daily inbox checks also collect application updates. Existing messages within the next scan are re-extracted with the application schema. The bounded inbox scan may be partial; inspect Import & sync activity.

The agent extracts explicit firm, role, application reference/link, date applied, deadline, next step and status (Applied, Interview, Offer, Rejected, Withdrawn). Unknown fields remain unknown, and each fact retains a supporting excerpt. Original messages and chronological status history are available in the application details. Different firms/roles and explicit requisitions are kept separate; ambiguous messages may need a clarification note. Review AI interpretations.

For applications without an email, use Capture & settings → Tell the CRM what happened, with firm, role, status and supporting details. Tsenta is not directly connected: there is no Tsenta login, application submission, API sync or automatic recruiter follow-up in this tracker. It reads confirmations and replies from the configured mailbox. Only mail matching tracked company names, domains or outreach contacts is imported, including recruiter or Tsenta mail that mentions a tracked company. A manually logged application with a firm and role adds that firm to the scope; there is no guaranteed VC-only classification.

Weekly or manual Attio sync includes job_application records in the existing Investment CRM object, with details/history in crm_context and current status in deal_status. No new Attio schema is required. Tracking does not send email or change outreach campaigns.


## September 27 reliability fixes

CRM export uses exact external_id lookup followed by record-ID update or create; a unique custom attribute is no longer required. Duplicate matches stop sync for review. Keep one runner per workspace; lookup/create is not a cross-process atomic upsert. Retry after a failed write performs lookup again. Exports over 100 KB are summarized with an explicit marker; full history stays in Signal Desk.

Applied status requires affirmative application-confirmation wording in its source quote; ambiguous evidence leaves status unknown. Received email is source context, not a contact touch. Sent email, meeting and manually logged note participants count as touches.

Attio meeting delivery requires mapped JSON: id, title, occurredAt, participants [{email,name}], text, and optional url. Raw provider event payloads are rejected. Use an adapter if workflow variables do not expose the transcript. Granola intake is disabled (410) and cannot reuse the Attio token.

Claude mode is selectable when an administrator enables subscription testing. API mode and worker-subscription mode are distinct; Settings identifies the active mode. A ready subscription does not prove a visitor has supplied an API key.
