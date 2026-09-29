import type { OutreachRecord, OutreachStore } from '../types.js';
import type { Logger } from '../scheduler/run.js';
import type { ToolCall } from './tools.js';
import { readConversation, latestReply, latestDeliveryFailure, plainReply, replyIntent, replySearchArgs } from './messages.js';
import { recordDeliveryOutcome } from '../send/reputation.js';
import { readCalendar, hasBooking, freeSlots, slotIsFree, bookingConfirmationBody, meetingTitle, plainPunctuation, companyLabel, requestedWindowIsObservable, type CalendarSnapshot, type AvailabilityPolicy } from './calendar.js';
import { ReplyJournal } from './journal.js';
import { deliveryRouteFor } from '../send/approved.js';
import { parseSchedulingWindow, inSchedulingWindow } from './window.js';
export interface ReplyOptions { inbox: string; dryRun: boolean; sender: string; policy: AvailabilityPolicy; limit: number; autoAvailability: boolean; meetingPurpose?: string; rotate?: boolean; conferencing?: string }
/** The Meet URL from a create_event result, wherever Slashy puts it. */
export const meetLinkOf = (event: unknown) => JSON.stringify(event ?? null).match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i)?.[0];

/**
 * Test delivery points every campaign at one inbox, so an accepted invite for one
 * company would read as a booking for all of them. There, only this company's meeting counts.
 */
const bookedFor = (cal: CalendarSnapshot, r: OutreachRecord) =>
  hasBooking(cal, r.contactEmail, new Date(), deliveryRouteFor(r.id) ? companyLabel(r.companyName) : undefined);

