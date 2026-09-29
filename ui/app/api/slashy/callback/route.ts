import { workspaceDb } from '@/db/workspace';
import { encryptSlashyEnvelope } from '@/lib/slashy-envelope';
import { callbackRedirect, exchangeSlashyCode, slashyAuthorizationServer } from '@/lib/slashy-oauth';
import { ensureSlashyTables } from '@/lib/slashy-tables';

export const dynamic = 'force-dynamic';

function redirectHome(request: Request, result: 'connected' | 'denied' | 'error') {
  return Response.redirect(callbackRedirect(new URL(request.url).origin, result), 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  if (error === 'access_denied') return redirectHome(request, 'denied');
  if (error || !code || code.length > 2048 || !/^[A-Za-z0-9._~-]+$/.test(code) || !/^[A-Za-z0-9_-]{16,128}$/.test(state)) {
    return redirectHome(request, 'error');
  }

  const db = workspaceDb();
  await ensureSlashyTables(db);
  const pending = await db.prepare('SELECT owner_id,code_verifier,redirect_uri,expires_at FROM slashy_oauth_pending WHERE state=?').bind(state).first<{owner_id:string;code_verifier:string;redirect_uri:string;expires_at:string}>();
  await db.prepare('DELETE FROM slashy_oauth_pending WHERE state=?').bind(state).run();
  if (!pending || Date.parse(pending.expires_at) <= Date.now()) return redirectHome(request, 'error');
  const expectedRedirect = new URL('/api/slashy/callback', request.url).toString();
  if (pending.redirect_uri !== expectedRedirect) return redirectHome(request, 'error');

  const runner = await db.prepare('SELECT owner_id,snapshot FROM outreach_runner WHERE id=?').bind('primary').first<{owner_id:string;snapshot:string}>();
  if (!runner || runner.owner_id !== pending.owner_id) return redirectHome(request, 'error');
  const exchange = JSON.parse(runner.snapshot || '{}').credentialKey;
  if (!exchange || exchange.algorithm !== 'RSA-OAEP-256' || typeof exchange.keyId !== 'string' || typeof exchange.publicKey !== 'string') {
    return redirectHome(request, 'error');
  }

  const client = await db.prepare('SELECT client_id FROM slashy_oauth_client WHERE id=?').bind('primary').first<{client_id:string}>();
  if (!client?.client_id) return redirectHome(request, 'error');

  try {
    const as = await slashyAuthorizationServer();
    const tokens = await exchangeSlashyCode(as, {
      clientId: client.client_id,
      redirectUri: pending.redirect_uri,
      code,
      verifier: pending.code_verifier,
    });
    const ciphertext = await encryptSlashyEnvelope(exchange.publicKey, exchange.keyId, JSON.stringify(tokens));
    const now = new Date().toISOString();
    await db.prepare('INSERT INTO runner_slashy (owner_id,key_id,ciphertext,client_id,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET key_id=excluded.key_id,ciphertext=excluded.ciphertext,client_id=excluded.client_id,updated_at=excluded.updated_at').bind(pending.owner_id, exchange.keyId, ciphertext, client.client_id, now).run();
    return redirectHome(request, 'connected');
  } catch (failure) {
    console.error('Slashy callback failed', failure);
    return redirectHome(request, 'error');
  }
}
