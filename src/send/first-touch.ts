import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OutreachRecord } from '../types.js';
import { sendGuardDir } from './runtime-dir.js';

type Ledger = Record<string, { approvedAt: string }>;

function path() { return resolve(sendGuardDir(), 'first-touch-approvals.json'); }

function load(): Ledger {
  if (!existsSync(path())) return {};
  try {
    const raw = JSON.parse(readFileSync(path(), 'utf8')) as Ledger;
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

function save(ledger: Ledger) {
  const tmp = path() + '.tmp';
  writeFileSync(tmp, JSON.stringify(ledger), { mode: 0o600 });
  renameSync(tmp, path());
}

export function isUnverifiedAddress(r: Pick<OutreachRecord, 'emailSource'>) {
  return r.emailSource?.kind === 'guessed';
}

export function needsFirstTouchApproval(r: Pick<OutreachRecord, 'id' | 'emailSource' | 'touchCount' | 'sequenceStage'>, touch: number) {
  if (touch !== 1 || r.touchCount > 0 || r.sequenceStage > 0) return false;
  if (!isUnverifiedAddress(r)) return false;
  return !load()[r.id];
}

export function approveFirstTouch(recordId: string) {
  const ledger = load();
  ledger[recordId] = { approvedAt: new Date().toISOString() };
  save(ledger);
  return ledger[recordId];
}

export function firstTouchApproved(recordId: string) {
  return !!load()[recordId];
}
