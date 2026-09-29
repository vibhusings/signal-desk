import { workspaceDb } from '@/db/workspace';
import { groundedAnalysis, sourceSchema } from './crm-schema';
import { addCrmScope, emptyCrmScope, sourceMatchesCrmScope, type CrmScope } from './crm-scope';
import { projectCrm } from './crm-projection';
import { firstReferral, recommendationEmail } from './vc-intro';
import { decisionFromAnalysis, matchOutreachRecord } from './meeting-decision';
import { cleanDraft, outreachSettings, runnerState } from './outreach-pipeline';
export async function ensureCrm(db=workspaceDb()){
 for(const sql of [
 `CREATE TABLE IF NOT EXISTS crm_settings(owner_id TEXT PRIMARY KEY,data TEXT NOT NULL,next_scan_at TEXT,next_attio_at TEXT,webhook_hash TEXT)`,
 `CREATE TABLE IF NOT EXISTS crm_jobs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,started_at TEXT,result TEXT)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS crm_one_job ON crm_jobs(owner_id,kind) WHERE status IN ('queued','running') AND kind IN ('inbox','attio')`,
 `CREATE TABLE IF NOT EXISTS crm_sources(owner_id TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,analysis TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,id))`,
 `CREATE TABLE IF NOT EXISTS crm_contacts(owner_id TEXT NOT NULL,email TEXT NOT NULL,relationship TEXT NOT NULL DEFAULT 'Contact',PRIMARY KEY(owner_id,email))`,
 `CREATE TABLE IF NOT EXISTS crm_referrals(owner_id TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,id))`,
 ])await db.prepare(sql).run();
 try{await db.prepare('ALTER TABLE crm_settings ADD COLUMN next_meetings_at TEXT').run();}catch{}
}
async function queryAll(db:any,sql:string,...args:unknown[]){
 try{
  const rows=await db.prepare(sql).bind(...args).all();
  return Array.isArray(rows)?rows:rows?.results??[];
 }catch{return [];}
}
export async function crmScope(owner:string,db=workspaceDb()):Promise<CrmScope>{
 const scope=emptyCrmScope();
 const runner=await db.prepare('SELECT snapshot FROM outreach_runner WHERE id=? AND owner_id=?').bind('primary',owner).first<{snapshot:string}>();
 const snapshot=JSON.parse(runner?.snapshot||'{}');
 for(const record of snapshot.records??[])addCrmScope(scope,{email:record.email??record.contactEmail,company:record.company??record.companyName});
 for(const company of await queryAll(db,'SELECT data FROM companies WHERE owner_id=?',owner)){
  try{const data=JSON.parse(company.data);addCrmScope(scope,{domain:data.domain??data.website,company:data.name});}catch{}
 }
 for(const event of await queryAll(db,'SELECT data FROM signal_events WHERE owner_id=?',owner)){
  try{const data=JSON.parse(event.data);addCrmScope(scope,{domain:data.website,company:data.company});}catch{}
 }
 for(const job of await queryAll(db,"SELECT payload,result FROM outreach_jobs WHERE owner_id=? AND action IN ('discover','launch')",owner)){
  try{
   const payload=JSON.parse(job.payload||'{}');
   addCrmScope(scope,{domain:payload.website,company:payload.company});
   for(const contact of payload.contacts??[])addCrmScope(scope,{email:contact.email,company:payload.company});
   const result=job.result?JSON.parse(job.result):{};
   addCrmScope(scope,{domain:result.website,company:payload.company});
   for(const contact of result.contacts??[])addCrmScope(scope,{email:contact.email,company:payload.company});
  }catch{}
 }
 // Explicitly logged applications establish a tracked company even before outreach.
 for(const row of await queryAll(db,"SELECT analysis FROM crm_sources WHERE owner_id=? AND analysis IS NOT NULL AND json_extract(data,'$.kind')='note'",owner)){
  try{for(const app of JSON.parse(row.analysis).applications??[])if(app.company&&app.role)addCrmScope(scope,{company:app.company.value});}catch{}
 }
 return scope;
}
export async function enqueueCrm(owner:string,kind:string,payload:unknown,id=crypto.randomUUID()){
 const body=kind==='inbox'&&payload&&typeof payload==='object'?{...(payload as object),wide:true}:payload;
 await workspaceDb().prepare("INSERT OR IGNORE INTO crm_jobs(id,owner_id,kind,payload,status,created_at) VALUES(?,?,?,?,'queued',?)").bind(id,owner,kind,JSON.stringify(body),new Date().toISOString()).run();return id;
}
export async function saveCrmSource(owner:string,input:unknown){
 const source=sourceSchema.parse(input),db=workspaceDb();
 const old=await db.prepare('SELECT data,analysis FROM crm_sources WHERE owner_id=? AND id=?').bind(owner,source.id).first<{data:string;analysis:string|null}>();
 if(old?.data===JSON.stringify(source)&&old.analysis&&Array.isArray(JSON.parse(old.analysis).applications))return;
 await db.prepare('INSERT INTO crm_sources(owner_id,id,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET data=excluded.data,analysis=NULL,updated_at=excluded.updated_at').bind(owner,source.id,JSON.stringify(source),new Date().toISOString()).run();
 // A content digest makes retries idempotent while allowing corrected transcripts.
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner+'applications-v1'+JSON.stringify(source))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 await enqueueCrm(owner,'extract',{source},digest);
 await db.prepare("UPDATE crm_jobs SET status='queued',result=NULL WHERE owner_id=? AND id=? AND status='failed'").bind(owner,digest).run();
}
export async function crmView(owner:string){
 const db=workspaceDb();
 const [s,j,r,c]=await Promise.all([
 db.prepare('SELECT data,next_scan_at,next_attio_at FROM crm_settings WHERE owner_id=?').bind(owner).first<any>(),
 db.prepare('SELECT id,kind,status,created_at,result FROM crm_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 30').bind(owner).all<any>(),
 db.prepare('SELECT id,data,analysis FROM crm_sources WHERE owner_id=? ORDER BY updated_at DESC LIMIT 2000').bind(owner).all<any>(),
 db.prepare('SELECT email,relationship FROM crm_contacts WHERE owner_id=?').bind(owner).all<any>(),
 ]);
 const referrals=await queryAll(db,'SELECT id,data FROM crm_referrals WHERE owner_id=?',owner);
 let criteria:any=null;
 try{const row=await db.prepare('SELECT data FROM signal_settings WHERE owner_id=?').bind(owner).first<{data:string}>();criteria=row?.data?JSON.parse(row.data):null;}catch{criteria=null;}
 let demoRecipient='';
 try{demoRecipient=(await outreachSettings(db,owner)).demoRecipient;}catch{demoRecipient='';}
 return {settings:s?JSON.parse(s.data):null,nextScanAt:s?.next_scan_at,nextAttioAt:s?.next_attio_at,jobs:j.results.map(x=>({...x,result:x.result?JSON.parse(x.result):null})),sources:r.results.map(x=>({...JSON.parse(x.data),analysis:x.analysis?JSON.parse(x.analysis):null})),relationships:Object.fromEntries(c.results.map(x=>[x.email,x.relationship])),referrals:referrals.map((row:any)=>({id:row.id,...JSON.parse(row.data)})),criteria,demoRecipient,limited:r.results.length===2000,scope:await crmScope(owner,db)};
}
export async function claimCrm(owner:string,capabilities:any){
 await ensureCrm();const db=workspaceDb(),now=new Date().toISOString();
 // Read-only extraction may safely be retried after a crash; Attio upserts use stable IDs.
 await db.prepare("UPDATE crm_jobs SET status='queued' WHERE owner_id=? AND status='running' AND started_at<?").bind(owner,new Date(Date.now()-30*60000).toISOString()).run();
 const s=await db.prepare('SELECT * FROM crm_settings WHERE owner_id=?').bind(owner).first<any>();
 if(s){const settings=JSON.parse(s.data);
 if(settings.enabled&&capabilities.claude&&capabilities.slashy&&(!s.next_scan_at||s.next_scan_at<=now)){
 await enqueueCrm(owner,'inbox',settings);await db.prepare('UPDATE crm_settings SET next_scan_at=? WHERE owner_id=?').bind(new Date(Date.now()+86400000).toISOString(),owner).run();}
 if(settings.attioEnabled&&capabilities.crmAttio&&(!s.next_attio_at||s.next_attio_at<=now)){
 await enqueueCrm(owner,'attio',{});await db.prepare('UPDATE crm_settings SET next_attio_at=? WHERE owner_id=?').bind(new Date(Date.now()+7*86400000).toISOString(),owner).run();}
 if(capabilities.attioMeetings&&(!s.next_meetings_at||s.next_meetings_at<=now)){
 const pending=await db.prepare("SELECT id FROM crm_jobs WHERE owner_id=? AND kind='meetings' AND status IN ('queued','running')").bind(owner).first();
 if(!pending)await enqueueCrm(owner,'meetings',{});
 await db.prepare('UPDATE crm_settings SET next_meetings_at=? WHERE owner_id=?').bind(new Date(Date.now()+15*60000).toISOString(),owner).run();}}
 const job=await db.prepare("UPDATE crm_jobs SET status='running',started_at=? WHERE id=(SELECT id FROM crm_jobs WHERE owner_id=? AND status='queued' AND ((kind='inbox' AND ?=1 AND ?=1) OR (kind='extract' AND ?=1) OR (kind='attio' AND ?=1) OR (kind='meetings' AND ?=1)) ORDER BY created_at LIMIT 1) AND status='queued' RETURNING *").bind(now,owner,+!!capabilities.claude,+!!capabilities.slashy,+!!capabilities.claude,+!!capabilities.crmAttio,+!!capabilities.attioMeetings).first<any>();
 if(!job)return {job:null};
 const scope=await crmScope(owner,db);
 return {job:{id:job.id,kind:job.kind,payload:job.kind==='attio'?await crmView(owner):{...JSON.parse(job.payload),scope}}};
}
export async function completeCrm(owner:string,id:string,result:any){
 const db=workspaceDb();const job=await db.prepare("SELECT * FROM crm_jobs WHERE owner_id=? AND id=? AND status='running'").bind(owner,id).first<any>();
 if(!job)return {ok:true};
 if(!result||typeof result!=='object')throw Error('Invalid CRM result');
 if(!result.error){
 if(job.kind==='inbox'){
 if(!Array.isArray(result.sources)||result.sources.length>100)throw Error('Invalid inbox result');
 const scope=await crmScope(owner,db);
 const wide=JSON.parse(job.payload).wide===true;
 for(const source of result.sources){
  if(!wide&&!sourceMatchesCrmScope(source,scope))continue;
  await saveCrmSource(owner,source);
 }
 }else if(job.kind==='meetings'){
 if(!Array.isArray(result.sources)||result.sources.length>20)throw Error('Invalid meeting result');
 for(const source of result.sources)await saveCrmSource(owner,source);
 }else if(job.kind==='extract'){
 const {source}=JSON.parse(job.payload),analysis=groundedAnalysis(result.analysis,source.text);
 // Do not attach an older analysis to a corrected source.
 await db.prepare('UPDATE crm_sources SET analysis=? WHERE owner_id=? AND id=? AND data=?').bind(JSON.stringify(analysis),owner,source.id,JSON.stringify(source)).run();
 if(source.kind==='attio'||source.kind==='note'||source.direction==='meeting')await queueMeetingDecision(owner,source,analysis);
 }}
 const status=result.error?'failed':result.partial?'partial':'succeeded';
 const summary={...result};delete summary.sources;delete summary.analysis;
 await db.prepare('UPDATE crm_jobs SET status=?,result=? WHERE owner_id=? AND id=?').bind(status,JSON.stringify(summary),owner,id).run();return {ok:true};
}
async function queueMeetingDecision(owner:string,source:{title?:string;text?:string;participants?:Array<{email?:string}>},analysis:Parameters<typeof decisionFromAnalysis>[0]){
 const decision=decisionFromAnalysis(analysis);
 if(!decision)return;
 const db=workspaceDb();
 let records:any[]=[];
 try{const runner=await db.prepare('SELECT snapshot FROM outreach_runner WHERE id=? AND owner_id=?').bind('primary',owner).first<{snapshot:string}>();records=JSON.parse(runner?.snapshot||'{}').records??[];}catch{return;}
 const match=matchOutreachRecord(records,source);
 if(!match)return;
 const note=`Decision: ${decision.label}. "${decision.quote}"`.slice(0,500);
 const now=new Date().toISOString();
 await db.prepare('CREATE TABLE IF NOT EXISTS outreach_jobs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)').run();
 await db.prepare('INSERT INTO outreach_jobs(id,owner_id,action,payload,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),owner,'meetingDecision',JSON.stringify({action:'meetingDecision',recordId:match.id,status:decision.status,note}),'queued',now,now).run();
 try{const settings=await db.prepare('SELECT data FROM crm_settings WHERE owner_id=?').bind(owner).first<{data:string}>();if(settings&&JSON.parse(settings.data).attioEnabled)await enqueueCrm(owner,'attio',{});}catch{}
}
function referralId(dealId:string,email:string){return `${dealId}|${email.toLowerCase()}`;}
/** Queue one recommendation. A queued or sent referral is not sent again. */
export async function queueReferral(owner:string,dealId:string){
 if(typeof dealId!=='string'||!dealId.includes('|'))throw Error('Unknown deal');
 await ensureCrm();
 const db=workspaceDb();
 const view=await crmView(owner);
 const deal=projectCrm(view).deals.find((item:any)=>item.id===dealId);
 if(!deal?.company||!deal.round||deal.round==='Unknown')throw Error('This deal has no round to compare with your stages.');
 const criteria=view.criteria??{};
 const pick=firstReferral(deal,criteria,projectCrm(view).contacts);
 if(!pick.outside)throw Error('This round is inside your saved stages.');
 if(!pick.match)throw Error(pick.note);
 const id=referralId(deal.id,pick.match.email);
 const existing=await db.prepare('SELECT data FROM crm_referrals WHERE owner_id=? AND id=?').bind(owner,id).first<{data:string}>();
 const prior=existing?JSON.parse(existing.data).status:'';
 if(prior==='queued'||prior==='sent')throw Error('This recommendation was already sent or is queued.');
 const {snapshot,online}=await runnerState(db);
 if(!online)throw Error('The cloud runner is offline. Wait for it to reconnect.');
 if(snapshot.capabilities?.sending!==true)throw Error('Email sending is turned off on the cloud runner.');
 if(snapshot.killSwitch?.halted)throw Error('Sending is halted. Resume sending in Launch outreach first.');
 const draft=cleanDraft(recommendationEmail({company:deal.company,round:deal.round,friendName:pick.match.name,quote:pick.match.quote,userStages:criteria.stages??'',senderName:snapshot.policy?.senderName||snapshot.investmentPolicy?.senderName||'Vibhu'}));
 const {demoRecipient}=await outreachSettings(db,owner);
 const jobId=crypto.randomUUID(),now=new Date().toISOString();
 const payload={action:'refer',referralId:id,dealId:deal.id,to:pick.match.email,toName:pick.match.name,subject:draft.subject,body:draft.body,deliverTo:demoRecipient||null,company:deal.company,round:deal.round};
 await db.prepare('CREATE TABLE IF NOT EXISTS outreach_jobs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)').run();
 await db.prepare('INSERT INTO outreach_jobs(id,owner_id,action,payload,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(jobId,owner,'refer',JSON.stringify(payload),'queued',now,now).run();
 const data={dealId:deal.id,vcEmail:pick.match.email,vcName:pick.match.name,company:deal.company,round:deal.round,status:'queued',jobId};
 await db.prepare('INSERT INTO crm_referrals(owner_id,id,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(owner,id,JSON.stringify(data),now).run();
 return {id,jobId,to:pick.match.email,deliverTo:demoRecipient||null};
}
export async function markReferral(owner:string,referralIdValue:string,status:'sent'|'failed'){
 if(status!=='sent'&&status!=='failed')return;
 await ensureCrm();
 const db=workspaceDb();
 const row=await db.prepare('SELECT data FROM crm_referrals WHERE owner_id=? AND id=?').bind(owner,referralIdValue).first<{data:string}>();
 if(!row)return;
 const data=JSON.parse(row.data);
 if(data.status==='sent')return;
 data.status=status;
 await db.prepare('UPDATE crm_referrals SET data=?,updated_at=? WHERE owner_id=? AND id=?').bind(JSON.stringify(data),new Date().toISOString(),owner,referralIdValue).run();
}
