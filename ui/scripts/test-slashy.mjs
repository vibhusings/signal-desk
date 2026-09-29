import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sqlite = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`drizzle/${file}`, 'utf8'));
const db = {
  prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async run() { return sqlite.prepare(sql).run(...args); },
    };
  },
};

const tokens = {
  access_token: 'access-token-material-that-is-long-enough',
  refresh_token: 'refresh-token-material-that-is-long-enough',
  expires_at: Date.now() + 3600_000,
  token_type: 'Bearer',
  scope: 'slashy.full_access',
  client_id: 'dyn_test_client',
};
const ciphertext = JSON.stringify({
  v: 1,
  alg: 'RSA-OAEP-256+A256GCM',
  keyId: 'a'.repeat(64),
  wrappedKey: Buffer.alloc(64, 3).toString('base64'),
  iv: Buffer.alloc(12, 4).toString('base64'),
  ciphertext: Buffer.alloc(80, 5).toString('base64'),
});

function load(path, extras = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name === '@/db/workspace') return { workspaceDb: () => db };
    if (name === '@/lib/pilot-auth') return { PILOT_OWNER_ID: 'signal-desk-pilot', workspaceOwner: async request => request.headers.get('oai-authenticated-user-id') };
    if (name === '@/lib/slashy-envelope') return { encryptSlashyEnvelope: async () => ciphertext };
    if (name === '@/lib/slashy-oauth') return extras.oauth ?? {};
    if (name === '@/lib/slashy-tables') return { ensureSlashyTables: async () => {} };
    return require(name);
  }, exports);
  return exports;
}

const owner = 'tester';
const keyId = 'a'.repeat(64);
const now = new Date().toISOString();
sqlite.prepare('INSERT INTO outreach_runner VALUES (?,?,?,?)').run('primary', owner, JSON.stringify({
  credentialKey: { algorithm: 'RSA-OAEP-256', keyId, publicKey: 'PUBLIC' },
  policy: { sender: 'owner@example.com', senderName: 'Alex Rivera' },
  slashy: { connected: false },
}), now);

const status = load('app/api/slashy/route.ts');
const request = (path, method, headers = {}) => new Request(`https://signal.test${path}`, {
  method,
  headers: { origin: 'https://signal.test', 'oai-authenticated-user-id': owner, ...headers },
});
assert.equal((await status.GET(request('/api/slashy', 'GET'))).status, 200);
const listed = await (await status.GET(request('/api/slashy', 'GET'))).json();
assert.equal(listed.configured, false);
assert.equal(listed.expectedInbox, 'owner@example.com');

const as = {
  authorization_endpoint: 'https://slashy.test/oauth/authorize',
  token_endpoint: 'https://slashy.test/oauth/token',
  registration_endpoint: 'https://slashy.test/oauth/register',
};
const connect = load('app/api/slashy/connect/route.ts', {
  oauth: {
    slashyAuthorizationServer: async () => as,
    registerSlashyClient: async () => 'dyn_test_client',
    createPkce: () => ({ verifier: 'v'.repeat(43), state: 'state-value-from-pkce' }),
    pkceChallenge: async () => 'challenge',
    authorizeUrl: () => 'https://slashy.test/oauth/authorize?state=state-value-from-pkce',
  },
});
const started = await connect.GET(request('/api/slashy/connect', 'GET'));
assert.equal(started.status, 302);
assert.equal(sqlite.prepare('SELECT owner_id FROM slashy_oauth_pending WHERE state=?').get('state-value-from-pkce').owner_id, owner);

const callback = load('app/api/slashy/callback/route.ts', {
  oauth: {
    slashyAuthorizationServer: async () => as,
    exchangeSlashyCode: async () => tokens,
    callbackRedirect: (origin, result) => `${origin}/?slashy=${result}`,
  },
});
const finished = await callback.GET(new Request('https://signal.test/api/slashy/callback?code=authcodevalue&state=state-value-from-pkce'));
assert.equal(finished.status, 302);
assert.equal(new URL(finished.headers.get('location')).searchParams.get('slashy'), 'connected');
const stored = sqlite.prepare('SELECT * FROM runner_slashy').get();
assert.equal(stored.ciphertext, ciphertext);
assert.ok(!JSON.stringify(stored).includes(tokens.access_token));
assert.ok(!JSON.stringify(stored).includes(tokens.refresh_token));
assert.equal(sqlite.prepare('SELECT count(*) n FROM slashy_oauth_pending').get().n, 0);

assert.equal((await status.DELETE(request('/api/slashy', 'DELETE'))).status, 200);
assert.equal(sqlite.prepare('SELECT count(*) n FROM runner_slashy').get().n, 0);
sqlite.close();
console.log('Slashy OAuth API stores only runner-encrypted tokens and supports disconnect.');
