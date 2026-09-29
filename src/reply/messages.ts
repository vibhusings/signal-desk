import type { OutreachRecord } from '../types.js';
import type { ToolCall } from './tools.js';
export interface Message { id: string; message_id?: string; threadId: string; from: {email: string}; to: Array<{email:string}>; date: string; direction: string; body: string; isDraft?: boolean; isTrash?: boolean; isSpam?: boolean; subject?: string;
  /** Rebuilt from a Gmail search preview because Slashy's stored thread lagged behind. */
  fromSearch?: boolean;
  /** The preview may be cut off, so the text cannot be trusted to hold every detail. */
  partial?: boolean }
export interface Conversation { threadId: string; messages: Message[]; subject: string }
export function plainReply(body: string): string {
  return body.split(/<blockquote|<div[^>]*class=["'][^"']*gmail_quote/i)[0]
    .replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi,'\n').replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"')
    .split(/\n\s*(?:On .+wrote:|From:|>)/i)[0].trim();
}
export function replyIntent(body: string): 'schedule' | 'unsubscribe' | 'complaint' | 'review' {
  const s = plainReply(body).toLowerCase().replace(/[‘’]/g, "'");
  if (/\b(this is spam|mark(?:ed|ing)? as spam|report(?:ed|ing)? (?:as )?spam)\b/.test(s)) return 'complaint';
  if (/\b(unsubscribe|remove me|stop (emailing|contacting)|do not contact|don't contact)\b/.test(s)) return 'unsubscribe';
  // A weekday or time in a rejection is not consent to book. Hold mixed negative
  // and positive proposals for review instead of choosing the wrong clause.
  if (/\b(not interested|no thanks|not hiring|not (?:available|free)|doesn't work|does not work|out of (the )?office|automatic reply|auto.?reply|unable|unavailable|don't|do not|cannot|can't)\b/.test(s)) return 'review';
  const proposedWindow = /\b(?:mon(?:day)?|tue(?:sday|s)?|wed(?:nesday)?|thu(?:rsday|rs)?|fri(?:day)?|today|tomorrow|next week|morning|afternoon|evening|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/.test(s)
    && /(?:\b(?:works?|available|free|can do|could do|how about|does .+ work|sounds good|that works)\b|\blet['’]?s (?:do|go with|say|book)\b|\bi['’]?ll take\b)/.test(s);
  const specificWindow = /\b(?:mon(?:day)?|tue(?:sday|s)?|wed(?:nesday)?|thu(?:rsday|rs)?|fri(?:day)?|today|tomorrow|next week)\b/.test(s)
    && /\b(?:morning|afternoon|evening|after|before|between|at|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/.test(s);
  if (proposedWindow || specificWindow) return 'schedule';
  // Conservative: requests for availability or an explicit invitation to talk.
  // "are you free/available" is asked at least as often as "when are you free",
  // and reads as a scheduling request with or without a day attached.
  if (/\b(availability|available times|send (me |us |over )?(some |your )?(times|slots)|(when|what time) (are you|would you be) (free|available)|are you (free|available)|what (times?|days?) (work|works)|let['’]?s (schedule|chat|talk|meet)|happy to (chat|talk|meet)|(set ?up|schedule|book|hop on|jump on) (a |an |the )?(call|meeting|interview|chat))\b/.test(s)) return 'schedule';
  return 'review';
}
export function latestReply(c: Conversation, r: OutreachRecord, inbox: string): Message | undefined {
  const sent = c.messages.filter(m => m.direction === 'SENT' && m.from.email.toLowerCase() === inbox.toLowerCase() && m.to.some(t=>t.email.toLowerCase()===r.contactEmail.toLowerCase()) && !m.isDraft);
  if (!sent.length) throw new Error('Thread contains no outbound email to this contact');
  const first = Math.min(...sent.map(m=>Date.parse(m.date)));
  return c.messages.filter(m => m.direction === 'RECEIVED' && m.from.email.toLowerCase() === r.contactEmail.toLowerCase() && m.to.some(t=>t.email.toLowerCase()===inbox.toLowerCase()) && Date.parse(m.date) >= first && !m.isDraft && !m.isTrash && !m.isSpam).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
}
const bounceSender = /mailer-daemon|postmaster|mail-daemon|noreply.*bounce/i;
const bounceText = /delivery (?:status notification|failure)|undeliverable|address (?:not found|rejected)|user unknown|mailbox unavailable|550[ -]5\.1\.1/i;
export function latestDeliveryFailure(c: Conversation, r: OutreachRecord, inbox: string): Message | undefined {
  const sent = c.messages.filter(m => m.direction === 'SENT' && m.from.email.toLowerCase() === inbox.toLowerCase() && m.to.some(t=>t.email.toLowerCase()===r.contactEmail.toLowerCase()) && !m.isDraft);
  if (!sent.length) return undefined;
  const first = Math.min(...sent.map(m=>Date.parse(m.date)));
  return c.messages.filter(m => {
    if (m.direction !== 'RECEIVED' || Date.parse(m.date) < first || m.isDraft || m.isTrash) return false;
    const text = `${m.subject ?? ''}\n${plainReply(m.body)}`;
    const mentions = text.toLowerCase().includes(r.contactEmail.toLowerCase());
    return bounceSender.test(m.from.email) || (bounceText.test(text) && mentions);
  }).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
}
/** Deterministic, so the batched pre-fetch in checkReplies can serve it from cache. */
export const replySearchArgs = (inbox: string, contactEmail: string) =>
  ({ inbox_email: inbox, q: `from:${contactEmail} newer_than:30d`, maxResults: 20 });

/** Drop the quoted original that Gmail previews run inline ("... On Sun, Sep 27 ... wrote: ..."). */
function previewReply(snippet: string): { body: string; partial: boolean } {
  const cut = snippet.search(/\s+On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b[^]{0,120}?\bwrote:/);
  if (cut >= 0) return { body: snippet.slice(0, cut).trim(), partial: false };
  return { body: snippet.trim(), partial: snippet.length >= 140 };
}

/**
 * Slashy's read_thread serves a stored copy that can lag incoming mail by many
 * minutes, while its Gmail search reads Gmail directly. When the search shows more
 * messages from this contact in this thread than the stored copy, add the missing
 * newest ones from the search preview. Never removes or rewrites stored messages.
 */
export async function withSearchedReplies(call: ToolCall, c: Conversation, r: OutreachRecord, inbox: string): Promise<Conversation> {
  let found: any;
  try { found = await call('list_messages', replySearchArgs(inbox, r.contactEmail)); } catch { return c; }
  const thread = (Array.isArray(found?.threads) ? found.threads : []).find((t: any) => t.thread_id === c.threadId);
  if (!thread || !Array.isArray(thread.messages)) return c;
  const contact = r.contactEmail.toLowerCase();
  const fromContact = thread.messages.filter((m: any) => typeof m.from === 'string' && m.from.toLowerCase() === contact && typeof m.snippet === 'string');
  const stored = c.messages.filter(m => m.direction === 'RECEIVED' && m.from.email.toLowerCase() === contact).length;
  if (fromContact.length <= stored) return c;
  const missing = fromContact
    .map((m: any) => ({ m, at: Date.parse(String(m.date ?? '').replace(' at ', ' ')) }))
    .filter((x: any) => Number.isFinite(x.at))
    .sort((a: any, b: any) => a.at - b.at)
    .slice(-(fromContact.length - stored));
  const added: Message[] = missing.map(({ m, at }: any) => {
    const { body, partial } = previewReply(m.snippet);
    const date = new Date(at).toISOString();
    return { id: `search:${c.threadId}:${date}`, threadId: c.threadId, from: { email: r.contactEmail }, to: [{ email: inbox }], date, direction: 'RECEIVED', body, subject: c.subject, fromSearch: true, partial };
  });
  return { ...c, messages: [...c.messages, ...added] };
}

export async function readConversation(call: ToolCall, r: OutreachRecord, inbox: string, knownThread?: string): Promise<Conversation> {
  let id = r.threadId ?? knownThread;
  const read = async (threadId: string): Promise<Conversation> => {
    if (!/^[0-9a-f]{16}$/.test(threadId)) throw new Error('Invalid thread ID');
    const full = await call('read_thread', { inbox_email: inbox, thread_id: threadId });
    if (full.thread_id !== threadId || full.inbox_email !== inbox || !Array.isArray(full.messages) || full.message_count !== full.messages.length || full.truncated === true) throw new Error('Incomplete or mismatched thread');
    for (const m of full.messages) if (!m.id || m.threadId !== threadId || !m.from?.email || !Array.isArray(m.to) || typeof m.body !== 'string' || !Number.isFinite(Date.parse(m.date))) throw new Error('Malformed message evidence');
    return { threadId, messages:full.messages, subject:full.subject };
  };
  if (!id) {
    if (!r.lastMessageId && !r.lastTouchAt) throw new Error('Cannot identify outreach without a message ID or last touch time');
    const exact = !!r.lastMessageId && !!r.lastSubject;
    const escapedSubject = r.lastSubject?.replace(/([\\"])/g,'\\$1');
    if (exact) {
      // Slashy answers subject/to: searches from an index that has missed fresh sent mail
      // for 30+ minutes, while a bare date-window listing reads its up-to-date store.
      // List recent sent threads, narrow by exact subject here, and still require the
      // exact Message-ID below: correlation is never weaker than the indexed search.
      const since = Date.parse(r.lastTouchAt ?? '') || Date.now();
      const days = Math.min(30, Math.max(1, Math.ceil((Date.now() - since) / 86400000) + 1));
      const recent = await call('list_messages', { inbox_email: inbox, q: `in:sent newer_than:${days}d`, maxResults: 50 }).catch(() => null);
      if (Array.isArray(recent?.threads) && recent.pagination?.has_more === false) {
        const matches: Conversation[] = [];
        for (const candidate of recent.threads) {
          if (candidate.subject !== r.lastSubject || !/^[0-9a-f]{16}$/.test(candidate.thread_id ?? '')) continue;
          const conversation = await read(candidate.thread_id);
          if (conversation.messages.some(m => m.message_id === r.lastMessageId && m.direction === 'SENT' &&
            m.from.email.toLowerCase() === inbox.toLowerCase() && m.to.some(t => t.email.toLowerCase() === r.contactEmail.toLowerCase()))) matches.push(conversation);
        }
        if (matches.length === 1) return withSearchedReplies(call, matches[0], r, inbox);
        if (matches.length > 1) throw new Error('Outreach thread is missing or ambiguous');
      }
    }
    const query = exact
      ? `to:${r.contactEmail} in:sent subject:"${escapedSubject}"`
      : `to:${r.contactEmail} in:sent after:${Math.floor(Date.parse(r.lastTouchAt!)/1000)-180}`;
    const result = await call('list_messages', { inbox_email: inbox, q: query, maxResults: 50 });
    if (!Array.isArray(result.threads) || result.pagination?.has_more !== false) throw new Error('Incomplete thread search');
    if (exact) {
      const matches: Conversation[] = [];
      for (const candidate of result.threads) {
        if (!/^[0-9a-f]{16}$/.test(candidate.thread_id ?? '')) continue;
        const conversation = await read(candidate.thread_id);
        if (conversation.messages.some(m => m.message_id === r.lastMessageId && m.direction === 'SENT' &&
          m.from.email.toLowerCase() === inbox.toLowerCase() && m.to.some(t => t.email.toLowerCase() === r.contactEmail.toLowerCase()))) matches.push(conversation);
      }
      if (matches.length !== 1) throw new Error('Outreach thread is missing or ambiguous');
      return withSearchedReplies(call, matches[0], r, inbox);
    }
    // Timestamp matching remains only for records sent before exact correlation
    // was stored, and must still produce exactly one candidate.
    const candidates = result.threads.filter((t:any) => t.messages?.some((m:any) =>
      m.direction === 'SENT' && m.from === inbox && Math.abs(Date.parse(m.date)-Date.parse(r.lastTouchAt!)) <= 180000));
    if (candidates.length !== 1) throw new Error('Outreach thread is missing or ambiguous');
    // The tool result is untyped, so a missing thread_id would otherwise reach read()
    // as undefined and surface as a confusing "Invalid thread ID" instead of the
    // actual problem, which is that the search came back without one.
    const found = candidates[0].thread_id;
    if (typeof found !== 'string') throw new Error('Matched thread carries no thread_id');
    id = found;
  }
  return withSearchedReplies(call, await read(id), r, inbox);
}
