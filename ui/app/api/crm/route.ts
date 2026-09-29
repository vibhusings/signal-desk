import { workspaceOwner } from '@/lib/pilot-auth';
import { workspaceDb } from '@/db/workspace';
import { ensureCrm,crmView,enqueueCrm,saveCrmSource,queueReferral } from '@/lib/crm-store';
import { settingsSchema } from '@/lib/crm-schema';
export async function GET(request:Request){
 const owner=await workspaceOwner(request);if(!owner)return Response.json({error:'Sign in to open CRM.'},{status:401});
 try{await ensureCrm();const runner=await workspaceDb().prepare('SELECT snapshot,updated_at FROM outreach_runner WHERE owner_id=? AND id=?').bind(owner,'primary').first<any>();const snapshot=JSON.parse(runner?.snapshot??'{}');const connections={online:!!runner?.updated_at&&Date.now()-Date.parse(runner.updated_at)<90000,claude:snapshot.capabilities?.claude===true,slashy:snapshot.capabilities?.slashy===true,attio:snapshot.capabilities?.crmAttio===true};return Response.json({...await crmView(owner),configuredInbox:snapshot.policy?.sender??'',senderName:snapshot.policy?.senderName??snapshot.investmentPolicy?.senderName??'',connections},{headers:{'Cache-Control':'private, no-store'}});}catch{return Response.json({error:'CRM unavailable'},{status:503});}
}
export async function POST(request:Request){
 const owner=await workspaceOwner(request);if(!owner)return Response.json({error:'Sign in to use CRM.'},{status:401});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});
 try{const raw=await request.text();if(raw.length>150000)return Response.json({error:'Input too large'},{status:413});const b=JSON.parse(raw);await ensureCrm();const db=workspaceDb();
 if(b.action==='settings'){
 const s=settingsSchema.parse(b.settings);
 const runner=await db.prepare('SELECT owner_id,snapshot FROM outreach_runner WHERE id=?').bind('primary').first<any>();
 if(!runner||runner.owner_id!==owner||JSON.parse(runner.snapshot).policy?.sender?.toLowerCase()!==s.inbox)throw Error('Choose the inbox configured for your runner.');
 if(s.attioEnabled&&!JSON.parse(runner.snapshot).capabilities?.crmAttio)throw Error('Connect a dedicated CRM Attio workspace on the runner first.');
 await db.prepare('INSERT INTO crm_settings(owner_id,data) VALUES(?,?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data').bind(owner,JSON.stringify(s)).run();
 }else if(b.action==='scan'||b.action==='sync'){
 const settings=await db.prepare('SELECT data FROM crm_settings WHERE owner_id=?').bind(owner).first<any>();if(!settings)throw Error('Save inbox settings first.');
 await enqueueCrm(owner,b.action==='scan'?'inbox':'attio',b.action==='scan'?JSON.parse(settings.data):{});
 }else if(b.action==='retry'){
 if(typeof b.id!=='string')throw Error('Invalid job');
 await db.prepare("UPDATE crm_jobs SET status='queued',result=NULL WHERE owner_id=? AND id=? AND status='failed'").bind(owner,b.id).run();
 }else if(b.action==='import'){if(b.source?.kind==='email')throw Error('Email evidence must come from the runner.');const source={...b.source,id:typeof b.source.id==='string'&&b.source.id.startsWith(`${b.source.kind}:`)?b.source.id:`${b.source.kind}:${b.source.id}`};await saveCrmSource(owner,source);
 }else if(b.action==='refer'){
  if(typeof b.dealId!=='string')throw Error('Unknown deal');
  return Response.json(await queueReferral(owner,b.dealId));
 }else if(b.action==='relationship'){
 if(typeof b.email!=='string'||!/^\S+@\S+\.\S+$/.test(b.email)||!['Contact','VC friend'].includes(b.relationship))throw Error('Invalid relationship');
 await db.prepare('INSERT INTO crm_contacts(owner_id,email,relationship) VALUES(?,?,?) ON CONFLICT(owner_id,email) DO UPDATE SET relationship=excluded.relationship').bind(owner,b.email.toLowerCase(),b.relationship).run();
 }else if(b.action==='webhook'){
 const token=crypto.randomUUID()+crypto.randomUUID();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const settings=await db.prepare('SELECT owner_id FROM crm_settings WHERE owner_id=?').bind(owner).first();if(!settings)throw Error('Save settings first.');
 await db.prepare('UPDATE crm_settings SET webhook_hash=? WHERE owner_id=?').bind(hash,owner).run();return Response.json({token},{headers:{'Cache-Control':'no-store'}});
 }else throw Error('Unknown action');return Response.json({ok:true});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'CRM request failed'},{status:400});}
}
