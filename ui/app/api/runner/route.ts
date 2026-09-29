import { ensureCrustdata } from '@/lib/crustdata-store';
import { claimCrm, completeCrm, markReferral } from '@/lib/crm-store';
import { env } from 'cloudflare:workers';
import { workspaceDb } from '@/db/workspace';
import { claimSignalScan, completeSignalScan } from '@/lib/signal-store';
import { ensureSlashyTables } from '@/lib/slashy-tables';
export const dynamic='force-dynamic';
async function allowed(request:Request){
 const expected=(env as any).OUTREACH_RUNNER_SECRET as string|undefined;
 const actual=request.headers.get('x-outreach-runner-key')??'';
 if(!expected||actual.length>256)return false;
 const encoder=new TextEncoder();const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(expected)),crypto.subtle.digest('SHA-256',encoder.encode(actual))]);
 let difference=0;const aa=new Uint8Array(a),bb=new Uint8Array(b);for(let i=0;i<aa.length;i++)difference|=aa[i]^bb[i];return difference===0;
}
export async function POST(request:Request){
 if(!await allowed(request))return Response.json({error:'Unauthorized runner'},{status:401});
 try{
  const raw=await request.text();if(raw.length>1000000)return Response.json({error:'Payload too large'},{status:413});
  const body=JSON.parse(raw);const db=workspaceDb();
  await ensureSlashyTables(db);
  const runner=await db.prepare('SELECT owner_id,snapshot FROM outreach_runner WHERE id = ?').bind('primary').first<{owner_id:string;snapshot:string}>();
  if(!runner)return Response.json({waitingForOwner:true});
  const owner=runner.owner_id;const now=new Date().toISOString();
  if(body.op==='crmClaim')return Response.json(await claimCrm(owner,JSON.parse(runner.snapshot||'{}').capabilities??{}));
  if(body.op==='crmComplete'){if(typeof body.id!=='string')return Response.json({error:'Invalid job'},{status:400});return Response.json(await completeCrm(owner,body.id,body.result));}
  if(body.op==='signalClaim')return Response.json(await claimSignalScan(owner));
  if(body.op==='signalComplete'){
   if(typeof body.id!=='string')return Response.json({error:'Invalid scan id'},{status:400});
   return Response.json(await completeSignalScan(owner,body.id,body.result));
  }
  if(body.op==='heartbeat'){
   if(!body.snapshot||typeof body.snapshot!=='object'||!Array.isArray(body.snapshot.records))return Response.json({error:'Invalid snapshot'},{status:400});
   await db.prepare('UPDATE outreach_runner SET snapshot = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(body.snapshot),now,'primary').run();
   return Response.json({ok:true});
  }
  if(body.op==='credentialGet'){
   await db.prepare("CREATE TABLE IF NOT EXISTS runner_claude_mode(owner_id TEXT PRIMARY KEY,mode TEXT NOT NULL DEFAULT 'api')").run();
   const selected=await db.prepare('SELECT mode FROM runner_claude_mode WHERE owner_id=?').bind(owner).first<{mode:string}>();
   await ensureCrustdata(db);
   const crustdata=await db.prepare('SELECT key_id,ciphertext,updated_at FROM runner_crustdata WHERE owner_id=?').bind(owner).first<any>();
   const credential=await db.prepare('SELECT key_id,ciphertext,updated_at FROM runner_credentials WHERE owner_id=?').bind(owner).first<{key_id:string;ciphertext:string;updated_at:string}>();
   const slashy=await db.prepare('SELECT key_id,ciphertext,client_id,updated_at FROM runner_slashy WHERE owner_id=?').bind(owner).first<{key_id:string;ciphertext:string;client_id:string;updated_at:string}>();
   await db.prepare('CREATE TABLE IF NOT EXISTS runner_resume(owner_id TEXT PRIMARY KEY,key_id TEXT NOT NULL,ciphertext TEXT NOT NULL,filename TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,updated_at TEXT NOT NULL)').run();
   const resume=await db.prepare('SELECT key_id,ciphertext,filename,mime_type,size,updated_at FROM runner_resume WHERE owner_id=?').bind(owner).first<any>();
   return Response.json({
    claudeMode:selected?.mode??'api',
    crustdata:crustdata?{keyId:crustdata.key_id,ciphertext:crustdata.ciphertext,updatedAt:crustdata.updated_at}:null,
    credential:credential?{keyId:credential.key_id,ciphertext:credential.ciphertext,updatedAt:credential.updated_at}:null,
    slashy:slashy?{keyId:slashy.key_id,ciphertext:slashy.ciphertext,clientId:slashy.client_id,updatedAt:slashy.updated_at}:null,
    resume:resume?{keyId:resume.key_id,ciphertext:resume.ciphertext,filename:resume.filename,mimeType:resume.mime_type,size:resume.size,updatedAt:resume.updated_at}:null,
   });
  }
  if(body.op==='resumePut'){
   if(typeof body.keyId!=='string'||typeof body.ciphertext!=='string'||body.ciphertext.length<200||body.ciphertext.length>16384||typeof body.filename!=='string'||body.filename.length>150||typeof body.mimeType!=='string'||!Number.isInteger(body.size)||body.size<1||body.size>500000)return Response.json({error:'Invalid resume update'},{status:400});
   let envelope:any;try{envelope=JSON.parse(body.ciphertext);}catch{return Response.json({error:'Invalid resume update'},{status:400});}
   if(envelope?.v!==1||envelope.alg!=='RSA-OAEP-256+A256GCM'||envelope.keyId!==body.keyId)return Response.json({error:'Invalid resume update'},{status:400});
   await db.prepare('CREATE TABLE IF NOT EXISTS runner_resume(owner_id TEXT PRIMARY KEY,key_id TEXT NOT NULL,ciphertext TEXT NOT NULL,filename TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,updated_at TEXT NOT NULL)').run();
   await db.prepare('INSERT INTO runner_resume(owner_id,key_id,ciphertext,filename,mime_type,size,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET key_id=excluded.key_id,ciphertext=excluded.ciphertext,filename=excluded.filename,mime_type=excluded.mime_type,size=excluded.size,updated_at=excluded.updated_at').bind(owner,body.keyId,body.ciphertext,body.filename,body.mimeType,body.size,now).run();
   return Response.json({ok:true,updatedAt:now});
  }
  if(body.op==='slashyPut'){
   if(typeof body.keyId!=='string'||typeof body.clientId!=='string'||typeof body.ciphertext!=='string'||body.ciphertext.length<200||body.ciphertext.length>16384||body.clientId.length<8||body.clientId.length>128){
    return Response.json({error:'Invalid Slashy token update'},{status:400});
   }
   let envelope:any;try{envelope=JSON.parse(body.ciphertext);}catch{return Response.json({error:'Invalid Slashy token update'},{status:400});}
   if(envelope?.v!==1||envelope.alg!=='RSA-OAEP-256+A256GCM'||envelope.keyId!==body.keyId)return Response.json({error:'Invalid Slashy token update'},{status:400});
   const now=new Date().toISOString();
   await db.prepare('INSERT INTO runner_slashy (owner_id,key_id,ciphertext,client_id,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET key_id=excluded.key_id,ciphertext=excluded.ciphertext,client_id=excluded.client_id,updated_at=excluded.updated_at').bind(owner,body.keyId,body.ciphertext,body.clientId,now).run();
   return Response.json({ok:true,updatedAt:now});
  }
  if(body.op==='claim'){
   const job=await db.prepare("UPDATE outreach_jobs SET status = 'running', updated_at = ? WHERE id = (SELECT id FROM outreach_jobs WHERE owner_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1) AND status = 'queued' RETURNING id,action,payload").bind(now,owner).first<{id:string;action:string;payload:string}>();
   return Response.json({job:job?{...job,payload:JSON.parse(job.payload)}:null});
  }
  if(body.op==='complete'){
   if(typeof body.id!=='string'||!['succeeded','review','failed'].includes(body.status))return Response.json({error:'Invalid completion'},{status:400});
   const existing=await db.prepare('SELECT action,payload FROM outreach_jobs WHERE id=? AND owner_id=?').bind(body.id,owner).first<{action:string;payload:string}>();
   await db.prepare("UPDATE outreach_jobs SET status = ?, result = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'running'").bind(body.status,JSON.stringify(body.result??{}),now,body.id,owner).run();
   if(existing?.action==='refer'){const payload=JSON.parse(existing.payload);if(typeof payload.referralId==='string')await markReferral(owner,payload.referralId,body.status==='succeeded'?'sent':'failed');}
   return Response.json({ok:true});
  }
  return Response.json({error:'Unknown operation'},{status:400});
 }catch(e){console.error('Runner request failed',e);return Response.json({error:'Runner request failed'},{status:503});}
}
