import type { ToolCall } from './tools.js';
import { inSchedulingWindow, type SchedulingWindow } from './window.js';
export interface CalendarEvent { title?: string; start_time_iso: string; end_time_iso: string; status?: string; availability?: string; attendees?: Array<{email: string; response?: string}>; organizer?: string; calendar_id?: string; is_all_day?: boolean }
export interface CalendarSnapshot { events: CalendarEvent[]; fetchedAt: string; inbox: string }
export async function readCalendar(call: ToolCall, inbox: string): Promise<CalendarSnapshot> {
  const r = await call('list_calendar_events', { inbox_email: inbox, time_period: 'next_7_days' });
  if (!Array.isArray(r.events) || r.truncated !== false || r.total_available !== r.events.length || r.inbox_email !== inbox) throw new Error('Calendar incomplete or wrong inbox');
  for (const e of r.events) if (!Number.isFinite(Date.parse(e.start_time_iso)) || !Number.isFinite(Date.parse(e.end_time_iso))) throw new Error('Calendar event has no valid absolute time');
  return { events: r.events, fetchedAt: new Date().toISOString(), inbox };
}
/** `titleIncludes` narrows to one campaign's meeting when several campaigns share an attendee (test delivery). */
export function hasBooking(c: CalendarSnapshot, email: string, now: Date, titleIncludes?: string): boolean {
  return c.events.some(e => e.status === 'confirmed' && Date.parse(e.start_time_iso) > +now &&
    (!titleIncludes || (e.title ?? '').toLowerCase().includes(titleIncludes.toLowerCase())) &&
    !e.attendees?.some(a => a.email.toLowerCase() === c.inbox.toLowerCase() && a.response === 'declined') &&
    !!e.attendees?.some(a => a.email.toLowerCase() === email.toLowerCase() && a.response === 'accepted'));
}
export interface AvailabilityPolicy { timezone: string; minutes: number; startHour: number; endHour: number; noticeHours: number }
export function availabilityPolicy(env = process.env): AvailabilityPolicy {
  const p = { timezone: env.MEETING_TIMEZONE ?? 'America/Los_Angeles', minutes: Number(env.MEETING_MINUTES ?? 30), startHour: Number(env.MEETING_START_HOUR ?? 9), endHour: Number(env.MEETING_END_HOUR ?? 17), noticeHours: Number(env.MEETING_NOTICE_HOURS ?? 24) };
  new Intl.DateTimeFormat('en-US', { timeZone: p.timezone });
  if (![15,30,45,60].includes(p.minutes) || !Number.isInteger(p.startHour) || !Number.isInteger(p.endHour) || p.startHour < 0 || p.endHour > 24 || p.startHour >= p.endHour || !Number.isFinite(p.noticeHours) || p.noticeHours < 1) throw new Error('Invalid meeting policy');
  return p;
}
function busyEvents(c: CalendarSnapshot): CalendarEvent[] {
  return c.events.filter(e => e.status !== 'cancelled' && e.availability !== 'free' && !e.attendees?.some(a => a.email.toLowerCase() === c.inbox.toLowerCase() && a.response === 'declined'));
}
function overlapsBusy(busy: CalendarEvent[], t: number, day: string, p: AvailabilityPolicy): boolean {
  return busy.some(e => (e.is_all_day && day >= e.start_time_iso.slice(0,10) && day < e.end_time_iso.slice(0,10)) || (t < Date.parse(e.end_time_iso) && t+p.minutes*60000 > Date.parse(e.start_time_iso)));
}
/** Whether one specific slot (e.g. one we offered earlier) is still bookable under the same rules as freeSlots. */
export function slotIsFree(c: CalendarSnapshot, slot: string, now: Date, p: AvailabilityPolicy): boolean {
  if (+now - Date.parse(c.fetchedAt) > 5 * 60000) throw new Error('Calendar snapshot is stale');
  const t = Date.parse(slot);
  if (!Number.isFinite(t) || t < +now + p.noticeHours*3600000 || t + p.minutes*60000 > Date.parse(c.fetchedAt) + 7*86400000) return false;
  const local = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: p.timezone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(t).map(x => [x.type,x.value]));
  return !overlapsBusy(busyEvents(c), t, `${local.year}-${local.month}-${local.day}`, p);
}
export function freeSlots(c: CalendarSnapshot, now: Date, p: AvailabilityPolicy, requested?: SchedulingWindow): string[] {
  if (+now - Date.parse(c.fetchedAt) > 5 * 60000) throw new Error('Calendar snapshot is stale');
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: p.timezone, weekday:'short', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
  const busy = busyEvents(c);
  const slots: string[] = []; const days = new Set<string>();
  const end = Date.parse(c.fetchedAt) + 7 * 86400000; // Stay inside the observed seven-day query.
  for (let t = Math.ceil((+now + p.noticeHours*3600000)/1800000)*1800000; t + p.minutes*60000 <= end; t += 1800000) {
    const local = Object.fromEntries(fmt.formatToParts(t).map(x => [x.type,x.value]));
    const day = `${local.year}-${local.month}-${local.day}`;
    const min = Number(local.hour)*60+Number(local.minute);
    if (['Sat','Sun'].includes(local.weekday) || days.has(day) || min < p.startHour*60 || min+p.minutes > p.endHour*60) continue;
    if (requested && !inSchedulingWindow(t, p.minutes, requested)) continue;
    if (overlapsBusy(busy, t, day, p)) continue;
    slots.push(new Date(t).toISOString()); days.add(day); if (slots.length === 3) break;
  }
  return slots;
}
export function availabilityBody(slots: string[], p: AvailabilityPolicy, sender: string, requested?: SchedulingWindow): string[] {
  const timezone = requested?.timezone ?? p.timezone;
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone:timezone, weekday:'long', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' });
  return [`Thanks for getting back to me. ${requested ? 'Within the window you suggested, I have' : 'I have'} these ${p.minutes}-minute times available (${timezone}):`, ...slots.map(s => `${fmt.format(new Date(s))} – ${new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(Date.parse(s)+p.minutes*60000))}`), 'Would one of these work for you? These times are available now but are not reserved yet.', sender];
}

