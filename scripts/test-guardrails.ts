import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeStore, makeRecord } from '../src/attio/fake.js';
import { runOnce, type Sender } from '../src/scheduler/run.js';
import { loadPolicy, type Policy } from '../src/scheduler/policy.js';
import { approveFirstTouch } from '../src/send/first-touch.js';
import { guardSend } from '../src/send/guard.js';
import { haltSending, isSendingHalted, resumeSending } from '../src/send/kill-switch.js';
import { recordDeliveryOutcome } from '../src/send/reputation.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const NOW = new Date('2026-09-02T12:00:00Z');
const policy = (): Policy => ({ ...loadPolicy({ DRY_RUN: '0' } as NodeJS.ProcessEnv), intervalsMinutes: [10, 10, 10] });
const countingSender = () => {
  const sent: string[] = [];
  const fn: Sender = async (r) => { sent.push(r.id); return { ok: true }; };
  return { fn, sent };
};

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  process.env.SEND_GUARD_DIR = mkdtempSync(join(tmpdir(), 'guard-'));
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (e) { console.log(`  \x1b[31m✗ ${name}\x1b[0m\n      ${(e as Error).message}`); failed++; }
}

console.log('\n\x1b[1mSend-path guardrails\x1b[0m');

await test('guessed first-touch is refused by the send tool itself', async () => {
  const r = makeRecord({ id: 'g1', emailSource: { kind: 'guessed', pattern: 'first@co.com' } });
  const blocked = guardSend(r, 1);
  assert.equal(blocked?.ok, false);
  assert.equal(blocked?.definitelyNotSent, true);
  assert.match(blocked?.error ?? '', /Guessed first-touch/);
});

await test('approved guessed first-touch can send, then follow-ups do not need another approval', async () => {
  const store = new FakeStore([makeRecord({ id: 'g2', emailSource: { kind: 'guessed', pattern: 'first@co.com' } })]);
  const first = countingSender();
  await runOnce(store, first.fn, policy(), NOW, quiet);
  assert.equal(first.sent.length, 0);
  assert.equal(store.records.get('g2')!.sequenceStatus, 'needs_review');

  approveFirstTouch('g2');
  const r = store.records.get('g2')!;
  r.sequenceStatus = 'active';
  r.nextTouchAt = NOW.toISOString();

  const second = countingSender();
  await runOnce(store, second.fn, policy(), NOW, quiet);
  assert.equal(second.sent.length, 1);
  assert.equal(store.records.get('g2')!.sequenceStage, 1);

  const later = new Date(NOW.getTime() + 10 * 60_000);
  const third = countingSender();
  await runOnce(store, third.fn, policy(), later, quiet);
  assert.equal(third.sent.length, 1, 'touch 2 must not be held for first-touch approval');
});

await test('kill switch is enforced in the send tool, not the prompt', async () => {
  const r = makeRecord({ id: 'k1' });
  assert.equal(guardSend(r, 1), null);
  haltSending('panic', 'manual');
  const blocked = guardSend(r, 1);
  assert.equal(blocked?.ok, false);
  assert.equal(blocked?.definitelyNotSent, true);
  assert.match(blocked?.error ?? '', /panic/);
  resumeSending();
  assert.equal(guardSend(r, 1), null);
});

await test('two bounces in five samples auto-pause sending', async () => {
  for (let i = 0; i < 3; i++) recordDeliveryOutcome('sent', `s${i}`, `ok${i}@co.com`);
  recordDeliveryOutcome('bounced', 'b1', 'bad1@co.com');
  const after = recordDeliveryOutcome('bounced', 'b2', 'bad2@co.com');
  assert.equal(after.halted, true);
  assert.equal(isSendingHalted(), true);
  const blocked = guardSend(makeRecord({ id: 'next' }), 1);
  assert.equal(blocked?.ok, false);
});

await test('a single complaint auto-pauses sending', async () => {
  recordDeliveryOutcome('sent', 's1', 'ok@co.com');
  const after = recordDeliveryOutcome('complained', 'c1', 'angry@co.com');
  assert.equal(after.halted, true);
  assert.equal(isSendingHalted(), true);
});

await test('human resume does not immediately re-halt on old bounces', async () => {
  for (let i = 0; i < 3; i++) recordDeliveryOutcome('sent', `s${i}`, `ok${i}@co.com`);
  recordDeliveryOutcome('bounced', 'b1', 'bad1@co.com');
  recordDeliveryOutcome('bounced', 'b2', 'bad2@co.com');
  assert.equal(isSendingHalted(), true);
  resumeSending();
  assert.equal(isSendingHalted(), false);
  const next = recordDeliveryOutcome('sent', 's-new', 'fresh@co.com');
  assert.equal(next.halted, false, 'stale bounce window must not re-pause after a human resume');
  assert.equal(guardSend(makeRecord({ id: 'next' }), 1), null);
});
await test('same-millisecond resume ignores old outcomes but still halts for a new complaint', async () => {
  mock.timers.enable({apis:['Date'],now:NOW});
  try {
    for(let i=0;i<3;i++)recordDeliveryOutcome('sent',`s${i}`,'ok@co.com');
    recordDeliveryOutcome('bounced','b1','bad@co.com');
    recordDeliveryOutcome('bounced','b2','bad@co.com');
    assert.equal(isSendingHalted(),true);
    resumeSending();
    assert.equal(recordDeliveryOutcome('sent','new','ok@co.com').halted,false);
    assert.equal(recordDeliveryOutcome('complained','new-complaint','angry@co.com').halted,true);
    resumeSending();
    assert.equal(recordDeliveryOutcome('sent','another','ok@co.com').halted,false);
  } finally {mock.timers.reset();}
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
