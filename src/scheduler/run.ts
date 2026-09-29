import {
  type OutreachRecord,
  type OutreachStore,
  type SendResult,
  SENDABLE_STATUSES,
} from '../types.js';
import { type Policy, isLocked, inQuietHours, nextTouchAfter } from './policy.js';
import { guardSend } from '../send/guard.js';
import { isSendingHalted } from '../send/kill-switch.js';
import { recordDeliveryOutcome } from '../send/reputation.js';
import { needsFirstTouchApproval } from '../send/first-touch.js';

export type Sender = (r: OutreachRecord, touch: number) => Promise<SendResult>;

export interface RunSummary {
  considered: number;
  sent: number;
  skippedLocked: number;
  skippedDuplicate: number;
  repaired: number;
  parked: number;
  failed: number;
  dryRun: boolean;
}

export interface Logger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

/** The touch number about to go out for this record. */
export const nextTouchNumber = (r: OutreachRecord) => r.sequenceStage + 1;
/** Idempotency key for the touch about to go out. */
export const keyForNextTouch = (r: OutreachRecord) => `${r.id}:${nextTouchNumber(r)}`;

/**
 * One scheduler pass. Deterministic: the caller supplies `now`, the store, and the
 * sender, so every branch below is testable without network, credentials, or clocks.
 *
 * Ordering is deliberate — claim is written BEFORE the send, and the stage advance is
 * written immediately after each individual send, never batched at the end of the run.
 * A crash can therefore lose at most the bookkeeping for one message, never for twenty.
 */
export async function runOnce(
  store: OutreachStore,
  send: Sender,
  policy: Policy,
  now: Date,
  log: Logger,
): Promise<RunSummary> {
  const s: RunSummary = {
    considered: 0, sent: 0, skippedLocked: 0, skippedDuplicate: 0,
    repaired: 0, parked: 0, failed: 0, dryRun: policy.dryRun,
  };

  if (inQuietHours(now, policy)) {
    log.info('within quiet hours — no sends this pass');
    return s;
  }

  if (isSendingHalted()) {
    log.warn('kill switch halted sending — no outbound this pass');
    return s;
  }

  // The batch cap is applied at the query, so a backlog of 500 can never
  // materialise as 500 sends no matter how long the scheduler was down.
  const due = await store.findDue(now, policy.batchCap);
  s.considered = due.length;

  if (due.length > policy.batchCap) {
    // A store that ignores the limit must not be trusted to bound the blast.
    throw new Error(
      `store returned ${due.length} records for limit ${policy.batchCap} — refusing to send`,
    );
  }

  for (const r of due) {
    if (!SENDABLE_STATUSES.includes(r.sequenceStatus)) continue;

    if (r.touchCount >= policy.maxTouches) {
      await store.park(r.id, 'stopped', `reached max touches (${policy.maxTouches})`);
      s.parked++;
      continue;
    }

    if (isLocked(r, now, policy)) {
      log.info(`skip ${r.id} — claimed ${r.claimedAt}, another run may be mid-send`);
      s.skippedLocked++;
      continue;
    }

    const key = keyForNextTouch(r);
    const touch = nextTouchNumber(r);

    if (needsFirstTouchApproval(r, touch)) {
      await store.park(r.id, 'needs_review', 'Guessed first-touch held for send-time approval');
      s.parked++;
      log.warn(`holding ${r.id} — guessed first-touch requires send-time approval`);
      continue;
    }

    const blocked = guardSend(r, touch);
    if (blocked) {
      log.warn(`send tool refused ${r.id}: ${blocked.error}`);
      if (isSendingHalted()) return s;
      continue;
    }

    // Confirmed-sent but the stage never advanced: repair the bookkeeping, do NOT resend.
    if (r.lastSendKey === key) {
      log.warn(`repairing ${r.id} — touch ${touch} confirmed sent but stage not advanced`);
      await store.recordSend(r.id, {
        sequenceStage: touch,
        touchCount: r.touchCount + 1,
        lastTouchAt: r.lastTouchAt ?? now.toISOString(),
        nextTouchAt: nextTouchAfter(touch, now, policy),
        lastSendKey: key,
        sequenceStatus: nextTouchAfter(touch, now, policy) ? 'active' : 'stopped',
      });
      s.repaired++;
      s.skippedDuplicate++;
      continue;
    }

    // A stale claim with no confirmation is genuinely ambiguous: the message may or
    // may not have gone out. For cold outreach a duplicate is worse than a delay, so
    // the default is to park it for a human rather than gamble.
    if (r.claimedAt && !isLocked(r, now, policy)) {
      if (policy.ambiguousPolicy === 'review') {
        log.warn(`parking ${r.id} — stale claim from ${r.claimedAt}, send outcome unknown`);
        await store.park(r.id, 'needs_review', `stale claim ${r.claimedAt}; unknown send outcome`);
        s.parked++;
        continue;
      }
      log.warn(`retrying ${r.id} despite stale claim (AMBIGUOUS_POLICY=retry)`);
    }

    if (policy.dryRun) {
      log.info(`DRY_RUN would send touch ${touch} to ${r.contactEmail} (${r.companyName})`);
      s.sent++;
      continue;
    }

    await store.claim(r.id, now);

    let result: SendResult;
    try {
      result = await send(r, touch);
    } catch (err) {
      result = { ok: false, error: String(err) };
    }

    if (result.ok) {
      const next = nextTouchAfter(touch, now, policy);
      await store.recordSend(r.id, {
        sequenceStage: touch,
        touchCount: r.touchCount + 1,
        lastTouchAt: now.toISOString(),
        nextTouchAt: next,
        lastSendKey: key,
        sequenceStatus: next ? 'active' : 'stopped',
        threadId: result.threadId ?? r.threadId ?? undefined,
        lastMessageId: result.messageId ?? r.lastMessageId ?? undefined,
        lastSubject: result.subject ?? r.lastSubject ?? undefined,
      });
      s.sent++;
      recordDeliveryOutcome('sent', r.id, r.contactEmail);
      log.info(`sent touch ${touch} to ${r.contactEmail}`);
    } else if (result.definitelyNotSent) {
      // The sender proved nothing left the building — safe to clear and retry next pass.
      await store.releaseClaim(r.id);
      s.failed++;
      log.error(`send failed for ${r.id} (nothing sent, will retry): ${result.error}`);
    } else {
      // Unknown outcome. Leave the claim set so the ambiguous branch above handles it.
      s.failed++;
      log.error(`send failed for ${r.id} with UNKNOWN outcome: ${result.error}`);
    }
  }

  return s;
}
