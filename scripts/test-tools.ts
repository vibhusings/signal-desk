import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { slashyCall } from '../src/reply/tools.js';

const fake = resolve('scripts/fixtures/fake-claude.mjs');
let count = 0;
async function test(name: string, fn: () => Promise<void>) {
  // Each test runs in its own directory so the fake's logs and .runtime/ never touch the repo.
  const dir = mkdtempSync(join(tmpdir(), 'tools-test-')); const home = process.cwd();
  process.chdir(dir);
  try { await fn(); } finally { process.chdir(home); }
  count++; console.log(`✓ ${name}`);
}
const spawns = () => existsSync('processes.log') ? readFileSync('processes.log', 'utf8').split('\n').filter(Boolean).length : 0;
const opts = { claudeBin: fake, model: 'x', timeoutMs: 30000, oauthToken: 't' };
const inbox = 'me@example.com';
const thread = (id: string) => ['read_thread', { inbox_email: inbox, thread_id: id }] as [string, Record<string, unknown>];
const cal: [string, Record<string, unknown>] = ['list_calendar_events', { inbox_email: inbox, time_period: 'next_7_days' }];

await test('BATCH: two lookups cost one process, and the later calls are served without spawning', async () => {
  const call = slashyCall(opts);
  assert.equal(await call.prefetch!([thread('a'), cal]), 2);
  assert.equal(spawns(), 1);
  assert.equal((await call(...thread('a'))).served.thread_id, 'a');
  // Argument key order must not matter for a cache hit.
  assert.ok(await call('list_calendar_events', { time_period: 'next_7_days', inbox_email: inbox }));
  assert.equal(spawns(), 1, 'a prefetched result was fetched again');
});

await test('CONSUMED ONCE: a deliberate re-read after the prefetched one goes back to Slashy', async () => {
  const call = slashyCall(opts);
  await call.prefetch!([thread('a'), cal]);
  await call(...thread('a'));
  await call(...thread('a'));
  assert.equal(spawns(), 2, 'the fresh pre-booking re-read was served from a stale cache');
});

await test('WRITES NEVER BATCH: send_email is dropped from a prefetch, leaving nothing worth batching', async () => {
  const call = slashyCall(opts);
  assert.equal(await call.prefetch!([['send_email', { inbox_email: inbox, draft_id: 'd' }], thread('a')]), 0);
  assert.equal(spawns(), 0);
});

await test('PARTIAL BATCH: a call the model skipped falls back to its own process', async () => {
  const call = slashyCall(opts);
  writeFileSync('mode', 'skip-last');
  assert.equal(await call.prefetch!([thread('a'), cal]), 1);
  writeFileSync('mode', '');
  await call(...thread('a'));
  await call(...cal);
  assert.equal(spawns(), 2, 'the skipped lookup should have cost exactly one extra process');
});

await test('SUBSTITUTED ARGUMENTS are never cached or returned', async () => {
  const call = slashyCall(opts);
  writeFileSync('mode', 'alter');
  assert.equal(await call.prefetch!([thread('a'), thread('b')]), 0);
  await assert.rejects(call(...thread('a')), /no matching successful tool result/);
});

console.log(`${count} tool batching tests passed`);
