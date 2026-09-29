import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const require=createRequire(import.meta.url),sqlite=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync(`drizzle/${file}`,'utf8'));
const db={prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){return sqlite.prepare(sql).run(...args);}};}};
function load(path){
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};
 new Function('require','exports',code)(name=>{
  if(name==='@/db/workspace')return{workspaceDb:()=>db};
  if(name==='@/lib/pilot-auth')return{PILOT_OWNER_ID:'signal-desk-pilot',workspaceOwner:async request=>request.headers.get('oai-authenticated-user-id')};
  if(name==='@/lib/crustdata-store')return load('lib/crustdata-store.ts');
  return require(name);
 },exports);
 return exports;
}
const api=load('app/api/crustdata/route.ts'),owner='tester',keyId='a'.repeat(64),publicKey='PUBLIC';
sqlite.prepare('INSERT INTO outreach_runner VALUES (?,?,?,?)').run('primary',owner,JSON.stringify({credentialKey:{algorithm:'RSA-OAEP-256',keyId,publicKey}}),new Date().toISOString());
const request=(method,body)=>new Request('https://signal.test/api/crustdata',{method,headers:{origin:'https://signal.test','Content-Type':'application/json','oai-authenticated-user-id':owner},body:body?JSON.stringify(body):undefined});
assert.equal((await api.GET(request('GET'))).status,200);
assert.equal((await api.POST(request('POST',{keyId:'wrong',ciphertext:'A'.repeat(344)}))).status,400);
const ciphertext=JSON.stringify({v:1,alg:'RSA-OAEP-256+A256GCM',keyId,wrappedKey:Buffer.alloc(512,7).toString('base64'),iv:Buffer.alloc(12).toString('base64'),ciphertext:Buffer.alloc(64).toString('base64')}),plaintext='private-crustdata-key';
assert.equal((await api.POST(request('POST',{keyId,ciphertext}))).status,200);
const stored=sqlite.prepare('SELECT * FROM runner_crustdata').get();
assert.equal(stored.ciphertext,ciphertext);assert.equal(stored.key_id,keyId);assert.ok(!JSON.stringify(stored).includes(plaintext));
assert.ok(!(await (await api.GET(request('GET'))).text()).includes(ciphertext));
assert.equal((await api.GET(new Request('https://signal.test/api/crustdata'))).status,401);
assert.equal((await api.GET(new Request('https://signal.test/api/crustdata',{headers:{'oai-authenticated-user-id':'other'}}))).status,403);
assert.equal((await api.POST(new Request('https://signal.test/api/crustdata',{method:'POST',headers:{origin:'https://evil.test'}}))).status,403);
assert.equal((await api.DELETE(request('DELETE'))).status,200);
assert.equal(sqlite.prepare('SELECT count(*) n FROM runner_crustdata').get().n,0);
sqlite.close();
console.log('Crustdata credential API encryption storage, owner isolation, authentication, CSRF and removal passed.');
