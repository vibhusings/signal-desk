# Signal Desk: setup and user guide

For the current private pilot. Checked against the implementation on September 23, 2026.

Open [Signal Desk](https://<your-worker>.workers.dev).

Signal Desk combines startup research, reviewed email outreach, and a CRM built from conversations. The website runs on Cloudflare and background work runs on Google Cloud. Once configured, your laptop can be asleep and your browser can be closed while scheduled work runs.

## 1. Before inviting a new user

The current deployment has **one pilot workspace and one configured sender**. Everyone using its access code enters that same workspace. It does not yet provide individual sign-up, separate accounts, or automatic isolation for multiple customers.

The administrator must prepare a separate deployment or deliberately migrate the pilot before onboarding another independent user. Do not distribute the same access code expecting separate private workspaces.

Administrator checklist:

- Configure the intended user's sender name, inbox, calendar policy, and outreach sequence on the cloud runner.
- Keep email sending disabled during onboarding; require the user's Claude API key.
- Ensure the cloud runner is online and the old Mac runner is stopped.
- Prepare the intended outreach Attio workspace and its attributes. Separately configure the investment CRM destination if CRM synchronization is wanted.
- Configure the user's resume if job-application outreach should attach one. Investment outreach does not attach a resume.
- Give the user the website link, private access code, assigned inbox address, and this guide.
- Help connect Attio recording delivery if automatic meeting imports are wanted.
- Verify research, mailbox identity, calendar access, and one controlled self-addressed email before enabling real outreach.

Server setup references: [pilot administration](single-tester-pilot.md), [cloud runner](google-cloud-runner.md), [outreach Attio fields](attio-setup.md), and [investment CRM configuration](vc-crm.md).

## 2. What a new user needs to do

You do not need to install this project or run a server on your laptop.

1. Open the website, enter the administrator's access code, and choose **Open workspace**.
2. Open **Settings**. Enter your Anthropic API key and choose **Encrypt for runner**. Refresh Settings after the runner picks it up. An Active indicator means the runner loaded the key; a successful research job is the practical check that it works.
3. In **Slashy email & calendar**, check the expected inbox. Choose **Connect Slashy**, sign in to your own Slashy account, and connect/authorize the Google account matching that inbox. Return to Signal Desk and wait for **Connected**.
4. For startup discovery, open **Signals → Investment criteria**, save your preferences, and run your first scan. Review the results before enabling recurring scans.
5. For conversation tracking, open **CRM → Capture & settings**, confirm the inbox, choose the lookback period, and save. Choose **Check inbox**, then review import activity and the Weekly/Contacts views.
6. Optionally connect Attio recording delivery and enable Attio synchronization after the administrator has configured the destination.
7. If you want to send outreach, review the sender, recipients, email purpose, resume setting, and follow-up policy with the administrator. Complete the controlled delivery test before real sending is enabled.

The hosted pilot uses an Anthropic API key. A Claude chat subscription alone is not the credential this setup asks for. Have API access and available usage in the Anthropic account supplying the key. Slashy must also have working access to the research/email/calendar tools used by the workflow.

Do not paste API keys into research notes or CRM notes. Use the password field in Settings. Signal Desk encrypts the Claude key and Slashy tokens for the runner; account connection is performed through the provider's sign-in flow.

### Choose only the features you need

| Feature | User supplies | Administrator prepares |
|---|---|---|
| Signals and contact research | Claude API key, Slashy connection, investment criteria | Online cloud runner |
| Inbox CRM | Claude API key, Slashy/Google inbox connection, lookback and schedule | Matching sender inbox on runner |
| Pasted conversation or meeting notes | Note text, date, contact emails, Claude API key for extraction | Online cloud runner |
| Automatic Attio meeting imports | Attio Pro/Enterprise, recording enabled, native workflow delivery mapping | Assistance configuring the integration if needed |
| Weekly Attio CRM updates | Permission to use the intended Attio workspace; enable sync after setup | Dedicated CRM token, custom object and fields, inbox binding |
| Email outreach and meetings | Recipient review, correct purpose, sender/calendar confirmation | Outreach Attio configuration, sequence, optional resume, delivery test and sending enabled |

## 3. What each workspace tab does

| Tab | Use it for | What it does not do by itself |
|---|---|---|
| **Launch outreach** | Find company contacts, inspect address evidence, confirm a campaign, monitor follow-ups, pause or halt sending | Merely researching a company does not send email |
| **Signals** | Discover companies and changes matching your investment criteria; inspect sources and shortlist opportunities | Shortlisting does not start outreach |
| **CRM** | Import conversations, track contacts, VC relationships, funds, deals and weekly activity | Importing a contact does not enroll them in an email sequence |
| **Companies** | Save company research, source links, notes and draft text | Manual company data is not independently verified automatically |
| **Pipeline** | View saved companies under New, Shortlisted, Draft ready and Passed | These are research stages, not confirmed investment deal statuses |
| **Outreach** | Browse saved companies with draft text | This draft queue is not the live campaign monitor or a send button |
| **Settings** | Connect Claude and Slashy; inspect integration and scheduling information | Server-managed sender, resume, calendar and Attio configuration are not all editable here |

Companies, Pipeline and the draft queue can initially show example data. Choose **Open my workspace** before working with real saved research. **Explore demo** returns to fictional examples. Signals and CRM have their own live data views.

The **Export** button in the manual research workspace downloads company research as JSON. It is not a complete export of emails, CRM records, campaigns or the database.

## 4. Finding startups with Signals

Optional: connect your Crustdata key in Settings to add up to ten company candidates per scan. Claude and Slashy still investigate and verify the signals. See [Crustdata setup and usage](crustdata.md).

### Configure a scan

1. Open **Signals → Investment criteria**.
2. Write an investment thesis explaining what makes a company relevant.
3. Add sectors, stages, geographies, keywords and exclusions.
4. Choose Hiring, Product, Partnership and/or Fundraising signals.
5. Optionally add a watchlist, one company per line (up to 20), and public HTTPS source URLs, one per line (up to 12).
6. Save the criteria and choose **Scan now**.
7. Expand **Collection activity** to see the run's status, checked sources and warnings.

Example thesis: “Find US seed-stage healthcare software companies with evidence of customer adoption or a recent product launch. Exclude staffing agencies.” Add source links relevant to that thesis rather than expecting complete coverage of every website.

The collector uses public web searches, configured sources and company pages. AI investigates candidates; code checks source excerpts, company identity, duplicates, dates and exclusions. A scan has limits of eight searches, sixteen page requests and approximately eight minutes, with up to ten accepted events. It is a bounded investigation, not an exhaustive internet crawl.

### Understand the scores

The displayed overall score is the rounded average of four components:

| Component | Current rule |
|---|---|
| Fit | Percentage of configured sector/keyword terms found in the extracted candidate context; 50 when none are configured |
| Recency | Falls over a 90-day window; zero when the event date cannot be verified |
| Strength | 75 if evidence includes the company's own website; otherwise 50 |
| Confidence | Starts at 50, adds 20 for company-site evidence and 20 for evidence spanning multiple domains, capped at 95 |

These are research heuristics. Confidence is not a calibrated probability. Stage and geography require review, and different domains may repeat the same original announcement. “First seen” means when this tool observed the item, not when the event happened.

Open a signal to read its explanation, quotations, source links and caveats. Choose **Shortlist** or **Pass**. A failed scan means the process failed, not that no relevant companies exist. A partial scan may still contain useful evidence but did not complete full intended coverage.

### Enable automatic scans

After a scan completes successfully or partially, reopen Investment criteria, choose an interval (6, 12, 24, 48 hours or weekly), select **Enable recurring scans**, and save. The UI shows the next scan time. Turn off the checkbox and save to stop future scheduled scans; an already-running job may finish.

### Start investment outreach from a signal

1. Open the signal and choose **Review company & find founders**.
2. Review the saved company research and notes.
3. Choose **Find founders for investment outreach**.
4. Review the resulting contacts in Launch outreach.
5. Select recipients and review the launch confirmation before sending.

This path carries the signal evidence and investment thesis into the outreach context and searches for founders/CEOs. The ordinary company-name discovery form targets hiring-related contacts. There is no universal purpose selector in that form; use the signal path for investment outreach.

## 5. Researching and launching email outreach

### Find and review contacts

1. Open **Launch outreach**.
2. Enter a company name and select the maximum contact count.
3. Choose **Find contacts** and wait for the research result. Older results are available through the research selector.
4. Review the company identity, contact role, email address and source.
5. Select only the recipients you intend to contact.

An address labeled **published** was supported by a fetched source page. It can still be outdated or undeliverable. A **guessed** address is inferred and needs additional first-email approval.

### Review what will be sent

Choose **Review & launch**. The confirmation displays the sender, selected addresses, purpose/mode, maximum email count, follow-up gaps, resume setting, and email directions. If these are wrong, ask the administrator to correct the configuration before launching.

The system uses AI to generate messages from those directions and company context. The launch screen shows directions, not necessarily the exact final email body. A saved draft in the manual research workspace is not automatically the literal body the scheduler sends.

For job applications, the administrator must select the application sequence and configure the resume attachment. Investment outreach uses its own sequence and omits the resume. Do not assume that entering a company name sets all of those options.

Choosing **Confirm recipients & start sending** authorizes the campaign. Published addresses can start sending; guessed addresses wait for **Approve first email** in the campaign monitor. In safe mode the launch and approval controls remain disabled.

Normal delivery goes to the selected contact. Redirection to your own inbox is a separate administrator-controlled test configuration; do not assume every campaign is redirected. The administrator must verify actual test routing and restore normal configuration after the controlled test.

### Monitor or stop a campaign

Use the **Campaigns** section of Launch outreach to see the recipient, sequence status, touch count, next follow-up and meeting/review status. Follow-up timing comes from the configured policy shown at launch.

- **Pause** stops that campaign's future scheduled outreach.
- **Halt sending** queues the global kill switch. A message already in flight may still finish.
- **Resume sending** clears the kill switch; it does not override server safe mode.
- A reply, unsubscribe, bounce, confirmed booking or completed sequence stops ordinary follow-ups when detected.
- Uncertain send outcomes are held for review. Do not repeatedly relaunch to force them through.

Reply checks are periodic rather than instantaneous. A reply can race with an email already queued. Existing Attio contacts are not automatically restarted just because they appear in research.

## 6. Replies and automatic meeting scheduling

Scheduling uses the connected calendar and the runner's meeting policy. The recipient's requested dates and times constrain the chosen slot.

| Situation | Behavior when automatic scheduling is enabled |
|---|---|
| A requested time window has an available slot | Book a verified slot within that window and send a confirmation in the thread |
| The requested window is observable but no slot fits | Ask for two or three alternative days/times and a timezone; do not book a different day |
| The request falls outside the checked seven-day calendar range | Hold for review; do not claim that unseen time is busy |
| A recognized general scheduling request has no specific window | It may book the earliest eligible free slot |
| Calendar/thread data is incomplete, mismatched or ambiguous | Hold for review |
| Reply is a rejection, unsubscribe or ambiguous message | Stop the outreach sequence; scheduling is not a general chat agent |

Relative dates are interpreted using the reply timestamp. Explicit supported timezones are respected; otherwise the configured meeting timezone is assumed. “Next week Wednesday” must not be substituted with the current Monday.

Ask the administrator to confirm meeting duration, working hours, timezone, minimum notice and whether automatic scheduling is enabled. The Settings scheduling card currently contains static labels; it may differ from the runner's effective configuration. In particular, the code defaults to 24 hours' notice while that card says 2 hours. Treat the administrator-confirmed runner policy as authoritative.

The present calendar integration observes only the next seven days. A requested date farther away may need manual handling even when your calendar is free then.

## 7. Building your CRM from inbox conversations

1. Open **CRM → Capture & settings**.
2. Confirm the connected inbox matches the address assigned to your runner.
3. Choose **Days to look back**, from 1 to 90. Start with a small period for your first test.
4. Choose **Save settings**, then **Check inbox**.
5. Watch **Import & sync activity**. Email collection and AI extraction are separate jobs, so sources may appear before summaries.
6. Review **Weekly**, **Contacts**, **Deals** and **VC funds** against their source evidence.
7. Enable **Automatically check inbox daily** and save if you want recurring imports.

The importer reads received and sent messages from the configured Gmail-shaped Slashy integration. It excludes drafts, spam and trash. Imports create CRM records without starting outreach campaigns.

### CRM views

| View | Meaning |
|---|---|
| Weekly | Conversations and deal updates grouped into weeks beginning Monday at 00:00 UTC |
| Contacts | People identified by email in imported conversations, including inbound-only contacts |
| VC friends | Contacts whose Relationship you explicitly set to VC friend |
| Deals | Opportunities grouped by company and round, with quoted facts and dated history |
| Deals with VC friends | Deals linked to at least one contact you marked as a VC friend |
| VC funds | Named fund details and sources flagged as VC-specific, with supporting excerpts |
| Capture & settings | Inbox schedule, Attio sync, natural-language notes and Attio recording delivery setup |

For weekly counts, a touch means a sent email, meeting or your own conversation note. Receiving a newsletter alone is not a conversation touch and does not establish friendship.

Example: mark Jane as a VC friend in Contacts. If an imported conversation with Jane discusses Acme's seed round, that opportunity can appear in Deals with VC friends. Jane's relationship remains separate from the deal, and Jane can be linked to several opportunities.

ARR and revenue are separate fields. Missing figures remain unknown. Quotes are checked against source text, but AI interpretation still needs review. Fund-associated contacts are participants in related conversations, not automatically verified fund employees. Company-name matching is basic; distinct companies sharing a name may need administrator assistance.

### Log a conversation in natural language

In **Capture & settings → Tell the CRM what happened**, choose Conversation note or Attio meeting. Enter a title, date, contact emails and the note/transcript, then choose **Extract CRM update**.

Example: “I spoke with Jane from North Fund about Acme's seed round. Jane offered an introduction next Tuesday. Acme reported $400k ARR as of August; we have not committed to invest.” Use actual facts and the real contact emails. The current form still requires those small identity/date fields; it is not a free-standing chatbot that infers every contact from a company name.

### Inbox coverage limits

Each scan is limited to 25 threads, 100 messages and approximately 550 KB. Long messages are excerpted to 16,000 characters. Partial runs and failed reads appear in activity. Repeating the same broad scan does not guarantee a complete historical backfill; there is no advancing mailbox cursor yet. Narrow the lookback and ask the administrator about larger imports.

The CRM currently displays at most 2,000 sources and blocks Attio sync at that limit. Outlook import, a complete account export, and a general CRM edit/delete interface are not provided in this version. Ask the administrator for corrections or removal rather than assuming a summary is directly editable in the UI.

## 8. Connecting Attio meeting recordings

Attio is the selected recorder. Granola and Zapier are not required for this flow.
Attio Call Intelligence requires Pro or Enterprise; confirm the workspace can also
run the workflow blocks below.

1. In Attio, connect the intended calendar and enable call recording. Follow
   [Attio's recording setup](https://attio.com/help/reference/productivity-collaborating/call-intelligence/enable-call-recording).
   The recorder must be admitted to the meeting; arrange recording consent with participants.
2. In Signal Desk, save CRM settings, then open **Capture & settings → Attio meeting recorder**.
3. Generate a delivery token. Copy it into the Attio workflow's Authorization header
   as `Bearer <token>`. Treat it as a secret. Rotation also invalidates any legacy Granola delivery token.
4. In Attio Workflows, use **Call recording created**, which fires after processing,
   followed by **Send HTTP request**. Filter to the intended user's meetings if the
   Attio workspace includes other people. This pilot is one shared workspace.
5. Use POST to `https://<your-worker>.workers.dev/api/crm/attio`
   (or the endpoint displayed in your deployment), with Content-Type `application/json`.
6. Map fields into the following JSON using Attio's variables. These values are examples:

```json
{
  "id": "stable-attio-recording-id-or-url",
  "title": "Meeting with North Fund",
  "occurredAt": "2026-09-23T16:00:00Z",
  "participants": [{"email": "jane@fund.example", "name": "Jane"}],
  "text": "Full meeting transcript",
  "url": "https://app.attio.com/your-workspace/calls/your-recording"
}
```

Use the recording's Attio URL as a stable ID if its ID is not exposed. Map title and
start time from the associated Meeting, and text from Transcript. Resolve email
addresses from linked person records when available; do not guess emails from
transcript speaker names. If no verified emails are available, send `participants: []`:
the source is saved and can yield deal facts, but will not create contact touches.
Use workflow variables/JSON serialization so quotes and newlines remain valid JSON.

7. Test a completed recording. Confirm HTTP 200, the meeting under Weekly, and an
   extraction job under Import & sync activity. Claude must be connected and the
   runner online for extraction. A successful delivery alone does not mean AI extraction finished.
8. Enable the workflow for future recordings. Historical meetings need explicit
   replay/import. Disable any old Granola Zap to avoid importing the same meeting twice.

The receiver accepts mapped workflow JSON, not raw Attio API webhook events. The
same recording ID and content are deduplicated; corrected content queues a fresh
extraction. Invalid requests return 400, bad tokens 401, oversized requests 413,
and storage failures 503. Transcripts are limited to 100,000 characters; delivery
bodies to 150,000 characters. Failed or oversized deliveries need attention in
Attio workflow history; do not silently truncate transcripts.

Attio setup is still required in the user's account; generating a Signal Desk
token does not connect an Attio account or enable recording. The existing
`/api/crm/granola` endpoint remains compatible for previous imports.
Weekly synchronization back to Attio is a separate integration.

See [Attio's workflow blocks](https://attio.com/help/reference/automations/workflows/workflows-block-library)
for provider-side mapping and workflow configuration.

## 9. Weekly Attio synchronization

Outreach Attio state and investment CRM synchronization are separate configurations. “Attio via cloud runner” in general Settings does not establish that the dedicated CRM destination is ready.

Ask the administrator to configure the intended Attio workspace, a dedicated CRM token, its custom object/fields and your inbox binding. The full field list is in [CRM administrator setup](vc-crm.md#attio-destination).

When the CRM connection banner says Attio CRM is configured:

1. Open Capture & settings.
2. Select **Sync CRM to the configured Attio destination every seven days** and save.
3. Choose **Sync Attio now** for the initial test.
4. Review the result in Import & sync activity and in Attio.

The scheduled interval is seven days, rather than a fixed weekday/time selection. Stable IDs update existing records on retries. This connector writes contacts, funds, deals and weekly records into a custom object, with structured history in `crm_context`. It does not currently create native Attio relationship-reference fields or provision all views automatically.

The administrator can create separate Attio views for VC friends, deals, funds and weekly updates. Selecting a relationship in Signal Desk affects the next sync. Airtable mirroring is not connected in the current tool.

## 10. Using saved company research

In Companies, choose **Open my workspace**, then **Add company**. Enter the company, sector, stage, signal, and source URL. Open a company to add research notes and draft text. **Shortlist & save**, **Save draft**, and **Pass** update its research status.

Pipeline displays these statuses as columns. Outreach displays companies marked Draft ready. Saving draft text alone does not send it or schedule follow-ups. Use Launch outreach for campaigns, and use the signal-linked founder discovery path when the purpose is investment outreach.

## 11. A practical weekly routine

1. Review failed/partial jobs and connection status before relying on fresh data.
2. Review new Signals, check evidence and shortlist opportunities.
3. Check CRM Weekly for touched contacts, meeting summaries and deal changes.
4. Confirm VC friendships and inspect the linked deal evidence.
5. Check that expected Attio meetings arrived and that Attio sync succeeded.
6. Review active campaigns and any first-email approvals or scheduling exceptions.

Scheduled work requires the cloud runner and provider access to remain available. It does not require your Mac to stay awake. The different schedules are independent: Signals uses its selected interval, CRM inbox collection is daily when enabled, Attio CRM sync is every seven days when enabled, and outreach uses its campaign policy.

## 12. Troubleshooting

| What you see | What to do |
|---|---|
| Access code rejected | Use the administrator's latest code for this deployment; do not use your Google password |
| Cloud runner offline | Ask the administrator to check the GCP service; keep the Mac runner stopped during cloud operation |
| Claude “Encrypted · connecting” | Refresh Settings after the runner processes it; check any displayed error. A successful job is still needed to validate provider access |
| Claude authentication or usage error | Check the API key/account usage; replace the key through Settings if needed |
| Slashy connected but research fails | Confirm the expected Google account and provider tool access; the connected badge alone does not prove a tool call will work |
| Scan now unavailable | Save criteria, check runner/credentials, and wait for an existing scan to finish |
| Recurring scans unavailable | Complete and review the first successful or partial scan |
| Zero signals or partial coverage | Inspect Collection activity, rejected evidence and source errors; refine criteria/sources before rerunning |
| CRM jobs remain queued | Check Claude, Slashy, runner and Attio readiness for that job type; extraction and inbox collection have different prerequisites |
| CRM job failed | Read its error, fix the cause, then use Retry. A partial import is not proof of complete coverage |
| Attio “destination setup needed” | Ask the administrator to configure the dedicated CRM workspace, token, object and inbox binding |
| Attio meeting absent | Check recording completed, the Attio workflow is enabled, and its HTTP delivery succeeded; verify mapped fields and token. Historical recordings are not automatically backfilled |
| No contacts in VC friends | Set the person's Relationship to VC friend in Contacts |
| No deals with a VC friend | Both a confirmed friendship and an imported deal conversation linked to that email are needed |
| Sending disabled | The administrator has safe mode enabled; Resume sending does not override it |
| First email awaiting approval | Review the guessed address and use Approve first email only if you intend that delivery |
| Meeting held for review | Read the campaign note; check calendar coverage, timezone and the requested date with the administrator |
| Email may already have sent | Check the actual sent thread and Attio before retrying; an uncertain outcome must not be blindly replayed |

When requesting help, include the tab, action, timestamp, job status and error message. Never include API keys, delivery tokens or the pilot access code in a bug report.

## 13. What is still required for this pilot

The last live verification on September 21, 2026 found the runner online with email sending disabled, Claude and Slashy unconfigured, and no dedicated Attio CRM destination configured. This is a dated checkpoint, not a live status display; use Settings and the CRM banner for current state.

Before a new user can run the full workflow, finish their Claude and Slashy connections, configure the intended Attio destination, connect Attio recording delivery if desired, and complete a real research/import test. Real sending requires the separate administrator-assisted delivery/calendar check.

The guide describes the features that exist today, including their limits. Public self-service onboarding, independent accounts within this deployment, complete mailbox backfills, Airtable synchronization and direct Granola OAuth are not implemented.
