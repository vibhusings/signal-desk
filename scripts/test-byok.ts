import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,statSync } from 'node:fs';
import { publicEncrypt } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptApiKey,ensureCredentialKey } from '../src/bridge/byok.js';

const directory=mkdtempSync(join(tmpdir(),'signal-desk-byok-'));
try{
 const first=ensureCredentialKey(directory),second=ensureCredentialKey(directory);
 assert.equal(first.keyId,second.keyId);
 assert.equal(statSync(join(directory,'byok-private.pem')).mode&0o777,0o600);
 const apiKey='sk-ant-api03-test-key-material-that-is-long-enough';
 const ciphertext=publicEncrypt({key:first.publicKey,oaepHash:'sha256'},Buffer.from(apiKey)).toString('base64');
 assert.equal(decryptApiKey(first.privateKey,ciphertext),apiKey);
 assert.throws(()=>decryptApiKey(first.privateKey,Buffer.from('not a key').toString('base64')),/invalid/i);
 console.log('BYO Claude key exchange: stable owner-only keypair and RSA-OAEP decryption passed.');
}finally{
 rmSync(directory,{recursive:true,force:true});
}
