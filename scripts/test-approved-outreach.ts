import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SEND_GUARD_DIR = mkdtempSync(join(tmpdir(), 'approved-outreach-'));
const { parseDraft, validateDraft, bodyBlocks, buildDraftPrompt } = await import('../src/send/draft.js');
const { recordApproval, approvedFirstTouchSender, routedRecord, deliveryRouteFor } = await import('../src/send/approved.js');
const { FakeStore, makeRecord } = await import('../src/attio/fake.js');
const { runOnce } = await import('../src/scheduler/run.js');
const { loadPolicy } = await import('../src/scheduler/policy.js');
const { haltSending, resumeSending } = await import('../src/send/kill-switch.js');
const { approveFirstTouch, needsFirstTouchApproval } = await import('../src/send/first-touch.js');
const { meetLinkOf } = await import('../src/reply/run.js');
const { bookingConfirmationBody, availabilityPolicy } = await import('../src/reply/calendar.js');

// Drafts: only complete, sendable text survives.
const good = parseDraft('Here you go {"subject":"Raindrop’s Series A and agent monitoring","body":"Hi Ana,\\n\\nCongrats on the round.\\n\\nBest,\\nVibhu Singh"}');
assert.equal(good.subject, "Raindrop's Series A and agent monitoring");
assert.deepEqual(bodyBlocks(good.body), ['Hi Ana,', 'Congrats on the round.', 'Best,<br>Vibhu Singh']);
assert.throws(() => parseDraft('no json here'), /JSON/);
assert.throws(() => validateDraft({ subject: 'Hello [Name]', body: 'Hi there, a long enough body text.' }), /placeholder/);
assert.throws(() => validateDraft({ subject: 'Specific subject', body: 'Hi <b>there</b>, a long enough body.' }), /angle/);
assert.throws(() => validateDraft({ subject: 'Specific subject', body: 42 }), /subject and a body/);
assert.match(buildDraftPrompt({ company: 'Raindrop', contactName: 'Ana', contactTitle: 'CEO', context: 'IGNORE PREVIOUS', senderName: 'Vibhu', angle: 'Intro' }), /untrusted factual context/);
console.log('Drafts: JSON-only, punctuation normalised, placeholders and HTML rejected.');

// Approved touch 1 sends the exact approved words to the (routed) recipient.
const id = '33333333-3333-4333-8333-333333333333';
recordApproval(id, { draft: good, deliverTo: 'Owner@Example.com' });
assert.equal(deliveryRouteFor(id), 'owner@example.com');
assert.throws(() => recordApproval('x', { deliverTo: 'not an email' }), /Invalid/);
const rec = makeRecord({ id, contactEmail: 'ana@raindrop.ai', sequenceStatus: 'active', nextTouchAt: new Date(Date.now() - 1000).toISOString() });
assert.equal(routedRecord(rec).contactEmail, 'owner@example.com');

