export type VcIntroMatch = {
  email: string;
  name: string;
  funds: string[];
  term: string;
  quote: string;
};

const GENERIC = new Set(['unknown', 'the', 'and', 'for', 'with', 'from', 'fund', 'funds', 'venture', 'capital', 'inc', 'llc']);

function listTerms(value: string) {
  return value.split(/[,;\n]/).map(part => part.trim().toLowerCase()).filter(part => part.length >= 3 && part !== 'unknown');
}

function fieldOutside(signalValue: string | undefined, criteriaValue: string | undefined) {
  const wanted = listTerms(criteriaValue ?? '');
  if (!wanted.length) return false;
  const got = (signalValue ?? '').trim().toLowerCase();
  if (!got || got === 'unknown') return false;
  return !wanted.some(term => got.includes(term) || term.includes(got));
}

export function outsideUserMandate(event: { sector?: string; stage?: string; geography?: string }, criteria: { sectors?: string; stages?: string; geographies?: string }) {
  return fieldOutside(event.stage, criteria.stages) || fieldOutside(event.sector, criteria.sectors) || fieldOutside(event.geography, criteria.geographies);
}

function startupTerms(event: { sector?: string; stage?: string; geography?: string }) {
  const phrases = [event.sector, event.stage, event.geography].flatMap(value => listTerms(value ?? ''));
  const words = phrases.flatMap(phrase => phrase.split(/\s+/).filter(word => word.length >= 4 && !GENERIC.has(word)));
  return [...new Set([...phrases, ...words])];
}

function excerptAround(text: string, term: string) {
  const haystack = text.replace(/\s+/g, ' ');
  const at = haystack.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return '';
  return haystack.slice(Math.max(0, at - 90), Math.min(haystack.length, at + term.length + 90)).trim();
}

export function vcFriendsForStartup(event: { sector?: string; stage?: string; geography?: string }, contacts: Array<{ email?: string; name?: string; relationship?: string; funds?: string[]; sources?: Array<{ text?: string; analysis?: { funds?: Array<{ details?: { quote?: string } | null }> } }> }>) {
  const terms = startupTerms(event);
  const friends = contacts.filter(contact => contact.relationship === 'VC friend' && contact.email);
  if (!terms.length) return { matches: [] as VcIntroMatch[], note: 'Sector, stage, and geography are unknown, so no VC friend can be matched from inbox evidence.' };
  if (!friends.length) return { matches: [] as VcIntroMatch[], note: 'No VC friends are marked yet. After an inbox check, mark the contacts who invest on behalf of a fund.' };
  const matches: VcIntroMatch[] = [];
  for (const friend of friends) {
    const passages = [
      ...(friend.sources ?? []).flatMap(source => [
        source.text ?? '',
        ...(source.analysis?.funds ?? []).map(fund => fund.details?.quote ?? ''),
      ]),
    ].filter(Boolean);
    let found: { term: string; quote: string } | null = null;
    for (const term of terms) {
      for (const passage of passages) {
        const quote = excerptAround(passage, term);
        if (quote) { found = { term, quote }; break; }
      }
      if (found) break;
    }
    if (!found) continue;
    matches.push({ email: friend.email!, name: friend.name || friend.email!, funds: friend.funds ?? [], term: found.term, quote: found.quote });
  }
  if (!matches.length) return { matches, note: 'Your VC friends are saved. None of their inbox conversations mention this sector, stage, or geography.' };
  return { matches: matches.slice(0, 8), note: '' };
}

/** One VC friend whose own mail mentions this round, and who is not already on the deal. */
export function firstReferral(
  deal: { round?: string; contacts?: string[] },
  criteria: { sectors?: string; stages?: string; geographies?: string },
  contacts: Parameters<typeof vcFriendsForStartup>[1],
) {
  const round = deal.round ?? '';
  if (!outsideUserMandate({ stage: round }, criteria)) return { outside: false as const, match: null, note: '' };
  const excluded = new Set((deal.contacts ?? []).map(email => email.toLowerCase()));
  const intro = vcFriendsForStartup({ stage: round }, contacts);
  const match = intro.matches.find(item => !excluded.has(item.email.toLowerCase())) ?? null;
  if (match) return { outside: true as const, match, note: '' };
  const note = intro.matches.length
    ? 'The VC friends who mention this round are already on the deal.'
    : (intro.note || 'No VC friend mentions this round.');
  return { outside: true as const, match: null, note };
}

/** Facts only: the company, the round, the user's stages, and a quote from the VC's own mail. */
export function recommendationEmail(input: { company: string; round: string; friendName: string; quote: string; userStages: string; senderName: string }) {
  const who = input.friendName.trim().split(/\s+/)[0] || 'there';
  const stages = input.userStages.trim() || 'the stages saved in Signals';
  const quote = input.quote.replace(/[<>\[\]]/g, '').replace(/\s+/g, ' ').trim();
  const subject = `${input.company} ${input.round}`.replace(/\s+/g, ' ').trim().slice(0, 140);
  const body = [
    `Hi ${who},`,
    `${input.company} is raising a ${input.round}. I invest at ${stages}, so this round is outside my range.`,
    `From our earlier email: "${quote}"`,
    'I am passing the company along in case it fits what you invest in. I have not committed to invest.',
    input.senderName.trim() || 'Vibhu',
  ].join('\n\n');
  return { subject, body };
}
