import 'dotenv/config';
import { decryptEnvelope,decryptFileEnvelope,encryptEnvelope } from './envelope.js';
import { collectInbox } from '../crm/inbox.js';
import { collectAttioMeetings } from '../crm/meetings.js';
import { extractCrm,extractCrmSubscription } from '../crm/extract.js';
import { subscriptionStatus,type ClaudeMode } from './claude-auth.js';
import { syncCrmAttio } from '../crm/attio.js';
import { slashyCall } from '../reply/tools.js';
import { readFileSync,writeFileSync,renameSync,mkdirSync,existsSync,readdirSync,openSync,closeSync,unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { discoverContacts } from '../sourcing/discover.js';
import { AttioStore } from '../attio/client.js';
import { prepareTarget,activateTarget } from './targets.js';
import { schedulerLock } from '../reply/lock.js';
import { loadPolicy } from '../scheduler/policy.js';
import { availabilityPolicy } from '../reply/calendar.js';
import { collectSignals } from '../signals/collector.js';
import { decryptApiKey,ensureCredentialKey } from './byok.js';
import { startSlashyRuntime } from './slashy-session.js';
import { approveFirstTouch,isUnverifiedAddress,needsFirstTouchApproval } from '../send/first-touch.js';
import { haltSending,isSendingHalted,readKillSwitch,resumeSending } from '../send/kill-switch.js';
import { reputationSnapshot } from '../send/reputation.js';
import { uploadResume } from './resume.js';
import { composeDraft,validateDraft } from '../send/draft.js';
import { recordApproval,deliveryRouteFor,approvedDraftFor } from '../send/approved.js';
import { sendReferral } from '../send/referral.js';

const dir=resolve('.runtime/bridge');mkdirSync(dir,{recursive:true});
const config=JSON.parse(readFileSync(resolve('.runtime/bridge-config.json'),'utf8')) as {url:string;siteToken:string;runnerKey:string};
if(!config.url.startsWith('https://')||!config.siteToken||!config.runnerKey)throw Error('Invalid bridge configuration');
const path=resolve(dir,'state.json');
type State={records:Array<{id:string;email:string;company:string;enabled:boolean;mode?:string}>;completions:Record<string,{status:string;result:any}>;started:string[];signalCompletion?:{id:string;result:any};crmCompletion?:{id:string;result:any}};
const state:State=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{records:[],completions:{},started:[]};
function save(){writeFileSync(path+'.tmp',JSON.stringify(state),{mode:0o600});renameSync(path+'.tmp',path);}
const lock=resolve(dir,'runner.lock');
if(existsSync(lock)){const pid=Number(readFileSync(lock,'utf8'));try{process.kill(pid,0);throw Error('Another outreach runner is active');}catch(e:any){if(e.code!=='ESRCH')throw e;unlinkSync(lock);}}
const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
process.on('exit',()=>{try{unlinkSync(lock);}catch{}});
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
const store=new AttioStore(process.env.ATTIO_API_KEY??'');
// Existing local installs keep their current behavior. Cloud installs explicitly
// set this to 0 until cutover is complete.
const sendingEnabled=process.env.RUNNER_SEND_ENABLED!=='0';
const byokRequired=process.env.RUNNER_BYOK_REQUIRED==='1';
const personalTestingAvailable=process.env.RUNNER_PERSONAL_TESTING==='1';
let claudeMode:ClaudeMode='api',subscription={ready:false,error:null as string|null},lastAuthCheck=0;
const claudeBin=process.env.CLAUDE_BIN??`${process.env.HOME}/.local/bin/claude`;
function claudeReady(){return claudeMode==='subscription'?personalTestingAvailable&&subscription.ready:!!byokApiKey||!byokRequired;}
function usingSubscription(){return claudeMode==='subscription';}
const configuredPollMs=Number(process.env.RUNNER_POLL_MS??10000);
const pollMs=Number.isFinite(configuredPollMs)?Math.max(5000,configuredPollMs):10000;
const {privateKey:credentialPrivateKey,publicKey:credentialPublicKey,keyId:credentialKeyId}=ensureCredentialKey(dir);
let crustdataKey:string|undefined,crustdataError:string|null=null,crustdataUpdatedAt='';
let byokApiKey:string|undefined,credentialUpdatedAt='',credentialError:string|null=null;
let resumeFileId=process.env.RESUME_FILE_ID||'',resumeFilename='',resumeUpdatedAt='',resumeError:string|null=null;
const slashy=await startSlashyRuntime({
 directory:dir,
 privateKey:credentialPrivateKey,
 publicKey:credentialPublicKey,
 keyId:credentialKeyId,
 required:byokRequired,
 persist:async(ciphertext,clientId)=>{await api({op:'slashyPut',keyId:credentialKeyId,ciphertext,clientId});},
});
const p=loadPolicy();const sequence=JSON.parse(readFileSync(process.env.SEQUENCE_FILE??'config/sequence.json','utf8'));
const policyBase={sender:process.env.SENDER_INBOX??'',senderName:process.env.SENDER_NAME??'Vibhu',maxTouches:p.maxTouches,intervalsMinutes:p.intervalsMinutes,sequence:sequence.touches,meeting:availabilityPolicy(),autoMeeting:process.env.AUTO_AVAILABILITY!=='0',mode:'Job application'};
function applicationPolicy(){const base={...policyBase,resumeAttached:!!resumeFileId};return {...base,hash:createHash('sha256').update(JSON.stringify(base)).digest('hex')};}
let policy=applicationPolicy();
const investmentBase={...policyBase,mode:'Investment outreach',resumeAttached:false,sequence:JSON.parse(readFileSync('config/sequence-investment.json','utf8')).touches};
const investmentPolicy={...investmentBase,hash:createHash('sha256').update(JSON.stringify(investmentBase)).digest('hex')};
function guardSnapshot(){return {killSwitch:readKillSwitch(),reputation:reputationSnapshot()};}
let snapshot:any={policy,investmentPolicy,resume:{configured:!!resumeFileId,filename:resumeFilename,error:null},credentialKey:{algorithm:'RSA-OAEP-256',keyId:credentialKeyId,publicKey:credentialPublicKey},credential:{configured:false},slashy:{connected:false,error:null},capabilities:{autoDraft:true,crm:true,crmAttio:!!process.env.CRM_ATTIO_API_KEY&&!!process.env.CRM_ATTIO_OBJECT&&process.env.CRM_ATTIO_INBOX===policy.sender,attioMeetings:!!process.env.ATTIO_API_KEY||!!process.env.CRM_ATTIO_API_KEY,signals:true,investment:true,sending:sendingEnabled,byok:true,claude:!byokRequired,slashy:!byokRequired},records:[],recordsUpdatedAt:null,scheduler:{running:false,lastError:null},...guardSnapshot()};
async function api(body:any){const r=await fetch(new URL('/api/runner',config.url),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':`Bearer ${config.siteToken}`,'x-outreach-runner-key':config.runnerKey},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Signal Desk connection failed (${r.status})`);return r.json();}
async function refreshCredential(){
 const response=await api({op:'credentialGet'}),credential=response.credential;
 claudeMode=response.claudeMode==='subscription'?'subscription':'api';
 if(personalTestingAvailable&&Date.now()-lastAuthCheck>30000){subscription=await subscriptionStatus(claudeBin);lastAuthCheck=Date.now();}
 if(!credential){
  byokApiKey=undefined;credentialUpdatedAt='';credentialError=null;
 }else if(credential.updatedAt!==credentialUpdatedAt){
  credentialUpdatedAt=credential.updatedAt;
  try{
   if(credential.keyId!==credentialKeyId)throw Error('Stored Claude key targets a different runner key');
   byokApiKey=decryptApiKey(credentialPrivateKey,credential.ciphertext);credentialError=null;
  }catch{byokApiKey=undefined;credentialError='Remove this key and add it again.';}
 }
 const crust=response.crustdata;
 crustdataKey=undefined;crustdataError=null;crustdataUpdatedAt=crust?.updatedAt??'';
 if(crust){try{
  if(crust.keyId!==credentialKeyId)throw Error('key mismatch');
  const value=decryptEnvelope(credentialPrivateKey,crust.ciphertext);
  if(value.length<20||value.length>4096||/\s/.test(value))throw Error('key format');
  crustdataKey=value;
 }catch{crustdataError='Remove the Crustdata key and add it again.';}}
 const slashyRow=response.slashy??null;
 await slashy.applyRecord(slashyRow);
 const slashyStatus=slashy.status();
 const resume=response.resume??null;
 if(!resume){resumeFileId='';resumeFilename='';resumeUpdatedAt='';resumeError=null;}
 else if(resume.updatedAt!==resumeUpdatedAt){
  resumeUpdatedAt=resume.updatedAt;resumeFilename=resume.filename??'';
  try{if(resume.keyId!==credentialKeyId)throw Error('key mismatch');const parsed=JSON.parse(decryptEnvelope(credentialPrivateKey,resume.ciphertext));if(typeof parsed.fileId!=='string'||parsed.fileId.length<3||parsed.fileId.length>500)throw Error('file id');resumeFileId=parsed.fileId;resumeError=null;}
  catch{resumeFileId='';resumeError='Remove this resume and upload it again.';}
 }
 policy=applicationPolicy();
 snapshot={...snapshot,policy,resume:{configured:!!resumeFileId,filename:resumeFilename,updatedAt:resumeUpdatedAt,error:resumeError},claudeAuth:{mode:claudeMode,personalTestingAvailable,subscription},crustdata:{configured:!!crustdataKey,updatedAt:crustdataUpdatedAt,error:crustdataError},credential:{configured:!!byokApiKey,error:credentialError},slashy:slashyStatus,capabilities:{...snapshot.capabilities,claude:claudeReady(),slashy:slashyStatus.connected||!byokRequired}};
}
function claudeCredential(){
 if(!claudeReady())throw Error(claudeMode==='subscription'?'Sign in to Claude Code with your subscription on the worker.':'Add a Claude API key in Signal Desk Settings before running research.');
 if(byokRequired&&!slashy.ready())throw Error('Connect Slashy in Signal Desk Settings before running research.');
 return claudeMode==='subscription'?{}:byokApiKey?{apiKey:byokApiKey}:{oauthToken:process.env.CLAUDE_CODE_OAUTH_TOKEN,apiKey:process.env.ANTHROPIC_API_KEY};
}
async function heartbeat(){await api({op:'heartbeat',snapshot});}
async function refresh(){
 const records=[];for(const entry of state.records){try{const r=await store.getById(entry.id);let meeting:any=null;
  if(existsSync('.runtime/replies'))for(const file of readdirSync('.runtime/replies').filter(f=>f.endsWith('.json'))){try{const j=JSON.parse(readFileSync(resolve('.runtime/replies',file),'utf8'));if(j.recordId===r.id&&(!meeting||j.updatedAt>meeting.updatedAt))meeting=j;}catch{}}
  const awaitingFirstTouch=needsFirstTouchApproval(r,(r.sequenceStage||0)+1)||(isUnverifiedAddress(r)&&r.touchCount===0&&r.sequenceStage===0&&(r.sequenceStatus==='needs_review'||r.sequenceStatus==='queued'));
  records.push({...r,enabled:entry.enabled,awaitingFirstTouch,deliverTo:deliveryRouteFor(r.id)??null,approvedDraft:!!approvedDraftFor(r.id),meeting:meeting?{state:meeting.state,selectedSlot:meeting.selectedSlot,eventTitle:meeting.eventTitle,meetLink:meeting.meetLink??null,note:meeting.note,updatedAt:meeting.updatedAt}:null});
 }catch{records.push({...entry,sequenceStatus:'unavailable',error:'Could not read current Attio state'});}}
 snapshot={...snapshot,records,recordsUpdatedAt:new Date().toISOString(),...guardSnapshot()};
}
async function acquireScheduler(){for(let n=0;n<120&&!stopping;n++){try{return schedulerLock();}catch(e){if(!String(e).includes('already running'))throw e;await new Promise(r=>setTimeout(r,5000));}}throw Error('Scheduler is busy. No change was made; retry after the current pass.');}
async function execute(job:any){
 if(job.action==='resumeUpload'){
  if(!slashy.ready())throw Error('Connect Slashy before uploading a resume.');
  if(job.payload.keyId!==credentialKeyId)throw Error('The runner key changed. Upload the resume again.');
  const bytes=decryptFileEnvelope(credentialPrivateKey,job.payload.envelope);
  if(bytes.length!==job.payload.size)throw Error('The encrypted resume size does not match the upload.');
  const fileId=await uploadResume(slashyCall({claudeBin:process.env.CLAUDE_BIN??`${process.env.HOME}/.local/bin/claude`,model:process.env.SEND_MODEL??'claude-haiku-4-5',timeoutMs:60000,...claudeCredential()}),{filename:job.payload.filename,mimeType:job.payload.mimeType,bytes});
  const ciphertext=encryptEnvelope(credentialPublicKey,credentialKeyId,JSON.stringify({fileId}));
  const saved:any=await api({op:'resumePut',keyId:credentialKeyId,ciphertext,filename:job.payload.filename,mimeType:job.payload.mimeType,size:bytes.length});
  resumeFileId=fileId;resumeFilename=job.payload.filename;resumeUpdatedAt=saved.updatedAt??new Date().toISOString();resumeError=null;policy=applicationPolicy();snapshot={...snapshot,policy,resume:{configured:true,filename:resumeFilename,updatedAt:resumeUpdatedAt,error:null}};
  return {uploaded:true,filename:resumeFilename};
 }
 if(job.action==='discover'){
  const credential=claudeCredential();
  const mode=job.payload.mode==='investment'?'investment':'application';
  const r=await discoverContacts({claudeBin:process.env.CLAUDE_BIN??`${process.env.HOME}/.local/bin/claude`,model:process.env.DISCOVER_MODEL??'claude-sonnet-5',timeoutMs:900000,...credential,maxContacts:job.payload.maxContacts,mode},job.payload.company);
  if(r.error&&!r.contacts.length)throw Error(r.error);
  if(job.payload.autoDraft!==true)return r;
  // Drafts are written with no tools and never sent here; the user approves each one.
  const angle=JSON.parse(readFileSync(mode==='investment'?'config/sequence-investment.json':'config/sequence-application.json','utf8')).touches.find((t:any)=>t.n===1)?.angle??'';
  const context=[r.summary,job.payload.investmentContext].filter(Boolean).join('\n\n');
  const drafts:any[]=[];
  for(const [index,c] of r.contacts.entries()){
   try{drafts.push({index,...await composeDraft({claudeBin,model:process.env.DRAFT_MODEL??'claude-sonnet-5',timeoutMs:180000,...credential},{company:job.payload.company,contactName:c.name,contactTitle:c.title,context,senderName:policyBase.senderName,angle})});}
   catch(e){drafts.push({index,error:(e instanceof Error?e.message:String(e)).slice(0,300)});}
  }
  return {...r,drafts};
 }
 if(job.action==='launch'){
  if(!sendingEnabled)throw Error('Cloud runner is in safe mode; email sending is disabled.');
  claudeCredential();
  if(job.payload.mode!=='investment'&&!resumeFileId)throw Error('Upload a resume in Settings before launching job-application outreach. Investment outreach does not require a resume.');
  const launchPolicy=job.payload.mode==='investment'?investmentPolicy:policy;
  if(job.payload.confirmSend!==true||job.payload.policyHash!==launchPolicy.hash)throw Error('Sequence settings changed; review and launch again.');
  if(!policy.sender)throw Error('Sender inbox is missing');
  // Approved drafts line up with contacts; validate all before any Attio write.
  const approved:any[]=Array.isArray(job.payload.drafts)?job.payload.drafts.map((d:any)=>d?validateDraft(d):undefined):[];
  const deliverTo=typeof job.payload.deliverTo==='string'&&job.payload.deliverTo?job.payload.deliverTo:undefined;
  const release=await acquireScheduler();const outcomes=[];
  try{for(const [i,c] of job.payload.contacts.entries()){
   if(c.emailSource.kind==='guessed'&&!job.payload.acknowledgeGuessed)throw Error('Guessed email was not approved');
   const draft=approved[i];
   const summary=[job.payload.summary,job.payload.investmentContext].filter(Boolean).join('\n\n');
   const target=await prepareTarget(job.payload.company,c,summary,job.payload.website,job.id,job.payload.mode);
   if(target.id){
    const guessed=c.emailSource.kind==='guessed';
    // Pin the approved words and any test address before the record can be scheduled.
    if(draft||deliverTo)recordApproval(target.id,{draft,deliverTo});
    state.records.push({id:target.id,email:c.email,company:job.payload.company,enabled:true,mode:job.payload.mode??'application'});save();
    if(guessed&&draft){
     // Approving the labelled draft is the send-time approval for a guessed address.
     approveFirstTouch(target.id);
     await activateTarget(target.id,'Approved draft for guessed address in Signal Desk');
     outcomes.push({email:c.email,...target,deliverTo:deliverTo??null});
    }else if(guessed){
     await store.park(target.id,'needs_review','Guessed first-touch held for send-time approval');
     outcomes.push({email:c.email,...target,held:'Guessed first-touch held for send-time approval'});
    }else{
     await activateTarget(target.id,draft?'Approved draft in Signal Desk':undefined);
     outcomes.push({email:c.email,...target,deliverTo:deliverTo??null});
    }
   }else outcomes.push({email:c.email,...target});
  }}finally{release();}
  return {outcomes};
 }
 if(job.action==='pause'){
  const entry=state.records.find(r=>r.id===job.payload.recordId);if(!entry)throw Error('Record is outside this runner');
  const release=await acquireScheduler();try{const record=await store.getById(entry.id);if(record.sequenceStatus==='active')await store.park(entry.id,'stopped','Paused in Signal Desk');entry.enabled=false;save();}finally{release();}
  return {paused:true};
 }
 if(job.action==='halt'){
  // Do not wait for the scheduler lock — a kill switch has to take effect during a pass.
  const halted=haltSending(typeof job.payload.reason==='string'&&job.payload.reason.trim()?job.payload.reason.trim():'Manual halt from Signal Desk','manual');
  snapshot={...snapshot,...guardSnapshot()};
  return {halted:true,reason:halted.reason};
 }
 if(job.action==='resume'){
  const resumed=resumeSending();
  snapshot={...snapshot,...guardSnapshot()};
  return {halted:false,resumedAt:resumed.updatedAt};
 }
 if(job.action==='meetingDecision'){
  const id=job.payload.recordId;
  const status=job.payload.status==='stopped'?'stopped':job.payload.status==='needs_review'?'needs_review':null;
  const note=job.payload.note;
  const entry=state.records.find(r=>r.id===id);
  if(!entry||!status||typeof note!=='string'||note.length<8||note.length>500)throw Error('Invalid meeting decision');
  const release=await acquireScheduler();
  try{await store.park(entry.id,status,note);}finally{release();}
  return {updated:true,recordId:entry.id,status};
 }
 if(job.action==='refer'){
  if(!sendingEnabled)throw Error('Cloud runner is in safe mode; email sending is disabled.');
  if(isSendingHalted())throw Error('Sending is halted.');
  if(!policy.sender)throw Error('Sender inbox is missing');
  const credential=claudeCredential();
  const call=slashyCall({claudeBin:process.env.CLAUDE_BIN??`${process.env.HOME}/.local/bin/claude`,model:process.env.CRM_MODEL??'claude-sonnet-4-6',timeoutMs:120000,...credential});
  const sent=await sendReferral(call,policy.sender,job.payload);
  if(!sent.ok)throw Error(sent.error);
  return sent;
 }
 if(job.action==='approveFirstTouch'){
  if(!sendingEnabled)throw Error('Cloud runner is in safe mode; email sending is disabled.');
  const entry=state.records.find(r=>r.id===job.payload.recordId);if(!entry)throw Error('Record is outside this runner');
  const release=await acquireScheduler();
  try{
   const record=await store.getById(entry.id);
   if(record.touchCount>0||record.sequenceStage>0)throw Error('First-touch approval is only for unsent guessed addresses');
   if(!isUnverifiedAddress(record))throw Error('Published addresses do not need first-touch approval');
   if(!['needs_review','queued'].includes(record.sequenceStatus))throw Error('Record is not waiting for first-touch approval');
   approveFirstTouch(entry.id);
   await activateTarget(entry.id,'First-touch approved for guessed address in Signal Desk');
   entry.enabled=true;save();
  }finally{release();}
  return {approved:true};
 }
 throw Error('Unknown action');
}
let schedulerRunning=false;let nextRun=0;
async function runScheduler(){
 if(!sendingEnabled||isSendingHalted())return;
 if(!claudeReady()||(byokRequired&&!slashy.ready()))return;
 const records=state.records.filter(r=>r.enabled);if(!records.length||schedulerRunning||Date.now()<nextRun)return;
 schedulerRunning=true;nextRun=Date.now()+60000;snapshot.scheduler={...snapshot.scheduler,running:true};
 let lastError:string|null=null;
 try{for(const mode of ['application','investment']){
  const ids=records.filter(r=>(r.mode??'application')===mode).map(r=>r.id);if(!ids.length)continue;
  const env:NodeJS.ProcessEnv={...process.env,OUTREACH_RECORD_IDS:ids.join(','),DRY_RUN:'0',HEARTBEAT_PATH:resolve(dir,'scheduler-heartbeat.json')};
  if(claudeMode==='subscription'){env.SIGNAL_DESK_CLAUDE_MODE='subscription';delete env.ANTHROPIC_API_KEY;delete env.CLAUDE_CODE_OAUTH_TOKEN;}
  else if(byokApiKey){env.SIGNAL_DESK_CLAUDE_MODE='api';env.ANTHROPIC_API_KEY=byokApiKey;delete env.CLAUDE_CODE_OAUTH_TOKEN;}
  else if(byokRequired){delete env.ANTHROPIC_API_KEY;delete env.CLAUDE_CODE_OAUTH_TOKEN;}
  for(const key of Object.keys(env))if(key.startsWith('TEST_'))env[key]='';
  if(mode==='investment'){env.SEQUENCE_FILE='config/sequence-investment.json';env.RESUME_FILE_ID='';env.MEETING_PURPOSE='Investment conversation about {company}';}
  else {env.SEQUENCE_FILE='config/sequence-application.json';env.RESUME_FILE_ID=resumeFileId;env.MEETING_PURPOSE='Conversation about an opportunity at {company}';}
  await new Promise<void>(done=>{
   const child=spawn(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve('src/main.ts')],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
   let output='';child.stdout.on('data',d=>{output=(output+d).slice(-2000);});child.stderr.on('data',d=>{output=(output+d).slice(-2000);});
   child.on('error',()=>{lastError='Could not start the scheduler';done();});
   child.on('close',code=>{if(code&&!output.includes('Scheduler already running'))lastError='Scheduler reported an error. Review the local scheduler log.';writeFileSync(resolve(dir,'scheduler-last.log'),output,{mode:0o600});done();});
  });
 }}catch{lastError='Could not run the scheduler';}finally{schedulerRunning=false;snapshot.scheduler={running:false,lastRunAt:new Date().toISOString(),lastError};}
}
for(const id of state.started)if(!state.completions[id])state.completions[id]={status:'review',result:{error:'Runner restarted during this request. Review Attio before retrying; this request was not replayed.'}};
save();
const schedulerTimer=setInterval(runScheduler,60000);
let heartbeating=false;const timer=setInterval(()=>{if(heartbeating)return;heartbeating=true;heartbeat().catch(e=>console.error(String(e))).finally(()=>{heartbeating=false;});},30000);
console.log('Signal Desk outreach runner started');
try{while(!stopping){try{
 await refreshCredential();await refresh();await heartbeat();
 for(const [id,completion] of Object.entries(state.completions)){await api({op:'complete',id,...completion});delete state.completions[id];state.started=state.started.filter(x=>x!==id);save();}
 const response=await api({op:'claim'});const job=response.job;
 if(job){state.started.push(job.id);save();try{state.completions[job.id]={status:'succeeded',result:await execute(job)};}catch(e){state.completions[job.id]={status:job.action==='discover'?'failed':'review',result:{error:String(e)}};}save();}
 if(state.signalCompletion){await api({op:'signalComplete',...state.signalCompletion});delete state.signalCompletion;save();}
 if(state.crmCompletion){await api({op:'crmComplete',...state.crmCompletion});delete state.crmCompletion;save();}
 let crmBusy=false;
 if(!job){const {job:crmJob}=await api({op:'crmClaim'});if(crmJob){crmBusy=true;let result:any;
 try{
 if(crmJob.kind==='inbox'){
 if(crmJob.payload.inbox!==policy.sender)throw Error('CRM inbox does not match configured sender.');
 const credential=claudeCredential();
 // Mailbox reads are plain tool calls. Sonnet intermittently refuses to read an inbox
 // that differs from the Claude login's own email; the send path's model does not.
 // CRM_MODEL still drives fact extraction.
 result=await collectInbox(slashyCall({claudeBin:process.env.CLAUDE_BIN??`${process.env.HOME}/.local/bin/claude`,model:process.env.CRM_TOOL_MODEL??process.env.SEND_MODEL??'claude-haiku-4-5',timeoutMs:60000,...credential}),policy.sender,crmJob.payload.lookbackDays,undefined,crmJob.payload.scope,crmJob.payload.wide===true);
 }else if(crmJob.kind==='extract'){
 if(!claudeReady())throw Error('Selected Claude connection is not ready.');
 result=usingSubscription()?await extractCrmSubscription(claudeBin,crmJob.payload.source):await extractCrm(byokApiKey??(!byokRequired?process.env.ANTHROPIC_API_KEY:'')??'',crmJob.payload.source);
 }
 else if(crmJob.kind==='attio')result=await syncCrmAttio(crmJob.payload,{key:process.env.CRM_ATTIO_API_KEY??'',object:process.env.CRM_ATTIO_OBJECT??'',inbox:process.env.CRM_ATTIO_INBOX??''});
 else if(crmJob.kind==='meetings')result=await collectAttioMeetings([process.env.ATTIO_API_KEY??'',process.env.CRM_ATTIO_API_KEY??''],crmJob.payload.scope??{emails:[],domains:[],companies:[]});
 else throw Error('Unknown CRM job');
 }catch(e){result={error:e instanceof Error?e.message:'CRM failed'};}
 state.crmCompletion={id:crmJob.id,result};save();
 }}
 if(!job&&!crmBusy){const {run}=await api({op:'signalClaim'});if(run){
  try{
   const credential=claudeCredential();
   const result=await collectSignals({crustdataKey,crustdataError:crustdataError??undefined,claudeBin:process.env.CLAUDE_BIN??`${process.env.HOME}/.local/bin/claude`,model:process.env.SIGNAL_MODEL??process.env.DISCOVER_MODEL??'claude-sonnet-5',...credential},run.criteria,run.previousSources,run.previousEvents);
   state.signalCompletion={id:run.id,result};save();
  }catch(e){state.signalCompletion={id:run.id,result:{error:String(e)}};save();}
 }}
 runScheduler();
 }catch(e){console.error(String(e));}
 await new Promise(r=>setTimeout(r,pollMs));
}}finally{clearInterval(timer);clearInterval(schedulerTimer);await slashy.close();}
