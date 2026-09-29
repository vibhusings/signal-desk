import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sendGuardDir } from './runtime-dir.js';

export type HaltSource = 'manual' | 'bounce' | 'complaint' | 'failures';
export type KillSwitch = { halted: boolean; reason: string; source: HaltSource; updatedAt: string; resumeId?: string };

function path() { return resolve(sendGuardDir(), 'send-kill-switch.json'); }

export function readKillSwitch(): KillSwitch | null {
  if (!existsSync(path())) return null;
  try {
    const raw = JSON.parse(readFileSync(path(), 'utf8')) as KillSwitch;
    if (typeof raw.halted !== 'boolean') return null;
    return raw;
  } catch { return null; }
}

export function isSendingHalted() {
  return readKillSwitch()?.halted === true;
}

export function haltSending(reason: string, source: HaltSource = 'manual') {
  const state: KillSwitch = { halted: true, reason, source, updatedAt: new Date().toISOString(), resumeId: readKillSwitch()?.resumeId };
  const tmp = path() + '.tmp';
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmp, path());
  return state;
}

export function resumeSending() {
  const state: KillSwitch = { halted: false, reason: '', source: 'manual', updatedAt: new Date().toISOString(), resumeId: randomUUID() };
  const tmp = path() + '.tmp';
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmp, path());
  return state;
}
