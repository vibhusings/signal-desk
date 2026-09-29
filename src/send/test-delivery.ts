import type { OutreachRecord } from '../types.js';

export function validateTestDelivery(env: NodeJS.ProcessEnv = process.env): void {
  if (env.TEST_DELIVERY_RECIPIENT && (!env.TEST_ONLY_RECORD_ID || !env.TEST_RECIPIENT)) {
    throw new Error('TEST_DELIVERY_RECIPIENT requires TEST_ONLY_RECORD_ID and TEST_RECIPIENT');
  }
}

/** Keep Attio's sourced address intact while routing a locked test to a safe inbox. */
export function testDeliveryRecord(r: OutreachRecord, env: NodeJS.ProcessEnv = process.env): OutreachRecord {
  if (!env.TEST_DELIVERY_RECIPIENT || r.id !== env.TEST_ONLY_RECORD_ID || r.contactEmail !== env.TEST_RECIPIENT) return r;
  return { ...r, contactEmail: env.TEST_DELIVERY_RECIPIENT };
}
