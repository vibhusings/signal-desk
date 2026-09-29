# CRM reliability release

Deployed Worker version: 3d9c8cbe-5e34-43c3-9188-441e44057062.
VM runner updated and restarted after its CRM regression test passed. Credentials, runtime state and environment flags were preserved.

Changes:
- Attio exports query external_id, create absent records, and update existing record IDs. Duplicate matches stop the export. Unique custom fields are no longer required. This is a single-runner design, not a distributed atomic upsert.
- Exports above 100 KB use explicitly marked summaries. Full source/history remains in Signal Desk.
- Inbox queries include tracked company names, allowing matching recruiter/confirmation mail from other domains. Explicit application notes add their company to scope after extraction. Scope-budget truncation is reported as partial coverage.
- Applied requires affirmative confirmation wording in the evidence quote; ambiguous wording produces unknown status.
- Legacy Granola intake returns 410. Attio intake documentation explicitly requires mapped JSON and transcript text.
- Weekly copy distinguishes incoming source context from touches. Existing counting logic already excludes received-only contacts.
- Handbook website and Word copy reflect Claude API versus worker-subscription modes and import limits.

Validation:
- Main regression suite passed, including 33 reply/calendar cases, signals, sending guardrails and CRM.
- UI CRM, signal lifecycle, credential, Slashy and Crustdata tests passed; corrected the signal test harness import resolver.
- Root TypeScript and UI production builds passed.
- Live Attio test created four synthetic record types, synced twice, verified stable IDs/updated values, and removed only its synthetic records.
- Deployed authenticated CRM/outreach/signals reads passed. Runner online; Slashy connected; Claude subscription selected; no user API key stored; sending remains enabled.
- Deployed Granola route returned 410; public guide corrections verified. All 12 Word handbook pages rendered and visually reviewed.

Still external setup:
- Native Attio People/company auto-creation settings require Attio workspace sign-in; no change applied here and no existing real records deleted.
- Automatic Attio recording delivery still requires the provider workflow or adapter with the documented fields.
- No real email was sent or meeting booked in this verification. Live Crustdata and connected mailbox/calendar end-to-end behavior require the appropriate provider access and controlled test.
