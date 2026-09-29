import type { ToolCall } from '../reply/tools.js';
import { bodyBlocks, validateDraft } from './draft.js';
import { isSendingHalted } from './kill-switch.js';

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * One recommendation email. It does not create an outreach sequence or schedule follow-ups.
 * Test delivery, when set, is the only recipient.
 */
export async function sendReferral(call: ToolCall, inbox: string, payload: { to?: unknown; toName?: unknown; subject?: unknown; body?: unknown; deliverTo?: unknown }) {
  if (isSendingHalted()) return { ok: false as const, error: 'Sending is halted' };
  if (!inbox) return { ok: false as const, error: 'Sender inbox is missing' };
  const to = typeof payload.to === 'string' ? payload.to.trim().toLowerCase() : '';
  const toName = typeof payload.toName === 'string' ? payload.toName.trim() : '';
  const deliverTo = typeof payload.deliverTo === 'string' && payload.deliverTo.trim() ? payload.deliverTo.trim().toLowerCase() : '';
  if (!EMAIL.test(to) || (deliverTo && !EMAIL.test(deliverTo))) return { ok: false as const, error: 'Invalid referral recipient' };
  const draft = validateDraft({ subject: payload.subject, body: payload.body });
  const recipient = deliverTo || to;
  const who = toName.split(/\s+/)[0] || 'VC';
  const subject = deliverTo ? `${draft.subject} (test: ${who})` : draft.subject;
  if (subject.length > 150) return { ok: false as const, error: 'Subject must be 3-150 characters' };
  let created: any;
  try {
    created = await call('draft_email', { inbox_email: inbox, to: [recipient], subject, body_blocks: bodyBlocks(draft.body) });
  } catch (e) { return { ok: false as const, error: `Referral draft could not be created: ${e}` }; }
  if (!created?.draft_id || created.to?.length !== 1 || created.to[0].email?.toLowerCase() !== recipient || created.cc?.length || created.bcc?.length) {
    return { ok: false as const, error: 'Referral recipient mismatch; not sent' };
  }
  let sent: any;
  try { sent = await call('send_email', { inbox_email: inbox, draft_id: created.draft_id }); }
  catch (e) { return { ok: false as const, error: `Unknown send outcome for referral: ${e}` }; }
  if (!['queued', 'sent', 'delivered'].includes(sent?.delivery_status)) return { ok: false as const, error: 'Unknown send result for referral' };
  return { ok: true as const, to: recipient, subject, testDelivery: !!deliverTo };
}
