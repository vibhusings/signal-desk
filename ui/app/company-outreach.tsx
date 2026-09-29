'use client';
import { useState } from 'react';
import { AlertCircle, CalendarCheck, CheckCircle2, Loader2, Mail, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

type Props = { companyId: string; item: any; meta: any; onChanged: () => void | Promise<void> };
const when = (s?: string | null) => s ? new Date(s).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

async function post(body: any) {
  const r = await fetch('/api/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error ?? 'Request failed');
  return d;
}

function Status({ c }: { c: any }) {
  const r = c.record, m = r?.meeting;
  switch (c.state) {
    case 'queued': case 'sending': return <p className="outreach-state"><Loader2 size={15} className="spin" />Approved. Sending on the next scheduler pass, usually within two minutes.</p>;
    case 'contacted': return <p className="outreach-state ok"><Mail size={15} />Email {r.touchCount} of 4 sent {when(r.lastTouchAt)}. {r.nextTouchAt ? `Next follow-up ${when(r.nextTouchAt)} unless they reply.` : 'Sequence complete.'}</p>;
    case 'replied': return <p className="outreach-state ok"><CheckCircle2 size={15} />Replied. Follow-ups stopped. {m?.state === 'review' ? `Held for your review: ${m.note ?? 'check the thread'}.` : m?.state === 'sent' ? 'No free slot matched, so they were asked for other times.' : 'If they suggested times, the meeting is booked automatically after checking your calendar.'}</p>;
    case 'booked': return <p className="outreach-state ok"><CalendarCheck size={15} />Meeting booked for {when(m?.selectedSlot)}. {m?.meetLink ? <a href={m.meetLink} target="_blank" rel="noreferrer">Google Meet link</a> : <span className="review-warning">No Google Meet link confirmed. Add one to the invitation.</span>}</p>;
    case 'bounced': return <p className="outreach-state warn"><AlertCircle size={15} />The email bounced. Follow-ups stopped.</p>;
    case 'unsubscribed': return <p className="outreach-state warn"><AlertCircle size={15} />They asked not to be contacted. Follow-ups stopped.</p>;
    case 'stopped': return <p className="outreach-state">Sequence stopped.</p>;
    case 'needs_review': return <p className="outreach-state warn"><AlertCircle size={15} />Held for review in Launch outreach. The send outcome was uncertain, so nothing was retried.</p>;
    case 'skipped': return <p className="outreach-state warn"><AlertCircle size={15} />{c.launch?.outcome?.skipped ?? 'Skipped.'}</p>;
    case 'failed': return <p className="outreach-state warn"><AlertCircle size={15} />Not sent: {c.launch?.error ?? 'the runner could not start this campaign.'}</p>;
    default: return null;
  }
}

export default function CompanyOutreach({ companyId, item, meta, onChanged }: Props) {
  const [edits, setEdits] = useState<Record<number, { subject: string; body: string }>>({});
  const [busy, setBusy] = useState<string>(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const research = item?.research;
  const running = research && ['queued', 'running'].includes(research.status);
  const blocked = !meta?.runnerOnline ? 'The cloud runner is offline.' : !meta?.sending ? 'Email sending is turned off on the cloud runner.' : meta?.halted ? 'Sending is halted. Resume it in Launch outreach.' : '';

  async function act(key: string, body: any, done?: (d: any) => void) {
    if (busy === key) return;
    setBusy(key); setError(''); setNotice('');
    try { const d = await post(body); done?.(d); await onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  return <section className="company-outreach">
    <div className="rail-heading"><Send size={15} /><span>OUTREACH</span></div>
    {meta?.demoRecipient && <div className="test-delivery-note"><strong>Test delivery is on.</strong> Approved emails and follow-ups go to {meta.demoRecipient}, not the contacts below. Change this in Settings.</div>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {!research ? <div className="outreach-empty"><p className="muted">Find the founders, their addresses, and a first-email draft for each.</p><Button disabled={busy === 'research'} onClick={() => act('research', { action: 'research', companyId }, d => d.pending && setError(d.pending))}><Mail size={15} />Find contacts & write drafts</Button></div>
      : running ? <p className="outreach-state"><Loader2 size={15} className="spin" />Finding contacts and writing first-email drafts. This usually takes 3–10 minutes; the page updates by itself.</p>
      : research.error ? <div className="outreach-empty"><p className="outreach-state warn"><AlertCircle size={15} />{research.error}</p><Button variant="outline" disabled={busy === 'retry'} onClick={() => act('retry', { action: 'research', companyId, retry: true }, d => d.pending && setError(d.pending))}><RefreshCw size={15} />Try again</Button></div>
      : null}
    {item?.summary && <p className="muted">{item.summary}</p>}
    {(item?.contacts ?? []).map((c: any) => {
      const draft = edits[c.index] ?? c.draft ?? { subject: '', body: '' };
      const guessed = c.emailSource?.kind === 'guessed';
      const sent = c.launch?.sentDraft;
      return <div className="contact-draft" key={c.index}>
        <div className="contact-head"><div><strong>{c.name}</strong>{c.title && <small>{c.title}</small>}<small>{c.email}</small></div>
          {guessed ? <Badge variant="outline" className="guessed-badge">Guessed address · may bounce</Badge> : <Badge variant="secondary">Published address</Badge>}</div>
        {c.state === 'draft' ? <>
          {c.draftError && <p className="review-warning">Couldn't write a draft ({c.draftError}). You can write one below.</p>}
          <label>Subject<Input value={draft.subject} maxLength={150} onChange={e => setEdits({ ...edits, [c.index]: { ...draft, subject: e.target.value } })} /></label>
          <label>Email<Textarea rows={9} value={draft.body} maxLength={4000} onChange={e => setEdits({ ...edits, [c.index]: { ...draft, body: e.target.value } })} /></label>
          {/* One contact per click: only this button waits, and it names its own person. */}
          <Button className="w-full" disabled={busy === `approve-${c.index}` || !!blocked || !draft.subject.trim() || !draft.body.trim()} onClick={() => act(`approve-${c.index}`, { action: 'approve', companyId, discoveryId: research.id, index: c.index, subject: draft.subject, body: draft.body }, d => setNotice(`Approved ${c.name} only. Sending to ${d.deliverTo ?? c.email}; follow-ups continue automatically until they reply.`))}>
            {busy === `approve-${c.index}` ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}Approve & send to {c.name.split(' ')[0]}</Button>
          <small className="muted-line">{meta?.demoRecipient ? `Test delivery: this email goes to ${meta.demoRecipient}, not ${c.email}, with "(test: ${c.name.split(' ')[0]})" added to the subject so each contact keeps its own thread.` : `Sends to ${c.email}.`} Only this contact is approved.</small>
          {blocked ? <small className="review-warning">{blocked}</small> : guessed ? <small className="review-warning">This address was inferred from a naming pattern. Approving confirms you accept the bounce risk.</small> : null}
        </> : <>
          <Status c={c} />
          {sent && <details className="sent-draft"><summary>Approved first email{c.launch?.deliverTo ? ` · test delivery to ${c.launch.deliverTo}` : ''}</summary><p><strong>{sent.subject}</strong></p><p>{sent.body}</p></details>}
        </>}
      </div>;
    })}
  </section>;
}
