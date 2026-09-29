import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SEND_GUARD_DIR = mkdtempSync(join(tmpdir(), 'sched-guard-'));
import { FakeStore, makeRecord } from '../src/attio/fake.js';
import { runOnce, type Sender } from '../src/scheduler/run.js';
import { loadPolicy, type Policy } from '../src/scheduler/policy.js';
import type { OutreachRecord } from '../src/types.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const NOW = new Date('2026-09-02T12:00:00Z');

const policy = (over: Partial<Policy> = {}): Policy => ({
  ...loadPolicy({ DRY_RUN: '0' } as NodeJS.ProcessEnv),
  intervalsMinutes: [10, 10, 10],
  ...over,
});

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (e) { console.log(`  \x1b[31m✗ ${name}\x1b[0m\n      ${(e as Error).message}`); failed++; }
}

const countingSender = () => {
  const sent: OutreachRecord[] = [];
  const fn: Sender = async (r) => { sent.push(r); return { ok: true }; };
  return { fn, sent };
};

console.log('\n\x1b[1mScheduler guarantees\x1b[0m');

await test('BLAST GUARD: 50 records due, one run sends exactly BATCH_CAP', async () => {
  const store = new FakeStore(Array.from({ length: 50 }, () => makeRecord()));
  const { fn, sent } = countingSender();
  const s = await runOnce(store, fn, policy({ batchCap: 20 }), NOW, quiet);
  assert.equal(sent.length, 20, `sent ${sent.length}, expected 20`);
  assert.equal(s.sent, 20);
  assert.equal(store.records.size, 50);
});

await test('BLAST GUARD: a store ignoring the limit is refused, not obeyed', async () => {
  const store = new FakeStore(Array.from({ length: 50 }, () => makeRecord()));
  store.findDue = async () => [...store.records.values()]; // rogue store
  const { fn, sent } = countingSender();
  await assert.rejects(
    () => runOnce(store, fn, policy({ batchCap: 20 }), NOW, quiet),
    /refusing to send/,
  );
  assert.equal(sent.length, 0, 'no sends should occur when the cap is violated');
});

await test('CRASH IDEMPOTENCY: crash after send, before write-back, does not resend', async () => {
  const store = new FakeStore([makeRecord({ id: 'r1' })]);
  const { fn, sent } = countingSender();

  store.failNextWrite = 'recordSend';
  await runOnce(store, fn, policy(), NOW, quiet).catch(() => {});
  assert.equal(sent.length, 1, 'first run sends once');

  // The claim is still set and no send was confirmed: outcome is unknown.
  const after = store.records.get('r1')!;
  assert.equal(after.claimedAt, NOW.toISOString());
  assert.equal(after.lastSendKey, null);

  // A later run, past the lock window, must not fire a second email.
  const later = new Date(NOW.getTime() + 60 * 60_000);
  await runOnce(store, fn, policy(), later, quiet);
  assert.equal(sent.length, 1, `resent! total sends = ${sent.length}`);
  assert.equal(store.records.get('r1')!.sequenceStatus, 'needs_review');
});

await test('CRASH IDEMPOTENCY: confirmed send with un-advanced stage repairs, no resend', async () => {
  // lastSendKey says touch 1 landed, but sequenceStage was never bumped.
  const store = new FakeStore([
    makeRecord({ id: 'r2', sequenceStage: 0, lastSendKey: 'r2:1' }),
  ]);
  const { fn, sent } = countingSender();
  const s = await runOnce(store, fn, policy(), NOW, quiet);
  assert.equal(sent.length, 0, 'must not resend a confirmed touch');
  assert.equal(s.repaired, 1);
  assert.equal(store.records.get('r2')!.sequenceStage, 1);
});

await test('LOCK: a fresh claim from a concurrent run is skipped', async () => {
  const store = new FakeStore([
    makeRecord({ id: 'r3', claimedAt: new Date(NOW.getTime() - 60_000).toISOString() }),
  ]);
  const { fn, sent } = countingSender();
  const s = await runOnce(store, fn, policy({ claimLockMinutes: 15 }), NOW, quiet);
  assert.equal(sent.length, 0);
  assert.equal(s.skippedLocked, 1);
});

await test('CEILING: touchCount at max is parked, never sent', async () => {
  const store = new FakeStore([makeRecord({ id: 'r4', touchCount: 4, sequenceStage: 4 })]);
  const { fn, sent } = countingSender();
  const s = await runOnce(store, fn, policy({ maxTouches: 4 }), NOW, quiet);
  assert.equal(sent.length, 0);
  assert.equal(s.parked, 1);
  assert.equal(store.records.get('r4')!.sequenceStatus, 'stopped');
});

