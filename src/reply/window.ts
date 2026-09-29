import { plainReply } from './messages.js';

export interface SchedulingWindow {
  timezone: string;
  startDate?: string;
  endDate?: string;
  weekdays?: number[]; // 0=Sunday ... 6=Saturday
  startMinute?: number;
  endMinute?: number;
  description: string;
}

const DAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};
const ZONES: Record<string, string> = {
  pt: 'America/Los_Angeles', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles',
  mt: 'America/Denver', mst: 'America/Denver', mdt: 'America/Denver',
  ct: 'America/Chicago', cst: 'America/Chicago', cdt: 'America/Chicago',
  et: 'America/New_York', est: 'America/New_York', edt: 'America/New_York',
  utc: 'UTC', gmt: 'UTC',
};

function localParts(date: Date | number, timezone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]));
}
function isoDate(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}
function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
function weekday(date: string) { return new Date(`${date}T12:00:00Z`).getUTCDay(); }
function nextDay(today: string, target: number) {
  let delta = (target - weekday(today) + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(today, delta);
}
function minutes(hour: number, minute: number, meridiem?: string) {
  let h = hour;
  if (meridiem) { h %= 12; if (meridiem.toLowerCase() === 'pm') h += 12; }
  return h * 60 + minute;
}
function parseTime(raw: string, inherited?: string): number | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(raw.trim());
  if (!m) return undefined;
  const meridiem = m[3] ?? inherited;
  if (Number(m[1]) > (meridiem ? 12 : 23) || Number(m[2] ?? 0) > 59) return undefined;
  return minutes(Number(m[1]), Number(m[2] ?? 0), meridiem);
}

/** Parses only explicit scheduling language. Unrecognized text returns undefined. */
export function parseSchedulingWindow(body: string, now: Date, defaultTimezone: string): SchedulingWindow | undefined {
  const text = plainReply(body).toLowerCase().replace(/[–—]/g, '-');
  const zoneToken = /\b(p[sd]?t|m[sd]?t|c[sd]?t|e[sd]?t|utc|gmt)\b/i.exec(text)?.[1].toLowerCase();
  const timezone = zoneToken ? ZONES[zoneToken] : defaultTimezone;
  new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  const p = localParts(now, timezone);
  const today = isoDate(Number(p.year), Number(p.month), Number(p.day));
  const result: SchedulingWindow = { timezone, description: plainReply(body) };
  let constrained = false;

  if (/\bday after tomorrow\b/.test(text)) {
    result.startDate = result.endDate = addDays(today, 2); constrained = true;
  } else if (/\btomorrow\b/.test(text)) {
    result.startDate = result.endDate = addDays(today, 1); constrained = true;
  } else if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(text)) {
    result.startDate = result.endDate = today; constrained = true;
  } else if (/\bnext week\b/.test(text)) {
    const monday = nextDay(today, 1);
    result.startDate = monday; result.endDate = addDays(monday, 4); constrained = true;
  } else {
    const namedDate = new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i').exec(text);
    const numericDate = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
    if (namedDate || numericDate) {
      const month = namedDate ? MONTHS[namedDate[1].toLowerCase()] : Number(numericDate![1]);
      const day = Number(namedDate?.[2] ?? numericDate![2]);
      let year = Number(namedDate?.[3] ?? numericDate?.[3] ?? p.year);
      if (year < 100) year += 2000;
      const candidate = new Date(Date.UTC(year, month - 1, day, 12));
      if (candidate.getUTCMonth() + 1 === month && candidate.getUTCDate() === day) {
        let date = isoDate(year, month, day);
        if (!namedDate?.[3] && !numericDate?.[3] && date < today) date = isoDate(year + 1, month, day);
        result.startDate = result.endDate = date; constrained = true;
      }
    }
  }

  const dayMatches = [...text.matchAll(new RegExp(`\\b(next\\s+)?(${Object.keys(DAYS).join('|')})\\b`, 'gi'))];
  if (dayMatches.length && !result.startDate) {
    const dates = dayMatches.map(m => nextDay(today, DAYS[m[2].toLowerCase()])).sort();
    if (dates.length === 1) result.startDate = result.endDate = dates[0];
    else result.weekdays = [...new Set(dayMatches.map(m => DAYS[m[2].toLowerCase()]))];
    constrained = true;
  } else if (dayMatches.length) {
    // "next week, Tuesday" keeps the week range and narrows it to every
    // explicitly named weekday instead of silently choosing Monday.
    result.weekdays = [...new Set(dayMatches.map(m => DAYS[m[2].toLowerCase()]))];
    constrained = true;
  }

  if (/\bmornings?\b/.test(text)) { result.startMinute = 9 * 60; result.endMinute = 12 * 60; constrained = true; }
  if (/\bafternoons?\b/.test(text)) { result.startMinute = 12 * 60; result.endMinute = 17 * 60; constrained = true; }
  if (/\bevenings?\b/.test(text)) { result.startMinute = 17 * 60; result.endMinute = 21 * 60; constrained = true; }

  const time = '(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)';
  const range = new RegExp(`(?:between|from)?\\s*${time}\\s*(?:-|to|and)\\s*${time}`, 'i').exec(text);
  if (range) {
    const rightMeridiem = /\b(am|pm)\b/i.exec(range[2])?.[1];
    const start = parseTime(range[1], rightMeridiem);
    const end = parseTime(range[2]);
    if (start !== undefined && end !== undefined && start < end) {
      result.startMinute = start; result.endMinute = end; constrained = true;
    }
  } else {
    const after = new RegExp(`\\b(?:after|from)\\s+${time}`, 'i').exec(text);
    const before = new RegExp(`\\b(?:before|until|by)\\s+${time}`, 'i').exec(text);
    const at = new RegExp(`\\b(?:at|around)\\s+${time}`, 'i').exec(text);
    if (after) { const value = parseTime(after[1]); if (value !== undefined) { result.startMinute = value; constrained = true; } }
    if (before) { const value = parseTime(before[1]); if (value !== undefined) { result.endMinute = value; constrained = true; } }
    if (at) { const value = parseTime(at[1]); if (value !== undefined) { result.startMinute = value; result.endMinute = value + 60; constrained = true; } }
  }
  return constrained ? result : undefined;
}

export function inSchedulingWindow(instant: number, durationMinutes: number, window: SchedulingWindow): boolean {
  const p = localParts(instant, window.timezone);
  const date = isoDate(Number(p.year), Number(p.month), Number(p.day));
  const minute = Number(p.hour) * 60 + Number(p.minute);
  if (window.startDate && date < window.startDate) return false;
  if (window.endDate && date > window.endDate) return false;
  if (window.weekdays && !window.weekdays.includes(weekday(date))) return false;
  if (window.startMinute !== undefined && minute < window.startMinute) return false;
  if (window.endMinute !== undefined && minute + durationMinutes > window.endMinute) return false;
  return true;
}
