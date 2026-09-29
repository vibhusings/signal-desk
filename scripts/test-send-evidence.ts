import assert from 'node:assert/strict';
import { SendEvidence } from '../src/send/evidence.js';
import { testDeliveryRecord, validateTestDelivery } from '../src/send/test-delivery.js';
import { makeRecord } from '../src/attio/fake.js';
import { buildPrompt } from '../src/send/prompt.js';
const e = new SendEvidence();
e.observe({ message: { content: [{ type: 'text', text: 'SEND_OK 1a08cf93780e8e02' }] } });
assert.equal(e.result, undefined);
const response = (id: string, raw: unknown) => ({ message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: JSON.stringify(raw) }] }] } });
e.observe(response('unmatched', { success: true, delivery_status: 'sent' }));
assert.equal(e.result, undefined);
e.observe({ message: { content: [{ type: 'tool_use', id: 'send', name: 'mcp__slashy__send_email' }] } });
e.observe(response('send', { success: false, delivery_status: 'queued' }));
assert.equal(e.result, undefined);
e.observe(response('send', { success: true, delivery_status: 'queued', thread_id: 'draft_123', message_id: '<1789170632709_lb2o@mail.slashy.ai>' }));
assert.deepEqual(e.result, { ok: true, threadId: undefined, messageId: '<1789170632709_lb2o@mail.slashy.ai>', subject: undefined });
e.observe({ message: { content: [{ type: 'text', text: 'API Error: Connection closed mid-response' }] } });
assert.deepEqual(e.result, { ok: true, threadId: undefined, messageId: '<1789170632709_lb2o@mail.slashy.ai>', subject: undefined });
e.observe(response('send', { success: true, delivery_status: 'sent', thread_id: '1a08cf93780e8e02', message_id: '<1789170632709_lb2o@mail.slashy.ai>' }));
assert.deepEqual(e.result, { ok: true, threadId: '1a08cf93780e8e02', messageId: '<1789170632709_lb2o@mail.slashy.ai>', subject: undefined });
// Subject is captured only from the tool result, and only when it is a usable string —
// it is what later touches search on to re-find the thread, so a blank one is worse
// than none at all.
// Read through a widened alias: the earlier equality assertions narrow `e.result` to
// `never`, which would make these property reads a compile error rather than a check.
const subjectOf = (ev: SendEvidence) => (ev.result as { subject?: string } | undefined)?.subject;
e.observe(response('send', { success: true, delivery_status: 'sent', thread_id: '1a08cf93780e8e02', message_id: '<1789170632709_lb2o@mail.slashy.ai>', subject: '   ' }));
assert.equal(subjectOf(e), undefined, 'a whitespace-only subject must not be stored');
e.observe(response('send', { success: true, delivery_status: 'sent', thread_id: '1a08cf93780e8e02', message_id: '<1789170632709_lb2o@mail.slashy.ai>', subject: 'Building Bree' }));
assert.equal(subjectOf(e), 'Building Bree');
const source=makeRecord({id:'locked',contactEmail:'scraped@example.com'});
const env={TEST_ONLY_RECORD_ID:'locked',TEST_RECIPIENT:'scraped@example.com',TEST_DELIVERY_RECIPIENT:'safe@example.com'} as NodeJS.ProcessEnv;
validateTestDelivery(env);
assert.equal(testDeliveryRecord(source,env).contactEmail,'safe@example.com');
assert.equal(testDeliveryRecord({...source,id:'other'},env).contactEmail,'scraped@example.com');
assert.throws(()=>validateTestDelivery({TEST_DELIVERY_RECIPIENT:'unsafe@example.com'} as NodeJS.ProcessEnv));
const prompt=buildPrompt(makeRecord({companyName:'Sixtyfour',contactName:'Saarth',companySummary:'Builds AI workflow tools.'}),1,'Vibhu');
assert.match(prompt,/Sixtyfour/);
assert.match(prompt,/Builds AI workflow tools/);
assert.doesNotMatch(prompt,/automation test|test email/i);
console.log('Send evidence checks passed');
