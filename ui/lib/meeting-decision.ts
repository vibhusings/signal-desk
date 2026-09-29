export type MeetingDecision = {
  status: 'stopped' | 'needs_review';
  label: 'Pass' | 'Invest';
  quote: string;
};

type ModelDecision = { decision?: string; quote?: string } | null;

/** Apply the extraction model's judgment. The quote must already be in the source. */
export function decisionFromAnalysis(analysis: { outreachDecision?: ModelDecision } | null | undefined): MeetingDecision | null {
  const decision = analysis?.outreachDecision;
  if (!decision || decision.decision === 'none') return null;
  if ((decision.decision !== 'pass' && decision.decision !== 'invest') || !decision.quote) return null;
  return {
    status: decision.decision === 'pass' ? 'stopped' : 'needs_review',
    label: decision.decision === 'pass' ? 'Pass' : 'Invest',
    quote: decision.quote,
  };
}

export function matchOutreachRecord(records: Array<{ id?: string; contactEmail?: string; email?: string; companyName?: string; company?: string }>, source: { title?: string; text?: string; participants?: Array<{ email?: string }> }) {
  const emails = new Set((source.participants ?? []).map(p => (p.email ?? '').toLowerCase()).filter(Boolean));
  const byEmail = records.filter(r => emails.has((r.contactEmail ?? r.email ?? '').toLowerCase()));
  if (byEmail.length === 1 && byEmail[0].id) return { id: byEmail[0].id };
  if (byEmail.length > 1) return null;
  const haystack = `${source.title ?? ''}\n${source.text ?? ''}`;
  const byCompany = records.filter(r => {
    const name = (r.companyName ?? r.company ?? '').split('—')[0].split(' - ')[0].trim();
    return name.length >= 3 && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack);
  });
  if (byCompany.length === 1 && byCompany[0].id) return { id: byCompany[0].id };
  return null;
}
