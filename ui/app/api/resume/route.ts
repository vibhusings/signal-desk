import { workspaceDb } from '@/db/workspace';
import { workspaceOwner } from '@/lib/pilot-auth';
import { z } from 'zod';
export const dynamic='force-dynamic';

const MIME=['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
const schema=z.object({id:z.string().uuid(),filename:z.string().trim().min(1).max(150),mimeType:z.enum(MIME),size:z.number().int().min(1).max(500000),keyId:z.string().regex(/^[a-f0-9]{64}$/),envelope:z.string().min(200).max(675000)}).strict();
async function context(request:Request){
 const owner=await workspaceOwner(request);if(!owner)throw Error('AUTH');const db=workspaceDb();
 await db.prepare('CREATE TABLE IF NOT EXISTS runner_resume(owner_id TEXT PRIMARY KEY,key_id TEXT NOT NULL,ciphertext TEXT NOT NULL,filename TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,updated_at TEXT NOT NULL)').run();
 const runner=await db.prepare('SELECT owner_id,snapshot,updated_at FROM outreach_runner WHERE id=?').bind('primary').first<any>();
 if(!runner||runner.owner_id!==owner)throw Error('OWNER');return {owner,db,runner};
}
function fail(e:unknown){const code=e instanceof Error?e.message:'';return Response.json({error:code==='AUTH'?'Enter the access code first.':code==='OWNER'?'This runner belongs to another workspace.':'Resume storage is unavailable.'},{status:code==='AUTH'||code==='OWNER'?403:503});}
export async function GET(request:Request){try{
 const {owner,db,runner}=await context(request);const snapshot=JSON.parse(runner.snapshot||'{}');
 const saved=await db.prepare('SELECT filename,mime_type,size,updated_at FROM runner_resume WHERE owner_id=?').bind(owner).first<any>();
 const job=await db.prepare("SELECT status,result,updated_at FROM outreach_jobs WHERE owner_id=? AND action='resumeUpload' ORDER BY created_at DESC LIMIT 1").bind(owner).first<any>();
 return Response.json({configured:!!saved,active:snapshot.resume?.configured===true,filename:saved?.filename??null,mimeType:saved?.mime_type??null,size:saved?.size??null,updatedAt:saved?.updated_at??null,runnerOnline:!!runner.updated_at&&Date.now()-Date.parse(runner.updated_at)<90000,slashyConnected:snapshot.slashy?.connected===true,exchange:snapshot.credentialKey??null,runnerError:snapshot.resume?.error??null,upload:job?{status:job.status,error:job.result?JSON.parse(job.result).error??null:null,updatedAt:job.updated_at}:null},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return fail(e);}}
export async function POST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin'},{status:403});
 const raw=await request.text();if(raw.length>700000)return Response.json({error:'Resume upload is too large'},{status:413});
 const parsed=schema.safeParse(JSON.parse(raw));if(!parsed.success)return Response.json({error:'Use a PDF, DOC, or DOCX file no larger than 500 KB.'},{status:400});
 const {owner,db,runner}=await context(request);const body=parsed.data,snapshot=JSON.parse(runner.snapshot||'{}');
 if(!runner.updated_at||Date.now()-Date.parse(runner.updated_at)>90000)return Response.json({error:'The cloud runner is offline.'},{status:409});
 if(snapshot.slashy?.connected!==true)return Response.json({error:'Connect Slashy before uploading a resume.'},{status:409});
 if(snapshot.credentialKey?.keyId!==body.keyId)return Response.json({error:'The runner key changed. Refresh and upload again.'},{status:409});
 let envelope:any;try{envelope=JSON.parse(body.envelope);}catch{return Response.json({error:'Encrypted resume is invalid.'},{status:400});}
 if(envelope?.keyId!==body.keyId||envelope?.alg!=='RSA-OAEP-256+A256GCM')return Response.json({error:'Encrypted resume is invalid.'},{status:400});
 const now=new Date().toISOString();await db.prepare('INSERT INTO outreach_jobs(id,owner_id,action,payload,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(body.id,owner,'resumeUpload',JSON.stringify(body),'queued',now,now).run();
 return Response.json({queued:true,id:body.id});
}catch(e){return fail(e);}}
export async function DELETE(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin'},{status:403});
 const {owner,db}=await context(request);await db.prepare('DELETE FROM runner_resume WHERE owner_id=?').bind(owner).run();return Response.json({ok:true});
}catch(e){return fail(e);}}
