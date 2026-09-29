import assert from 'node:assert/strict';
import { parse } from '../src/sourcing/discover.js';
import { DiscoveryEvidence } from '../src/sourcing/discovery-evidence.js';
import { checkBookings } from '../src/reply/bookings.js';
import { FakeStore, makeRecord } from '../src/attio/fake.js';

let passed = 0, failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (e) { console.log(`  \x1b[31m✗ ${name}\x1b[0m\n      ${(e as Error).message}`); failed++; }
}

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const opts = {
  claudeBin: '/nonexistent', model: 'x', timeoutMs: 1, limit: 20, dryRun: false,
};

/** Feeds text through the evidence collector as if a research tool had returned it. */
function evidenceWith(fetched: string): DiscoveryEvidence {
  const e = new DiscoveryEvidence();
  e.observe({
    message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__slashy__scrape_url', input: { url: 'https://acme.com/team' } }] },
  });
  e.observe({
    message: {
      content: [{
        type: 'tool_result', tool_use_id: 't1',
        content: [{ type: 'text', text: fetched }],
      }],
    },
  });
  return e;
}

console.log('\n\x1b[1mContact discovery\x1b[0m');

await test('PUBLISHED CLAIM backed by a fetched page is kept as published', () => {
  const ev = evidenceWith('Our team: reach Jane at jane@acme.com for anything.');
  const r = parse('CONTACT | Jane Roe | CTO | jane@acme.com | published:https://acme.com/team', ev);
  assert.equal(r.contacts.length, 1);
  assert.equal(r.contacts[0].emailSource.kind, 'published', 'a verifiable claim was wrongly demoted');
  assert.equal(r.demoted.length, 0);
});

await test('OFFICIAL WEBSITE is retained only when a successfully scraped host matches the email domain', () => {
  const ev = evidenceWith('Our team: reach Jane at jane@acme.com for anything.');
  const r = parse('CONTACT | Jane Roe | CTO | jane@acme.com | published:https://acme.com/team', ev);
  assert.equal(r.website, 'https://acme.com');
});

await test('FABRICATED CLAIM: published address absent from fetched pages is demoted to guessed', () => {
  const ev = evidenceWith('Our team page lists nobody at all.');
  const r = parse('CONTACT | Jane Roe | CTO | jane@acme.com | published:https://acme.com/team', ev);
  assert.equal(r.contacts[0].emailSource.kind, 'guessed', 'an unbacked claim was trusted');
  assert.equal(r.demoted.length, 1, 'demotion must be reported, not silent');
});

await test('GUESSED addresses keep their pattern and are never marked published', () => {
  const r = parse('CONTACT | Sam Lee | Founder | sam@acme.com | guessed:first@acme.com', evidenceWith(''));
  assert.equal(r.contacts[0].emailSource.kind, 'guessed');
  assert.deepEqual(r.contacts[0].emailSource, { kind: 'guessed', pattern: 'first@acme.com' });
});

await test('MALFORMED lines and non-emails are dropped, not half-parsed', () => {
  const r = parse(
    ['CONTACT | No Email | CTO | not-an-email | guessed:x',
     'CONTACT | | | |',
     'I found some people for you!',
     'CONTACT | Real One | Eng | real@acme.com | guessed:first@acme.com'].join('\n'),
    evidenceWith(''),
  );
  assert.equal(r.contacts.length, 1);
  assert.equal(r.contacts[0].email, 'real@acme.com');
});

await test('DUPLICATE addresses collapse to one contact', () => {
  const r = parse(
    ['CONTACT | Jane Roe | CTO | jane@acme.com | guessed:first@acme.com',
     'CONTACT | Jane R | Chief Tech | JANE@acme.com | guessed:first@acme.com'].join('\n'),
    evidenceWith(''),
  );
  assert.equal(r.contacts.length, 1, 'same address listed twice produced two records');
});

await test('SOURCE URL: an address on a different page cannot validate the cited URL', () => {
  const r = parse('CONTACT | Jane Roe | CTO | jane@acme.com | published:https://acme.com/other', evidenceWith('jane@acme.com'));
  assert.equal(r.contacts[0].emailSource.kind, 'guessed');
});