await test('REPLY STOP: non-active statuses are never sent to', async () => {
  const seed = (['replied', 'booked', 'bounced', 'unsubscribed', 'stopped'] as const).map((st, i) =>
    makeRecord({ id: `s${i}`, sequenceStatus: st }),
  );
  const store = new FakeStore(seed);
  const { fn, sent } = countingSender();
  await runOnce(store, fn, policy(), NOW, quiet);
  assert.equal(sent.length, 0, `sent to ${sent.map((r) => r.sequenceStatus).join(',')}`);
});

await test('DRY_RUN: reports intended sends but calls the sender zero times', async () => {
  const store = new FakeStore(Array.from({ length: 5 }, () => makeRecord()));
  const { fn, sent } = countingSender();
  const s = await runOnce(store, fn, policy({ dryRun: true }), NOW, quiet);
  assert.equal(sent.length, 0, 'sender must not be invoked');
  assert.equal(s.sent, 5, 'but the run should report what it would have done');
  assert.equal(store.writes.length, 0, 'and must not write any state');
});

await test('SEQUENCE: touch advances stage and schedules the next at the interval', async () => {
  const store = new FakeStore([makeRecord({ id: 'r5' })]);
  const { fn } = countingSender();
  await runOnce(store, fn, policy({ intervalsMinutes: [10, 10, 10] }), NOW, quiet);
  const r = store.records.get('r5')!;
  assert.equal(r.sequenceStage, 1);
  assert.equal(r.touchCount, 1);
  assert.equal(r.lastSendKey, 'r5:1');
  assert.equal(r.claimedAt, null, 'claim must be cleared after a confirmed send');
  assert.equal(r.nextTouchAt, new Date(NOW.getTime() + 10 * 60_000).toISOString());
});

await test('SEQUENCE: the final touch stops the sequence instead of rescheduling', async () => {
  const store = new FakeStore([makeRecord({ id: 'r6', sequenceStage: 3, touchCount: 3 })]);
  const { fn } = countingSender();
  await runOnce(store, fn, policy({ maxTouches: 4 }), NOW, quiet);
  const r = store.records.get('r6')!;
  assert.equal(r.sequenceStage, 4);
  assert.equal(r.nextTouchAt, null);
  assert.equal(r.sequenceStatus, 'stopped');
});

await test('FAILURE: a proven non-send clears the claim so the next pass retries', async () => {
  const store = new FakeStore([makeRecord({ id: 'r7' })]);
  const failing: Sender = async () => ({ ok: false, error: 'smtp refused', definitelyNotSent: true });
  const s = await runOnce(store, failing, policy(), NOW, quiet);
  assert.equal(s.failed, 1);
  const r = store.records.get('r7')!;
  assert.equal(r.claimedAt, null, 'claim must be released');
  assert.equal(r.sequenceStage, 0, 'stage must not advance on a failed send');

  const { fn, sent } = countingSender();
  await runOnce(store, fn, policy(), new Date(NOW.getTime() + 60_000), quiet);
  assert.equal(sent.length, 1, 'the next pass should retry it');
});

await test('GUESSED FIRST-TOUCH: unverified touch 1 is parked, never sent', async () => {
  const store = new FakeStore([makeRecord({ id: 'g1', emailSource: { kind: 'guessed', pattern: 'first@co.com' } })]);
  const { fn, sent } = countingSender();
  const s = await runOnce(store, fn, policy(), NOW, quiet);
  assert.equal(sent.length, 0);
  assert.equal(s.parked, 1);
  assert.equal(store.records.get('g1')!.sequenceStatus, 'needs_review');
});

await test('PUBLISHED FIRST-TOUCH: verified addresses send without a second approval', async () => {
  const store = new FakeStore([makeRecord({ id: 'p1', emailSource: { kind: 'published', url: 'https://example.com' } })]);
  const { fn, sent } = countingSender();
  const s = await runOnce(store, fn, policy(), NOW, quiet);
  assert.equal(sent.length, 1);
  assert.equal(s.sent, 1);
  assert.equal(store.records.get('p1')!.sequenceStage, 1);
});

await test('KILL SWITCH: halted sending skips the entire pass', async () => {
  const { haltSending, resumeSending } = await import('../src/send/kill-switch.js');
  haltSending('test halt', 'manual');
  try {
    const store = new FakeStore([makeRecord({ id: 'k1' })]);
    const { fn, sent } = countingSender();
    const s = await runOnce(store, fn, policy(), NOW, quiet);
    assert.equal(sent.length, 0);
    assert.equal(s.considered, 0);
  } finally {
    resumeSending();
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
