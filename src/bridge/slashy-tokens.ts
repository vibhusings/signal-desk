import type { SlashyTokenBundle } from './envelope.js';

const AS_WELL_KNOWN = 'https://slashy.ctrlcenter.ai/.well-known/oauth-authorization-server';
const RESOURCE = 'https://slashy.ctrlcenter.ai/mcp';

async function authorizationServer() {
  const response = await fetch(AS_WELL_KNOWN, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Slashy authorization server discovery failed (${response.status})`);
  const as = await response.json() as { token_endpoint?: string; revocation_endpoint?: string };
  if (typeof as.token_endpoint !== 'string' || !as.token_endpoint.startsWith('https://')) throw new Error('Slashy token URL is missing');
  return {
    token_endpoint: as.token_endpoint,
    revocation_endpoint: typeof as.revocation_endpoint === 'string' && as.revocation_endpoint.startsWith('https://') ? as.revocation_endpoint : undefined,
  };
}

export async function refreshSlashyTokens(tokens: SlashyTokenBundle): Promise<SlashyTokenBundle> {
  const as = await authorizationServer();
  const response = await fetch(as.token_endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: tokens.client_id,
      resource: RESOURCE,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error('Slashy session expired. Connect Slashy again in Settings.');
  if (typeof body.access_token !== 'string' || body.access_token.length < 20) throw new Error('Slashy did not return an access token');
  const expiresIn = Number(body.expires_in);
  return {
    access_token: body.access_token,
    refresh_token: typeof body.refresh_token === 'string' && body.refresh_token.length >= 20 ? body.refresh_token : tokens.refresh_token,
    expires_at: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600 * 1000),
    token_type: typeof body.token_type === 'string' ? body.token_type : 'Bearer',
    scope: typeof body.scope === 'string' ? body.scope : tokens.scope,
    client_id: tokens.client_id,
  };
}

export async function revokeSlashyTokens(tokens: SlashyTokenBundle) {
  try {
    const as = await authorizationServer();
    if (typeof as.revocation_endpoint !== 'string' || !as.revocation_endpoint.startsWith('https://')) return;
    await fetch(as.revocation_endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: tokens.refresh_token,
        token_type_hint: 'refresh_token',
        client_id: tokens.client_id,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {}
}
