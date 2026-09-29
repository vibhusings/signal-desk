import { z } from 'zod';
import { workspaceDb } from '@/db/workspace';
import { workspaceOwner } from '@/lib/pilot-auth';
import { approveDraft, ensureOutreachSettings, EMAIL, pipelineView, queueResearch } from '@/lib/outreach-pipeline';
export const dynamic='force-dynamic';

const requestSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('research'),companyId:z.string().min(1).max(100),retry:z.boolean().optional()}).strict(),
 z.object({action:z.literal('approve'),companyId:z.string().min(1).max(100),discoveryId:z.string().uuid(),index:z.number().int().min(0).max(9),subject:z.string().max(300),body:z.string().max(6000)}).strict(),
 z.object({action:z.literal('settings'),demoRecipient:z.string().trim().max(254).refine(s=>!s||EMAIL.test(s),'Enter a valid email address')}).strict(),
]);

export async function GET(request:Request){
 const owner=await workspaceOwner(request);
 if(!owner)return Response.json({error:'Enter the pilot access code to open this workspace.'},{status:401});
 try{return Response.json(await pipelineView(workspaceDb(),owner),{headers:{'Cache-Control':'private, no-store'}});}
 catch(e){console.error('Pipeline read failed',e);return Response.json({error:'Pipeline is unavailable. Please retry.'},{status:503});}
}

export async function POST(request:Request){
 const owner=await workspaceOwner(request);
 if(!owner)return Response.json({error:'Enter the pilot access code to use the pipeline.'},{status:401});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin'},{status:403});
 const raw=await request.text();if(raw.length>20000)return Response.json({error:'Request too large'},{status:413});
 let input;try{input=JSON.parse(raw);}catch{return Response.json({error:'Invalid JSON'},{status:400});}
 const parsed=requestSchema.safeParse(input);
 if(!parsed.success)return Response.json({error:parsed.error.issues.map(i=>i.message).join('; ')},{status:400});
 const body=parsed.data,db=workspaceDb();
 try{
  if(body.action==='research')return Response.json(await queueResearch(db,owner,body.companyId,{retry:body.retry}));
  if(body.action==='settings'){
   await ensureOutreachSettings(db);
   await db.prepare('INSERT INTO outreach_settings(owner_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(owner,JSON.stringify({demoRecipient:body.demoRecipient.toLowerCase()}),new Date().toISOString()).run();
   return Response.json({ok:true,demoRecipient:body.demoRecipient.toLowerCase()});
  }
  return Response.json(await approveDraft(db,owner,body));
 }catch(e){
  const message=e instanceof Error?e.message:'';
  // Validation messages are written for the user; anything else is a storage fault.
  if(message&&!/D1|SQL|database/i.test(message))return Response.json({error:message},{status:409});
  console.error('Pipeline request failed',e);return Response.json({error:'Pipeline storage is unavailable. Please retry.'},{status:503});
 }
}