await test('EMAIL BOUNDARIES: a substring of a different mailbox is not evidence', () => {
  assert.equal(evidenceWith('notjane@acme.com').sawVerbatim('jane@acme.com', 'https://acme.com/team'), false);
});

await test('FAILED SCRAPE: error text containing the address is not publication', () => {
  const ev = evidenceWith(JSON.stringify({ success: false, error: 'jane@acme.com not found' }));
  assert.equal(ev.sawVerbatim('jane@acme.com', 'https://acme.com/team'), false);
});

await test('SEARCH QUERY: an echoed address cannot validate publication', () => {
  const ev = new DiscoveryEvidence();
  ev.observe({ message: { content: [{ type: 'tool_use', id: 'q', name: 'mcp__slashy__web_search', input: { query: 'jane@acme.com' } }] } });
  ev.observe({ message: { content: [{ type: 'tool_result', tool_use_id: 'q', content: [{ type: 'text', text: 'jane@acme.com' }] }] } });
  assert.equal(ev.sawVerbatim('jane@acme.com', 'https://acme.com/team'), false);
});

console.log('\n\x1b[1mBooking detection\x1b[0m');

await test('BOOKED: an attendee matching an active record stops that sequence', async () => {
  const store = new FakeStore([
    makeRecord({ id: 'a', contactEmail: 'jane@acme.com', touchCount: 2, sequenceStage: 2 }),
  ]);
  const s = await checkBookings(store, opts, quiet, async () => ({ emails: ['jane@acme.com'] }));
  assert.equal(s.booked, 1);
  assert.equal(store.records.get('a')!.sequenceStatus, 'booked');
  assert.equal(store.records.get('a')!.nextTouchAt, null, 'a booked record must not stay scheduled');
});

await test('UNRELATED attendees never touch a sequence', async () => {
  const store = new FakeStore([
    makeRecord({ id: 'a', contactEmail: 'jane@acme.com', touchCount: 1 }),
  ]);
  const s = await checkBookings(store, opts, quiet, async () => ({ emails: ['someone@else.com'] }));
  assert.equal(s.booked, 0);
  assert.equal(store.records.get('a')!.sequenceStatus, 'active');
});

await test('CASE INSENSITIVE: calendar casing differences still match', async () => {
  const store = new FakeStore([
    makeRecord({ id: 'a', contactEmail: 'jane@acme.com', touchCount: 1 }),
  ]);
  await checkBookings(store, opts, quiet, async () => ({ emails: ['Jane@Acme.com'] }));
  assert.equal(store.records.get('a')!.sequenceStatus, 'booked');
});

await test('NOT YET EMAILED: a queued record is never considered booked', async () => {
  const store = new FakeStore([
    makeRecord({ id: 'a', contactEmail: 'jane@acme.com', touchCount: 0, sequenceStatus: 'queued' }),
  ]);
  const s = await checkBookings(store, opts, quiet, async () => ({ emails: ['jane@acme.com'] }));
  assert.equal(s.examined, 0);
  assert.equal(store.records.get('a')!.sequenceStatus, 'queued');
});

await test('CALENDAR FAILURE leaves sequences running rather than silently stopping them', async () => {
  const store = new FakeStore([
    makeRecord({ id: 'a', contactEmail: 'jane@acme.com', touchCount: 1 }),
  ]);
  const s = await checkBookings(store, opts, quiet, async () => ({ emails: [], error: 'timed out' }));
  assert.ok(s.error, 'a failed check must report the failure');
  assert.equal(s.booked, 0);
  assert.equal(store.records.get('a')!.sequenceStatus, 'active', 'a failed check must not park anyone');
});

await test('DRY_RUN reports the booking but writes nothing', async () => {
  const store = new FakeStore([
    makeRecord({ id: 'a', contactEmail: 'jane@acme.com', touchCount: 1 }),
  ]);
  const s = await checkBookings(
    store, { ...opts, dryRun: true }, quiet, async () => ({ emails: ['jane@acme.com'] }),
  );
  assert.equal(s.booked, 1);
  assert.equal(store.records.get('a')!.sequenceStatus, 'active', 'DRY_RUN wrote to the store');
  assert.equal(store.writes.length, 0, 'DRY_RUN performed a write');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
