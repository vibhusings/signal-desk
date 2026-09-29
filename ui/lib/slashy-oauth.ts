export const SLASHY_MCP_URL = 'https://slashy.ctrlcenter.ai/mcp';
export const SLASHY_RESOURCE_METADATA = 'https://slashy.ctrlcenter.ai/.well-known/oauth-protected-resource';
export const SLASHY_SCOPE = 'slashy.full_access';

export type SlashyAuthorizationServer = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint?: string;
};

function randomUrl(bytes: number) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function createPkce() {
  const verifier = randomUrl(32);
  return { verifier, state: randomUrl(24) };
}

export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function readJson(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  return response.json() as Promise<any>;
}

export async function slashyAuthorizationServer(): Promise<SlashyAuthorizationServer> {
  const resource = await readJson(await fetch(SLASHY_RESOURCE_METADATA, { redirect: 'follow', signal: AbortSignal.timeout(15000) }), 'Slashy resource discovery');
  const issuer = Array.isArray(resource.authorization_servers) ? resource.authorization_servers[0] : null;
  if (typeof issuer !== 'string' || !issuer.startsWith('https://')) throw new Error('Slashy authorization server is missing');
  const wellKnown = issuer.endsWith('/')
    ? `${issuer}.well-known/oauth-authorization-server`
    : `${issuer}/.well-known/oauth-authorization-server`;
  const as = await readJson(await fetch(wellKnown, { redirect: 'follow', signal: AbortSignal.timeout(15000) }), 'Slashy authorization server discovery');
  if (typeof as.authorization_endpoint !== 'string' || !as.authorization_endpoint.startsWith('https://')) throw new Error('Slashy authorize URL is missing');
  if (typeof as.token_endpoint !== 'string' || !as.token_endpoint.startsWith('https://')) throw new Error('Slashy token URL is missing');
  if (typeof as.registration_endpoint !== 'string' || !as.registration_endpoint.startsWith('https://')) throw new Error('Slashy registration URL is missing');
  return {
    authorization_endpoint: as.authorization_endpoint,
    token_endpoint: as.token_endpoint,
    registration_endpoint: as.registration_endpoint,
    revocation_endpoint: typeof as.revocation_endpoint === 'string' && as.revocation_endpoint.startsWith('https://') ? as.revocation_endpoint : undefined,
  };
}

export async function registerSlashyClient(as: SlashyAuthorizationServer, redirectUri: string) {
  const registered = await readJson(await fetch(as.registration_endpoint, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Signal Desk',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: SLASHY_SCOPE,
    }),
    signal: AbortSignal.timeout(15000),
  }), 'Slashy client registration');
  if (typeof registered.client_id !== 'string' || registered.client_id.length < 8 || registered.client_id.length > 128) {
    throw new Error('Slashy did not return a client id');
  }
  return registered.client_id as string;
}

export function authorizeUrl(as: SlashyAuthorizationServer, input: { clientId: string; redirectUri: string; state: string; challenge: string }) {
  const url = new URL(as.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', SLASHY_SCOPE);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', SLASHY_MCP_URL);
  return url.toString();
}

export async function exchangeSlashyCode(as: SlashyAuthorizationServer, input: { clientId: string; redirectUri: string; code: string; verifier: string }) {
  const response = await fetch(as.token_endpoint, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.verifier,
      resource: SLASHY_MCP_URL,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error('Slashy could not complete sign-in');
  if (typeof body.access_token !== 'string' || body.access_token.length < 20 || body.access_token.length > 4096) {
    throw new Error('Slashy did not return an access token');
  }
  if (typeof body.refresh_token !== 'string' || body.refresh_token.length < 20 || body.refresh_token.length > 4096) {
    throw new Error('Slashy did not return a refresh token');
  }
  const expiresIn = Number(body.expires_in);
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600 * 1000),
    token_type: typeof body.token_type === 'string' ? body.token_type : 'Bearer',
    scope: typeof body.scope === 'string' ? body.scope : SLASHY_SCOPE,
    client_id: input.clientId,
  };
}

export function callbackRedirect(origin: string, result: 'connected' | 'denied' | 'error') {
  return `${origin}/?slashy=${result}`;
}