function firstName(name: string | undefined, email: string): string {
  const raw = name?.trim().split(/\s+/)[0] || email.split('@')[0].split(/[._+-]/)[0] || 'Guest';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Slashy tool results are only trusted when the model's call arguments match ours
 * exactly, and the model rewrites typographic punctuation (“ ” ’ —) to ASCII. Sending
 * plain punctuation avoids a successful booking being rejected as unverified.
 */
export function plainPunctuation(s: string): string {
  return s.replace(/[“”„]/g, '"').replace(/[‘’‚]/g, "'").replace(/[–—]/g, '-').replace(/[\u00a0\u202f]/g, ' ');
}

export function companyLabel(company: string): string {
  return plainPunctuation(company.replace(/\s+[—–]\s+.*$/, '')).replace(/^["']+|["']+$/g, '').trim();
}

export function meetingTitle(contactName: string | undefined, contactEmail: string, sender: string, company: string, purposeTemplate = 'Discussing opportunities at {company}'): string {
  const purpose = purposeTemplate.replaceAll('{company}', companyLabel(company)).trim();
  return plainPunctuation(`${firstName(contactName, contactEmail)} <> ${firstName(sender, '')} - ${purpose}`);
}

export function bookingConfirmationBody(slot: string, p: AvailabilityPolicy, sender: string, title: string, meetLink?: string): string[] {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone:p.timezone, weekday:'long', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' });
  const when = `${fmt.format(new Date(slot))} for ${p.minutes} minutes`;
  return ([
    `Great - I booked ${when} and sent a calendar invitation titled "${title}".`,
    ...(meetLink ? [`Google Meet: ${meetLink}`] : []),
    'Looking forward to speaking with you.',
    sender,
  ]).map(plainPunctuation);
}

export function requestedWindowIsObservable(c: CalendarSnapshot, window: SchedulingWindow): boolean {
  // Check the actual intersection, including weekday and time constraints. A
  // week starting on the horizon boundary does not make its Wednesday visible.
  const start = Date.parse(c.fetchedAt);
  const end = start + 7 * 86400000;
  for (let t = Math.ceil(start / 60000) * 60000; t + 60000 <= end; t += 60000) {
    if (inSchedulingWindow(t, 1, window)) return true;
  }
  return false;
}