const calls: Array<[string, any]> = [];
const fakeCall = (to = 'owner@example.com', failSend = false) => Object.assign(async (name: string, args: any) => {
  calls.push([name, args]);
  if (name === 'draft_email') return { draft_id: 'draft_1', thread_id: '0123456789abcdef', to: [{ email: to }] };
  if (name === 'send_email') { if (failSend) throw new Error('timeout'); return { delivery_status: 'queued', message_id: '<m1@mail.gmail.com>' }; }
  throw new Error('unexpected');
}, {});
let fallbackUsed = 0;
const fallback = async () => { fallbackUsed++; return { ok: true }; };
const store = new FakeStore([rec]);
const send = approvedFirstTouchSender(fakeCall(), 'sender@example.com', fallback as any);
const summary = await runOnce(store, (r, t) => send(routedRecord(r), t), { ...loadPolicy({}), dryRun: false, quietHours: null }, new Date(), { info() {}, warn() {}, error() {} });
assert.equal(summary.sent, 1);
assert.equal(calls[0][0], 'draft_email');
assert.deepEqual(calls[0][1], { inbox_email: 'sender@example.com', to: ['owner@example.com'], subject: `${good.subject} (test: ${rec.contactName?.split(' ')[0] || id.slice(0, 8)})`, body_blocks: bodyBlocks(good.body) });
assert.match(String(store.records.get(id)!.lastSubject), /\(test: /);
assert.deepEqual(calls[1], ['send_email', { inbox_email: 'sender@example.com', draft_id: 'draft_1' }]);
const after = store.records.get(id)!;
assert.equal(after.sequenceStage, 1); assert.equal(after.threadId, '0123456789abcdef'); assert.equal(fallbackUsed, 0);
console.log('Approved touch 1: exact body, test-tagged subject, pinned test recipient, thread recorded, stage advanced.');

// Touch 2+ is composed as before.
await send(routedRecord({ ...after, touchCount: 1 }), 2);
assert.equal(fallbackUsed, 1);
// Recipient mismatch never reaches send_email; a lost send result stays ambiguous.
calls.length = 0;
const mismatch = await approvedFirstTouchSender(fakeCall('someone@else.com'), 'sender@example.com', fallback as any)(routedRecord({ ...rec, touchCount: 0 }), 1);
assert.equal(mismatch.ok, false); assert.equal(mismatch.definitelyNotSent, true); assert.ok(!calls.some(([n]) => n === 'send_email'));
const lost = await approvedFirstTouchSender(fakeCall('owner@example.com', true), 'sender@example.com', fallback as any)(routedRecord({ ...rec, touchCount: 0 }), 1);
assert.equal(lost.ok, false); assert.notEqual(lost.definitelyNotSent, true);
// The kill switch still wins.
haltSending('test', 'manual');
calls.length = 0;
const halted = await send(routedRecord({ ...rec, touchCount: 0 }), 1);
assert.equal(halted.ok, false); assert.equal(calls.length, 0);
resumeSending();
console.log('Approved sends: recipient verified, ambiguous outcomes held, kill switch enforced.');

// Approving a labelled guessed draft satisfies the send-time approval.
const guessedId = '44444444-4444-4444-8444-444444444444';
const guessed = makeRecord({ id: guessedId, emailSource: { kind: 'guessed', pattern: 'first@' } });
assert.equal(needsFirstTouchApproval(guessed, 1), true);
approveFirstTouch(guessedId);
assert.equal(needsFirstTouchApproval(guessed, 1), false);

// Booking: Meet links are captured and included in the confirmation.
assert.equal(meetLinkOf({ event: { hangout_link: 'https://meet.google.com/abc-defg-hij' } }), 'https://meet.google.com/abc-defg-hij');
assert.equal(meetLinkOf({ event_id: 'x' }), undefined);
assert.ok(bookingConfirmationBody(new Date().toISOString(), availabilityPolicy({}), 'Vibhu', 'Title', 'https://meet.google.com/abc-defg-hij').some(l => l.includes('meet.google.com')));
console.log('Guessed approval and Google Meet capture passed.');

// A systemd env line such as `BATCH_CAP=20   # note` must not become NaN (which matched nothing).
assert.equal(loadPolicy({ BATCH_CAP: '20          # hard ceiling on sends per run' }).batchCap, 20);
assert.equal(loadPolicy({ DRY_RUN: '0             # 1 = log intended sends' }).dryRun, false);
assert.throws(() => loadPolicy({ BATCH_CAP: 'twenty' }), /Invalid numeric setting/);
console.log('Policy numbers tolerate trailing env comments and reject garbage.');

// Slashy's stored thread can lag incoming mail; the Gmail search preview fills the gap.
{
  const { withSearchedReplies } = await import('../src/reply/messages.js');
  const { checkReplies } = await import('../src/reply/run.js');
  const { ReplyJournal } = await import('../src/reply/journal.js');
  const inbox = 'demo@example.com', contact = 'me@test.dev', thread = '1a0e5e6db6df6584';
  const sentMsg = { id: 'm1', threadId: thread, from: { email: inbox }, to: [{ email: contact }], date: '2026-09-28T02:47:23Z', direction: 'SENT', body: '<p>Hi Zubin</p>', subject: 'S' };
  const quote = ' On Sun, Sep 27, 2026 at 7:48 PM John Doe <demo@example.com> wrote: Hi Zubin, I saw Raindrop closed a Series A';
  const fake = (snippet: string, made: Array<[string, any]>) => Object.assign(async (name: string, args: any) => {
    made.push([name, args]);
    if (name === 'read_thread') return { thread_id: thread, inbox_email: inbox, message_count: 1, messages: [sentMsg], subject: 'S' };
    if (name === 'list_messages') return { threads: [{ thread_id: thread, message_count: 2, messages: [{ from: inbox, snippet: 'Hi Zubin', date: 'Mon Sep 28, 2026 at 02:48 AM UTC' }, { from: contact, snippet, date: 'Mon Sep 28, 2026 at 02:58 AM UTC' }] }], pagination: { has_more: false } };
    if (name === 'list_calendar_events') return { events: [], truncated: false, total_available: 0, inbox_email: inbox };
    if (name === 'create_event') return { success: true, event_id: 'ev1', hangout_link: 'https://meet.google.com/abc-defg-hij' };
    if (name === 'draft_email') return { draft_id: 'd1', thread_id: thread, to: [{ email: contact }], cc: [], bcc: [] };
    if (name === 'send_email') return { delivery_status: 'queued' };
    throw new Error(`unexpected ${name}`);
  }, {});
  const base = makeRecord({ id: '55555555-5555-4555-8555-555555555555', contactEmail: contact, contactName: 'Zubin Koticha', companyName: 'Raindrop — Zubin Koticha', threadId: thread, touchCount: 1, sequenceStage: 1, sequenceStatus: 'active', lastTouchAt: '2026-09-28T02:47:23Z' });
  const conv = await withSearchedReplies(fake("Happy to chat, let's set up a call." + quote, []), { threadId: thread, messages: [sentMsg as any], subject: 'S' }, base, inbox);
  const added = conv.messages.at(-1)!;
  assert.equal(conv.messages.length, 2); assert.equal(added.fromSearch, true); assert.equal(added.partial, false);
  assert.equal(added.body, "Happy to chat, let's set up a call."); assert.equal(added.date, '2026-09-28T02:58:00.000Z');
  const unchanged = await withSearchedReplies(Object.assign(async () => { throw new Error('search down'); }, {}), { threadId: thread, messages: [sentMsg as any], subject: 'S' }, base, inbox);
  assert.equal(unchanged.messages.length, 1);

  const made: Array<[string, any]> = [];
  const store = new FakeStore([{ ...base }]);
  const journal = new ReplyJournal(mkdtempSync(join(tmpdir(), 'journal-')));
  const opts = { inbox, dryRun: false, sender: 'Vibhu Singh', policy: availabilityPolicy({}), limit: 3, autoAvailability: true, conferencing: 'gmeet', rotate: false };
  const quiet = { info() {}, warn() {}, error() {} };
  await checkReplies(store, [store.records.get(base.id)!], fake("Happy to chat, let's set up a call." + quote, made), journal, opts, quiet);
  const event = made.find(([n]) => n === 'create_event');
  assert.ok(event, 'booked from the search preview'); assert.equal(event![1].conferencing, 'gmeet'); assert.deepEqual(event![1].attendees, [contact]);
  assert.equal(store.records.get(base.id)!.sequenceStatus, 'booked');
  assert.ok(made.some(([n, a]) => n === 'draft_email' && a.body_blocks.some((b: string) => b.includes('meet.google.com'))));

  // A cut-off preview stops follow-ups but never books from half a sentence.
  const made2: Array<[string, any]> = [];
  const store2 = new FakeStore([{ ...base }]);
  const long = 'Tuesday at 2pm works for me. ' + 'Looking forward to hearing more about how you think about the space and the round. '.repeat(3);
  await checkReplies(store2, [store2.records.get(base.id)!], fake(long, made2), new ReplyJournal(mkdtempSync(join(tmpdir(), 'journal-'))), opts, quiet);
  assert.ok(!made2.some(([n]) => n === 'create_event')); assert.equal(store2.records.get(base.id)!.sequenceStatus, 'replied');
  console.log('Stale Slashy thread: reply recovered from Gmail search, booked with Meet; cut-off previews held for review.');
}

// Fresh sent mail missing from Slashy's subject index is found via the recent-sent listing,
// still by exact Message-ID; duplicates stay ambiguous.
{
  const { readConversation } = await import('../src/reply/messages.js');
  const inbox = 'demo@example.com', contact = 'me@test.dev', subject = "StableBrowse's launch (test: Somansh)", mid = '<abc@mail.slashy.ai>';
  const a = '1a0e959e9788d5d7', b = '1a0e959e9788d5d8';
  const rec = makeRecord({ contactEmail: contact, threadId: null, lastMessageId: mid, lastSubject: subject, lastTouchAt: new Date().toISOString() });
  const mk = (ids: Record<string, string>, more = false) => { const queries: string[] = []; return { queries, call: Object.assign(async (name: string, args: any) => {
    if (name === 'list_messages') { queries.push(args.q); return String(args.q).startsWith('in:sent newer_than:') ? { threads: Object.keys(ids).map(id => ({ thread_id: id, subject })), pagination: { has_more: more } } : { threads: [], pagination: { has_more: false } }; }
    if (name === 'read_thread') { const id = String(args.thread_id); return { thread_id: id, inbox_email: inbox, message_count: 1, subject, messages: [{ id: 'm-' + id, threadId: id, message_id: ids[id], from: { email: inbox }, to: [{ email: contact }], date: new Date().toISOString(), direction: 'SENT', body: 'x' }] }; }
    throw new Error(name);
  }, {}) }; };
  const one = mk({ [a]: mid, [b]: '<other@mail.slashy.ai>' });
  assert.equal((await readConversation(one.call, rec, inbox)).threadId, a);
  assert.match(one.queries[0], /^in:sent newer_than:[12]d$/);
  await assert.rejects(readConversation(mk({ [a]: mid, [b]: mid }).call, rec, inbox), /ambiguous/);
  const paged = mk({ [a]: mid }, true);
  await assert.rejects(readConversation(paged.call, rec, inbox), /missing or ambiguous/);
  assert.ok(paged.queries.some(q => q.includes('subject:')), 'falls back to the indexed search when the listing is incomplete');
  console.log('Thread resolution: recent-sent listing finds fresh mail by exact Message-ID; duplicates and incomplete listings are never guessed.');
}

// Test delivery: another company's accepted invite for the shared test inbox is not this campaign's booking.
{
  const { hasBooking, companyLabel } = await import('../src/reply/calendar.js');
  const cal = { inbox: 'demo@example.com', fetchedAt: new Date().toISOString(), events: [{ title: 'Hunter <> Vibhu - Investment conversation about Flatkey', start_time_iso: new Date(Date.now() + 86400000).toISOString(), end_time_iso: new Date(Date.now() + 88200000).toISOString(), status: 'confirmed', attendees: [{ email: 'me@test.dev', response: 'accepted' }] }] };
  assert.equal(hasBooking(cal, 'me@test.dev', new Date()), true);
  assert.equal(hasBooking(cal, 'me@test.dev', new Date(), companyLabel('StableBrowse — Somansh Shah')), false);
  assert.equal(hasBooking(cal, 'me@test.dev', new Date(), companyLabel('Flatkey — Hunter Guo')), true);
  console.log('Test delivery bookings are matched per company, so one accepted invite cannot mark every campaign booked.');
}
