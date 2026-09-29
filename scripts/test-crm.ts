import assert from 'node:assert/strict';
import { collectInbox } from '../src/crm/inbox.js';
import { groundedAnalysis } from '../ui/lib/crm-schema.js';
import { projectCrm,weekOf } from '../ui/lib/crm-projection.js';
import { syncCrmAttio, attioContext } from '../src/crm/attio.js';
import { collectAttioMeetings } from '../src/crm/meetings.js';
const analysis={summary:'Intro',vcSource:true,vcEvidence:'North Fund',funds:[{name:{value:'North Fund',quote:'North Fund'},details:null}],deals:[{company:{value:'Acme',quote:'Acme is raising'},round:null,status:null,arr:null,revenue:null,amount:null,nextStep:null}]};
assert.throws(()=>groundedAnalysis(analysis,'No fund here'));
const text='North Fund: Acme is raising';assert.deepEqual(groundedAnalysis(analysis,text),analysis);
const id='0123456789abcdef',inbox='me@example.com';
let calls:string[]=[];
const m={id:'m1',threadId:id,from:{email:inbox},to:[{email:'vc@fund.com'}],date:'2026-09-18T14:00:00Z',body:text};
const scope={emails:['vc@fund.com'],domains:['fund.com'],companies:['Acme']};
const call:any=async(name:string,args:any)=>{calls.push(name);assert.equal(args.inbox_email,inbox);if(name==='list_messages'){assert.match(args.q,/fund\.com/);return {threads:[{thread_id:id}],pagination:{has_more:false}};}return {inbox_email:inbox,thread_id:id,message_count:4,messages:[m,{...m,id:'draft',isDraft:true},{...m,id:'personal',from:{email:'mom@gmail.com'},to:[{email:inbox}],body:'Dinner tonight?'},{...m,id:'other',from:{email:'stranger@evil.com'},to:[{email:'elsewhere@example.com'}]}]};};
assert.equal((await collectInbox(call,inbox,7,new Date('2026-09-19T00:00:00Z'))).sources.length,0);
const batch=await collectInbox(call,inbox,7,new Date('2026-09-19T00:00:00Z'),scope);assert.equal(batch.sources.length,1);assert.equal(batch.partial,false);assert.deepEqual(calls,['list_messages','read_thread']);
const mismatched:any=async(name:string)=>name==='list_messages'?{threads:[{thread_id:id}],pagination:{has_more:false}}:{inbox_email:'wrong@example.com'};
assert.equal((await collectInbox(mismatched,inbox,7,undefined,scope)).partial,true);
const source={...batch.sources[0],analysis};
let view:any={settings:{inbox},sources:[source],relationships:{}};
let p=projectCrm(view);assert.equal(p.contacts[0].relationship,'Contact');assert.equal(p.deals[0].status,undefined);assert.equal(p.deals[0].vcFriends.length,0);assert.equal(p.weeks[0].contacts.length,1);
view.relationships['vc@fund.com']='VC friend';p=projectCrm(view);assert.deepEqual(p.deals[0].vcFriends,['vc@fund.com']);
assert.equal(projectCrm({...view,sources:[{...source,direction:'received'}]}).weeks[0].contacts.length,0);
assert.equal(weekOf('2026-09-20T23:59:00Z'),'2026-09-14');assert.equal(weekOf('2026-09-21T00:00:00Z'),'2026-09-21');
const writes:any[]=[],remote=new Map<string,string>();
const fetcher:any=async(url:string,req:any)=>{
 const body=JSON.parse(req.body);
 if(url.endsWith('/query'))return {ok:true,json:async()=>({data:remote.has(body.filter.external_id)?[{id:{record_id:remote.get(body.filter.external_id)}}]:[]})};
 writes.push({url,method:req.method,body});remote.set(body.data.values.external_id,body.data.values.external_id);
 return {ok:true};
};
await assert.rejects(()=>syncCrmAttio(view,{key:'test',object:'crm',inbox:'wrong@example.com'},fetcher));
await syncCrmAttio(view,{key:'test',object:'crm',inbox},fetcher);assert.ok(writes.every(w=>w.method==='POST'));const keys=writes.map(w=>w.body.data.values.external_id);writes.length=0;await syncCrmAttio(view,{key:'test',object:'crm',inbox},fetcher);assert.deepEqual(writes.map(w=>w.body.data.values.external_id),keys);
assert.ok(writes.every(w=>w.method==='PUT'));
assert.equal(writes.some(w=>JSON.stringify(w).includes('sequence_status')),false);
console.log('CRM evidence, inbox scope, draft exclusion, weekly grouping, VC relationships and idempotent Attio upserts passed.');

