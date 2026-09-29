import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { haltSending, isSendingHalted, readKillSwitch } from './kill-switch.js';
import { sendGuardDir } from './runtime-dir.js';

export type ReputationKind = 'sent' | 'bounced' | 'complained';
type Event = { at: string; kind: ReputationKind; recordId: string; domain: string; resumeId?: string };
type State = { events: Event[] };

const WINDOW = 20;
const MIN_SAMPLES = 5;
const BOUNCE_RATE = 0.05;
const BOUNCE_COUNT = 2;

function path() { return resolve(sendGuardDir(), 'send-reputation.json'); }

function load(): State {
  if (!existsSync(path())) return { events: [] };
  try {
    const raw = JSON.parse(readFileSync(path(), 'utf8')) as State;
    return { events: Array.isArray(raw.events) ? raw.events.slice(-200) : [] };
  } catch { return { events: [] }; }
}

function save(state: State) {
  const tmp = path() + '.tmp';
  writeFileSync(tmp, JSON.stringify({ events: state.events.slice(-200) }), { mode: 0o600 });
  renameSync(tmp, path());
}

export function domainOf(email: string) {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

export function recordDeliveryOutcome(kind: ReputationKind, recordId: string, email: string) {
  const state = load();
  state.events.push({ at: new Date().toISOString(), kind, recordId, domain: domainOf(email), resumeId: readKillSwitch()?.resumeId });
  save(state);
  return evaluateReputation(state);
}

function relevantEvents(state: State) {
  const halt = readKillSwitch();
  // A human resume is a decision to continue; only outcomes after that can auto-pause again.
  // Timestamps cannot distinguish an old bounce from a new complaint in the same millisecond.
  if (halt?.resumeId) return state.events.filter(e => e.resumeId === halt.resumeId);
  if (halt && !halt.halted && halt.updatedAt) {
    return state.events.filter(e => e.at >= halt.updatedAt);
  }
  return state.events;
}

export function reputationSnapshot(state = load()) {
  const events = relevantEvents(state);
  const window = events.filter(e => e.kind === 'sent' || e.kind === 'bounced').slice(-WINDOW);
  const bounced = window.filter(e => e.kind === 'bounced').length;
  const complained = events.filter(e => e.kind === 'complained').length;
  return {
    samples: window.length,
    bounced,
    bounceRate: window.length ? bounced / window.length : 0,
    complained,
  };
}

export function evaluateReputation(state = load()) {
  const snap = reputationSnapshot(state);
  if (isSendingHalted()) return { ...snap, halted: true as const };
  if (snap.complained > 0) {
    haltSending(`Complaint detected (${snap.complained}). Sending halted until a human resumes it.`, 'complaint');
    return { ...snap, halted: true as const };
  }
  if (snap.samples >= MIN_SAMPLES && (snap.bounceRate >= BOUNCE_RATE || snap.bounced >= BOUNCE_COUNT)) {
    haltSending(`Bounce rate ${Math.round(snap.bounceRate * 100)}% (${snap.bounced}/${snap.samples}) crossed the auto-pause threshold.`, 'bounce');
    return { ...snap, halted: true as const };
  }
  return { ...snap, halted: false as const };
}
