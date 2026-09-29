import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OutreachRecord, SendResult } from '../types.js';
import type { Sender } from '../scheduler/run.js';
import type { ToolCall } from '../reply/tools.js';
import { sendGuardDir } from './runtime-dir.js';
import { guardSend } from './guard.js';
import { bodyBlocks, validateDraft, type FirstTouchDraft } from './draft.js';

/**
 * Per-record facts fixed at launch: the exact first email the user approved and,
 * for test delivery, the one address every touch goes to. Stored beside the other
 * send-guard ledgers so the scheduler child process reads the same files.
 */
interface Entry { draft?: FirstTouchDraft & { approvedAt: string }; deliverTo?: string }
type Ledger = Record<string, Entry>;

const path = () => resolve(sendGuardDir(), 'approved-outreach.json');
function load(): Ledger {
  if (!existsSync(path())) return {};
  try { const raw = JSON.parse(readFileSync(path(), 'utf8')); return raw && typeof raw === 'object' ? raw : {}; } catch { return {}; }
}
function save(ledger: Ledger) { writeFileSync(path() + '.tmp', JSON.stringify(ledger), { mode: 0o600 }); renameSync(path() + '.tmp', path()); }

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Written before the record is activated, so the scheduler never sees it without these. */
export function recordApproval(recordId: string, a: { draft?: FirstTouchDraft; deliverTo?: string }) {
  const ledger = load();
  const entry: Entry = {};
  if (a.draft) entry.draft = { ...validateDraft(a.draft), approvedAt: new Date().toISOString() };
  if (a.deliverTo) { if (!EMAIL.test(a.deliverTo)) throw new Error('Invalid test delivery address'); entry.deliverTo = a.deliverTo.toLowerCase(); }
  ledger[recordId] = entry; save(ledger);
}
export function approvedDraftFor(recordId: string) { return load()[recordId]?.draft; }
export function deliveryRouteFor(recordId: string) { return load()[recordId]?.deliverTo; }

/**
 * Test delivery is pinned per record at launch. Turning the Settings switch off
 * later never redirects an existing test campaign to the real founder.
 */
export function routedRecord(r: OutreachRecord): OutreachRecord {
  const to = deliveryRouteFor(r.id);
  return to ? { ...r, contactEmail: to } : r;
}

/**
 * Test delivery sends every contact to one inbox, where Gmail merges identical
 * subjects into one thread and a single reply would then book for every contact.
 * Tagging the subject keeps one thread per contact.
 */
export function testSubject(r: OutreachRecord, subject: string) {
  if (!deliveryRouteFor(r.id)) return subject;
  const who = (r.contactName ?? '').trim().split(/\s+/)[0] || r.id.slice(0, 8);
  return `${subject} (test: ${who})`;
}

const threadOf = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : undefined;

/**
 * Touch 1 sends the approved words verbatim through exact, verified tool calls.
 * Every later touch (and any record without an approved draft) uses `fallback`.
 */
export function approvedFirstTouchSender(call: ToolCall, inbox: string, fallback: Sender): Sender {
  return async (r: OutreachRecord, touch: number): Promise<SendResult> => {
    const draft = touch === 1 && r.touchCount === 0 ? approvedDraftFor(r.id) : undefined;
    if (!draft) return fallback(r, touch);
    const blocked = guardSend(r, touch);
    if (blocked) return blocked;
    if (!inbox) return { ok: false, definitelyNotSent: true, error: 'Sender inbox is missing' };
    const subject = testSubject(r, draft.subject);
    let created: any;
    try {
      created = await call('draft_email', { inbox_email: inbox, to: [r.contactEmail], subject, body_blocks: bodyBlocks(draft.body) });
    } catch (e) { return { ok: false, definitelyNotSent: true, error: `Approved draft could not be created: ${e}` }; }
    if (!created?.draft_id || created.to?.length !== 1 || created.to[0].email?.toLowerCase() !== r.contactEmail.toLowerCase() || created.cc?.length || created.bcc?.length) {
      return { ok: false, definitelyNotSent: true, error: 'Approved draft recipient mismatch; not sent' };
    }
    let sent: any;
    try { sent = await call('send_email', { inbox_email: inbox, draft_id: created.draft_id }); }
    catch (e) { return { ok: false, error: `Unknown send outcome for approved draft: ${e}` }; }
    if (!['queued', 'sent', 'delivered'].includes(sent?.delivery_status)) return { ok: false, error: 'Unknown send result for approved draft' };
    const messageId = typeof sent.message_id === 'string' && /^<[^<>\s]+@[^<>\s]+>$/.test(sent.message_id) ? sent.message_id : undefined;
    return { ok: true, threadId: threadOf(sent.thread_id) ?? threadOf(created.thread_id), messageId, subject };
  };
}
