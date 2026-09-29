import type { OutreachRecord, OutreachStore, SendPatch, SequenceStatus } from '../types.js';
import { ATTR } from './schema.js';
import { parseEmailSource } from '../sourcing/types.js';

const BASE = 'https://api.attio.com/v2';

/** Attio returns every attribute as an array of value objects. */
type AttioValues = Record<string, Array<Record<string, unknown>> | undefined>;
interface AttioRecord {
  id: { record_id: string };
  values: AttioValues;
}

const first = (v: AttioValues, slug: string): unknown => {
  const arr = v[slug];
  if (!arr?.length) return undefined;
  const cell = arr[0];
  return cell.value ?? cell.option ?? cell.target_object ?? cell.full_name ?? cell.email_address;
};
const str = (v: AttioValues, s: string): string | null => {
  const raw = first(v, s);
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object' && raw !== null && 'title' in raw) return String((raw as any).title);
  return String(raw);
};
const num = (v: AttioValues, s: string, d = 0): number => {
  const raw = first(v, s);
  return raw === undefined || raw === null ? d : Number(raw);
};

/**
 * Attio REST store. Writes go through REST rather than the Attio MCP because MCP
 * write operations prompt for user confirmation, which would hang a headless run.
 */
export class AttioStore implements OutreachStore {
  constructor(
    private apiKey: string,
    private object = process.env.ATTIO_OBJECT ?? 'companies',
  ) {
    if (!apiKey) throw new Error('ATTIO_API_KEY is required');
  }

  private async call(path: string, init: RequestInit): Promise<any> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Attio ${init.method} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  private toRecord(r: AttioRecord): OutreachRecord {
    const v = r.values;
    return {
      id: r.id.record_id,
      companyName: str(v, ATTR.companyName) ?? '(unnamed)',
      contactEmail: str(v, ATTR.contactEmail) ?? '',
      contactName: str(v, ATTR.contactName) ?? undefined,
      outreachMode: str(v, ATTR.sourceDeck)?.startsWith('ui-investment:') ? 'investment' : undefined,
      assetClass: str(v, ATTR.assetClass) ?? undefined,
      companySummary: str(v, ATTR.summary) ?? undefined,
      raisedAmount: str(v, ATTR.raisedRaw) ?? undefined,
      sequenceStage: num(v, ATTR.sequenceStage),
      sequenceStatus: (str(v, ATTR.sequenceStatus) ?? 'queued') as SequenceStatus,
      nextTouchAt: str(v, ATTR.nextTouchAt),
      lastTouchAt: str(v, ATTR.lastTouchAt),
      touchCount: num(v, ATTR.touchCount),
      claimedAt: str(v, ATTR.claimedAt),
      lastSendKey: str(v, ATTR.lastSendKey),
      lastMessageId: str(v, ATTR.lastMessageId),
      lastSubject: str(v, ATTR.lastSubject),
      threadId: str(v, ATTR.threadId),
      emailSource: parseEmailSource(str(v, ATTR.emailSource)),
    };
  }

  async findDue(now: Date, limit: number): Promise<OutreachRecord[]> {
    const body = {
      filter: {
        $and: [
          { [ATTR.sequenceStatus]: { $eq: 'active' } },
          { [ATTR.nextTouchAt]: { $lte: now.toISOString() } },
        ],
      },
      sorts: [{ attribute: ATTR.nextTouchAt, direction: 'asc' }],
      limit,
    };
    const json = await this.call(`/objects/${this.object}/records/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return (json.data as AttioRecord[]).map((r) => this.toRecord(r)).slice(0, limit);
  }

  async getById(id: string): Promise<OutreachRecord> {
    const json=await this.call(`/objects/${this.object}/records/${id}`,{method:'GET'});
    return this.toRecord(json.data as AttioRecord);
  }

  async findAwaitingReply(limit: number): Promise<OutreachRecord[]> {
    const json = await this.call(`/objects/${this.object}/records/query`, {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          $and: [
            { [ATTR.sequenceStatus]: { $eq: 'active' } },
            { [ATTR.touchCount]: { $gte: 1 } },
          ],
        },
        limit,
      }),
    });
    return (json.data as AttioRecord[]).map((r) => this.toRecord(r)).slice(0, limit);
  }

  async findReplyCandidates(): Promise<OutreachRecord[]> {
    const records: OutreachRecord[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const json = await this.call(`/objects/${this.object}/records/query`, {
        method: 'POST', body: JSON.stringify({ filter: { $and: [
          { [ATTR.touchCount]: { $gte: 1 } },
          { [ATTR.lastTouchAt]: { $gte: new Date(Date.now() - 30 * 86400000).toISOString() } },
          { $or: [
            { [ATTR.sequenceStatus]: { $eq: 'active' } },
            { [ATTR.sequenceStatus]: { $eq: 'replied' } },
            { $and: [{ [ATTR.sequenceStatus]: { $eq: 'stopped' } }, { [ATTR.sequenceStage]: { $gte: 4 } }] },
          ] },
        ] }, limit: 100, offset }),
      });
      records.push(...(json.data as AttioRecord[]).map(r => this.toRecord(r)));
      if (json.data.length < 100) return records.sort((a,b) => a.id.localeCompare(b.id));
    }
    throw new Error('Reply candidate limit exceeded; refusing incomplete scan');
  }

  setThread(id: string, threadId: string) {
    return this.patch(id, { [ATTR.threadId]: threadId });
  }

  private async patch(id: string, values: Record<string, unknown>) {
    // Attio rejects `null` for clearing an attribute value ("Invalid input") — it
    // wants an empty array instead. Translate here so callers can keep writing
    // `null` to mean "clear this field", which is the natural shape everywhere else.
    const cleaned = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v === null ? [] : v]),
    );
    await this.call(`/objects/${this.object}/records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data: { values: cleaned } }),
    });
  }

  claim(id: string, at: Date) {
    return this.patch(id, { [ATTR.claimedAt]: at.toISOString() });
  }

  releaseClaim(id: string) {
    return this.patch(id, { [ATTR.claimedAt]: null });
  }

  recordSend(id: string, p: SendPatch) {
    return this.patch(id, {
      // Only written when the send reported one, so a later touch can't blank it.
      ...(p.threadId ? { [ATTR.threadId]: p.threadId } : {}),
      ...(p.lastMessageId ? { [ATTR.lastMessageId]: p.lastMessageId } : {}),
      ...(p.lastSubject ? { [ATTR.lastSubject]: p.lastSubject } : {}),
      [ATTR.sequenceStage]: p.sequenceStage,
      [ATTR.touchCount]: p.touchCount,
      [ATTR.lastTouchAt]: p.lastTouchAt,
      [ATTR.nextTouchAt]: p.nextTouchAt,
      [ATTR.lastSendKey]: p.lastSendKey,
      [ATTR.sequenceStatus]: p.sequenceStatus,
      [ATTR.claimedAt]: null,
    });
  }

  park(id: string, status: SequenceStatus, note: string) {
    return this.patch(id, {
      [ATTR.sequenceStatus]: status,
      [ATTR.nextTouchAt]: null,
      [ATTR.claimedAt]: null,
      [ATTR.reviewNote]: note,
    });
  }
}
