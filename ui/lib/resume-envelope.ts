const ALG = 'RSA-OAEP-256+A256GCM';
export const MAX_RESUME_BYTES = 500_000;

function decodePem(pem: string) {
  const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  return Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
}

function encodeBase64(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < view.length; offset += 8192) {
    binary += String.fromCharCode(...view.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export async function encryptResumeEnvelope(publicKeyPem: string, keyId: string, bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_RESUME_BYTES) throw new Error('Resume must be 500 KB or smaller.');
  if (!/^[a-f0-9]{64}$/.test(keyId)) throw new Error('Runner key is invalid');
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const rawAes = await crypto.subtle.exportKey('raw', aesKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, bytes as BufferSource);
  const rsa = await crypto.subtle.importKey('spki', decodePem(publicKeyPem), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsa, rawAes);
  return JSON.stringify({v:1,alg:ALG,keyId,wrappedKey:encodeBase64(wrapped),iv:encodeBase64(iv),ciphertext:encodeBase64(encrypted)});
}
