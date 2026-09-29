import 'dotenv/config';
import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ATTR } from '../src/attio/schema.js';

const BASE='https://api.attio.com/v2';
const apiKey=process.env.ATTIO_API_KEY;
const object=process.env.ATTIO_OBJECT ?? 'companies';
const sourceEmail=process.argv.find(a=>a.startsWith('--email='))?.slice(8);
const deliveryEmail=process.argv.find(a=>a.startsWith('--deliver-to='))?.slice(13);
const touches=Number(process.argv.find(a=>a.startsWith('--touches='))?.slice(10) ?? 1);
if(!apiKey||!sourceEmail||!deliveryEmail||!/^\S+@\S+\.\S+$/.test(sourceEmail)||!/^\S+@\S+\.\S+$/.test(deliveryEmail)||!Number.isInteger(touches)||touches<1||touches>4){
  console.error('Usage: npm run prepare:test -- --email=<scraped-email> --deliver-to=<safe-inbox> [--touches=1]');process.exit(1);
}
const headers={Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'};
async function call(path:string,init:RequestInit){const res=await fetch(`${BASE}${path}`,{...init,headers:{...headers,...init.headers}});if(!res.ok)throw new Error(`Attio ${init.method} ${path} -> ${res.status}: ${await res.text()}`);return res.json();}
function setEnv(values:Record<string,string>){
  const path='.env';let lines=readFileSync(path,'utf8').split('\n');
  for(const [key,value] of Object.entries(values)){
    const i=lines.findIndex(line=>new RegExp(`^#?${key}=`).test(line));
    if(i>=0)lines[i]=`${key}=${value}`;else lines.push(`${key}=${value}`);
  }
  // Write-then-rename: a scheduler run that reads .env mid-write crashed with
  // "Invalid test intervals" and left a record stuck behind an orphaned claim.
  writeFileSync(`${path}.tmp`,lines.join('\n'),{mode:0o600});chmodSync(`${path}.tmp`,0o600);renameSync(`${path}.tmp`,path);
}
async function main(){
  const found=await call(`/objects/${object}/records/query`,{method:'POST',body:JSON.stringify({filter:{[ATTR.contactEmail]:{$eq:sourceEmail}},limit:2})});
  if(found.data.length!==1)throw new Error(`Expected exactly one Attio record for ${sourceEmail}; found ${found.data.length}`);
  const id=found.data[0].id.record_id as string;
  const values={
    [ATTR.sequenceStatus]:'active',[ATTR.sequenceStage]:0,[ATTR.touchCount]:0,
    [ATTR.nextTouchAt]:new Date(Date.now()-60000).toISOString(),[ATTR.lastTouchAt]:[],
    [ATTR.claimedAt]:[],[ATTR.lastSendKey]:[],[ATTR.lastMessageId]:[],[ATTR.lastSubject]:[],[ATTR.threadId]:[],
    [ATTR.reviewNote]:`TEST ONLY: Attio email ${sourceEmail}; delivery redirected to ${deliveryEmail}`,
  };
  await call(`/objects/${object}/records/${id}`,{method:'PATCH',body:JSON.stringify({data:{values}})});
  setEnv({TEST_ONLY_RECORD_ID:id,TEST_RECIPIENT:sourceEmail!,TEST_DELIVERY_RECIPIENT:deliveryEmail!,TEST_MAX_TOUCHES:String(touches),TEST_INTERVALS_MINUTES:'1,1,1'});
  console.log(`Prepared Attio record ${id}`);
  console.log(`  stored outreach email: ${sourceEmail}`);
  console.log(`  actual delivery inbox: ${deliveryEmail}`);
  console.log(`  touches allowed: ${touches}`);
  console.log('  status: active; stage: 0; due now');
  // Start a run now instead of waiting up to a full launchd interval. No `-k`:
  // killing an in-flight run is exactly what orphans a claim.
  try {
    execFileSync('launchctl',['kickstart',`gui/${process.getuid!()}/com.vibhu.gtm-workflow`],{stdio:'ignore'});
    console.log('  scheduler started — first send in ~1 minute');
  } catch {
    console.log('  scheduler not started automatically; it will pick this up on its next cycle');
  }
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1);});
