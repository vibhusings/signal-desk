import 'dotenv/config';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AttioStore} from '../src/attio/client.js';
import {scopeStore} from '../src/bridge/scope.js';
import {runOnce} from '../src/scheduler/run.js';
import {loadPolicy} from '../src/scheduler/policy.js';
// Real Attio writes; simulated sender only. Never registers with a runner.
if(!process.argv.includes('--write-test'))throw Error('Requires --write-test');
process.env.SEND_GUARD_DIR=mkdtempSync(join(tmpdir(),'attio-followup-test-'));
const object=process.env.ATTIO_OBJECT??'companies';
async function api(path:string,method:string,body?:unknown){const r=await fetch('https://api.attio.com/v2'+path,{method,headers:{Authorization:'Bearer '+process.env.ATTIO_API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(`Attio ${r.status}: ${await r.text()}`);return r.status===204?null:r.json();}
const initial=new Date();
const created:any=await api(`/objects/${object}/records`,'POST',{data:{values:{name:'TEST — Signal Desk follow-up verification',outreach_email:'followup-verification@example.invalid',outreach_contact:'Simulated recipient',sequence_status:'active',sequence_stage:0,touch_count:0,next_touch_at:initial.toISOString(),email_source:'published:https://example.invalid/test',review_note:'Temporary integration test. Sender is simulated; no emails sent.'}}});
const id=created.data.id.record_id;
try{
 const store=scopeStore(new AttioStore(process.env.ATTIO_API_KEY!,object),[id]);
 const policy={...loadPolicy({DRY_RUN:'0'}),quietHours:null};
 const sent:number[]=[];const sender=async(_:unknown,touch:number)=>{sent.push(touch);return {ok:true,messageId:`test-${touch}`,subject:'SIMULATED — no email sent'};};
 const log={info:()=>{},warn:console.warn,error:console.error};
 let now=initial;
 for(let touch=1;touch<=4;touch++){
  const result=await runOnce(store,sender,policy,now,log);assert.equal(result.sent,1);
  const record=await store.getById(id);assert.equal(record.sequenceStage,touch);assert.equal(record.touchCount,touch);
  const before=sent.length;await runOnce(store,sender,policy,now,log);assert.equal(sent.length,before);
  if(touch<4){assert.equal(Date.parse(record.nextTouchAt!),+now+policy.intervalsMinutes[touch-1]*60000);now=new Date(record.nextTouchAt!);}
  else {assert.equal(record.sequenceStatus,'stopped');assert.equal(record.nextTouchAt,null);}
  console.log(`Attio readback verified touch ${touch}, next deadline, and no immediate resend`);
 }
 await store.park(id,'replied','SIMULATED reply for verification');await runOnce(store,sender,policy,new Date(+now+86400000),log);assert.equal(sent.length,4);
 console.log('Reply-stop verified; simulated sender calls only, zero email delivery calls');
}finally{await api(`/objects/${object}/records/${id}`,'DELETE');console.log('Removed temporary Attio follow-up record');}
