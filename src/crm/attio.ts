import { createHash } from 'node:crypto';
import { isAutomatedSender, projectCrm } from '../../ui/lib/crm-projection.js';
// Single runner per workspace: crm_jobs serializes exports. Query before every write
// so a retry after a lost response finds the previously created record.
export function attioContext(data:any){
 const full=JSON.stringify(data);
 if(Buffer.byteLength(full,'utf8')<=100000)return full;
 const {sources=[],history=[],...fields}=data;
 const compact={...fields,exportSummary:true,sourceCount:sources.length,historyCount:history.length,
  detailLocation:'Full sources and history remain in Signal Desk CRM',
  sources:sources.slice(-20).map((s:any)=>({id:s.id,title:s.title,occurredAt:s.occurredAt,url:s.url})),history:history.slice(-5)};
 const value=JSON.stringify(compact);
 return Buffer.byteLength(value,'utf8')<=100000?value:JSON.stringify({exportSummary:true,detailLocation:'Full details remain in Signal Desk CRM',sourceCount:sources.length,historyCount:history.length});
}
// Deliberately separate credentials/object from the operator's outreach Attio store.
export async function syncCrmAttio(view:any,opts:{key:string;object:string;inbox:string},fetcher:typeof fetch=fetch){
 if(!opts.key||!opts.object||!opts.inbox||view.settings?.inbox!==opts.inbox)throw Error('Dedicated CRM Attio destination and inbox binding required.');
 if(view.limited)throw Error('CRM history exceeds export limit; refusing an incomplete Attio sync.');
 const p=projectCrm(view),records=[...p.applications.map(x=>({kind:'job_application',id:x.id,name:`${x.company} — ${x.role}`,data:x})),...p.contacts.filter(x=>!isAutomatedSender(x.email)).map(x=>({kind:'contact',id:x.email,name:x.name||x.email,data:x})),...p.funds.map(x=>({kind:'vc_fund',id:x.id,name:x.name,data:x})),...p.deals.map(x=>({kind:'deal',id:x.id,name:x.company,data:x})),...p.weeks.map(x=>({kind:'weekly',id:x.week,name:`Week of ${x.week} (UTC)`,data:x}))];
 let count=0;
 for(const r of records){const externalId=createHash('sha256').update(opts.inbox+'|'+r.kind+'|'+r.id).digest('hex');
 const base=`https://api.attio.com/v2/objects/${encodeURIComponent(opts.object.trim())}/records`;
 const headers={Authorization:`Bearer ${opts.key}`,'Content-Type':'application/json'};
 const query=await fetcher(base+'/query',{method:'POST',headers,body:JSON.stringify({filter:{external_id:externalId},limit:2}),signal:AbortSignal.timeout(30000)});
 if(!query.ok)throw Error(`CRM Attio lookup stopped after ${count} records (HTTP ${query.status}).`);
 const found:any=await query.json();
 if(!Array.isArray(found.data))throw Error('Invalid Attio lookup response; no record written.');
 if(found.data.length>1)throw Error('Duplicate CRM external_id in Attio; resolve duplicates before retrying.');
 const recordId=found.data[0]?.id?.record_id;
 if(found.data.length&&!recordId)throw Error('Attio record ID missing; no record written.');
 const values={external_id:externalId,name:r.name,record_type:r.kind,crm_context:attioContext(r.data),relationship:r.data.relationship??'',contact_email:r.kind==='contact'?r.id:'',deal_status:r.data.status?.value??'',arr:r.data.arr?.value??'',revenue:r.data.revenue?.value??'',last_updated:new Date().toISOString()};
 const res=await fetcher(recordId?base+'/'+encodeURIComponent(recordId):base,{method:recordId?'PUT':'POST',headers,body:JSON.stringify({data:{values}}),signal:AbortSignal.timeout(30000)});
 if(!res.ok)throw Error(`CRM Attio sync stopped after ${count} records (HTTP ${res.status}); retry looks up existing IDs before writing.`);count++;}
 return {count,destination:opts.object};
}
