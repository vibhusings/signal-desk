import type { OutreachRecord, SendResult } from '../types.js';
import { needsFirstTouchApproval } from './first-touch.js';
import { isSendingHalted, readKillSwitch } from './kill-switch.js';

/** Structural send-tool gates. The model never sees these and cannot override them. */
export function guardSend(r: OutreachRecord, touch: number): SendResult | null {
  if (isSendingHalted()) {
    const halt = readKillSwitch();
    return { ok: false, definitelyNotSent: true, error: `Kill switch halted sending${halt?.reason ? `: ${halt.reason}` : ''}` };
  }
  if (needsFirstTouchApproval(r, touch)) {
    return { ok: false, definitelyNotSent: true, error: 'Guessed first-touch requires send-time approval' };
  }
  return null;
}
