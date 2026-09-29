import 'dotenv/config';
import { scopeStore } from './bridge/scope.js';
import { AttioStore } from './attio/client.js';
import { FakeStore, makeRecord } from './attio/fake.js';
import { runOnce, type Logger, type Sender } from './scheduler/run.js';
import { loadPolicy } from './scheduler/policy.js';
import { slashySender } from './send/slashy.js';
import { checkReplies } from './reply/run.js';
import { slashyCall } from './reply/tools.js';
import { availabilityPolicy } from './reply/calendar.js';
import { ReplyJournal } from './reply/journal.js';
import { testDeliveryRecord, validateTestDelivery } from './send/test-delivery.js';
import { schedulerLock } from './reply/lock.js';
import { readHeartbeat, writeHeartbeat, isStale, type Heartbeat } from './health/heartbeat.js';
import { haltSending } from './send/kill-switch.js';
import { approvedFirstTouchSender, routedRecord } from './send/approved.js';
import type { OutreachStore } from './types.js';

const HB_PATH = process.env.HEARTBEAT_PATH ?? `${process.env.HOME}/.gtm-workflow/heartbeat.json`;
const DEMO = process.argv.includes('--demo');
// dotenv may have restored credentials removed by the parent worker.
if(process.env.SIGNAL_DESK_CLAUDE_MODE==='subscription'){
 delete process.env.ANTHROPIC_API_KEY;
 delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
}

const log: Logger = {
  info: (m) => console.log(`  ${m}`),
  warn: (m) => console.warn(`  ! ${m}`),
  error: (m) => console.error(`  x ${m}`),
};