const fact=(value:string)=>({value,quote:value});
const application={company:fact('North Fund'),role:fact('Investment Analyst'),reference:null,url:null,appliedAt:null,deadline:null,nextStep:null,status:fact('Applied')};
const appText='North Fund Investment Analyst Applied Interview Rejected. We received your application.';
application.status={value:'Applied',quote:'We received your application.'};
const appAnalysis={summary:'Application',vcSource:false,vcEvidence:'',funds:[],deals:[],applications:[application]};
assert.equal(groundedAnalysis(appAnalysis,appText).applications?.length,1);
assert.throws(()=>groundedAnalysis({...appAnalysis,applications:[{...application,status:fact('Offer')}]},appText));
assert.throws(()=>groundedAnalysis({...appAnalysis,applications:[{...application,status:fact('Closed')}]},appText));
const appSource={...source,text:appText,analysis:appAnalysis};
const interview={...appSource,id:'interview',occurredAt:'2026-09-20T14:00:00Z',analysis:{...appAnalysis,applications:[{...application,status:fact('Interview')}]}};
const appView={...view,sources:[interview,appSource]};
const apps=projectCrm(appView).applications;
assert.equal(apps.length,1);assert.equal(apps[0].status.value,'Interview');assert.equal(apps[0].history.length,2);assert.equal(projectCrm(appView).deals.length,0);
const separate={...interview,id:'other-role',analysis:{...appAnalysis,applications:[{...application,role:fact('Partner')}]}};
assert.equal(projectCrm({...appView,sources:[appSource,separate]}).applications.length,2);
writes.length=0;await syncCrmAttio(appView,{key:'test',object:'crm',inbox},fetcher);
const appWrite=writes.find(w=>w.body.data.values.record_type==='job_application');assert.ok(appWrite);assert.equal(appWrite.body.data.values.deal_status,'Interview');
const shown=projectCrm({...view,sources:[source,{id:'personal',kind:'email',title:'Dinner',text:'Dinner tonight?',occurredAt:source.occurredAt,direction:'received',participants:[{email:'mom@gmail.com',name:'Mom'}]}],scope});
assert.equal(shown.contacts.some((c:any)=>c.email==='mom@gmail.com'),true);
assert.equal(shown.contacts.some((c:any)=>c.email==='vc@fund.com'),true);
console.log('Job application evidence, status history, role isolation and Attio export passed.');

assert.equal(groundedAnalysis({...appAnalysis,applications:[{...application,status:{value:'Applied',quote:'Investment Analyst'}}]},appText).applications?.[0].status,null);
const negative='I have not applied to North Fund Investment Analyst yet';
assert.equal(groundedAnalysis({...appAnalysis,applications:[{...application,status:{value:'Applied',quote:negative}}]},negative).applications?.[0].status,null);
const huge={sources:Array.from({length:100},(_,i)=>({id:String(i),text:'x'.repeat(16000)})),history:[]};
assert.ok(Buffer.byteLength(attioContext(huge))<=100000);assert.equal(JSON.parse(attioContext(huge)).sourceCount,100);
await assert.rejects(()=>syncCrmAttio(view,{key:'test',object:'crm',inbox},(async()=>({ok:true,json:async()=>({data:[{id:{record_id:'a'}},{id:{record_id:'b'}}]})})) as any),/Duplicate/);
console.log('Attio non-unique lookup/update, duplicate rejection, bounded export and Applied confirmation gate passed.');

