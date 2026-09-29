import { chmodSync,existsSync,readFileSync,renameSync,writeFileSync } from 'node:fs';
import { constants,createHash,createPublicKey,generateKeyPairSync,privateDecrypt } from 'node:crypto';
import { resolve } from 'node:path';

export type CredentialKey = {
  privateKey: string;
  publicKey: string;
  keyId: string;
};

export function ensureCredentialKey(directory: string): CredentialKey {
  const privateKeyPath = resolve(directory, 'byok-private.pem');
  if (!existsSync(privateKeyPath)) {
    const generated = generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    writeFileSync(privateKeyPath + '.tmp', generated.privateKey, { mode: 0o600 });
    renameSync(privateKeyPath + '.tmp', privateKeyPath);
  }
  chmodSync(privateKeyPath, 0o600);
  const privateKey = readFileSync(privateKeyPath, 'utf8');
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return {
    privateKey,
    publicKey,
    keyId: createHash('sha256').update(publicKey).digest('hex'),
  };
}

export function decryptApiKey(privateKey: string, ciphertext: string) {
  if (ciphertext.length < 300 || ciphertext.length > 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) {
    throw new Error('Encrypted Claude key is invalid');
  }
  const plaintext = privateDecrypt({
    key: privateKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, Buffer.from(ciphertext, 'base64')).toString('utf8');
  if (!/^sk-ant-[\x21-\x7e]{20,390}$/.test(plaintext)) throw new Error('Decrypted Claude key has an invalid format');
  return plaintext;
}
