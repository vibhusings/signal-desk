import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {syncCrmAttio} from '../src/crm/attio.js';
import {projectCrm} from '../ui/lib/crm-projection.js';
if(!process.argv.includes('--write-test'))throw Error('Requires --write-test');
const inbox=`test-${randomUUID()}@example.invalid`,email='contact@example.invalid',key=process.env.ATTIO_API_KEY!,object='investment_crm';
const fact=(value:string)=>({value,quote:'Synthetic verification fixture, not real business data.'});
const view:any={settings:{inbox},relationships:{[email]:'VC friend'},sources:[{id:'test-fixture',kind:'note',title:'TEST — temporary CRM verification',occurredAt:'2099-01-05T12:00:00Z',participants:[{email,name:'TEST — temporary contact'}],direction:'meeting',text:'Synthetic verification fixture, not real business data.',analysis:{summary:'Synthetic verification',vcSource:true,funds:[{name:fact('TEST — temporary fund'),details:null}],deals:[{company:fact('TEST — temporary deal'),round:null,status:fact('Reviewing'),arr:fact('TEST ARR'),revenue:null,amount:null,nextStep:null}]}}]};
const p=projectCrm(view),keys=[['contact',email],['vc_fund',p.funds[0].id],['deal',p.deals[0].id],['weekly',p.weeks[0].week]].map(([kind,id])=>createHash('sha256').update(inbox+'|'+kind+'|'+id).digest('hex'));
async function api(path:string,method:string,body?:unknown):Promise<any>{const r=await fetch('https://api.attio.com/v2'+path,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('Attio status '+r.status);return r.status===204?null:r.json();}
const rows=async()=>{const out:any[]=[];for(const id of keys){const b=await api(`/objects/${object}/records/query`,'POST',{filter:{external_id:id}});out.push(...b.data);}return out;};
try{
 assert.equal((await rows()).length,0);
 assert.equal((await syncCrmAttio(view,{key,object,inbox})).count,4);
 const first=await rows();assert.equal(first.length,4);
 view.sources[0].analysis.deals[0].status=fact('Passed');
 await syncCrmAttio(view,{key,object,inbox});const second=await rows();
 assert.deepEqual(second.map(r=>r.id.record_id).sort(),first.map(r=>r.id.record_id).sort());
 const deal=second.find(r=>r.values.record_type[0].value==='deal');assert.equal(deal.values.deal_status[0].value,'Passed');assert.equal(deal.values.arr[0].value,'TEST ARR');
 const contact=second.find(r=>r.values.record_type[0].value==='contact');assert.equal(contact.values.relationship[0].value,'VC friend');
 console.log('Live Attio contact, VC friend, fund, deal, ARR and weekly record readbacks passed; second sync updated in place without duplicates.');
}finally{for(const r of await rows())await api(`/objects/${object}/records/${r.id.record_id}`,'DELETE');console.log('Removed all temporary CRM verification records');}
