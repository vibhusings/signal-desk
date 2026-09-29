import { workspaceDb } from '@/db/workspace';
import { PILOT_OWNER_ID, workspaceOwner } from '@/lib/pilot-auth';
import { ensureSlashyTables } from '@/lib/slashy-tables';
import {
  authorizeUrl,
  createPkce,
  pkceChallenge,
  registerSlashyClient,
  slashyAuthorizationServer,
} from '@/lib/slashy-oauth';

export const dynamic = 'force-dynamic';

function htmlError(message: string, status = 503) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>Slashy</title><p>${message}</p>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request) {
  const owner = await workspaceOwner(request);
  if (!owner) return htmlError('Enter the pilot access code before connecting Slashy.', 401);
  const db = workspaceDb();
  await ensureSlashyTables(db);
  await db.prepare('INSERT INTO outreach_runner (id,owner_id,snapshot,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING').bind('primary', owner, '{}', '').run();
  if (owner === PILOT_OWNER_ID) await db.prepare('UPDATE outreach_runner SET owner_id=? WHERE id=?').bind(owner, 'primary').run();
  const runner = await db.prepare('SELECT owner_id,snapshot,updated_at FROM outreach_runner WHERE id=?').bind('primary').first<{owner_id:string;snapshot:string;updated_at:string}>();
  if (!runner || runner.owner_id !== owner) return htmlError('This runner belongs to another workspace.', 403);
  if (!runner.updated_at || Date.now() - Date.parse(runner.updated_at) > 90000) {
    return htmlError('The cloud runner must be online before connecting Slashy.', 409);
  }
  const exchange = JSON.parse(runner.snapshot || '{}').credentialKey;
  if (!exchange || exchange.algorithm !== 'RSA-OAEP-256' || typeof exchange.publicKey !== 'string') {
    return htmlError('The cloud runner is not ready to receive a Slashy connection.', 409);
  }

  try {
    const redirectUri = new URL('/api/slashy/callback', request.url).toString();
    const as = await slashyAuthorizationServer();
    const existing = await db.prepare('SELECT client_id,redirect_uri FROM slashy_oauth_client WHERE id=?').bind('primary').first<{client_id:string;redirect_uri:string}>();
    let clientId = existing?.client_id;
    if (!clientId || existing?.redirect_uri !== redirectUri) {
      clientId = await registerSlashyClient(as, redirectUri);
      const now = new Date().toISOString();
      await db.prepare('INSERT INTO slashy_oauth_client (id,client_id,redirect_uri,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id,redirect_uri=excluded.redirect_uri,updated_at=excluded.updated_at').bind('primary', clientId, redirectUri, now).run();
    }
    const pkce = createPkce();
    const challenge = await pkceChallenge(pkce.verifier);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.prepare('DELETE FROM slashy_oauth_pending WHERE expires_at < ?').bind(new Date().toISOString()).run();
    await db.prepare('INSERT INTO slashy_oauth_pending (state,owner_id,code_verifier,redirect_uri,expires_at) VALUES (?,?,?,?,?)').bind(pkce.state, owner, pkce.verifier, redirectUri, expiresAt).run();
    return Response.redirect(authorizeUrl(as, {
      clientId,
      redirectUri,
      state: pkce.state,
      challenge,
    }), 302);
  } catch (error) {
    console.error('Slashy connect failed', error);
    return htmlError('Slashy sign-in is unavailable. Please retry.');
  }
}
