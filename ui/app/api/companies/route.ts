import { z } from 'zod';
import { workspaceDb } from '@/db/workspace';
import { workspaceOwner } from '@/lib/pilot-auth';

const companySchema = z.object({
  id:z.string().min(1).max(100),name:z.string().trim().min(1).max(150),
  domain:z.string().max(250),sector:z.string().trim().min(1).max(150),
  stage:z.string().max(100),location:z.string().max(150),
  signal:z.string().trim().min(1).max(2000),
  kind:z.enum(['Hiring','Product','Partnership','Fundraising']),
  source:z.string().max(2000).refine(s=>{if(!s)return true;try{return ['http:','https:'].includes(new URL(s).protocol);}catch{return false;}},'Source must be an http or https URL'),
  status:z.enum(['New','Shortlisted','Draft ready','Passed']),
  notes:z.string().max(10000),draft:z.string().max(10000),
  observed:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
export async function GET(request:Request){
  const owner=await workspaceOwner(request);
  if(!owner)return Response.json({error:'Enter the pilot access code to open this workspace.'},{status:401});
  try{
    const result=await workspaceDb().prepare('SELECT data FROM companies WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 1000').bind(owner).all<{data:string}>();
    return Response.json(result.results.map(row=>JSON.parse(row.data)),{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){console.error('Load company research failed',error);return Response.json({error:'Research storage is unavailable. Please try again.'},{status:503});}
}
export async function POST(request:Request){
  const owner=await workspaceOwner(request);
  if(!owner)return Response.json({error:'Enter the pilot access code to save company research.'},{status:401});
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin)return Response.json({error:'Invalid request origin'},{status:403});
  if(!request.headers.get('content-type')?.includes('application/json'))return Response.json({error:'Expected JSON'},{status:415});
  let input;try{const text=await request.text();if(text.length>40000)return Response.json({error:'Company record is too large'},{status:413});input=JSON.parse(text);}catch{return Response.json({error:'Invalid JSON'},{status:400});}
  const result=companySchema.safeParse(input);
  if(!result.success)return Response.json({error:result.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')},{status:400});
  try{
    await workspaceDb().prepare('INSERT INTO companies (owner_id,id,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').bind(owner,result.data.id,JSON.stringify(result.data),new Date().toISOString()).run();
    return Response.json({saved:true});
  }catch(error){console.error('Save company research failed',error);return Response.json({error:'Could not save your research. Keep this form open and retry.'},{status:503});}
}
