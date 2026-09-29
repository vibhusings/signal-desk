import { workspaceDb } from '@/db/workspace';
import { ensureCrm, saveCrmSource } from '@/lib/crm-store';
import { sourceSchema } from '@/lib/crm-schema';

// Attio Workflow: Call recording created -> Send HTTP request.
// Delivery credentials identify the workspace; never trust an owner in the body.
export async function POST(request: Request) {
 const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
 if (token.length !== 72) return Response.json({error:'Unauthorized'}, {status:401});
 await ensureCrm();
 const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const owner = await workspaceDb().prepare('SELECT owner_id FROM crm_settings WHERE webhook_hash=?').bind(hash).first<{owner_id:string}>();
 if (!owner) return Response.json({error:'Unauthorized'}, {status:401});
 let source;
 try {
  const raw = await request.text();
  if (raw.length > 150000) return Response.json({error:'Too large'}, {status:413});
  const b = JSON.parse(raw);
  if (typeof b.id !== 'string' || !b.id.trim()) throw Error('Missing recording ID');
  source = sourceSchema.parse({id:'attio:'+b.id,kind:'attio',title:b.title,occurredAt:b.occurredAt,participants:b.participants,text:b.text,direction:'meeting',url:b.url??''});
 } catch {
  return Response.json({error:'Invalid meeting: require stable recording id, title, occurredAt (ISO date), participants [{email,name}], text, optional https url.'}, {status:400});
 }
 try {
  await saveCrmSource(owner.owner_id, source);
  return Response.json({ok:true});
 } catch {
  return Response.json({error:'Meeting storage unavailable; retry delivery.'}, {status:503});
 }
}
