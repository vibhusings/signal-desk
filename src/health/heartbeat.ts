import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The scheduler's dead-man switch. A silent stall is the exact bug this project
 * exists to eliminate, so "the run stopped happening" must itself be detectable.
 */
export interface Heartbeat {
  lastRunAt: string;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export function writeHeartbeat(path: string, hb: Heartbeat): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(hb, null, 2));
}

export function readHeartbeat(path: string): Heartbeat | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as Heartbeat; }
  catch { return null; }
}

/** True when the scheduler has gone quiet for longer than it plausibly should have. */
export function isStale(hb: Heartbeat | null, intervalMinutes: number, now = new Date()): boolean {
  if (!hb) return true;
  return now.getTime() - new Date(hb.lastRunAt).getTime() > intervalMinutes * 2 * 60_000;
}
