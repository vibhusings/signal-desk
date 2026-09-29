import type { OutreachRecord, OutreachStore, SendPatch, SequenceStatus } from '../types.js';

/**
 * In-memory OutreachStore. Lets the scheduler's guarantees be tested without an
 * Attio account, credentials, or network. Mirrors the real client's semantics,
 * including honouring `limit` at the query.
 */
export class FakeStore implements OutreachStore {
  records = new Map<string, OutreachRecord>();
  writes: Array<{ op: string; id: string }> = [];
  /** Set to make the next write of this kind throw, to simulate a crash. */
  failNextWrite: string | null = null;

  constructor(seed: OutreachRecord[] = []) {
    for (const r of seed) this.records.set(r.id, { ...r });
  }

  async getById(id: string): Promise<OutreachRecord> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Record not found: ${id}`);
    return { ...record };
  }

  private maybeFail(op: string, id: string) {
    this.writes.push({ op, id });
    if (this.failNextWrite === op) {
      this.failNextWrite = null;
      throw new Error(`simulated crash during ${op}`);
    }
  }

  async findDue(now: Date, limit: number): Promise<OutreachRecord[]> {
    return [...this.records.values()]
      .filter(
        (r) =>
          r.sequenceStatus === 'active' &&
          r.nextTouchAt !== null &&
          new Date(r.nextTouchAt) <= now,
      )
      .sort((a, b) => (a.nextTouchAt! < b.nextTouchAt! ? -1 : 1))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async findAwaitingReply(limit: number): Promise<OutreachRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.sequenceStatus === 'active' && r.touchCount >= 1)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async findReplyCandidates(): Promise<OutreachRecord[]> {
    return [...this.records.values()].filter(r => r.touchCount > 0 && (['active','replied'].includes(r.sequenceStatus) || (r.sequenceStatus === 'stopped' && r.sequenceStage >= 4))).map(r => ({...r}));
  }
  async setThread(id: string, threadId: string) { this.maybeFail('setThread',id); this.records.get(id)!.threadId = threadId; }

  async claim(id: string, at: Date) {
    this.maybeFail('claim', id);
    const r = this.records.get(id)!;
    r.claimedAt = at.toISOString();
  }

  async releaseClaim(id: string) {
    this.maybeFail('releaseClaim', id);
    this.records.get(id)!.claimedAt = null;
  }

  async recordSend(id: string, patch: SendPatch) {
    this.maybeFail('recordSend', id);
    const r = this.records.get(id)!;
    Object.assign(r, patch, { claimedAt: null });
  }

  async park(id: string, status: SequenceStatus, _note: string) {
    this.maybeFail('park', id);
    const r = this.records.get(id)!;
    r.sequenceStatus = status;
    r.nextTouchAt = null;
    r.claimedAt = null;
  }
}

export function makeRecord(over: Partial<OutreachRecord> = {}): OutreachRecord {
  const id = over.id ?? `rec_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    companyName: `Company ${id}`,
    contactEmail: `founder@${id}.example`,
    sequenceStage: 0,
    sequenceStatus: 'active',
    nextTouchAt: new Date(0).toISOString(),
    lastTouchAt: null,
    touchCount: 0,
    claimedAt: null,
    lastSendKey: null,
    lastMessageId: null,
    lastSubject: null,
    threadId: null,
    ...over,
  };
}
