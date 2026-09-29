import { ensureCrustdata } from '@/lib/crustdata-store';
import { workspaceDb } from '@/db/workspace';
import { PILOT_OWNER_ID, workspaceOwner } from '@/lib/pilot-auth';

export const dynamic = 'force-dynamic';

async function context(request: Request) {
  const owner = await workspaceOwner(request);
  if (!owner) throw new Error('AUTH');
  const db = workspaceDb();
  await ensureCrustdata(db);
  await db.prepare('INSERT INTO outreach_runner (id,owner_id,snapshot,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING').bind('primary', owner, '{}', '').run();
  if (owner === PILOT_OWNER_ID) {
    await db.prepare('UPDATE outreach_runner SET owner_id=? WHERE id=?').bind(owner, 'primary').run();
  }
  const runner = await db.prepare('SELECT owner_id,snapshot,updated_at FROM outreach_runner WHERE id=?').bind('primary').first<{owner_id:string;snapshot:string;updated_at:string}>();
  if (!runner || runner.owner_id !== owner) throw new Error('OWNER');
  return { owner, db, runner };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'AUTH') return Response.json({ error: 'Enter the pilot access code to configure Crustdata.' }, { status: 401 });
  if (message === 'OWNER') return Response.json({ error: 'This runner belongs to another workspace.' }, { status: 403 });
  console.error('Credential request failed', error);
  return Response.json({ error: 'Crustdata key configuration is unavailable. Please retry.' }, { status: 503 });
}

export async function GET(request: Request) {
  try {
    const { owner, db, runner } = await context(request);
    const credential = await db.prepare('SELECT key_id,updated_at FROM runner_crustdata WHERE owner_id=?').bind(owner).first<{key_id:string;updated_at:string}>();
    const snapshot = JSON.parse(runner.snapshot || '{}');
    return Response.json({
      configured: !!credential,
      active: !!credential && credential.key_id === snapshot.credentialKey?.keyId && snapshot.crustdata?.configured === true && snapshot.crustdata?.updatedAt === credential.updated_at,
      runnerError: snapshot.crustdata?.error ?? null,
      updatedAt: credential?.updated_at ?? null,
      keyId: credential?.key_id ?? null,
      exchange: snapshot.credentialKey ?? null,
      runnerOnline: !!runner.updated_at && Date.now() - Date.parse(runner.updated_at) < 90000,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Invalid request origin' }, { status: 403 });
    if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: 'Expected JSON' }, { status: 415 });
    const raw = await request.text();
    if (raw.length > 20000) return Response.json({ error: 'Request too large' }, { status: 413 });
    let body: { keyId?:unknown; ciphertext?:unknown };
    try { body = JSON.parse(raw); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { owner, db, runner } = await context(request);
    const exchange = JSON.parse(runner.snapshot || '{}').credentialKey;
    if (!exchange || exchange.algorithm !== 'RSA-OAEP-256' || typeof exchange.keyId !== 'string') {
      return Response.json({ error: 'The cloud runner is not ready to receive a Crustdata key.' }, { status: 409 });
    }
    let envelope:any;
    try { envelope=JSON.parse(String(body.ciphertext)); } catch { return Response.json({error:'Invalid encrypted key.'},{status:400}); }
    if(!envelope || body.keyId!==exchange.keyId || typeof body.ciphertext!=='string' || body.ciphertext.length>16384 || envelope.keyId!==exchange.keyId || envelope.v!==1 || envelope.alg!=='RSA-OAEP-256+A256GCM' || ![envelope.wrappedKey,envelope.iv,envelope.ciphertext].every(v=>typeof v==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(v))){
      return Response.json({error:'Invalid encrypted key.'},{status:400});
    }
    const now = new Date().toISOString();
    await db.prepare('INSERT INTO runner_crustdata (owner_id,key_id,ciphertext,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET key_id=excluded.key_id,ciphertext=excluded.ciphertext,updated_at=excluded.updated_at').bind(owner, body.keyId, body.ciphertext, now).run();
    return Response.json({ configured: true, updatedAt: now });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Invalid request origin' }, { status: 403 });
    const { owner, db } = await context(request);
    await db.prepare('DELETE FROM runner_crustdata WHERE owner_id=?').bind(owner).run();
    return Response.json({ configured: false });
  } catch (error) {
    return failure(error);
  }
}
