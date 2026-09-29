import type { OutreachRecord } from '../types.js';

export interface Policy {
  batchCap: number;
  maxTouches: number;
  claimLockMinutes: number;
  /** Minutes between touch N and N+1. Index 0 = gap after the first send. */
  intervalsMinutes: number[];
  dryRun: boolean;
  /** What to do with a record whose claim went stale with no confirmed send. */
  ambiguousPolicy: 'review' | 'retry';
  quietHours: { startHour: number; endHour: number } | null;
}

// systemd EnvironmentFile keeps `20   # note` verbatim, unlike dotenv. A cap that
// silently parses to NaN matched no records, so strip the note and refuse garbage.
const num = (v: string | undefined, d: number) => {
  if (v === undefined) return d;
  const clean = v.split('#')[0].trim();
  const n = Number(clean);
  if (!clean || !Number.isFinite(n)) throw new Error(`Invalid numeric setting: ${JSON.stringify(v.slice(0, 40))}`);
  return n;
};

export function loadPolicy(env: NodeJS.ProcessEnv = process.env): Policy {
  return {
    batchCap: num(env.BATCH_CAP, 20),
    maxTouches: num(env.MAX_TOUCHES, 4),
    claimLockMinutes: num(env.CLAIM_LOCK_MINUTES, 15),
    intervalsMinutes: env.INTERVALS_MINUTES
      ? env.INTERVALS_MINUTES.split(',').map((s) => Number(s.trim()))
      : [4320, 5760, 10080], // 3d, 4d, 7d
    dryRun: (env.DRY_RUN ?? '').split('#')[0].trim() !== '0',
    ambiguousPolicy: env.AMBIGUOUS_POLICY === 'retry' ? 'retry' : 'review',
    quietHours:
      env.QUIET_HOURS === undefined
        ? null
        : (() => {
            const [s, e] = env.QUIET_HOURS.split('-').map(Number);
            return { startHour: s, endHour: e };
          })(),
  };
}

/** Interval after the touch that just went out at `stage`. null = sequence complete. */
export function nextTouchAfter(stage: number, now: Date, p: Policy): string | null {
  if (stage >= p.maxTouches) return null;
  const gap = p.intervalsMinutes[Math.min(stage - 1, p.intervalsMinutes.length - 1)];
  if (gap === undefined) return null;
  return new Date(now.getTime() + gap * 60_000).toISOString();
}

/** A claim younger than the lock window means another run is mid-send. */
export function isLocked(r: OutreachRecord, now: Date, p: Policy): boolean {
  if (!r.claimedAt) return false;
  return now.getTime() - new Date(r.claimedAt).getTime() < p.claimLockMinutes * 60_000;
}

export function inQuietHours(now: Date, p: Policy): boolean {
  if (!p.quietHours) return false;
  const h = now.getHours();
  const { startHour, endHour } = p.quietHours;
  return startHour <= endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}
