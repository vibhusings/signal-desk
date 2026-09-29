import { workspaceDb } from '@/db/workspace';
import { PILOT_OWNER_ID, workspaceOwner } from '@/lib/pilot-auth';
import { ensureSlashyTables } from '@/lib/slashy-tables';

export const dynamic = 'force-dynamic';

async function context(request: Request) {
  const owner = await workspaceOwner(request);
  if (!owner) throw new Error('AUTH');
  const db = workspaceDb();
  await ensureSlashyTables(db);
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
  if (message === 'AUTH') return Response.json({ error: 'Enter the pilot access code to connect Slashy.' }, { status: 401 });
  if (message === 'OWNER') return Response.json({ error: 'This runner belongs to another workspace.' }, { status: 403 });
  console.error('Slashy credential request failed', error);
  return Response.json({ error: 'Slashy configuration is unavailable. Please retry.' }, { status: 503 });
}

export async function GET(request: Request) {
  try {
    const { owner, db, runner } = await context(request);
    const stored = await db.prepare('SELECT updated_at FROM runner_slashy WHERE owner_id=?').bind(owner).first<{updated_at:string}>();
    const snapshot = JSON.parse(runner.snapshot || '{}');
    return Response.json({
      configured: !!stored,
      active: !!stored && snapshot.slashy?.connected === true,
      runnerError: snapshot.slashy?.error ?? null,
      updatedAt: stored?.updated_at ?? null,
      expectedInbox: snapshot.policy?.sender ?? null,
      senderName: snapshot.policy?.senderName ?? null,
      runnerOnline: !!runner.updated_at && Date.now() - Date.parse(runner.updated_at) < 90000,
      exchangeReady: snapshot.credentialKey?.algorithm === 'RSA-OAEP-256',
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Invalid request origin' }, { status: 403 });
    const { owner, db } = await context(request);
    await db.prepare('DELETE FROM runner_slashy WHERE owner_id=?').bind(owner).run();
    return Response.json({ configured: false });
  } catch (error) {
    return failure(error);
  }
}
