import type { EnrichedContact } from './types.js';

const BASE = 'https://api.apollo.io/api/v1';

/** Titles worth reaching, in priority order. First match wins. */
const TARGET_TITLES = ['founder', 'co-founder', 'ceo'];

interface SearchCandidate {
  first_name?: string;
  last_name_obfuscated?: string;
  has_email?: boolean;
  id: string;
  title?: string;
}

/**
 * Apollo REST client. Uses api.apollo.io directly, NOT the Apollo MCP — the MCP is
 * chat-scoped ("only works inside a chat you start"), which can't run from a cron
 * job. The REST API has no such limitation and is what this ingestion step calls.
 *
 * Two calls per company: `api_search` (free) finds candidates by domain + title;
 * `people/match` (1 credit per hit) reveals the actual email for the best one.
 */
export class ApolloClient {
  constructor(private apiKey: string) {
    if (!apiKey) throw new Error('APOLLO_API_KEY is required');
  }

  private async call(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Apollo POST ${path} -> ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  /** Best-effort: finds a founder/co-founder/CEO at `domain` and reveals their email.
   *  Returns null rather than throwing when no one is found — a missing contact for
   *  one company must not abort the batch. */
  async findContact(domain: string): Promise<EnrichedContact | null> {
    const search = await this.call('/mixed_people/api_search', {
      q_organization_domains_list: [domain],
      person_titles: TARGET_TITLES,
      include_similar_titles: true,
      per_page: 5,
    });
    const candidates: SearchCandidate[] = search.people ?? [];
    if (candidates.length === 0) return null;

    // Prefer a confirmed-email candidate; fall back to the top match otherwise.
    const withEmail = candidates.filter((c) => c.has_email);
    const best = withEmail[0] ?? candidates[0];

    const enriched = await this.call('/people/match', {
      id: best.id,
      domain,
      reveal_personal_emails: false,
    });
    const person = enriched.person;
    if (!person?.email) return null;

    return {
      name: person.name ?? ([person.first_name, person.last_name].filter(Boolean).join(' ') || null),
      email: person.email,
      title: person.title ?? best.title ?? null,
    };
  }
}

export function domainFromWebsite(website: string): string {
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch {
    return website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}
