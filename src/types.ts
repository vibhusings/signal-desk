/** One company in the outreach sequence. All durable state lives in these fields. */
export interface OutreachRecord {
  id: string;
  companyName: string;
  contactEmail: string;
  contactName?: string;
  outreachMode?: 'investment';
  assetClass?: string;

  /** Sourcing context, written at ingest. Read only by the copy prompt. */
  companySummary?: string;
  raisedAmount?: string;

  /** 0 = nothing sent yet. N = N touches delivered. */
  sequenceStage: number;
  sequenceStatus: SequenceStatus;

  /** The scheduler's query key. null = not scheduled. */
  nextTouchAt: string | null;
  lastTouchAt: string | null;
  touchCount: number;

  /** Set immediately before a send. An in-flight lock, not an audit field. */
  claimedAt: string | null;

  /** `${id}:${stage}` of the last CONFIRMED send. The duplicate guard. */
  lastSendKey: string | null;

  /** RFC Message-ID returned by the confirmed send, used to resolve the Gmail thread exactly. */
  lastMessageId: string | null;
  /** Subject returned by the confirmed send, used only to narrow thread discovery. */
  lastSubject: string | null;

  /**
   * The email thread touch 1 started. Every later touch replies into it, so the
   * whole sequence lands as one conversation rather than N disconnected emails.
   * Captured from the send result; null until the first successful send.
   */
  threadId: string | null;

  /** How the address was sourced. Guessed addresses need send-time approval for touch 1. */
  emailSource?: import('./sourcing/types.js').EmailSource;
}

export type SequenceStatus =
  | 'queued'
  | 'active'
  | 'replied'
  | 'booked'
  | 'bounced'
  | 'stopped'
  | 'unsubscribed'
  | 'needs_review';

/** Statuses the scheduler will act on. Everything else is terminal or parked. */
export const SENDABLE_STATUSES: SequenceStatus[] = ['active'];

export interface SendResult {
  ok: boolean;
  error?: string;
  /** True only when we know no message left the building. Safe to retry. */
  definitelyNotSent?: boolean;
  /** Thread the message landed in, so later touches can reply into it. */
  threadId?: string;
  /** RFC Message-ID from the send result; unlike timestamps, this identifies one message. */
  messageId?: string;
  subject?: string;
}

export interface OutreachStore {
  getById(id: string): Promise<OutreachRecord>;
  findDue(now: Date, limit: number): Promise<OutreachRecord[]>;
  /** Records already emailed at least once and still running — candidates for a booking. */
  findAwaitingReply(limit: number): Promise<OutreachRecord[]>;
  findReplyCandidates(): Promise<OutreachRecord[]>;
  setThread(id: string, threadId: string): Promise<void>;
  claim(id: string, at: Date): Promise<void>;
  releaseClaim(id: string): Promise<void>;
  recordSend(id: string, patch: SendPatch): Promise<void>;
  park(id: string, status: SequenceStatus, note: string): Promise<void>;
}

export interface SendPatch {
  sequenceStage: number;
  touchCount: number;
  lastTouchAt: string;
  nextTouchAt: string | null;
  lastSendKey: string;
  sequenceStatus: SequenceStatus;
  /** Only set on the touch that starts the thread; omitted leaves it unchanged. */
  threadId?: string;
  /** Persisted correlation key for resolving a queued send's final Gmail thread. */
  lastMessageId?: string;
  lastSubject?: string;
}

export const sendKeyFor = (r: OutreachRecord): string => `${r.id}:${r.sequenceStage}`;
