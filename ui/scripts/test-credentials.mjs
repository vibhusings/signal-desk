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
  return require(name);
 },exports);
 return exports;
}
const api=load('app/api/credentials/route.ts'),owner='tester',keyId='a'.repeat(64),publicKey='PUBLIC';
sqlite.prepare('INSERT INTO outreach_runner VALUES (?,?,?,?)').run('primary',owner,JSON.stringify({credentialKey:{algorithm:'RSA-OAEP-256',keyId,publicKey}}),new Date().toISOString());
const request=(method,body)=>new Request('https://signal.test/api/credentials',{method,headers:{origin:'https://signal.test','Content-Type':'application/json','oai-authenticated-user-id':owner},body:body?JSON.stringify(body):undefined});
assert.equal((await api.GET(request('GET'))).status,200);
assert.equal((await api.POST(request('POST',{keyId:'wrong',ciphertext:'A'.repeat(344)}))).status,400);
const ciphertext=Buffer.alloc(512,7).toString('base64'),plaintext='sk-ant-secret-must-not-appear';
assert.equal((await api.POST(request('POST',{keyId,ciphertext}))).status,200);
const stored=sqlite.prepare('SELECT * FROM runner_credentials').get();
assert.equal(stored.ciphertext,ciphertext);assert.equal(stored.key_id,keyId);assert.ok(!JSON.stringify(stored).includes(plaintext));
assert.equal((await api.DELETE(request('DELETE'))).status,200);
assert.equal(sqlite.prepare('SELECT count(*) n FROM runner_credentials').get().n,0);
assert.equal((await api.POST(request('POST',{mode:'wrong'}))).status,400);
assert.equal((await api.POST(request('POST',{mode:'subscription'}))).status,409);
sqlite.prepare('UPDATE outreach_runner SET snapshot=?').run(JSON.stringify({claudeAuth:{personalTestingAvailable:true,mode:'api',subscription:{ready:false,error:'Login required'}}}));
assert.equal((await api.POST(request('POST',{mode:'subscription'}))).status,200);
let status=await (await api.GET(request('GET'))).json();assert.equal(status.mode,'subscription');assert.equal(status.effectiveMode,'api');assert.equal(status.subscription.ready,false);
assert.equal((await api.POST(new Request('https://signal.test/api/credentials',{method:'POST',headers:{origin:'https://evil.test','Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify({mode:'api'})}))).status,403);
assert.equal((await api.POST(request('POST',{mode:'api'}))).status,200);
status=await (await api.GET(request('GET'))).json();assert.equal(status.mode,'api');
sqlite.close();
console.log('Credential API stores only runner-encrypted ciphertext and supports removal.');
