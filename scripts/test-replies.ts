import assert from 'node:assert/strict';
import { mock } from 'node:test';
mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-11T20:00:00Z') });
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SEND_GUARD_DIR = mkdtempSync(join(tmpdir(), 'reply-guard-'));
import { FakeStore, makeRecord } from '../src/attio/fake.js';
import { checkReplies } from '../src/reply/run.js';
import { ReplyJournal } from '../src/reply/journal.js';
import { replyIntent, latestReply, readConversation, type Conversation } from '../src/reply/messages.js';
import { freeSlots, hasBooking, availabilityPolicy, requestedWindowIsObservable } from '../src/reply/calendar.js';
import { parseSchedulingWindow, inSchedulingWindow } from '../src/reply/window.js';
import type { ToolCall } from '../src/reply/tools.js';
const inbox='sender@example.com', email='person@example.com', thread='1a08d811daf52f02';
const now=new Date();
const policy=availabilityPolicy({} as NodeJS.ProcessEnv);
const out={id:'out',threadId:thread,from:{email:inbox},to:[{email}],date:new Date(+now-3600000).toISOString(),direction:'SENT',body:'Would you like a call?'};
const reply={id:'reply',threadId:thread,from:{email},to:[{email:inbox}],date:new Date(+now-60000).toISOString(),direction:'RECEIVED',body:'Happy to chat. Please send your availability.'};
const record=()=>makeRecord({id:'r',contactEmail:email,threadId:thread,touchCount:1,sequenceStage:1,lastTouchAt:out.date});
const calendar={success:true,events:[],truncated:false,total_available:0,inbox_email:inbox};
const options={inbox,sender:'Sender',dryRun:false,policy,limit:3,autoAvailability:true};
const log={info:()=>{},warn:()=>{},error:()=>{}};
let count=0;
async function test(name:string, fn:()=>void|Promise<void>){await fn();count++;console.log(`✓ ${name}`);}
function fixture(body=reply.body, sendFails=false, calFails=false, calEvents:any[]=[]){
 const store=new FakeStore([record()]);const journal=new ReplyJournal(mkdtempSync(join(tmpdir(),'reply-test-')));let sends=0, drafts=0, events=0, draftArgs:any, eventArgs:any;
 const call:ToolCall=async(name,args)=>{
  if(name==='read_thread')return {success:true,thread_id:thread,inbox_email:inbox,message_count:2,subject:'Test',messages:[out,{...reply,body}]};
  if(name==='list_calendar_events'){if(calFails)throw new Error('offline');return {...calendar,events:calEvents,total_available:calEvents.length};}
  if(name==='create_event'){events++;eventArgs=args;return {success:true,event_id:'calendar-event-1'};}
  if(name==='draft_email'){assert.ok(['replied','booked'].includes(store.records.get('r')!.sequenceStatus));drafts++;draftArgs=args;return {success:true,draft_id:'d',thread_id:thread,to:[{email}],cc:[],bcc:[]};}
  if(name==='send_email'){sends++;if(sendFails)throw new Error('timeout');return {success:true,delivery_status:'queued'};}
  throw new Error(name);
 };
 return {store,journal,call,counts:()=>({sends,drafts,events,draftArgs,eventArgs})};
}
await test('A request for availability books the earliest opening instead of emailing options, and polling does not rebook',async()=>{
 const f=fixture();await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 assert.equal(f.store.records.get('r')!.sequenceStatus,'booked');assert.equal(f.store.records.get('r')!.nextTouchAt,null);
 assert.equal(f.counts().events,1);assert.equal(f.counts().sends,1);
 assert.match((f.counts().draftArgs.body_blocks as string[]).join('\n'),/calendar invitation titled/);
 await checkReplies(f.store,[f.store.records.get('r')!],f.call,f.journal,options,log);assert.equal(f.counts().events,1);assert.equal(f.counts().sends,1);
});
await test('Ambiguous send outcome is held, never retried automatically',async()=>{
 const f=fixture(reply.body,true);await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 assert.equal(f.journal.get('r','reply')!.state,'review');await checkReplies(f.store,[record()],f.call,f.journal,options,log);assert.equal(f.counts().sends,1);
});
await test('Calendar failure still stops follow-ups and preserves pending availability work',async()=>{
 const f=fixture(reply.body,false,true);const r=await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 assert.equal(r.failures,1);assert.equal(f.store.records.get('r')!.sequenceStatus,'replied');assert.equal(f.counts().sends,0);assert.equal(f.journal.get('r','reply')!.state,'pending');
});
await test('Unsubscribe stops outreach without an availability reply',async()=>{
 const f=fixture('Unsubscribe. Stop emailing me.');await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 assert.equal(f.store.records.get('r')!.sequenceStatus,'unsubscribed');assert.equal(f.counts().sends,0);
});
await test('Rejected, automatic, ambiguous, and quoted scheduling text do not trigger replies',()=>{
 for(const text of ['Not interested, thanks','Out of office; contact me for availability','Thanks','No thanks. <blockquote>Send your availability</blockquote>'])assert.notEqual(replyIntent(text),'schedule');
});
await test('Negative availability stops follow-ups without booking the mentioned window',async()=>{
 for(const body of ['I am unavailable Tuesday afternoon','I cannot do Monday at 3 PM','No thanks, Tuesday at 2 PM does not work','I’m not available Tuesday afternoon','I can’t do Monday at 3 PM']){
  const f=fixture(body);
  await checkReplies(f.store,[record()],f.call,f.journal,options,log);
  assert.equal(f.store.records.get('r')!.sequenceStatus,'replied');
  assert.equal(f.counts().events,0,body);assert.equal(f.counts().sends,0,body);
 }
});
await test('Unrelated sender and pre-outreach messages do not count as replies',()=>{
 const c:Conversation={threadId:thread,subject:'Test',messages:[out,{...reply,from:{email:'other@example.com'}}]};assert.equal(latestReply(c,record(),inbox),undefined);
 c.messages=[out,{...reply,date:new Date(+now-7200000).toISOString()}];assert.equal(latestReply(c,record(),inbox),undefined);
});
await test('Read failure never clears a follow-up for sending',async()=>{
 const f=fixture();const r=await checkReplies(f.store,[record()],async()=>{throw new Error('offline');},f.journal,options,log);assert.equal(r.clear.size,0);assert.equal(r.failures,1);
});
await test('Queued send resolves its Gmail thread by exact RFC Message-ID',async()=>{
 // Search narrows by subject; the exact Message-ID on a SENT message decides the match.
 const messageId='<unique-send@mail.slashy.ai>';let query='';
 const r=makeRecord({contactEmail:email,threadId:null,lastMessageId:messageId,lastSubject:'Exact thread',lastTouchAt:now.toISOString()});
 const other='1a08d811daf52f03';
 const call:ToolCall=async(name,args)=>{
  // Without subjects in the recent-sent listing, resolution falls back to the indexed subject search.
  if(name==='list_messages'){if(String(args.q).includes('subject:'))query=String(args.q);return {success:true,pagination:{has_more:false},threads:[{thread_id:other},{thread_id:thread}]};}
  if(name==='read_thread'){const id=String(args.thread_id);return {success:true,thread_id:id,inbox_email:inbox,message_count:1,subject:'Exact thread',
   messages:[{...out,threadId:id,message_id:id===thread?messageId:'<someone-else@mail.slashy.ai>'}]};}
  throw new Error(name);
 };
 const c=await readConversation(call,r,inbox);
 assert.equal(query,`to:${email} in:sent subject:"Exact thread"`);assert.equal(c.threadId,thread,'a same-subject thread with a different Message-ID was chosen');
});
await test('Dry run writes no Attio changes and sends nothing',async()=>{
 const f=fixture();await checkReplies(f.store,[record()],f.call,f.journal,{...options,dryRun:true},log);assert.equal(f.store.writes.length,0);assert.equal(f.counts().sends,0);assert.equal(f.journal.get('r','reply'),undefined);
});
await test('Availability respects Pacific weekdays, notice, busy events, and cancelled events',()=>{
 const at=new Date('2026-09-11T20:00:00Z');const c={inbox,fetchedAt:at.toISOString(),events:[{start_time_iso:'2026-09-14T16:00:00Z',end_time_iso:'2026-09-14T17:00:00Z',availability:'busy',status:'confirmed'}]};
 const slots=freeSlots(c,at,policy);assert.equal(slots[0],'2026-09-14T17:00:00.000Z');assert.equal(slots.length,3);
 c.events[0].status='cancelled';assert.equal(freeSlots(c,at,policy)[0],'2026-09-14T16:00:00.000Z');
});
await test('Availability follows DST instead of a fixed UTC offset',()=>{
 const at=new Date('2026-10-30T20:00:00Z');const slots=freeSlots({inbox,fetchedAt:at.toISOString(),events:[]},at,policy);assert.equal(slots[0],'2026-11-02T17:00:00.000Z');
});
await test('Booking requires accepted attendee, not a description, declined guest, or cancelled event',()=>{
 const c={inbox,fetchedAt:now.toISOString(),events:[{start_time_iso:new Date(+now+86400000).toISOString(),end_time_iso:new Date(+now+90000000).toISOString(),status:'confirmed',attendees:[{email,response:'declined'}]}]};
 assert.equal(hasBooking(c,email,now),false);c.events[0].attendees[0].response='accepted';assert.equal(hasBooking(c,email,now),true);c.events[0].status='cancelled';assert.equal(hasBooking(c,email,now),false);
});
await test('An interrupted send claim is not retried after process restart',async()=>{
 const f=fixture();f.journal.save({recordId:'r',messageId:'reply',threadId:thread,state:'sending',updatedAt:now.toISOString()});
 await checkReplies(f.store,[record()],f.call,f.journal,options,log);assert.equal(f.counts().sends,0);
});
await test('Busy all-day events exclude the full local day',()=>{
 const at=new Date('2026-09-11T20:00:00Z');const slots=freeSlots({inbox,fetchedAt:at.toISOString(),events:[{start_time_iso:'2026-09-14T00:00:00Z',end_time_iso:'2026-09-15T00:00:00Z',status:'confirmed',availability:'busy',is_all_day:true}]},at,policy);
 assert.equal(slots[0],'2026-09-15T16:00:00.000Z');
});
await test('Recipient weekday and afternoon window constrains offered slots',()=>{
 const at=new Date('2026-09-11T20:00:00Z');
 const window=parseSchedulingWindow('Tuesday afternoon works for me',at,policy.timezone)!;
 assert.deepEqual(window.startDate,'2026-09-15');
 assert.equal(window.startMinute,12*60);assert.equal(window.endMinute,17*60);
 const slots=freeSlots({inbox,fetchedAt:at.toISOString(),events:[]},at,policy,window);
 assert.deepEqual(slots,['2026', '2026', '2026'].slice(0,1).map(()=> '2026-09-15T19:00:00.000Z'));
});
await test('Explicit recipient timezone is applied to the requested window',()=>{
 const at=new Date('2026-09-11T20:00:00Z');
 const window=parseSchedulingWindow('Monday between 2 and 4 PM ET',at,policy.timezone)!;
 assert.equal(window.timezone,'America/New_York');
 assert.equal(inSchedulingWindow(Date.parse('2026-09-14T18:00:00Z'),30,window),true);
 assert.equal(inSchedulingWindow(Date.parse('2026-09-14T20:00:00Z'),30,window),false);
});
await test('Relative days and exact times are parsed deterministically',()=>{
 const at=new Date('2026-09-11T20:00:00Z');
 const tomorrow=parseSchedulingWindow('Tomorrow at 3pm PT works',at,policy.timezone)!;
 assert.equal(tomorrow.startDate,'2026-09-12');assert.equal(tomorrow.startMinute,15*60);
 const later=parseSchedulingWindow('Day after tomorrow morning',at,policy.timezone)!;
 assert.equal(later.startDate,'2026-09-13');
});
await test('Next-week replies with multiple named days exclude every other weekday',()=>{
 const at=new Date('2026-09-11T20:00:00Z');
 const window=parseSchedulingWindow('Sure, next week. I am available anytime on Tuesday and Wednesday.',at,policy.timezone)!;
 assert.deepEqual(window.weekdays,[2,3]);assert.equal(window.startDate,'2026-09-14');assert.equal(window.endDate,'2026-09-18');
 const slots=freeSlots({inbox,fetchedAt:at.toISOString(),events:[]},at,policy,window);
 assert.equal(slots[0],'2026-09-15T16:00:00.000Z');
});
await test('Next-week reply with one named day does not silently choose Monday',()=>{
 const at=new Date('2026-09-12T00:23:00Z');
 const window=parseSchedulingWindow("Sounds good, let's meet next week. I am available anytime on Tuesday.",at,policy.timezone)!;
 assert.deepEqual(window.weekdays,[2]);assert.equal(window.startDate,'2026-09-14');assert.equal(window.endDate,'2026-09-18');
 assert.equal(inSchedulingWindow(Date.parse('2026-09-14T16:00:00Z'),30,window),false);
 assert.equal(inSchedulingWindow(Date.parse('2026-09-15T16:00:00Z'),30,window),true);
});
await test('Positive replies with specific windows trigger scheduling',()=>{
 for(const text of ['Tuesday afternoon works','Thursday after 2 PM ET','Tomorrow at 10am','Happy to meet next Monday morning']) assert.equal(replyIntent(text),'schedule');
});
await test('A recipient window creates the earliest free event, invites them, updates Attio, and confirms in-thread',async()=>{
 const f=fixture('Monday between 2 and 4 PM PT works for me');
 await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 const counts=f.counts();
 assert.equal(counts.events,1);assert.equal(counts.eventArgs.start_time,'2026-09-14T21:00:00.000Z');
 assert.equal(counts.eventArgs.end_time,'2026-09-14T21:30:00.000Z');
 assert.deepEqual(counts.eventArgs.attendees,[email]);assert.equal(counts.eventArgs.transparency,'opaque');
 assert.equal(counts.eventArgs.title,'Person <> Sender - Discussing opportunities at Company r');
 assert.equal(f.store.records.get('r')!.sequenceStatus,'booked');
 const body=(counts.draftArgs.body_blocks as string[]).join('\n');
 assert.match(body,/calendar invitation titled/);assert.match(body,/Person <> Sender/);assert.equal(counts.sends,1);
 await checkReplies(f.store,[f.store.records.get('r')!],f.call,f.journal,options,log);
 assert.equal(f.counts().events,1);assert.equal(f.counts().sends,1);
});
await test('A requested date beyond the calendar observation range is held',()=>{
 const at=new Date('2026-09-11T20:00:00Z');
 const c={inbox,fetchedAt:at.toISOString(),events:[]};
 assert.equal(requestedWindowIsObservable(c,parseSchedulingWindow('September 30 at 2pm PT',at,policy.timezone)!),false);
});
await test('A today request blocked by notice does not book another day',async()=>{
 const f=fixture('Thanks for sharing this. Are you available today for a call sometime?');
 await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 const c=f.counts();
 assert.equal(c.events,0);assert.equal(c.sends,1);
 assert.equal(f.journal.get('r','reply')!.state,'sent');
});
await test('A fully busy requested window never books outside the request',async()=>{
 const text='Monday between 2 and 4 PM PT works for me';
 const w=parseSchedulingWindow(text,new Date(),policy.timezone)!;
 const day=Date.parse(`${w.startDate}T00:00:00Z`);
 const busy=[{start_time_iso:new Date(day+18*3600000).toISOString(),end_time_iso:new Date(day+26*3600000).toISOString(),status:'confirmed',availability:'busy'}];
 const f=fixture(text,false,false,busy);
 await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 const c=f.counts();
 assert.equal(c.events,0);assert.equal(c.sends,1);
 assert.equal(f.journal.get('r','reply')!.state,'sent');
 assert.match(c.draftArgs.body_blocks.join('\n'),/two or three alternative days/);
 assert.equal(f.store.records.get('r')!.sequenceStatus,'replied');
 await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 assert.equal(f.counts().sends,1);
});
await test('Alternative availability send timeout is held without retry or booking',async()=>{
 const f=fixture('Are you available today for a call?',true);
 await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 assert.equal(f.journal.get('r','reply')!.state,'review');
 await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 assert.equal(f.counts().sends,1);assert.equal(f.counts().events,0);
});
await test('Alternative availability dry run does not draft or send',async()=>{
 const f=fixture('Are you available today for a call?');
 await checkReplies(f.store,[record()],f.call,f.journal,{...options,dryRun:true},log);
 assert.equal(f.counts().drafts,0);assert.equal(f.counts().sends,0);assert.equal(f.counts().events,0);
 assert.equal(f.journal.get('r','reply'),undefined);
});
await test('"today" parses to today in the meeting timezone',()=>{
 const at=new Date('2026-09-11T20:00:00Z');
 assert.equal(parseSchedulingWindow('Are you free today for a call?',at,policy.timezone)!.startDate,'2026-09-11');
});
await test('Picking a day from offered times ("Let’s do Tuesday") counts as scheduling',()=>{
 for(const text of ['Let’s do Tuesday','Let\'s do Tuesday\n\nAlex Rivera\nBlock a time: cal.com/alexrivera','Sounds good, Wednesday works','I\'ll take Monday'])assert.equal(replyIntent(text),'schedule',text);
});
await test('A day picked from earlier-offered times books the exact offered time, not another slot that day',async()=>{
 // Choose a weekday 3–6 days out so the 24h notice never interferes, whatever day the suite runs.
 const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
 let target='';for(let d=3;d<=6;d++){const wd=new Date(Date.now()+d*86400000).getDay();if(wd>=1&&wd<=5){target=names[wd];break;}}
 const text=`Let's do ${target}`;
 const w=parseSchedulingWindow(text,new Date(),policy.timezone)!;
 const earliest=freeSlots({inbox,fetchedAt:new Date().toISOString(),events:[]},new Date(),policy,w)[0];
 const offeredSlot=new Date(Date.parse(earliest)+90*60000).toISOString(); // 90 min after the earliest free slot that day
 const f=fixture(text);
 f.journal.save({recordId:'r',messageId:'earlier-offer',threadId:thread,state:'sent',updatedAt:new Date(Date.now()-3600000).toISOString(),slots:[offeredSlot]});
 await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 const c=f.counts();
 assert.equal(c.events,1);assert.equal(c.eventArgs.start_time,offeredSlot,'booked a different time than the one we offered');
 assert.doesNotMatch((c.draftArgs.body_blocks as string[]).join('\n'),/closest opening/);
});
await test('Typographic punctuation is sent as ASCII so the model cannot cause a verified booking to be rejected',async()=>{
 const f=fixture('Let’s do Monday between 2 and 4 PM PT — thanks!');
 const rec=makeRecord({id:'r',contactEmail:email,contactName:'Ann',companyName:'“Silimate” — Ann Wu',threadId:thread,touchCount:1,sequenceStage:1,lastTouchAt:out.date});
 f.store.records.set('r',rec);
 await checkReplies(f.store,[rec],f.call,f.journal,options,log);
 const c=f.counts();
 assert.equal(c.events,1);
 for(const k of ['title','description','datetime_human'])assert.doesNotMatch(String(c.eventArgs[k]),/[“”‘’–—]/,k);
 assert.equal(c.eventArgs.title,'Ann <> Sender - Discussing opportunities at Silimate');
 assert.doesNotMatch((c.draftArgs.body_blocks as string[]).join('\n'),/[“”‘’–—\u202f]/);
});
await test('Monday September 14 next-week Wednesday cannot fall back to Monday',async()=>{
 const at=new Date('2026-09-14T07:49:00Z');
 mock.timers.setTime(+at);
 try {
  const text="Hi, I'm free next week on Wednesday.";
  const w=parseSchedulingWindow(text,at,policy.timezone)!;
  assert.equal(w.startDate,'2026-09-21');assert.deepEqual(w.weekdays,[3]);
  assert.equal(inSchedulingWindow(Date.parse('2026-09-23T17:00:00Z'),30,w),true);
  assert.equal(requestedWindowIsObservable({inbox,fetchedAt:at.toISOString(),events:[]},w),false);
  const f=fixture(text);
  const call:ToolCall=async(name,args)=>name==='read_thread'
   ? {success:true,thread_id:thread,inbox_email:inbox,message_count:2,subject:'Test',messages:[out,{...reply,date:at.toISOString(),body:text}]}
   : f.call(name,args);
  await checkReplies(f.store,[record()],call,f.journal,{...options,policy:{...policy,noticeHours:2}},log);
  assert.equal(f.counts().events,0);assert.equal(f.counts().drafts,0);assert.equal(f.counts().sends,0);
  assert.match(f.journal.get('r','reply')!.note!,/outside checked calendar range/);
 } finally { mock.timers.setTime(+now); }
});
await test('Mailer-daemon delivery failure parks as bounced and does not treat it as a reply', async () => {
 const bounce={id:'bounce',threadId:thread,from:{email:'mailer-daemon@google.com'},to:[{email:inbox}],date:new Date(+now-60000).toISOString(),direction:'RECEIVED',subject:'Delivery Status Notification (Failure)',body:`Address not found: ${email}`};
 const f=fixture();
 const call:ToolCall=async(name,args)=>name==='read_thread'
  ? {success:true,thread_id:thread,inbox_email:inbox,message_count:2,subject:'Test',messages:[out,bounce]}
  : f.call(name,args);
 await checkReplies(f.store,[record()],call,f.journal,options,log);
 assert.equal(f.store.records.get('r')!.sequenceStatus,'bounced');
 assert.equal(f.counts().sends,0);
});
await test('Spam complaint parks the record and does not send availability', async () => {
 const f=fixture('This is spam. Marked as spam.');
 await checkReplies(f.store,[record()],f.call,f.journal,options,log);
 assert.equal(f.store.records.get('r')!.sequenceStatus,'unsubscribed');
 assert.equal(f.counts().sends,0);
 assert.equal(replyIntent('This is spam. Marked as spam.'),'complaint');
});
mock.timers.reset();
console.log(`${count} reply/calendar tests passed`);
