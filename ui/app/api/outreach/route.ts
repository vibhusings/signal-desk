import { workspaceDb } from '@/db/workspace';
import { z } from 'zod';
import { campaignLinksSql } from '@/lib/outreach-links';
import { PILOT_OWNER_ID, workspaceOwner } from '@/lib/pilot-auth';
export const dynamic = 'force-dynamic';
const requestSchema = z.discriminatedUnion('action', [
 z.object({id:z.string().uuid(),action:z.literal('discover'),company:z.string().trim().min(2).max(150),maxContacts:z.number().int().min(1).max(10),companyId:z.string().min(1).max(100).optional(),mode:z.enum(['application','investment']),signalId:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict(),
 z.object({id:z.string().uuid(),action:z.literal('launch'),discoveryId:z.string().uuid(),indices:z.array(z.number().int().min(0).max(9)).min(1).max(10),policyHash:z.string().min(1).max(100),acknowledgeGuessed:z.boolean(),confirmSend:z.literal(true)}).strict(),
 z.object({id:z.string().uuid(),action:z.literal('pause'),recordId:z.string().uuid()}).strict(),
 z.object({id:z.string().uuid(),action:z.literal('halt'),reason:z.string().trim().max(300).optional()}).strict(),
 z.object({id:z.string().uuid(),action:z.literal('resume')}).strict(),
 z.object({id:z.string().uuid(),action:z.literal('approveFirstTouch'),recordId:z.string().uuid()}).strict(),
]);
async function owner(request:Request){
 const id=await workspaceOwner(request);
 if(!id)throw new Error('AUTH');
 const db=workspaceDb();
 await db.prepare('INSERT INTO outreach_runner (id,owner_id,snapshot,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING').bind('primary',id,'{}','').run();
 if(id===PILOT_OWNER_ID)await db.prepare('UPDATE outreach_runner SET owner_id=? WHERE id=?').bind(id,'primary').run();
 const row=await db.prepare('SELECT owner_id,snapshot,updated_at FROM outreach_runner WHERE id = ?').bind('primary').first<{owner_id:string;snapshot:string;updated_at:string}>();
 if(row?.owner_id!==id)throw new Error('OWNER');
 return {id,row,db};
}
function failure(e:unknown){console.error('Outreach request failed',e);return Response.json({error:e instanceof Error&&e.message==='AUTH'?'Enter the pilot access code to use outreach.':e instanceof Error&&e.message==='OWNER'?'This runner belongs to another workspace.':'Outreach storage is unavailable. Please retry.'},{status:e instanceof Error&&['AUTH','OWNER'].includes(e.message)?403:503});}
export async function GET(request:Request){try{
 const {id,row,db}=await owner(request);
 const jobs=await db.prepare('SELECT id,action,payload,status,result,created_at,updated_at FROM outreach_jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50').bind(id).all();
 const links=await db.prepare(campaignLinksSql).bind(id).all<{recordId:string;companyId:string}>();
 return Response.json({campaignLinks:Object.fromEntries(links.results.map(link=>[link.recordId,link.companyId])),runner:{...JSON.parse(row.snapshot),lastSeen:row.updated_at,online:!!row.updated_at&&Date.now()-Date.parse(row.updated_at)<90000},jobs:jobs.results.map((j:any)=>({...j,payload:JSON.parse(j.payload),result:j.result?JSON.parse(j.result):null}))},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin'},{status:403});
 if(!request.headers.get('content-type')?.includes('application/json'))return Response.json({error:'Expected JSON'},{status:415});
 const parsed=requestSchema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({error:'Invalid outreach request'},{status:400});
 const {id,row,db}=await owner(request);const body=parsed.data;
 const duplicate=await db.prepare('SELECT id FROM outreach_jobs WHERE id = ? AND owner_id = ?').bind(body.id,id).first();
 if(duplicate)return Response.json({id:body.id,queued:true});
 const snapshot=JSON.parse(row.snapshot);
 if(!row.updated_at||Date.now()-Date.parse(row.updated_at)>90000)return Response.json({error:'The cloud runner is offline. Wait for it to reconnect before submitting a request.'},{status:409});
 if(body.action==='discover'&&snapshot.capabilities?.claude===false)return Response.json({error:'Add a Claude API key in Settings before starting contact research.'},{status:409});
 if(body.action==='discover'&&snapshot.capabilities?.slashy===false)return Response.json({error:'Connect Slashy in Settings before starting contact research.'},{status:409});
 if(body.action==='launch'&&snapshot.capabilities?.sending!==true)return Response.json({error:'Email sending is disabled while the cloud runner is being validated.'},{status:409});
 let payload:any=body;
 if(body.action==='discover'&&body.mode==='investment'&&!snapshot.capabilities?.investment)return Response.json({error:'Update the cloud runner to use investment outreach.'},{status:409});
 if(body.action==='discover'&&body.companyId){
  const saved=await db.prepare('SELECT id FROM companies WHERE owner_id = ? AND id = ?').bind(id,body.companyId).first();
  if(!saved)return Response.json({error:'Save this company to your workspace before starting outreach.'},{status:400});
 }
 if(body.action==='discover'&&(body.signalId||body.companyId?.startsWith('signal:'))){
  const signal=body.signalId?await db.prepare('SELECT data,company_key FROM signal_events WHERE owner_id=? AND id=?').bind(id,body.signalId).first<{data:string;company_key:string}>():await db.prepare('SELECT data,company_key FROM signal_events WHERE owner_id=? AND company_key=? ORDER BY last_seen DESC LIMIT 1').bind(id,body.companyId!.slice(7)).first<{data:string;company_key:string}>();
  if(!signal||body.companyId!==`signal:${signal.company_key}`||body.mode!=='investment')return Response.json({error:'Signal does not match this research record.'},{status:400});
  const s=JSON.parse(signal.data);
  const settings=await db.prepare('SELECT data FROM signal_settings WHERE owner_id=?').bind(id).first<{data:string}>();
  payload={...body,company:s.company,investmentContext:JSON.stringify({thesis:settings?JSON.parse(settings.data).thesis:'',signal:s.title,evidence:s.evidence,caveats:s.caveats})};
 }
 if(body.action==='launch'){
  const discovery=await db.prepare('SELECT payload,result FROM outreach_jobs WHERE id = ? AND owner_id = ? AND action = ? AND status = ?').bind(body.discoveryId,id,'discover','succeeded').first<{payload:string;result:string}>();
  if(!discovery)return Response.json({error:'Completed discovery not found'},{status:400});
  const result=JSON.parse(discovery.result);const contacts=[...new Set(body.indices)].map(i=>result.contacts?.[i]);
  if(contacts.some(c=>!c))return Response.json({error:'A selected contact no longer exists'},{status:400});
  if(contacts.some(c=>c.emailSource.kind==='guessed')&&!body.acknowledgeGuessed)return Response.json({error:'Review and acknowledge guessed addresses before sending.'},{status:400});
  const research=JSON.parse(discovery.payload);
  const policy=research.mode==='investment'?snapshot.investmentPolicy:snapshot.policy;
  if(research.mode==='application'&&policy?.resumeAttached!==true)return Response.json({error:'Upload a confirmed resume in Settings before launching a job application.'},{status:409});
  if(body.policyHash!==policy?.hash)return Response.json({error:'Sequence settings changed. Refresh and review them again.'},{status:409});
  payload={...body,company:research.company,companyId:research.companyId??null,mode:research.mode??'application',investmentContext:research.investmentContext??null,contacts,summary:result.summary,website:result.website};
 }else if(body.action==='pause'||body.action==='approveFirstTouch'){
  if(!snapshot.records?.some((r:any)=>r.id===body.recordId))return Response.json({error:'Campaign is not managed by this runner'},{status:403});
 }
 if(body.action==='approveFirstTouch'&&snapshot.capabilities?.sending!==true)return Response.json({error:'Email sending is disabled while the cloud runner is being validated.'},{status:409});
 const pending=await db.prepare('SELECT COUNT(*) AS n FROM outreach_jobs WHERE owner_id = ? AND status IN (?,?)').bind(id,'queued','running').first<{n:number}>();
 if((pending?.n??0)>=10)return Response.json({error:'Ten requests are already pending. Wait for them to complete.'},{status:429});
 const now=new Date().toISOString();
 await db.prepare('INSERT INTO outreach_jobs (id,owner_id,action,payload,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(body.id,id,body.action,JSON.stringify(payload),'queued',now,now).run();
 return Response.json({id:body.id,queued:true});
}catch(e){return failure(e);}}
