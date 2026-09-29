import { workspaceDb } from '@/db/workspace';
import { crmView } from '@/lib/crm-store';
import { projectCrm } from '@/lib/crm-projection';
import { criteriaSchema, emptyCriteria } from '@/lib/signal-schema';
import { outsideUserMandate, vcFriendsForStartup } from '@/lib/vc-intro';
import { PILOT_OWNER_ID, workspaceOwner } from '@/lib/pilot-auth';
import { companyFromSignal, queueResearch } from '@/lib/outreach-pipeline';
export const dynamic='force-dynamic';
async function context(request:Request){
 const owner=await workspaceOwner(request);if(!owner)throw Error('AUTH');
 const db=workspaceDb();
 await db.prepare('INSERT INTO outreach_runner (id,owner_id,snapshot,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING').bind('primary',owner,'{}','').run();
 if(owner===PILOT_OWNER_ID)await db.prepare('UPDATE outreach_runner SET owner_id=? WHERE id=?').bind(owner,'primary').run();
 const runner=await db.prepare('SELECT owner_id,snapshot,updated_at FROM outreach_runner WHERE id=?').bind('primary').first<{owner_id:string;snapshot:string;updated_at:string}>();
 if(runner?.owner_id!==owner)throw Error('AUTH');
 return {owner,db,runner};
}
function failed(e:unknown){console.error('Signal request failed',e);return Response.json({error:e instanceof Error&&e.message==='AUTH'?'Enter the pilot access code to open this workspace.':'Signal storage is unavailable. Please retry.'},{status:e instanceof Error&&e.message==='AUTH'?403:503});}
export async function GET(request:Request){try{
 const {owner,db,runner}=await context(request);
 const [setting,events,runs,sources]=await Promise.all([
  db.prepare('SELECT data,next_scan_at FROM signal_settings WHERE owner_id=?').bind(owner).first<{data:string;next_scan_at:string|null}>(),
  db.prepare('SELECT id,data,status,first_seen,last_seen FROM signal_events WHERE owner_id=? ORDER BY first_seen DESC LIMIT 200').bind(owner).all<any>(),
  db.prepare('SELECT id,status,created_at,started_at,completed_at,result FROM signal_runs WHERE owner_id=? ORDER BY created_at DESC LIMIT 20').bind(owner).all<any>(),
  db.prepare('SELECT data FROM signal_sources WHERE owner_id=? ORDER BY updated_at DESC LIMIT 24').bind(owner).all<{data:string}>(),
 ]);
 const snapshot=JSON.parse(runner.snapshot);
 const criteria=setting?JSON.parse(setting.data):emptyCriteria;
 let contacts:any[]=[];
 try{contacts=projectCrm(await crmView(owner)).contacts;}catch{contacts=[];}
 const listed=events.results.map(e=>{
  const event={...JSON.parse(e.data),status:e.status,firstSeen:e.first_seen,lastSeen:e.last_seen};
  const outsideMandate=event.status==="Can't invest"||outsideUserMandate(event,criteria);
  if(!outsideMandate)return {...event,outsideMandate:false,vcIntros:[]};
  const intro=vcFriendsForStartup(event,contacts);
  return {...event,outsideMandate:true,vcIntros:intro.matches,vcIntroNote:intro.note};
 });
 return Response.json({criteria,configured:!!setting,nextScanAt:setting?.next_scan_at,runnerOnline:!!runner.updated_at&&Date.now()-Date.parse(runner.updated_at)<90000,collectorReady:snapshot.capabilities?.signals===true,events:listed,runs:runs.results.map(r=>({...r,result:r.result?JSON.parse(r.result):null})),sources:sources.results.map(s=>JSON.parse(s.data))},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return failed(e);}}
export async function POST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});
 const raw=await request.text();if(raw.length>20000)return Response.json({error:'Request too large'},{status:413});
 let body;try{body=JSON.parse(raw);}catch{return Response.json({error:'Invalid JSON'},{status:400});}
 const {owner,db,runner}=await context(request),now=new Date().toISOString();
 if(body.action==='settings'){
  const parsed=criteriaSchema.safeParse(body.criteria);if(!parsed.success)return Response.json({error:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')},{status:400});
  if(parsed.data.enabled){
   const completed=await db.prepare("SELECT id FROM signal_runs WHERE owner_id=? AND status IN ('succeeded','partial') LIMIT 1").bind(owner).first();
   if(!completed)return Response.json({error:'Run and review your first scan before enabling recurring scans.'},{status:409});
  }
  await db.prepare('INSERT INTO signal_settings (owner_id,data,updated_at,next_scan_at) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,next_scan_at=excluded.next_scan_at').bind(owner,JSON.stringify(parsed.data),now,parsed.data.enabled?new Date(Date.now()+parsed.data.intervalHours*3600000).toISOString():null).run();
  return Response.json({ok:true});
 }
 if(body.action==='scan'){
  const capabilities=JSON.parse(runner.snapshot).capabilities;
  if(!runner.updated_at||Date.now()-Date.parse(runner.updated_at)>90000||!capabilities?.signals)return Response.json({error:'The cloud signal collector is offline. Wait for it to reconnect.'},{status:409});
  if(capabilities?.claude===false)return Response.json({error:'Add a Claude API key in Settings before running a signal scan.'},{status:409});
  const setting=await db.prepare('SELECT data FROM signal_settings WHERE owner_id=?').bind(owner).first<{data:string}>();
  if(!setting)return Response.json({error:'Save your investment criteria first.'},{status:400});
  const id=crypto.randomUUID();
  const inserted=await db.prepare("INSERT INTO signal_runs (id,owner_id,status,criteria,created_at) SELECT ?,?,'queued',?,? WHERE NOT EXISTS (SELECT 1 FROM signal_runs WHERE owner_id=? AND status IN ('queued','running')) RETURNING id").bind(id,owner,setting.data,now,owner).first();
  return inserted?Response.json({id}):Response.json({error:'A scan is already queued or running.'},{status:409});
 }
 if(body.action==='review'&&typeof body.id==='string'&&['New','Shortlisted','Passed',"Can't invest"].includes(body.status)){
  await db.prepare('UPDATE signal_events SET status=? WHERE owner_id=? AND id=?').bind(body.status,owner,body.id).run();
  // Shortlisting is the start of outreach: save the company and research contacts
  // and first-email drafts straight away. Passing it later takes it off the board.
  if(body.status==='Shortlisted'){const {companyId}=await companyFromSignal(db,owner,body.id);return Response.json({ok:true,companyId,research:await queueResearch(db,owner,companyId)});}
  if(body.status==='Passed'||body.status==="Can't invest"){
   const event=await db.prepare('SELECT company_key FROM signal_events WHERE owner_id=? AND id=?').bind(owner,body.id).first<{company_key:string}>();
   const saved=event?await db.prepare('SELECT data FROM companies WHERE owner_id=? AND id=?').bind(owner,`signal:${event.company_key}`).first<{data:string}>():null;
   if(saved)await db.prepare('UPDATE companies SET data=?,updated_at=? WHERE owner_id=? AND id=?').bind(JSON.stringify({...JSON.parse(saved.data),status:'Passed'}),new Date().toISOString(),owner,`signal:${event!.company_key}`).run();
  }
  return Response.json({ok:true});
 }
 if(body.action==='research'&&typeof body.id==='string'){
  const {companyId}=await companyFromSignal(db,owner,body.id);
  await db.prepare("UPDATE signal_events SET status='Shortlisted' WHERE owner_id=? AND id=? AND status='New'").bind(owner,body.id).run();
  return Response.json({companyId,signalId:body.id,research:await queueResearch(db,owner,companyId)});
 }
 return Response.json({error:'Invalid action'},{status:400});
}catch(e){return failed(e);}}