let recruiterQuery='';
const recruiterCall:any=async(name:string,args:any)=>{if(name==='list_messages'){recruiterQuery=args.q;return {threads:[{thread_id:id}],pagination:{has_more:false}};}return {inbox_email:inbox,thread_id:id,message_count:1,messages:[{...m,from:{email:'recruiter@untracked.com'},to:[{email:inbox}],body:'Acme: We received your application.',id:'application'}]};};
const recruiterBatch=await collectInbox(recruiterCall,inbox,7,new Date('2026-09-19T00:00:00Z'),scope);
assert.match(recruiterQuery,/"Acme"/);assert.equal(recruiterBatch.sources.length,1);
console.log('Tracked company mentions admit recruiter mail from an untracked sender domain.');
const wideCall:any=async(name:string,args:any)=>{if(name==='list_messages'){assert.doesNotMatch(args.q,/fund\.com/);return {threads:[{thread_id:id}],pagination:{has_more:false}};}return {inbox_email:inbox,thread_id:id,message_count:4,messages:[m,{...m,id:'draft',isDraft:true},{...m,id:'personal',from:{email:'mom@gmail.com'},to:[{email:inbox}],body:'Dinner tonight?'},{...m,id:'other',from:{email:'stranger@evil.com'},to:[{email:'elsewhere@example.com'}]}]};};
const wide=await collectInbox(wideCall,inbox,7,new Date('2026-09-19T00:00:00Z'),undefined,true);
assert.equal(wide.sources.length,2);
assert.ok(wide.sources.some((s:any)=>s.participants.some((p:any)=>p.email==='mom@gmail.com')));
assert.ok(!wide.sources.some((s:any)=>s.text.includes('elsewhere')));
console.log('A wide inbox check keeps recent conversations, including people not already tracked.');
{
 let listings=0;
 const retry:any=async(name:string,args:any)=>{
  if(name==='list_messages'&&++listings===1)throw Error('list_messages: no matching successful tool result (exit 0)');
  return wideCall(name,args);
 };
 const recovered=await collectInbox(retry,inbox,7,new Date('2026-09-19T00:00:00Z'),undefined,true);
 assert.equal(listings,2);assert.equal(recovered.sources.length,2);assert.equal(recovered.partial,false);
 let failures=0;
 await assert.rejects(()=>collectInbox((async()=>{failures++;throw Error('provider unavailable');}) as any,inbox,7,undefined,undefined,true),/provider unavailable/);
 assert.equal(failures,2,'persistent read failure must stop after one retry');
 let emptyCalls=0;
 const empty=await collectInbox((async()=>{emptyCalls++;return {threads:[],pagination:{has_more:false}};}) as any,inbox,7,undefined,undefined,true);
 assert.equal(emptyCalls,1);assert.equal(empty.sources.length,0);
 console.log('Inbox listing retries transient tool failures once; persistent failures remain visible and successful empty results are not retried.');
}
const meetingScope={emails:['founder@flatkey.example'],domains:[],companies:['Flatkey']};
const meetingNow=new Date('2026-09-30T17:00:00Z');
const meeting={id:{meeting_id:'m1'},title:'Investment conversation about Flatkey',start:{datetime:'2026-09-30T16:00:00.000Z',timezone:'UTC'},end:{datetime:'2026-09-30T16:30:00.000Z',timezone:'UTC'},participants:[{email_address:'founder@flatkey.example',name:'Hunter'}]};
const other={...meeting,id:{meeting_id:'m2'},title:'Dinner',participants:[{email_address:'mom@gmail.com',name:'Mom'}],end:{datetime:'2026-09-30T18:00:00.000Z',timezone:'UTC'}};
const meetingFetch:any=async(url:string,init:any)=>{
 assert.equal(init.headers.Authorization,'Bearer second');
 if(url.includes('/call_recordings/r1/transcript'))return new Response(JSON.stringify({data:{raw_transcript:'We are not moving forward with Flatkey.',web_url:'https://app.attio.com/w/calls/r1'}}),{status:200});
 if(url.includes('/call_recordings'))return new Response(JSON.stringify({data:[{id:{meeting_id:'m1',call_recording_id:'r1'}}]}),{status:200});
 return new Response(JSON.stringify({data:[meeting,other],pagination:{next_cursor:null}}),{status:200});
};
const denied:any=async()=>new Response('',{status:403});
const recorded=await collectAttioMeetings(['first','second'],meetingScope,meetingNow,async(url,init)=>{
 const auth=init?.headers&&(init.headers as any).Authorization;
 if(auth==='Bearer first')return denied(url,init);
 return meetingFetch(url,init);
});
assert.equal(recorded.sources.length,1);
assert.equal(recorded.sources[0].id,'attio:r1');
assert.match(recorded.sources[0].text,/not moving forward/);
assert.equal(recorded.sources[0].participants[0].email,'founder@flatkey.example');
console.log('Finished Attio recordings for outreach meetings are collected; other meetings are left out.');

