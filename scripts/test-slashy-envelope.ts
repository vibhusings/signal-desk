import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptFileEnvelope, decryptSlashyTokens, encryptSlashyTokens, parseSlashyEnvelope } from '../src/bridge/envelope.js';
import { encryptSlashyEnvelope } from '../ui/lib/slashy-envelope.js';
import { encryptResumeEnvelope } from '../ui/lib/resume-envelope.js';
import { ensureCredentialKey } from '../src/bridge/byok.js';

const directory = mkdtempSync(join(tmpdir(), 'signal-desk-slashy-envelope-'));
try {
  const key = ensureCredentialKey(directory);
  const tokens = {
    access_token: 'access-token-material-that-is-long-enough',
    refresh_token: 'refresh-token-material-that-is-long-enough',
    expires_at: Date.now() + 3600_000,
    token_type: 'Bearer',
    scope: 'slashy.full_access',
    client_id: 'dyn_test_client',
  };
  const nodeCipher = encryptSlashyTokens(key.publicKey, key.keyId, tokens);
  assert.equal(parseSlashyEnvelope(nodeCipher).keyId, key.keyId);
  assert.deepEqual(decryptSlashyTokens(key.privateKey, nodeCipher), tokens);

  const webCipher = await encryptSlashyEnvelope(key.publicKey, key.keyId, JSON.stringify(tokens));
  assert.deepEqual(decryptSlashyTokens(key.privateKey, webCipher), tokens);
  assert.ok(!webCipher.includes(tokens.access_token));
  assert.ok(!nodeCipher.includes(tokens.refresh_token));
  const resume=Uint8Array.from([37,80,68,70,45,49,46,55,10,0,255,42]);
  const resumeCipher=await encryptResumeEnvelope(key.publicKey,key.keyId,resume);
  assert.deepEqual(decryptFileEnvelope(key.privateKey,resumeCipher),Buffer.from(resume));
  console.log('Slashy hybrid envelope: Node and Web Crypto encrypt; runner decrypts both.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
