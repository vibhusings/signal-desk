# Attio workspace setup

Create these attributes on the **Companies** object before the scheduler runs.
Slugs must match `src/attio/schema.ts` (or override each via the `ATTIO_ATTR_*` env vars).

| Slug | Type | Notes |
|---|---|---|
| `outreach_email` | Email or Text | Who the touch goes to |
| `outreach_contact` | Text | First name, used in the copy |
| `asset_class` | Select | VC, CRE, … — the only cross-vertical variable |
| `sequence_stage` | Number | Touches delivered. 0 = none |
| `sequence_status` | Select | `queued` `active` `replied` `booked` `bounced` `stopped` `unsubscribed` `needs_review` |
| `next_touch_at` | Date (with time) | **The query key.** The scheduler reads this and nothing else |
| `last_touch_at` | Date (with time) | The follow-up timestamp tracking |
| `touch_count` | Number | Ceiling enforcement |
| `claimed_at` | Date (with time) | In-flight lock. Not for humans |
| `last_send_key` | Text | Idempotency key. Never edit by hand |
| `last_message_id` | Text | Exact RFC Message-ID used to resolve the final Gmail thread |
| `last_subject` | Text | Send-result subject used to narrow thread discovery before Message-ID validation |
| `review_note` | Text | Why a record was parked |

Additional attributes for the deck-ingestion pipeline (`scripts/ingest-deck.ts`) — the
scheduler never reads these, they're informational:

| Slug | Type | Notes |
|---|---|---|
| `source_website` | Text | The upsert matching key — re-running ingest on the same deck updates, not duplicates |
| `company_summary` | Text | One-liner from the source doc, useful context for touch-1 copy |
| `raised_amount` | Text | As printed in the source (e.g. "$1.95M", "Bootstrapped") — not parsed to a number |
| `source_deck` | Text | Which document this record came from |

## The weekly view

The "weekly tab" is a saved Attio list view, not something this repo builds:

1. Companies → Filter → `next_touch_at` **is within** *this week*
2. Group by `sequence_stage`
3. Show `last_touch_at`, `touch_count`, `sequence_status`
4. Save as "This week's follow-ups"

Add a second view filtered on `sequence_status = needs_review` — that is the queue the
scheduler parks anything ambiguous into, and it needs a human eye.

## API key

Workspace settings → Developers → create an access token with read + write on records.
Attio's free plan includes API access. Put it in `.env` as `ATTIO_API_KEY`.
