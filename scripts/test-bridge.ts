import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SEND_GUARD_DIR = mkdtempSync(join(tmpdir(), 'bridge-guard-'));
import { FakeStore,makeRecord } from '../src/attio/fake.js';
import { scopeStore } from '../src/bridge/scope.js';
import { runOnce } from '../src/scheduler/run.js';
import { loadPolicy } from '../src/scheduler/policy.js';
const id='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const now=new Date();
const records=[makeRecord({id,sequenceStatus:'active',nextTouchAt:new Date(+now-1000).toISOString()}),makeRecord({id:other,sequenceStatus:'active',nextTouchAt:new Date(+now-2000).toISOString()})];
const base=new FakeStore(records);const scoped=scopeStore(base,[id]);const sent:string[]=[];
await runOnce(scoped,async r=>{sent.push(r.id);return {ok:true};},{...loadPolicy({}),dryRun:false},now,{info(){},warn(){},error(){}});
assert.deepEqual(sent,[id]);assert.equal(base.records.get(other)!.touchCount,0);
assert.throws(()=>scoped.park(other,'stopped','outside scope'),/outside UI/);
assert.throws(()=>scopeStore(base,[]),/Invalid/);
console.log('UI scheduler scope: only explicitly registered recipients can be sent or changed.');
const {prepareTarget}=await import('../src/bridge/targets.js');
const originalFetch=globalThis.fetch;const calls:string[]=[];
try{
 globalThis.fetch=async(input,init)=>{calls.push(`${init?.method} ${input}`);return new Response(JSON.stringify({data:[{id:{record_id:other},values:{sequence_status:[{value:'unsubscribed'}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});};
 const result=await prepareTarget('Test',{name:'Test',email:'test@example.com',title:null,emailSource:{kind:'published',url:'https://example.com'}},null,null,'job');
 assert.ok(result.skipped);assert.equal(calls.length,1);assert.ok(calls[0].endsWith('/query'));
}finally{globalThis.fetch=originalFetch;}
console.log('Existing Attio contacts are skipped without a write or sequence restart.');
