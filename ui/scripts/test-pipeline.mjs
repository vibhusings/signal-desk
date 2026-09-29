import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
const require=createRequire(import.meta.url),sqlite=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(`drizzle/${f}`,'utf8'));
const db={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};},async batch(statements){const r=[];for(const s of statements)r.push(await s.run());return r;}};
const modules={};
function load(path){if(modules[path])return modules[path];const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};new Function('require','exports',code)((name)=>{if(name==='@/db/workspace')return {workspaceDb:()=>db};if(name==='@/lib/pilot-auth')return {PILOT_OWNER_ID:'owner',workspaceOwner:async request=>request.headers.get('oai-authenticated-user-id')};if(name.startsWith('@/lib/'))return load(name.replace('@/','')+'.ts');if(name.startsWith('./'))return load('lib/'+name.slice(2)+'.ts');return require(name);},exports);return modules[path]=exports;}
const pipeline=load('app/api/pipeline/route.ts'),signals=load('app/api/signals/route.ts');
const origin='https://signal.test';
const post=(api,path,body,owner='owner')=>api.POST(new Request(origin+path,{method:'POST',headers:{origin,'Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify(body)}));
const view=async()=>(await pipeline.GET(new Request(origin+'/api/pipeline',{headers:{'oai-authenticated-user-id':'owner'}}))).json();
const snapshot=(extra={})=>({capabilities:{autoDraft:true,sending:true,claude:true,slashy:true,signals:true},investmentPolicy:{hash:'policy-1',sender:'me@example.com'},records:[],...extra});
const setRunner=(s,updated=new Date().toISOString())=>sqlite.prepare("INSERT INTO outreach_runner (id,owner_id,snapshot,updated_at) VALUES ('primary','owner',?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot,updated_at=excluded.updated_at").run(JSON.stringify(s),updated);
setRunner(snapshot());

// Shortlisting a signal saves the company and queues research that ends in drafts.
const key='a'.repeat(64),signalId='b'.repeat(64),now=new Date().toISOString();
sqlite.prepare('INSERT INTO signal_events (owner_id,id,company_key,data,status,first_seen,last_seen,run_id) VALUES (?,?,?,?,?,?,?,?)').run('owner',signalId,key,JSON.stringify({company:'Raindrop',website:'https://raindrop.ai/',kind:'Fundraising',title:'Raindrop raises Series A to monitor AI agents',summary:'s',sector:'AI infra',stage:'Series A',geography:'US',evidence:[{url:'https://raindrop.ai/blog',quote:'We raised our Series A to help teams monitor agents.'}],caveats:[],observedAt:now}),'New',now,now,'run');
let r=await post(signals,'/api/signals',{action:'review',id:signalId,status:'Shortlisted'});
let body=await r.json();assert.equal(r.status,200);assert.equal(body.companyId,`signal:${key}`);assert.ok(body.research.discoveryId);
const job=sqlite.prepare("SELECT id,payload FROM outreach_jobs WHERE action='discover'").get();
const payload=JSON.parse(job.payload);assert.equal(payload.autoDraft,true);assert.equal(payload.mode,'investment');assert.match(payload.investmentContext,/Series A/);
r=await post(pipeline,'/api/pipeline',{action:'research',companyId:`signal:${key}`});assert.equal((await r.json()).discoveryId,job.id);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM outreach_jobs WHERE action='discover'").get().n,1);
let v=await view();assert.equal(v.items[`signal:${key}`].stage,'Shortlisted');
console.log('Shortlist saves the company to Pipeline and queues one research-and-draft job.');

// Research finished: drafts are reviewable per contact.
sqlite.prepare("UPDATE outreach_jobs SET status='succeeded',result=? WHERE id=?").run(JSON.stringify({summary:'Agent monitoring',website:'https://raindrop.ai',contacts:[{name:'Ana',title:'CEO',email:'ana@raindrop.ai',emailSource:{kind:'published',url:'https://raindrop.ai/team'}},{name:'Ben',title:'CTO',email:'ben@raindrop.ai',emailSource:{kind:'guessed',pattern:'first@'}}],drafts:[{index:0,subject:'Raindrop Series A',body:'Hi Ana,\n\nCongrats on the round.\n\nBest,\nVibhu Singh'},{index:1,error:'Draft was not returned as JSON'}]}),job.id);
v=await view();const item=v.items[`signal:${key}`];
assert.equal(item.stage,'Draft ready');assert.equal(item.contacts[0].state,'draft');assert.equal(item.contacts[0].draft.subject,'Raindrop Series A');assert.equal(item.contacts[1].draftError,'Draft was not returned as JSON');

// Test delivery is validated and pinned into the launch payload at approval.
r=await post(pipeline,'/api/pipeline',{action:'settings',demoRecipient:'nope'});assert.equal(r.status,400);
r=await post(pipeline,'/api/pipeline',{action:'settings',demoRecipient:'Me@Test.dev'});assert.equal((await r.json()).demoRecipient,'me@test.dev');
const approve=(extra={})=>post(pipeline,'/api/pipeline',{action:'approve',companyId:`signal:${key}`,discoveryId:job.id,index:0,subject:'Raindrop’s Series A',body:'Hi Ana,\n\nCongrats on the round.\n\nBest,\nVibhu Singh',...extra});
r=await approve({body:'Hi [Name], congrats on the round and the launch.'});assert.equal(r.status,409);assert.match((await r.json()).error,/placeholder/);
setRunner(snapshot({capabilities:{autoDraft:true,sending:false}}));
r=await approve();assert.equal(r.status,409);assert.match((await r.json()).error,/sending is turned off/i);
setRunner(snapshot(),new Date(Date.now()-5*60000).toISOString());
r=await approve();assert.match((await r.json()).error,/offline/);
setRunner(snapshot());
r=await approve();body=await r.json();assert.equal(r.status,200);assert.equal(body.deliverTo,'me@test.dev');
const launch=JSON.parse(sqlite.prepare("SELECT payload FROM outreach_jobs WHERE action='launch'").get().payload);
assert.deepEqual(launch.indices,[0]);assert.equal(launch.drafts[0].subject,"Raindrop's Series A");assert.equal(launch.deliverTo,'me@test.dev');
assert.equal(launch.contacts[0].email,'ana@raindrop.ai');assert.equal(launch.policyHash,'policy-1');assert.equal(launch.confirmSend,true);
r=await approve();assert.equal(r.status,409);assert.match((await r.json()).error,/already approved/);
v=await view();assert.equal(v.items[`signal:${key}`].stage,'Contacted');assert.equal(v.items[`signal:${key}`].contacts[0].state,'queued');
console.log('Approve validates the draft, refuses when sending is off or the runner is offline, pins test delivery, and cannot double-send.');

// Runner outcomes drive the stage: contacted → replied → meeting booked.
const launchId=sqlite.prepare("SELECT id FROM outreach_jobs WHERE action='launch'").get().id;
sqlite.prepare("UPDATE outreach_jobs SET status='succeeded',result=? WHERE id=?").run(JSON.stringify({outcomes:[{email:'ana@raindrop.ai',id:'rec-1',deliverTo:'me@test.dev'}]}),launchId);
const rec=(status,extra={})=>setRunner(snapshot({records:[{id:'rec-1',sequenceStatus:status,touchCount:1,lastTouchAt:now,nextTouchAt:now,deliverTo:'me@test.dev',meeting:null,...extra}]}));
rec('active');v=await view();assert.equal(v.items[`signal:${key}`].contacts[0].state,'contacted');assert.equal(v.items[`signal:${key}`].stage,'Contacted');
rec('replied');v=await view();assert.equal(v.items[`signal:${key}`].stage,'Replied');
rec('replied',{meeting:{state:'sent',selectedSlot:now,meetLink:'https://meet.google.com/abc-defg-hij'}});v=await view();assert.equal(v.items[`signal:${key}`].stage,'Meeting booked');
rec('replied',{meeting:{state:'sent',selectedSlot:null}});v=await view();assert.equal(v.items[`signal:${key}`].stage,'Replied');
console.log('Pipeline stages follow the runner: Contacted, Replied, Meeting booked (only with a booked slot).');

// Passing an un-contacted signal takes its company off the active board.
const key2='c'.repeat(64),signal2='d'.repeat(64);
sqlite.prepare('INSERT INTO signal_events (owner_id,id,company_key,data,status,first_seen,last_seen,run_id) VALUES (?,?,?,?,?,?,?,?)').run('owner',signal2,key2,JSON.stringify({company:'Flatkey',website:'https://flatkey.ai/',kind:'Fundraising',title:'Flatkey raises Series A after developer growth',summary:'s',evidence:[{url:'https://flatkey.ai',quote:'Flatkey raised a Series A to grow developer adoption.'}],caveats:[],observedAt:now}),'New',now,now,'run');
await post(signals,'/api/signals',{action:'review',id:signal2,status:'Shortlisted'});
await post(signals,'/api/signals',{action:'review',id:signal2,status:'Passed'});
v=await view();assert.equal(v.items[`signal:${key2}`].stage,'Passed');
const before=sqlite.prepare('SELECT COUNT(*) AS n FROM outreach_jobs').get().n;r=await post(pipeline,'/api/pipeline',{action:'research',companyId:`signal:${key}`,retry:true},'intruder');assert.match((await r.json()).pending,/Save this company/);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM outreach_jobs').get().n,before);
console.log('Pass removes an un-contacted company from the active stages; other owners cannot queue research.');
