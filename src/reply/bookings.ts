import { slashyCall } from './tools.js';
import { readCalendar } from './calendar.js';
import type { Logger } from '../scheduler/run.js';
import type { OutreachStore } from '../types.js';

export interface BookingCheckOptions {
  claudeBin: string;
  model: string;
  timeoutMs: number;
  oauthToken?: string;
  apiKey?: string;
  /** Ceiling on records examined per run, mirroring the scheduler's batch cap. */
  limit: number;
  dryRun: boolean;
}

export interface BookingSummary {
  examined: number;
  booked: number;
  error?: string;
}



/**
 * Stops sequences for people who have put a meeting on the calendar.
 *
 * One subprocess for the whole run, never one per contact — each spawn costs 30-120s,
 * so per-contact polling would not survive the target volume.
 *
 * The model's only job is to call the tool. Which addresses appear in upcoming events
 * is a fact read out of the raw tool result and matched in code here, so a booking is
 * never something the model can talk us into or out of.
 */
export type AttendeeFetcher = () => Promise<{ emails: string[]; error?: string }>;

export async function checkBookings(
  store: OutreachStore,
  o: BookingCheckOptions,
  log: Logger,
  /** Injectable so the matching rules can be tested without a subprocess or a calendar. */
  fetchAttendees: AttendeeFetcher = () => listUpcomingAttendees(o),
): Promise<BookingSummary> {
  const awaiting = await store.findAwaitingReply(o.limit);
  const summary: BookingSummary = { examined: awaiting.length, booked: 0 };
  if (!awaiting.length) return summary;

  const byEmail = new Map(awaiting.map((r) => [r.contactEmail.toLowerCase(), r]));

  const attendees = await fetchAttendees();
  if (attendees.error) {
    // A failed calendar check must never look like "nobody booked" — say so and let
    // the sequence continue rather than silently stopping or silently sending.
    summary.error = attendees.error;
    log.warn(`booking check failed, sequences continue as scheduled: ${attendees.error}`);
    return summary;
  }

  for (const email of attendees.emails) {
    const record = byEmail.get(email.toLowerCase());
    if (!record) continue;
    if (o.dryRun) {
      log.info(`DRY_RUN would mark ${record.companyName} booked (${email} on the calendar)`);
      summary.booked++;
      continue;
    }
    // park() already sets the status, clears next_touch_at, and releases any claim.
    await store.park(record.id, 'booked', `meeting on the calendar with ${email}`);
    summary.booked++;
    log.info(`booked: ${record.companyName} (${email}) — sequence stopped`);
  }

  return summary;
}

/** Compatibility entry point: parse accepted attendees, never descriptions or memories. */
async function listUpcomingAttendees(o: BookingCheckOptions): Promise<{ emails: string[]; error?: string }> {
  try {
    const inbox = process.env.SENDER_INBOX;
    if (!inbox) throw new Error('SENDER_INBOX required');
    const calendar = await readCalendar(slashyCall(o), inbox);
    const emails = calendar.events.filter(e => e.status === 'confirmed' && Date.parse(e.start_time_iso) > Date.now() &&
      !e.attendees?.some(a => a.email.toLowerCase() === inbox.toLowerCase() && a.response === 'declined'))
      .flatMap(e => (e.attendees ?? []).filter(a => a.response === 'accepted').map(a => a.email));
    return { emails: [...new Set(emails)] };
  } catch (e) { return { emails: [], error: String(e) }; }
}
