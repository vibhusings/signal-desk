import { ATTR } from '../attio/schema.js';
import type { EnrichedContact, SourcedCompany } from './types.js';

const BASE = 'https://api.attio.com/v2';

export interface IngestRow {
  company: SourcedCompany;
  contact: EnrichedContact | null;
}

export interface OutreachTargetInput {
  companyName: string;
  email: string;
  contactName?: string;
  contactTitle?: string | null;
  emailSource?: string;
  sourceLabel?: string;
  /** Official site verified by a successful scrape during this discovery run. */
  website?: string | null;
  /** What the company does. Read by the copy prompt so touch 1 can open on something real. */
  companySummary?: string | null;
}

/**
 * Upserts one outreach target, matched on `outreach_email`.
 *
 * Query-then-write rather than Attio's `matching_attribute` upsert: that endpoint
 * requires the matching attribute to be unique, and this workspace's plan refuses to
 * mark a text attribute unique at all (rejected both at creation and via PATCH).
 *
 * A record here is one outreach thread, not one company — several people at the same
 * company each get their own, since each needs its own sequence state.
 */
export async function upsertOutreachTarget(
  apiKey: string,
  input: OutreachTargetInput,
  object = process.env.ATTIO_OBJECT ?? 'companies',
): Promise<'created' | 'updated'> {
  if (!apiKey) throw new Error('ATTIO_API_KEY is required');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  const values: Record<string, unknown> = {
    [ATTR.companyName]: input.companyName,
    [ATTR.contactEmail]: input.email,
    [ATTR.sequenceStatus]: 'queued',
  };
  if (input.contactName) values[ATTR.contactName] = input.contactName;
  if (input.contactTitle) values[ATTR.contactTitle] = input.contactTitle;
  if (input.emailSource) values[ATTR.emailSource] = input.emailSource;
  if (input.companySummary) values[ATTR.summary] = input.companySummary;
  if (input.sourceLabel) values[ATTR.sourceDeck] = input.sourceLabel;
  if (input.website) values[ATTR.website] = input.website;

  const found = await fetch(`${BASE}/objects/${object}/records/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ filter: { [ATTR.contactEmail]: { $eq: input.email } }, limit: 1 }),
  });
  if (!found.ok) throw new Error(`Attio query -> ${found.status}: ${await found.text()}`);
  const existing = (await found.json()).data?.[0];

  if (existing) {
    const res = await fetch(`${BASE}/objects/${object}/records/${existing.id.record_id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ data: { values } }),
    });
    if (!res.ok) throw new Error(`Attio PATCH -> ${res.status}: ${await res.text()}`);
    return 'updated';
  }

  const res = await fetch(`${BASE}/objects/${object}/records`, {
    method: 'POST', headers, body: JSON.stringify({ data: { values } }),
  });
  if (!res.ok) throw new Error(`Attio POST -> ${res.status}: ${await res.text()}`);
  return 'created';
}

export interface IngestResult {
  created: number;
  updated: number;
  noContact: string[];
  errors: Array<{ company: string; error: string }>;
}

/**
 * Upserts sourced companies into Attio, matched on `source_website` so re-running
 * ingestion on the same deck updates records instead of duplicating them.
 *
 * Always writes `sequence_status: 'queued'`, never 'active' — even when a contact
 * was found. A human reviewing the list before anything starts sending is a
 * deliberate gate, not an oversight: see docs/sourcing-workflow.md.
 */
export async function ingestToAttio(
  apiKey: string,
  rows: IngestRow[],
  object = process.env.ATTIO_OBJECT ?? 'companies',
): Promise<IngestResult> {
  const result: IngestResult = { created: 0, updated: 0, noContact: [], errors: [] };

  for (const { company, contact } of rows) {
    const values: Record<string, unknown> = {
      [ATTR.companyName]: company.name,
      [ATTR.website]: company.website,
      [ATTR.summary]: company.summary,
      [ATTR.raisedRaw]: company.raisedRaw,
      [ATTR.sourceDeck]: company.sourceDeck,
      [ATTR.sequenceStatus]: 'queued',
    };
    if (contact) {
      values[ATTR.contactEmail] = contact.email;
      if (contact.name) values[ATTR.contactName] = contact.name;
    } else {
      result.noContact.push(company.name);
    }

    try {
      const res = await fetch(
        `${BASE}/objects/${object}/records?matching_attribute=${ATTR.website}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ data: { values } }),
        },
      );
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const json = await res.json();
      // Attio's assert endpoint doesn't distinguish create/update in the response
      // in a version-independent way, so this is a best-effort count, not exact.
      if (json.data?.id) result.created++;
    } catch (err) {
      result.errors.push({ company: company.name, error: String(err) });
    }
  }

  return result;
}
