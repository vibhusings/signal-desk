/** A company as extracted from a source document (pitch deck, portfolio page, ...). */
export interface SourcedCompany {
  name: string;
  website: string;
  summary: string;
  raisedRaw: string;
  country: string;
  university?: string;
  sourceDeck: string;
}

export interface EnrichedContact {
  name: string | null;
  email: string;
  title: string | null;
}

/**
 * A person found by web research rather than a paid enrichment API.
 *
 * `emailSource` is the whole point of this type. Slashy's research tools return a
 * person's title and history but never an email, so an address here was either found
 * printed on a real page or inferred from a naming pattern — and the two carry very
 * different bounce risk. Nothing sends until a human has seen which is which.
 */
export interface DiscoveredContact {
  name: string;
  title: string | null;
  email: string;
  emailSource: EmailSource;
}

export type EmailSource =
  /** Seen verbatim in a page this run actually fetched. `url` is where. */
  | { kind: 'published'; url: string }
  /** Inferred from a naming convention. Unverified — may bounce. */
  | { kind: 'guessed'; pattern: string };

export const formatEmailSource = (s: EmailSource): string =>
  s.kind === 'published' ? `published:${s.url}` : `guessed:${s.pattern}`;

export function parseEmailSource(raw: string | null | undefined): EmailSource | undefined {
  if (!raw) return undefined;
  if (raw.startsWith('published:')) return { kind: 'published', url: raw.slice('published:'.length) };
  if (raw.startsWith('guessed:')) return { kind: 'guessed', pattern: raw.slice('guessed:'.length) || 'unspecified' };
  return undefined;
}
