import { constants, createCipheriv, createDecipheriv, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';

export type SlashyEnvelope = {
  v: 1;
  alg: 'RSA-OAEP-256+A256GCM';
  keyId: string;
  wrappedKey: string;
  iv: string;
  ciphertext: string;
};

export type SlashyTokenBundle = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
  scope: string;
  client_id: string;
};

const ALG = 'RSA-OAEP-256+A256GCM';

export function isSlashyEnvelope(value: unknown): value is SlashyEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as SlashyEnvelope;
  return envelope.v === 1
    && envelope.alg === ALG
    && typeof envelope.keyId === 'string'
    && /^[a-f0-9]{64}$/.test(envelope.keyId)
    && typeof envelope.wrappedKey === 'string'
    && typeof envelope.iv === 'string'
    && typeof envelope.ciphertext === 'string'
    && /^[A-Za-z0-9+/]+={0,2}$/.test(envelope.wrappedKey)
    && /^[A-Za-z0-9+/]+={0,2}$/.test(envelope.iv)
    && /^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext);
}

export function parseSlashyEnvelope(raw: string) {
  if (raw.length < 200 || raw.length > 16384) throw new Error('Encrypted Slashy tokens are invalid');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Encrypted Slashy tokens are invalid'); }
  if (!isSlashyEnvelope(parsed)) throw new Error('Encrypted Slashy tokens are invalid');
  return parsed;
}

export function encryptEnvelope(publicKey: string, keyId: string, plaintext: string) {
  if (plaintext.length < 20 || plaintext.length > 8000) throw new Error('Slashy token payload is the wrong size');
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const wrappedKey = publicEncrypt({
    key: publicKey,
    oaepHash: 'sha256',
  }, aesKey).toString('base64');
  const envelope: SlashyEnvelope = {
    v: 1,
    alg: ALG,
    keyId,
    wrappedKey,
    iv: iv.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
  return JSON.stringify(envelope);
}

export function decryptEnvelope(privateKey: string, raw: string) {
  const envelope = parseSlashyEnvelope(raw);
  return decryptEnvelopeBytes(privateKey, envelope).toString('utf8');
}

function decryptEnvelopeBytes(privateKey: string, envelope: SlashyEnvelope) {
  const aesKey = privateDecrypt({
    key: privateKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, Buffer.from(envelope.wrappedKey, 'base64'));
  const blob = Buffer.from(envelope.ciphertext, 'base64');
  if (blob.length < 17) throw new Error('Encrypted Slashy tokens are invalid');
  const data = blob.subarray(0, blob.length - 16);
  const tag = blob.subarray(blob.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Resume files use the same envelope but allow a larger binary payload. */
export function decryptFileEnvelope(privateKey: string, raw: string, maxBytes = 500_000) {
  if (raw.length < 200 || raw.length > Math.ceil(maxBytes * 4 / 3) + 4096) throw new Error('Encrypted file is invalid');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Encrypted file is invalid'); }
  if (!isSlashyEnvelope(parsed)) throw new Error('Encrypted file is invalid');
  const bytes = decryptEnvelopeBytes(privateKey, parsed);
  if (!bytes.length || bytes.length > maxBytes) throw new Error('Encrypted file is invalid');
  return bytes;
}

export function parseSlashyTokens(plaintext: string): SlashyTokenBundle {
  let parsed: any;
  try { parsed = JSON.parse(plaintext); } catch { throw new Error('Decrypted Slashy tokens have an invalid format'); }
  if (typeof parsed?.access_token !== 'string' || parsed.access_token.length < 20 || parsed.access_token.length > 4096) {
    throw new Error('Decrypted Slashy tokens have an invalid format');
  }
  if (typeof parsed?.refresh_token !== 'string' || parsed.refresh_token.length < 20 || parsed.refresh_token.length > 4096) {
    throw new Error('Decrypted Slashy tokens have an invalid format');
  }
  if (!Number.isFinite(parsed.expires_at) || parsed.expires_at < 0) {
    throw new Error('Decrypted Slashy tokens have an invalid format');
  }
  if (typeof parsed.client_id !== 'string' || parsed.client_id.length < 8 || parsed.client_id.length > 128) {
    throw new Error('Decrypted Slashy tokens have an invalid format');
  }
  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    expires_at: Number(parsed.expires_at),
    token_type: typeof parsed.token_type === 'string' ? parsed.token_type : 'Bearer',
    scope: typeof parsed.scope === 'string' ? parsed.scope : 'slashy.full_access',
    client_id: parsed.client_id,
  };
}

export function decryptSlashyTokens(privateKey: string, raw: string) {
  return parseSlashyTokens(decryptEnvelope(privateKey, raw));
}

export function encryptSlashyTokens(publicKey: string, keyId: string, tokens: SlashyTokenBundle) {
  return encryptEnvelope(publicKey, keyId, JSON.stringify(tokens));
}
