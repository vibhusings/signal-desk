import type { CrmScope } from '../../ui/lib/crm-scope.js';

type MeetingSource = {
  id: string;
  kind: 'attio';
  title: string;
  occurredAt: string;
  participants: Array<{ email: string; name: string }>;
  text: string;
  direction: 'meeting';
  url: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function companyInTitle(company: string, title: string) {
  const name = company.split('—')[0].split(' - ')[0].trim();
  return name.length >= 3 && new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(title);
}

export function meetingMatchesOutreach(meeting: { title?: string; participants?: Array<{ email_address?: string | null }> }, scope: CrmScope) {
  const emails = new Set((meeting.participants ?? []).map(p => (p.email_address ?? '').toLowerCase()).filter(Boolean));
  if (scope.emails.some(email => emails.has(email.toLowerCase()))) return true;
  const title = meeting.title ?? '';
  return scope.companies.some(company => companyInTitle(company, title));
}

function endedBefore(meeting: { end?: { datetime?: string; date?: string } }, now: Date) {
  const end = meeting.end?.datetime;
  const at = end ? Date.parse(end) : NaN;
  return Number.isFinite(at) && at <= +now;
}

function occurredAt(meeting: { start?: { datetime?: string } }) {
  const start = meeting.start?.datetime ?? '';
  return Number.isFinite(Date.parse(start)) ? new Date(start).toISOString() : '';
}

async function attioJson(fetcher: typeof fetch, key: string, path: string) {
  const response = await fetcher(`https://api.attio.com${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
  if (response.status === 401 || response.status === 403) return { denied: response.status as 401 | 403, body: null };
  if (response.status === 404) return { denied: null, body: null };
  if (!response.ok) throw Error(`Attio meetings request failed (HTTP ${response.status}).`);
  return { denied: null, body: await response.json() as any };
}

/** Read finished Attio call recordings for outreach meetings. Recording must already be on in Attio. */
export async function collectAttioMeetings(keys: string[], scope: CrmScope, now = new Date(), fetcher: typeof fetch = fetch) {
  const usable = keys.filter(Boolean);
  if (!usable.length) throw Error('Attio API key is missing.');
  if (!scope.emails.length && !scope.companies.length) return { sources: [] as MeetingSource[], warnings: ['No outreach records to match recorded meetings against.'] };
  const endsFrom = new Date(+now - 14 * 86400000).toISOString();
  let key = '';
  let listed: any = null;
  for (const candidate of usable) {
    const page = await attioJson(fetcher, candidate, `/v2/meetings?limit=20&sort=start_desc&ends_from=${encodeURIComponent(endsFrom)}&starts_before=${encodeURIComponent(now.toISOString())}`);
    if (page.denied) continue;
    key = candidate;
    listed = page.body;
    break;
  }
  if (!key) throw Error('Attio refused to read meetings. The token needs meeting:read and call_recording:read.');
  const meetings = (Array.isArray(listed?.data) ? listed.data : []).filter((meeting: any) => endedBefore(meeting, now) && meetingMatchesOutreach(meeting, scope)).slice(0, 8);
  const sources: MeetingSource[] = [];
  const warnings: string[] = [];
  for (const meeting of meetings) {
    const meetingId = meeting.id?.meeting_id;
    const when = occurredAt(meeting);
    if (!meetingId || !when) continue;
    const recordings = await attioJson(fetcher, key, `/v2/meetings/${encodeURIComponent(meetingId)}/call_recordings`);
    if (recordings.denied || !Array.isArray(recordings.body?.data)) { warnings.push('A finished meeting had no readable recording yet.'); continue; }
    for (const recording of recordings.body.data.slice(0, 2)) {
      const recordingId = recording.id?.call_recording_id;
      if (!recordingId) continue;
      const transcript = await attioJson(fetcher, key, `/v2/meetings/${encodeURIComponent(meetingId)}/call_recordings/${encodeURIComponent(recordingId)}/transcript`);
      const text = typeof transcript.body?.data?.raw_transcript === 'string' ? transcript.body.data.raw_transcript.trim() : '';
      if (transcript.denied || text.length < 5) { warnings.push('A recording has no transcript yet.'); continue; }
      const participants = (meeting.participants ?? []).flatMap((p: any) => {
        const email = typeof p.email_address === 'string' ? p.email_address.toLowerCase() : '';
        return /^\S+@\S+\.\S+$/.test(email) ? [{ email, name: typeof p.name === 'string' ? p.name : '' }] : [];
      }).slice(0, 100);
      const url = typeof transcript.body?.data?.web_url === 'string' && transcript.body.data.web_url.startsWith('https://') ? transcript.body.data.web_url : '';
      sources.push({ id: `attio:${recordingId}`, kind: 'attio', title: (meeting.title || 'Recorded meeting').slice(0, 500), occurredAt: when, participants, text: text.slice(0, 100000), direction: 'meeting', url });
    }
  }
  return { sources, warnings: warnings.slice(0, 10) };
}
