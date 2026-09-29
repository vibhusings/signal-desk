import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('lib/pilot-auth.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(env){const exports={};new Function('require','exports',code)(name=>{if(name==='cloudflare:workers')return {env};throw Error(name);},exports);return exports;}
const spoofed=new Request('https://site.test/',{headers:{'oai-authenticated-user-id':'attacker'}});

// Unconfigured Worker: a client-supplied identity header grants nothing.
assert.equal(await load({}).workspaceOwner(spoofed),null);
// Behind a platform that sets the header, it can be trusted explicitly.
assert.equal(await load({TRUST_PLATFORM_IDENTITY:'1'}).workspaceOwner(spoofed),'attacker');

// Access-code mode: only a signed session cookie admits; the header is ignored.
const accessCode='correct-horse-battery';
const auth=load({PILOT_ACCESS_CODE_SHA256:createHash('sha256').update(accessCode).digest('hex'),PILOT_SESSION_SECRET:'s'.repeat(48),TRUST_PLATFORM_IDENTITY:'1'});
assert.equal(auth.pilotModeConfigured(),true);
assert.equal(await auth.workspaceOwner(spoofed),null);
assert.equal(await auth.accessCodeValid(accessCode),true);
assert.equal(await auth.accessCodeValid('wrong-code-123'),false);
const cookie=(await auth.sessionCookie()).split(';')[0];
assert.equal(await auth.workspaceOwner(new Request('https://site.test/',{headers:{cookie}})),'signal-desk-pilot');
assert.equal(await auth.workspaceOwner(new Request('https://site.test/',{headers:{cookie:cookie.slice(0,-2)+'00'}})),null);
console.log('Site sign-in: spoofed identity headers rejected unless trusted; access-code sessions verified.');
