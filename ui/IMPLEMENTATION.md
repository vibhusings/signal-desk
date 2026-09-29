# Signal Desk

A separate web UI for the existing investment-sourcing workflow. The root scheduler remains independent.

## Implemented

- Clearly labeled fictional demo with search, signal filters, company detail, shortlisting, passing, research notes and outreach drafts.
- Personal saved workspace backed by D1, scoped to either the authenticated Sites user or the configured single-tester pilot session on every query and mutation.
- Manual company and source entry, status pipeline, JSON export, and connection status.
- Responsive sidebar, accessible dialog and detail sheet, and keyboard navigation through shared UI primitives.
- Strict server validation; outreach sends are handled by the local runner only after a confirmed launch.

## Integration boundary

Attio, email/calendar, and automated signal scanning connect through the cloud runner described below. Airtable remains unconnected. The single-tester pilot can encrypt a tester-provided Anthropic API key to the runner from Settings; plaintext is not stored in D1.

The default Site remains owner-private. When the pilot secrets are configured, a high-entropy access-code session selects one isolated tester owner and ignores platform identity. This is deliberately not a multi-user account system.

## Validation and publication

Dependencies are installed and the schema migration is generated. Browser checks cover responsive rendering, filtering, input rejection, shortlisting and saved-workspace access. Preserve the existing project_id when publishing or updating.

Demo edits intentionally reset; real workspace records are server-backed. The browser never supplies an owner ID. Server code derives it from either trusted platform headers or a signed, HTTP-only pilot cookie.

## Original outreach workflow

The Launch outreach screen submits discovery, launch, and pause requests into a per-owner D1 queue. A saved company record can also start contact research from its detail sheet; that request saves the record first, carries the record id through discovery into the launch, and the resulting campaign links back to the research record. The record id is verified against the owner's own saved companies, and launch still requires the same recipient confirmation in Launch outreach. A local runner uses the existing Claude/Slashy discovery and Attio scheduler. Production credentials remain on the local machine; the runner uses the Site's existing machine-access token plus a separate runner secret.

Recipients are selected from the stored discovery result. Launch requires recipient confirmation, an unchanged policy fingerprint and explicit guessed-address acknowledgment. Existing Attio contacts are skipped rather than restarted. A scoped scheduler restricts UI runs to the local registry and clears inherited test-delivery overrides for that child process only. The original scheduler and environment file are unchanged.

Mutating jobs are not automatically replayed after a runner crash. Review jobs with uncertain outcomes in Attio before another launch. Pauses wait for the active scheduler pass; they cannot retract mail already in flight. Automatic scheduling retains the seven-day calendar limit and holds unmatched windows for review.

The runner is an always-on, single-owner cloud service. It is not multi-tenant. Historical campaigns created outside the UI are not automatically imported.

## Automated signals

Signals opens with a criteria form: thesis, sectors, stage, geography, exclusions, signal categories, optional watchlist and public HTTPS sources. No investment thesis is preselected. Scan now queues a bounded read-only Claude/Slashy research run; recurring collection can be enabled after the first completed scan. The runner checks due scans when the outreach job queue is idle, and overdue scans are visible. It runs one catch-up scan instead of replaying every missed interval.

D1 stores criteria, runs, independent signal events, last successful source snapshots, and append-only observations. Repeated completions are idempotent. Duplicate source events are collapsed without overwriting review status or research notes. Partial source failures retain the last successful snapshot. An abandoned running scan is failed after 20 minutes.

Collection uses web_search and scrape_url to investigate news, blogs, product pages, public hiring pages and configured feeds. It does not use a native RSS subscription service; feed coverage depends on the scraper returning usable text. Limits are 8 searches, 16 page fetches, 24 turns and 8 minutes per scan. Verbatim excerpts must occur in actual scrape results and the claimed official domain must have been fetched. Date confidence is conservative: a YYYY-MM-DD date must occur in the evidence quote, otherwise the event date remains unknown. First seen is always distinct from event date. Scores are transparent heuristics, not probabilities: term overlap for fit, date-based recency, and source-domain rules for strength/confidence. Claims are agent interpretations; excerpts are verified against retrieved text, not independently fact-checked. Conflicts and unknown stage/geography are displayed as caveats. Headcount growth cannot be inferred from a single job listing; source-reported growth is labeled accordingly.

Signals can create a company research record without overwriting an existing one. Their contact discovery targets founders/CEOs; investment context is captured server-side from the signal and thesis. A separate investment sequence and policy hash are shown for recipient approval. Investment records persist their mode in the Attio source marker, suppress resume attachments, and use investment meeting titles, including when processed outside the UI runner.

Validation: root scripts/test-signals.ts covers evidence, identity, dates, exclusions, duplicate signals, unsupported growth and investment copy. UI scripts/test-signals.mjs exercises real SQLite migrations and the API/store lifecycle with a local D1 adapter. scripts/check-signal-collector.ts is a read-only live smoke test and never writes its sample research to production.
