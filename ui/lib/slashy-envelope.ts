const ALG = 'RSA-OAEP-256+A256GCM';

function decodePem(pem: string) {
  const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  const binary = atob(encoded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function encodeBase64(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function encryptSlashyEnvelope(publicKeyPem: string, keyId: string, plaintext: string) {
  if (plaintext.length < 20 || plaintext.length > 8000) throw new Error('Slashy token payload is the wrong size');
  if (!/^[a-f0-9]{64}$/.test(keyId)) throw new Error('Runner key is invalid');
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const rawAes = await crypto.subtle.exportKey('raw', aesKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plaintext));
  const rsa = await crypto.subtle.importKey(
    'spki',
    decodePem(publicKeyPem),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsa, rawAes);
  return JSON.stringify({
    v: 1,
    alg: ALG,
    keyId,
    wrappedKey: encodeBase64(wrapped),
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(encrypted),
  });
}
