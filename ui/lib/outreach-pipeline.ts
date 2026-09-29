import { workspaceDb } from '@/db/workspace';

/**
 * Shortlist → contact research + first-email drafts → per-contact approval →
 * send + follow-ups → reply → meeting. D1 holds the queue and saved companies;
 * the runner snapshot and Attio hold send state. Stages are derived, not stored,
 * so they can never drift from what actually happened.
 */
type Db = ReturnType<typeof workspaceDb>;
export const STAGES = ['New','Shortlisted','Draft ready','Contacted','Replied','Meeting booked','Passed'] as const;

export async function ensureOutreachSettings(db:Db){
 await db.prepare('CREATE TABLE IF NOT EXISTS outreach_settings(owner_id TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL)').run();
}
export async function outreachSettings(db:Db,owner:string):Promise<{demoRecipient:string}>{
 await ensureOutreachSettings(db);
 const row=await db.prepare('SELECT data FROM outreach_settings WHERE owner_id=?').bind(owner).first<{data:string}>();
 const data=row?JSON.parse(row.data):{};
 return {demoRecipient:typeof data.demoRecipient==='string'?data.demoRecipient:''};
}
export const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Mirrors the runner's validateDraft so a rejected draft fails here, not at send time. */
export function cleanDraft(d:{subject?:unknown;body?:unknown}){
 if(typeof d.subject!=='string'||typeof d.body!=='string')throw Error('A draft needs a subject and a body.');
 const plain=(s:string)=>s.replace(/[“”„]/g,'"').replace(/[‘’‚]/g,"'").replace(/[–—]/g,'-').replace(/[  ]/g,' ');
 const subject=plain(d.subject).replace(/\s+/g,' ').trim();
 const body=plain(d.body).replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 if(subject.length<3||subject.length>150)throw Error('Subject must be 3–150 characters.');
 if(body.length<20||body.length>4000)throw Error('Body must be 20–4000 characters.');
 if(/[<>]/.test(subject+body))throw Error('Remove < and > characters from the draft.');
 if(/\[[^\]]{1,40}\]|\{\{|```/.test(subject+body))throw Error('The draft still contains a placeholder such as [Name].');
 return {subject,body};
}

export async function runnerState(db:Db){
 const row=await db.prepare('SELECT snapshot,updated_at FROM outreach_runner WHERE id=?').bind('primary').first<{snapshot:string;updated_at:string}>();
 const snapshot=JSON.parse(row?.snapshot||'{}');
 return {snapshot,online:!!row?.updated_at&&Date.now()-Date.parse(row.updated_at)<90000};
}

/** Create (or revive) the company for a signal. Idempotent per company. */
export async function companyFromSignal(db:Db,owner:string,signalId:string){
 const event=await db.prepare('SELECT data,company_key FROM signal_events WHERE owner_id=? AND id=?').bind(owner,signalId).first<{data:string;company_key:string}>();
 if(!event)throw Error('Signal not found');
 const s=JSON.parse(event.data),id=`signal:${event.company_key}`,now=new Date().toISOString();
 const existing=await db.prepare('SELECT data FROM companies WHERE owner_id=? AND id=?').bind(owner,id).first<{data:string}>();
 if(existing){
  const data=JSON.parse(existing.data);
  if(data.status==='Passed'||data.status==='New')await db.prepare('UPDATE companies SET data=?,updated_at=? WHERE owner_id=? AND id=?').bind(JSON.stringify({...data,status:'Shortlisted'}),now,owner,id).run();
  return {companyId:id,company:s.company as string};
 }
 const company={id,name:s.company,domain:new URL(s.website).hostname,sector:s.sector||'Unknown',stage:s.stage||'Unknown',location:s.geography||'Unknown',signal:s.title,kind:s.kind,source:s.evidence[0].url,status:'Shortlisted',notes:[s.summary,...(s.reasons??[]),...s.evidence.map((e:any)=>`${e.quote}\n${e.url}`)].join('\n\n').slice(0,10000),draft:'',observed:String(s.observedAt??now).slice(0,10)};
 await db.prepare('INSERT INTO companies (owner_id,id,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,id) DO NOTHING').bind(owner,id,JSON.stringify(company),now).run();
 return {companyId:id,company:s.company as string};
}

/**
 * Queue contact research that ends in drafts. Skips when research is already
 * queued, running, or produced contacts, unless `retry` is set after a failure.
 */
export async function queueResearch(db:Db,owner:string,companyId:string,opts:{retry?:boolean}={}):Promise<{discoveryId?:string;pending?:string}>{
 const saved=await db.prepare('SELECT data FROM companies WHERE owner_id=? AND id=?').bind(owner,companyId).first<{data:string}>();
 if(!saved)return {pending:'Save this company first.'};
 const company=JSON.parse(saved.data);
 const prior=await db.prepare("SELECT id,status FROM outreach_jobs WHERE owner_id=? AND action='discover' AND json_extract(payload,'$.companyId')=? ORDER BY created_at DESC LIMIT 1").bind(owner,companyId).first<{id:string;status:string}>();
 if(prior&&(['queued','running'].includes(prior.status)||(prior.status==='succeeded'&&!opts.retry)))return {discoveryId:prior.id};
 const {snapshot,online}=await runnerState(db);
 if(!online)return {pending:'The cloud runner is offline. Contact research will need to be started again once it reconnects.'};
 if(!snapshot.capabilities?.autoDraft)return {pending:'Update the cloud runner to write drafts automatically.'};
 if(snapshot.capabilities?.claude===false)return {pending:'Connect Claude in Settings before contact research.'};
 if(snapshot.capabilities?.slashy===false)return {pending:'Connect Slashy in Settings before contact research.'};
 const pendingJobs=await db.prepare("SELECT COUNT(*) AS n FROM outreach_jobs WHERE owner_id=? AND status IN ('queued','running')").bind(owner).first<{n:number}>();
 if((pendingJobs?.n??0)>=10)return {pending:'Ten requests are already pending. Retry when they finish.'};
 let investmentContext:string|undefined;
 if(companyId.startsWith('signal:')){
  const signal=await db.prepare('SELECT data FROM signal_events WHERE owner_id=? AND company_key=? ORDER BY last_seen DESC LIMIT 1').bind(owner,companyId.slice(7)).first<{data:string}>();
  const settings=await db.prepare('SELECT data FROM signal_settings WHERE owner_id=?').bind(owner).first<{data:string}>();
  if(signal){const s=JSON.parse(signal.data);investmentContext=JSON.stringify({thesis:settings?JSON.parse(settings.data).thesis:'',signal:s.title,evidence:s.evidence,caveats:s.caveats});}
 }else investmentContext=JSON.stringify({signal:company.signal,source:company.source,notes:String(company.notes??'').slice(0,3000)});
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const payload={id,action:'discover',company:company.name,maxContacts:3,companyId,mode:'investment',investmentContext,autoDraft:true};
 await db.prepare('INSERT INTO outreach_jobs (id,owner_id,action,payload,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id,owner,'discover',JSON.stringify(payload),'queued',now,now).run();
 return {discoveryId:id};
}

const parse=(s:string|null)=>{try{return s?JSON.parse(s):null;}catch{return null;}};

function contactState(launch:any,record:any){
 if(!launch)return 'draft';
 if(['queued','running'].includes(launch.status))return 'queued';
 if(launch.status!=='succeeded')return 'failed';
 const outcome=launch.outcome;
 if(outcome?.skipped)return 'skipped';
 if(!record)return 'sending';
 // A meeting journal entry only counts once a slot was actually booked.
 if(record.sequenceStatus==='booked'||(['booked','sent'].includes(record.meeting?.state)&&record.meeting?.selectedSlot))return 'booked';
 if(record.touchCount>0&&['replied','unsubscribed','bounced','stopped'].includes(record.sequenceStatus))return record.sequenceStatus;
 if(record.sequenceStatus==='needs_review')return 'needs_review';
 return record.touchCount>0?'contacted':'sending';
}

/** Everything the Pipeline board and company panel need, derived in one read. */
export async function pipelineView(db:Db,owner:string){
 const [companies,discovers,launches,{snapshot,online},settings]=await Promise.all([
  db.prepare('SELECT data FROM companies WHERE owner_id=?').bind(owner).all<{data:string}>(),
  db.prepare("SELECT id,payload,status,result,created_at FROM outreach_jobs WHERE owner_id=? AND action='discover' ORDER BY created_at DESC LIMIT 500").bind(owner).all<any>(),
  db.prepare("SELECT id,payload,status,result,created_at FROM outreach_jobs WHERE owner_id=? AND action='launch' ORDER BY created_at DESC LIMIT 500").bind(owner).all<any>(),
  runnerState(db),
  outreachSettings(db,owner),
 ]);
 const records=new Map<string,any>((snapshot.records??[]).map((r:any)=>[r.id,r]));
 const items:Record<string,any>={};
 for(const row of companies.results){
  const company=JSON.parse(row.data);
  const job=discovers.results.find((j:any)=>parse(j.payload)?.companyId===company.id);
  const result=job?parse(job.result):null;
  const contacts=(job?.status==='succeeded'?result?.contacts??[]:[]).map((c:any,index:number)=>{
   const draft=(result?.drafts??[]).find((d:any)=>d.index===index);
   const launchRow=launches.results.find((l:any)=>{const p=parse(l.payload);return p?.discoveryId===job.id&&p?.indices?.includes(index);});
   const launchResult=launchRow?parse(launchRow.result):null;
   const outcome=launchResult?.outcomes?.find((o:any)=>o.email===c.email);
   const launch=launchRow?{id:launchRow.id,status:launchRow.status,error:launchResult?.error??null,outcome,sentDraft:parse(launchRow.payload)?.drafts?.[0]??null,deliverTo:parse(launchRow.payload)?.deliverTo??null}:null;
   const record=outcome?.id?records.get(outcome.id)??null:null;
   return {index,name:c.name,title:c.title,email:c.email,emailSource:c.emailSource,draft:draft&&!draft.error?{subject:draft.subject,body:draft.body}:null,draftError:draft?.error??null,launch,
    record:record?{id:record.id,sequenceStatus:record.sequenceStatus,touchCount:record.touchCount,nextTouchAt:record.nextTouchAt,lastTouchAt:record.lastTouchAt,deliverTo:record.deliverTo??null,meeting:record.meeting??null}:null,
    state:contactState(launch?{...launch}:null,record)};
  });
  const states=contacts.map((c:any)=>c.state);
  const launched=states.some((s:string)=>s!=='draft');
  const stage=company.status==='Passed'&&!launched?'Passed'
   :states.includes('booked')?'Meeting booked'
   :states.includes('replied')?'Replied'
   :launched?'Contacted'
   :contacts.some((c:any)=>c.draft)?'Draft ready'
   :job||company.status==='Shortlisted'?'Shortlisted'
   :company.status==='Draft ready'?'Draft ready':company.status;
  items[company.id]={stage,research:job?{id:job.id,status:job.status,error:job.status==='succeeded'?(contacts.length?null:'No contacts with an email address were found.'):result?.error??null,createdAt:job.created_at}:null,summary:result?.summary??null,website:result?.website??null,contacts};
 }
 return {items,runnerOnline:online,sending:snapshot.capabilities?.sending===true,autoDraft:snapshot.capabilities?.autoDraft===true,policyHash:snapshot.investmentPolicy?.hash??null,sender:snapshot.investmentPolicy?.sender??null,demoRecipient:settings.demoRecipient,halted:snapshot.killSwitch?.halted===true};
}

/** Queue the exact approved first email for one contact. */
export async function approveDraft(db:Db,owner:string,input:{companyId:string;discoveryId:string;index:number;subject:string;body:string}){
 const {snapshot,online}=await runnerState(db);
 if(!online)throw Error('The cloud runner is offline. Wait for it to reconnect.');
 if(snapshot.capabilities?.sending!==true)throw Error('Email sending is turned off on the cloud runner.');
 if(snapshot.killSwitch?.halted)throw Error('Sending is halted. Resume sending in Launch outreach first.');
 const policy=snapshot.investmentPolicy;if(!policy?.hash)throw Error('The runner has not reported its sequence settings yet.');
 const job=await db.prepare("SELECT payload,result FROM outreach_jobs WHERE id=? AND owner_id=? AND action='discover' AND status='succeeded'").bind(input.discoveryId,owner).first<{payload:string;result:string}>();
 if(!job)throw Error('Contact research for this company was not found.');
 const research=JSON.parse(job.payload),result=JSON.parse(job.result);
 if(research.companyId!==input.companyId)throw Error('This draft does not belong to that company.');
 const contact=result.contacts?.[input.index];if(!contact)throw Error('That contact no longer exists.');
 const existing=await db.prepare("SELECT id FROM outreach_jobs WHERE owner_id=? AND action='launch' AND status IN ('queued','running','succeeded') AND json_extract(payload,'$.discoveryId')=? AND EXISTS (SELECT 1 FROM json_each(payload,'$.indices') WHERE value=?)").bind(owner,input.discoveryId,input.index).first();
 if(existing)throw Error('This draft was already approved.');
 const draft=cleanDraft(input);
 const {demoRecipient}=await outreachSettings(db,owner);
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const payload={id,action:'launch',discoveryId:input.discoveryId,indices:[input.index],policyHash:policy.hash,acknowledgeGuessed:true,confirmSend:true,company:research.company,companyId:research.companyId,mode:research.mode??'investment',investmentContext:research.investmentContext??null,contacts:[contact],summary:result.summary,website:result.website,drafts:[draft],deliverTo:demoRecipient||null};
 await db.prepare('INSERT INTO outreach_jobs (id,owner_id,action,payload,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id,owner,'launch',JSON.stringify(payload),'queued',now,now).run();
 return {id,deliverTo:demoRecipient||null};
}
