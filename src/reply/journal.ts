import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export interface ReplyJob {
  recordId: string;
  messageId: string;
  threadId: string;
  state: 'pending' | 'booking' | 'booked' | 'sending' | 'sent' | 'review' | 'handled';
  updatedAt: string;
  note?: string;
  slots?: string[];
  selectedSlot?: string;
  eventId?: string;
  eventTitle?: string;
  meetLink?: string;
}
export class ReplyJournal {
  constructor(private dir = '.runtime/replies') { mkdirSync(dir,{recursive:true}); }
  private path(key: string) { return join(this.dir, createHash('sha256').update(key).digest('hex')+'.json'); }
  get(recordId: string, messageId: string): ReplyJob | undefined {
    const p=this.path(recordId+':'+messageId); if(!existsSync(p))return undefined;
    return JSON.parse(readFileSync(p,'utf8'));
  }
  save(job: ReplyJob) {
    const p=this.path(job.recordId+':'+job.messageId);writeFileSync(p+'.tmp',JSON.stringify(job,null,2),{mode:0o600});renameSync(p+'.tmp',p);
  }
  /** Times we most recently emailed to this record, so "let's do Tuesday" takes the Tuesday we proposed. */
  offeredSlots(recordId: string): string[] {
    let latest: ReplyJob | undefined;
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const j: ReplyJob = JSON.parse(readFileSync(join(this.dir, f), 'utf8'));
        if (j.recordId === recordId && j.state === 'sent' && j.slots?.length && (!latest || j.updatedAt > latest.updatedAt)) latest = j;
      } catch { /* a half-written or foreign file is not an offer */ }
    }
    return latest?.slots ?? [];
  }
  cursor(): number { const p=join(this.dir,'cursor'); return existsSync(p)?Number(readFileSync(p,'utf8'))||0:0; }
  advance(n:number) { writeFileSync(join(this.dir,'cursor'),String(n)); }
}