async function main() {
  const policy = loadPolicy();
  const now = new Date();

  // Warn before doing anything: a stalled scheduler is the failure this project targets.
  const prev = readHeartbeat(HB_PATH);
  const interval = Number(process.env.RUN_INTERVAL_MINUTES ?? 5);
  if (prev && isStale(prev, interval, now)) {
    log.warn(`STALE: last run was ${prev.lastRunAt} (expected every ~${interval}m)`);
  }
  if (prev && prev.consecutiveFailures >= 3) {
    log.warn(`${prev.consecutiveFailures} consecutive failed runs. Last: ${prev.lastError}`);
  }

  let store: OutreachStore;
  let send: Sender;

  if (DEMO) {
    console.log('\n\x1b[1mDEMO\x1b[0m — in-memory store, no network, no credentials\n');
    store = new FakeStore([
      makeRecord({ id: 'demo1', companyName: 'Northwind Labs', contactEmail: 'ana@northwind.example', contactName: 'Ana' }),
      makeRecord({ id: 'demo2', companyName: 'Pier 9 Capital', contactEmail: 'sam@pier9.example', assetClass: 'VC' }),
      makeRecord({ id: 'demo3', companyName: 'Halcyon CRE', contactEmail: 'lee@halcyon.example', assetClass: 'CRE', sequenceStage: 2, touchCount: 2 }),
      makeRecord({ id: 'demo4', companyName: 'Replied Co', contactEmail: 'no@replied.example', sequenceStatus: 'replied' }),
      makeRecord({ id: 'demo5', companyName: 'Maxed Out Inc', contactEmail: 'no@maxed.example', touchCount: 4, sequenceStage: 4 }),
    ]);
    send = async (r, touch) => { log.info(`(demo sender) touch ${touch} -> ${r.contactEmail}`); return { ok: true }; };
  } else {
    validateTestDelivery();
    store = new AttioStore(process.env.ATTIO_API_KEY ?? '');
    if (process.env.OUTREACH_RECORD_IDS) {
      if (process.env.TEST_ONLY_RECORD_ID || process.env.TEST_DELIVERY_RECIPIENT) throw new Error('UI campaign scope cannot use test delivery overrides');
      store = scopeStore(store, process.env.OUTREACH_RECORD_IDS.split(','));
    }
    // A short-cadence inbox test must never accelerate other outreach records.
    if (process.env.TEST_ONLY_RECORD_ID) {
      const findDue = store.findDue.bind(store);
      store.findDue = async (at, limit) => (await findDue(at, limit)).filter(r =>
        r.id === process.env.TEST_ONLY_RECORD_ID && r.contactEmail === process.env.TEST_RECIPIENT);
      if (process.env.TEST_INTERVALS_MINUTES) {
        const gaps = process.env.TEST_INTERVALS_MINUTES.split(',').map(Number);
        if (!gaps.length || gaps.some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Invalid test intervals');
        policy.intervalsMinutes = gaps;
      }
      if (process.env.TEST_MAX_TOUCHES) {
        const max = Number(process.env.TEST_MAX_TOUCHES);
        if (!Number.isInteger(max) || max < 1 || max > 4) throw new Error('TEST_MAX_TOUCHES must be 1–4');
        policy.maxTouches = max;
      }
    }
    if (process.env.SIGNAL_DESK_CLAUDE_MODE!=='subscription' && !process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
      log.warn(
        'no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY set — the send leg will fail to authenticate. ' +
        'Run `claude setup-token` (uses your subscription) or set an API key in .env.',
      );
    }
    const rawSend = slashySender({
      claudeBin: process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`,
      model: process.env.SEND_MODEL ?? 'claude-haiku-4-5',
      senderName: process.env.SENDER_NAME ?? 'Vibhu',
      inboxEmail: process.env.SENDER_INBOX,
      timeoutMs: Number(process.env.SEND_TIMEOUT_MS ?? 120_000),
      oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    // Touch 1 of an approved campaign sends the reviewed words verbatim; everything
    // else is composed at send time as before.
    const firstTouch = approvedFirstTouchSender(slashyCall({
      claudeBin: process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`,
      model: process.env.SEND_MODEL ?? 'claude-haiku-4-5',
      timeoutMs: Number(process.env.SEND_TIMEOUT_MS ?? 120_000),
      oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN, apiKey: process.env.ANTHROPIC_API_KEY,
    }), process.env.SENDER_INBOX ?? '', rawSend);
    send = async (record, touch) => {
      const deliveryRecord=routedRecord(testDeliveryRecord(record));
      if(deliveryRecord.contactEmail!==record.contactEmail) log.info(`routing stored ${record.contactEmail} -> test inbox ${deliveryRecord.contactEmail}`);
      return firstTouch(deliveryRecord,touch);
    };
    if (process.env.TEST_DELIVERY_RECIPIENT) {
      log.info(`TEST DELIVERY: locked Attio record ${process.env.TEST_ONLY_RECORD_ID} routes only to ${process.env.TEST_DELIVERY_RECIPIENT}`);
    }
  }

  console.log(
    `  policy: cap=${policy.batchCap} maxTouches=${policy.maxTouches} ` +
    `dryRun=${policy.dryRun} ambiguous=${policy.ambiguousPolicy}\n`,
  );

  const hb: Heartbeat = {
    lastRunAt: now.toISOString(),
    lastSuccessAt: prev?.lastSuccessAt ?? null,
    consecutiveFailures: prev?.consecutiveFailures ?? 0,
    lastError: null,
  };

  try {
    if (!DEMO) {
      let candidates = await store.findReplyCandidates();
      if (process.env.TEST_ONLY_RECORD_ID) {
        // A one-touch test becomes `stopped` immediately, while the normal reply
        // query includes stopped records only after all four production touches.
        // Fetch the one locked test record directly so its real Gmail thread ID
        // and any reply are still discovered automatically on the next run.
        const testRecord=await store.getById(process.env.TEST_ONLY_RECORD_ID);
        const recent=testRecord.lastTouchAt&&Date.parse(testRecord.lastTouchAt)>=Date.now()-30*86400000;
        candidates=testRecord.contactEmail===process.env.TEST_RECIPIENT&&testRecord.touchCount>=1&&recent&&
          ['active','replied','stopped'].includes(testRecord.sequenceStatus)?[testRecord]:[];
      }
      candidates = candidates.map(r => routedRecord(testDeliveryRecord(r)));
      const inbox = process.env.SENDER_INBOX ?? '';
      if (!inbox && candidates.length) throw new Error('SENDER_INBOX required for reply/calendar checks');
      const call = slashyCall({
        claudeBin: process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`,
        model: process.env.SEND_MODEL ?? 'claude-haiku-4-5',
        timeoutMs: Number(process.env.REPLY_TIMEOUT_MS ?? 120000),
        oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN, apiKey: process.env.ANTHROPIC_API_KEY,
      });
      const journal = new ReplyJournal();
      const replyOptions = {
        inbox, dryRun: policy.dryRun, sender: process.env.SENDER_NAME ?? 'Vibhu',
        policy: availabilityPolicy(), limit: Number(process.env.REPLY_BATCH_CAP ?? 3),
        autoAvailability: process.env.AUTO_AVAILABILITY !== '0',
        meetingPurpose: process.env.MEETING_PURPOSE,
        conferencing: process.env.MEETING_CONFERENCING ?? 'gmeet',
      };
      const replies = await checkReplies(store, candidates, call, journal, replyOptions, log);
      log.info(`replies: stopped=${replies.stopped} availability=${replies.responded} held=${replies.failures}`);
      // Recheck a due record if its background scan was skipped or is stale.
      // This avoids starving earlier records when a batch takes longer than a minute.
      const outbound = send;
      send = async (record, touch) => {
        if (record.touchCount > 0 && Date.now() - (replies.clear.get(record.id) ?? 0) >= 60000) {
          const check = await checkReplies(store, [routedRecord(testDeliveryRecord(record))], call, journal, { ...replyOptions, limit: 1, rotate: false }, log);
          if (!check.clear.has(record.id)) return { ok: false, definitelyNotSent: true, error: 'Follow-up held: reply, booking, or failed pre-send check' };
        }
        return outbound(record, touch);
      };
      if (replies.failures) { hb.consecutiveFailures++; hb.lastError = `${replies.failures} reply/calendar checks failed; follow-ups held`; }
    }

    const s = await runOnce(store, send, policy, now, log);
    if (s.failed && !hb.lastError) { hb.consecutiveFailures++; hb.lastError = `${s.failed} sends failed or were held`; }
    if (!hb.lastError) { hb.consecutiveFailures = 0; hb.lastSuccessAt = now.toISOString(); }
    if (hb.consecutiveFailures >= 3 && !DEMO) {
      haltSending(`${hb.consecutiveFailures} consecutive scheduler failures. Sending halted until a human resumes it.`, 'failures');
      log.error('kill switch engaged after repeated scheduler failures');
    }
    console.log(
      `\n  ${policy.dryRun ? 'would send' : 'sent'} ${s.sent}` +
      ` | considered ${s.considered} | locked ${s.skippedLocked}` +
      ` | duplicate ${s.skippedDuplicate} | repaired ${s.repaired}` +
      ` | parked ${s.parked} | failed ${s.failed}\n`,
    );
  } catch (err) {
    hb.consecutiveFailures += 1;
    hb.lastError = String(err);
    console.error(`\n  RUN FAILED: ${err}\n`);
    if (hb.consecutiveFailures >= 3 && !DEMO) haltSending(`${hb.consecutiveFailures} consecutive scheduler failures. Sending halted until a human resumes it.`, 'failures');
    writeHeartbeat(HB_PATH, hb);
    process.exitCode = 1;
    return;
  }

  writeHeartbeat(HB_PATH, hb);
}

let unlock: (() => void) | undefined;
try { if (!DEMO) unlock = schedulerLock(); await main(); }
catch (e) { console.error(String(e)); process.exitCode = 1; }
finally { unlock?.(); }