// Wide scans use a bare newer_than: listing (Slashy's up-to-date store), skip drafts/spam/trash, and retry a missed read once.
{
 const now=new Date(),qs:string[]=[];let reads=0;
 const msg=(id:string,labels:string[])=>({id,threadId:'1a0e96250d213959',from:{email:'founder@samplestack.com'},to:[{email:inbox}],date:new Date(now.getTime()-3600000).toISOString(),body:'<p>SampleStack is raising a Series B.</p>',labels,subject:'Demo opportunity'});
 const c:any=async(name:string,args:any)=>{
  if(name==='list_messages'){qs.push(args.q);return {threads:[{thread_id:'draft_123'},{thread_id:'1a0e96250d213959'}],pagination:{has_more:false}};}
  if(++reads===1)throw Error('no matching successful tool result');
  return {inbox_email:inbox,thread_id:'1a0e96250d213959',message_count:3,messages:[msg('a',['INBOX']),msg('b',['SPAM']),msg('c',['TRASH'])]};
 };
 const r=await collectInbox(c,inbox,7,now,undefined,true);
 assert.match(qs[0],/^newer_than:\d+d$/);assert.equal(r.sources.length,1);assert.equal(r.partial,false);assert.equal(reads,2);
 console.log('Wide inbox scan: up-to-date listing, drafts/spam/trash excluded, one retry on a missed read.');
}

// Evidence check tolerates typographic punctuation echoed as ASCII, but never a changed word.
{
 const text='For this fictional demo, I\u2019m an investor at Cedar Demo Ventures. We invest in Series B, typically writing $3\u20135 million checks.';
 const base={summary:'VC',vcSource:true,vcEvidence:"I'm an investor at Cedar Demo Ventures.",funds:[{name:{value:'Cedar Demo Ventures',quote:"I'm an investor at Cedar Demo Ventures."},details:{value:'Series B',quote:'writing $3-5 million checks'}}],deals:[],outreachDecision:{decision:'none',quote:''}};
 assert.equal(groundedAnalysis(base,text).vcSource,true);
 assert.throws(()=>groundedAnalysis({...base,vcEvidence:"I'm an investor at Birch Demo Ventures."},text),/VC classification/);
 assert.throws(()=>groundedAnalysis({...base,funds:[{name:{value:'x',quote:'writing $4-5 million checks'},details:null}]},text),/source evidence/);
 console.log('CRM evidence: curly quotes/dashes match their ASCII echo; altered words are still rejected.');
}

// Contacts carry the funds and deals they appear in; system mailboxes are recognisable.
{
 const { isAutomatedSender } = await import('../ui/lib/crm-projection.js');
 const src=(id:string,email:string,analysis:any)=>({id,kind:'email',title:id,text:'x',occurredAt:'2026-09-28T19:00:00Z',direction:'received',participants:[{email,name:'Vibhu Singh'}],analysis});
 const p=projectCrm({settings:{inbox:'me@example.com'},relationships:{},sources:[
  src('cedar','investor@example.org',{funds:[{name:{value:'Cedar Demo Ventures',quote:'q'},details:null}],deals:[]}),
  src('sample','founder@example.net',{funds:[],deals:[{company:{value:'SampleStack',quote:'q'},round:{value:'Series B',quote:'q'}}]})]});
 assert.deepEqual(p.contacts.find((c:any)=>c.email==='investor@example.org').funds,['Cedar Demo Ventures']);
 assert.deepEqual(p.contacts.find((c:any)=>c.email==='founder@example.net').deals,['SampleStack · Series B']);
 for(const e of ['no-reply@accounts.google.com','noreply-accounts@google.com','mailer-daemon@googlemail.com','do-not-reply@x.com'])assert.equal(isAutomatedSender(e),true,e);
 for(const e of ['harsha@slashy.com','founder@example.net','noah@x.com','replyall@x.com'])assert.equal(isAutomatedSender(e),false,e);
 console.log('CRM contacts show their funds and deals; no-reply senders are identified for hiding.');
}

// Attio export includes unscoped inbox contacts (like the UI) but never no-reply system senders.
{
 const { syncCrmAttio } = await import('../src/crm/attio.js');
 const names:string[]=[];
 const fetcher:any=async(url:string,req:any)=>{const body=JSON.parse(req.body);if(url.endsWith('/query'))return new Response(JSON.stringify({data:[]}),{status:200});names.push(`${body.data.values.record_type}:${body.data.values.name}`);return new Response(JSON.stringify({data:{id:{record_id:'r'}}}),{status:200});};
 const src=(id:string,email:string,name:string)=>({id,kind:'email',title:id,text:'x',occurredAt:'2026-09-28T19:00:00Z',direction:'received',participants:[{email,name}],analysis:null});
 await syncCrmAttio({settings:{inbox:'me@example.com'},relationships:{},sources:[src('cedar','investor@example.org','Vibhu Singh'),src('google','no-reply@accounts.google.com','Google')]},{key:'k',object:'investment_crm',inbox:'me@example.com'},fetcher);
 assert.ok(names.includes('contact:Vibhu Singh'));assert.ok(!names.some(n=>n.startsWith('contact:Google')));
 console.log('Attio export: inbox contacts included, no-reply senders excluded.');
}