export async function checkReplies(store: OutreachStore, records: OutreachRecord[], call: ToolCall, journal: ReplyJournal, o: ReplyOptions, log: Logger) {
  const clear = new Map<string, number>(); let responded=0, stopped=0, failures=0;
  if (!records.length) return {clear,responded,stopped,failures};
  if(!Number.isInteger(o.limit) || o.limit < 1 || o.limit > 20) throw new Error('REPLY_BATCH_CAP must be 1–20');
  const cursor=o.rotate===false?0:journal.cursor()%records.length;
  const batch=Array.from({length:Math.min(o.limit,records.length)},(_,i)=>records[(cursor+i)%records.length]);
  if(!o.dryRun && o.rotate!==false)journal.advance(cursor+batch.length);
  // Every record's first look needs its thread and the calendar. Fetch them together in
  // one Claude process instead of one process each; misses fall back to normal calls.
  const lookups: Array<[string, Record<string, unknown>]> = batch.filter(r => r.threadId)
    .flatMap(r => [['read_thread', { inbox_email: o.inbox, thread_id: r.threadId }], ['list_messages', replySearchArgs(o.inbox, r.contactEmail)]] as Array<[string, Record<string, unknown>]>);
  if (lookups.length) lookups.push(['list_calendar_events', { inbox_email: o.inbox, time_period: 'next_7_days' }]);
  await call.prefetch?.(lookups).catch(e => log.warn(`batched lookup failed, falling back to single calls: ${e}`));
  let calendar: CalendarSnapshot | undefined;
  const getCalendar = async () => {
    if (!calendar || Date.now()-Date.parse(calendar.fetchedAt)>240000) calendar=await readCalendar(call,o.inbox);
    return calendar;
  };
  for (const r of batch) {
    try {
      const c=await readConversation(call,r,o.inbox);
      if(!o.dryRun && r.threadId!==c.threadId)await store.setThread(r.id,c.threadId);
      const bounce=latestDeliveryFailure(c,r,o.inbox);
      if (bounce) {
        if(!o.dryRun){
          await store.park(r.id,'bounced',`Delivery failure ${bounce.id} in thread ${c.threadId}`);
          recordDeliveryOutcome('bounced', r.id, r.contactEmail);
        }
        stopped++; log.info(`bounced: ${r.contactEmail}`);
        continue;
      }
      const reply=latestReply(c,r,o.inbox);
      if (!reply) {
        // Do not permit outbound follow-ups when the calendar check failed either.
        if(bookedFor(await getCalendar(),r)) {
          if(!o.dryRun)await store.park(r.id,'booked','Confirmed upcoming calendar attendee');
          stopped++; log.info(`booked: ${r.contactEmail}`);
        } else clear.set(r.id,Date.now());
        continue;
      }
      const intent=replyIntent(reply.body);
      if(intent==='complaint') {
        if(!o.dryRun){
          await store.park(r.id,'unsubscribed',`Spam complaint ${reply.id} in thread ${c.threadId}`);
          recordDeliveryOutcome('complained', r.id, r.contactEmail);
        }
        stopped++; log.info(`complaint: ${r.contactEmail}; sending auto-paused`);
        continue;
      }
      // Persist the stop before availability lookup or any outgoing reply.
      if(!o.dryRun)await store.park(r.id,intent==='unsubscribe'?'unsubscribed':'replied',`Reply ${reply.id} in thread ${c.threadId}`);
      stopped++; log.info(`reply detected: ${r.contactEmail} (${intent}); follow-ups stopped`);
      let job=journal.get(r.id,reply.id);
      if(job && job.state!=='pending') {
        if(intent!=='unsubscribe' && bookedFor(await getCalendar(),r) && !o.dryRun) await store.park(r.id,'booked','Confirmed upcoming calendar attendee');
        continue;
      }
      const alreadyAnswered=c.messages.some(m=>m.direction==='SENT'&&m.from.email.toLowerCase()===o.inbox.toLowerCase()&&Date.parse(m.date)>Date.parse(reply.date));
      if(intent==='schedule'&&reply.partial&&!alreadyAnswered) {
        // Only a cut-off preview is available; booking from half a sentence could pick the wrong time.
        if(!o.dryRun)journal.save({recordId:r.id,messageId:reply.id,threadId:c.threadId,state:'review',updatedAt:new Date().toISOString(),note:'Reply text is only partly available yet; check the thread and book manually'});
        continue;
      }
      if(intent!=='schedule'||alreadyAnswered||!o.autoAvailability) {
        if(!o.dryRun)journal.save({recordId:r.id,messageId:reply.id,threadId:c.threadId,state:'handled',updatedAt:new Date().toISOString(),note:alreadyAnswered?'Already answered':intent});
        continue;
      }
      job ??= {recordId:r.id,messageId:reply.id,threadId:c.threadId,state:'pending',updatedAt:new Date().toISOString()};
      if(!o.dryRun)journal.save(job);
      const cal=await getCalendar();
      if(bookedFor(cal,r)) {
        if(!o.dryRun){await store.park(r.id,'booked','Confirmed upcoming calendar attendee');journal.save({...job,state:'handled',note:'Already booked'});}
        continue;
      }
      // Explicit availability is a constraint: never substitute a different day.
      // Unconstrained scheduling requests can use the earliest opening.
      const requested=parseSchedulingWindow(reply.body,new Date(reply.date),o.policy.timezone);
      const fresh=await readConversation(call,{...r,threadId:c.threadId},o.inbox);
      if(latestReply(fresh,r,o.inbox)?.id!==reply.id || fresh.messages.some(m=>m.direction==='SENT'&&!m.isDraft&&Date.parse(m.date)>Date.parse(reply.date))) {
        if(!o.dryRun)journal.save({...job,state:'review',note:'Thread changed during booking preparation'});continue;
      }
      const freshCal=await readCalendar(call,o.inbox);
      // If we already emailed them specific times and they picked a day, honour the
      // exact time we proposed on that day rather than a different slot that day.
      const offered=requested?journal.offeredSlots(r.id).filter(s=>inSchedulingWindow(Date.parse(s),o.policy.minutes,requested)&&slotIsFree(freshCal,s,new Date(),o.policy)):[];
      const inWindow=offered.length?offered:requested?freeSlots(freshCal,new Date(),o.policy,requested):[];
      if(requested && !inWindow.length && !requestedWindowIsObservable(freshCal,requested)) {
        // Their window lies past the calendar we can see, so we cannot tell whether
        // it is free — booking a different time would override a slot that may work.
        log.warn(`Requested window is outside the checked calendar range for ${r.contactEmail}; paused for review`);
        if(!o.dryRun)journal.save({...job,state:'review',note:'Requested window outside checked calendar range'});
        continue;
      }
      const slot=requested ? inWindow[0] : freeSlots(freshCal,new Date(),o.policy)[0];
      if(!slot) {
        if(o.dryRun){log.info(`DRY_RUN would ask ${r.contactEmail} for alternative availability`);continue;}
        const body=[requested
          ? "Thanks for sharing your availability. I don't have a free meeting slot within the time window you suggested."
          : "Thanks for getting back to me. I don't have a free meeting slot within my current scheduling window.",
          'Could you share two or three alternative days and times that work for you, along with your time zone?',
          "I haven't scheduled a meeting yet.",o.sender];
        // Persist before drafting: an interrupted or ambiguous send is held for
        // review rather than replayed during the next scheduler poll.
        journal.save({...job,state:'review',note:'Preparing request for alternative availability',updatedAt:new Date().toISOString()});
        const draft=await call('draft_email',{inbox_email:o.inbox,to:[r.contactEmail],thread_id:c.threadId,subject:c.subject,body_blocks:body});
        if(draft.thread_id!==c.threadId || !draft.draft_id || draft.to?.length!==1 || draft.to[0].email.toLowerCase()!==r.contactEmail.toLowerCase() || draft.cc?.length || draft.bcc?.length)throw new Error('Alternative availability draft mismatch; not sent');
        journal.save({...job,state:'sending',note:'Requesting alternative availability',updatedAt:new Date().toISOString()});
        try {
          const sent=await call('send_email',{inbox_email:o.inbox,draft_id:draft.draft_id});
          if(!['queued','sent','delivered'].includes(sent.delivery_status))throw new Error('Unknown send result');
          journal.save({...job,state:'sent',note:'Asked for alternative availability; waiting for reply',updatedAt:new Date().toISOString()});responded++;
        }catch(e){journal.save({...job,state:'review',note:`Unknown alternative availability send outcome: ${e}`,updatedAt:new Date().toISOString()});throw e;}
        continue;
      }
      const end=new Date(Date.parse(slot)+o.policy.minutes*60000).toISOString();
      const title=meetingTitle(r.contactName,r.contactEmail,o.sender,r.companyName,r.outreachMode==='investment'?'Investment conversation about {company}':o.meetingPurpose);
      if(o.dryRun){log.info(`DRY_RUN would create “${title}” at ${slot} with ${r.contactEmail}`);continue;}
      journal.save({...job,state:'booking',selectedSlot:slot,eventTitle:title,updatedAt:new Date().toISOString()});
      let event:any;
      try {
        event=await call('create_event',{
          inbox_email:o.inbox,
          title,
          start_time:slot,
          end_time:end,
          timezone:o.policy.timezone,
          datetime_human:plainPunctuation(plainReply(reply.body)).replace(/\s+/g,' ').trim(),
          attendees:[r.contactEmail],
          description:`Conversation about ${companyLabel(r.companyName)}.`,
          transparency:'opaque',
          ...(o.conferencing?{conferencing:o.conferencing}:{}),
        });
      } catch(e) {
        journal.save({...job,state:'review',selectedSlot:slot,eventTitle:title,note:`Unknown calendar creation outcome: ${e}`,updatedAt:new Date().toISOString()});
        throw e;
      }
      const eventId=typeof event.event_id==='string'?event.event_id:typeof event.id==='string'?event.id:typeof event.event?.event_id==='string'?event.event.event_id:undefined;
      const meetLink=meetLinkOf(event);
      // A booked time without its video link is still a booked time: keep it, flag it.
      const meetNote=o.conferencing==='gmeet'&&!meetLink?'No Google Meet link confirmed; add one to the invitation':undefined;
      journal.save({...job,state:'booked',selectedSlot:slot,eventTitle:title,eventId,meetLink,note:meetNote,updatedAt:new Date().toISOString()});
      await store.park(r.id,'booked',`Calendar invitation created: ${title} at ${slot}${eventId?` (${eventId})`:''}${meetLink?` ${meetLink}`:''}`);
      const confirm=bookingConfirmationBody(slot,o.policy,o.sender,title,meetLink);
      const draft=await call('draft_email',{inbox_email:o.inbox,to:[r.contactEmail],thread_id:c.threadId,subject:c.subject,body_blocks:confirm});
      if(draft.thread_id!==c.threadId || !draft.draft_id || draft.to?.length!==1 || draft.to[0].email.toLowerCase()!==r.contactEmail.toLowerCase() || draft.cc?.length || draft.bcc?.length) throw new Error('Booking confirmation draft mismatch; not sent');
      journal.save({...job,state:'sending',selectedSlot:slot,eventTitle:title,eventId,updatedAt:new Date().toISOString()});
      try {
        const sent=await call('send_email',{inbox_email:o.inbox,draft_id:draft.draft_id});
        if(!['queued','sent','delivered'].includes(sent.delivery_status))throw new Error('Unknown send result');
        journal.save({...job,state:'sent',selectedSlot:slot,eventTitle:title,eventId,meetLink,note:meetNote,updatedAt:new Date().toISOString()});responded++;
        log.info(`Calendar invitation created and confirmation queued to ${r.contactEmail}`);
      } catch(e) { journal.save({...job,state:'review',selectedSlot:slot,eventTitle:title,eventId,note:`Invitation exists; unknown confirmation send outcome: ${e}`,updatedAt:new Date().toISOString()});throw e; }
    } catch(e) {failures++;log.error(`Reply check held ${r.contactEmail}: ${e}`);}
  }
  return {clear,responded,stopped,failures};
}
