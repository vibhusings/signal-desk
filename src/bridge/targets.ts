import { ATTR } from '../attio/schema.js';
import type { DiscoveredContact } from '../sourcing/types.js';
import { formatEmailSource } from '../sourcing/types.js';
export async function prepareTarget(company:string,contact:DiscoveredContact,summary:string|null,website:string|null,jobId:string,mode?:string):Promise<{id?:string;skipped?:string}>{
 const base=`https://api.attio.com/v2/objects/${process.env.ATTIO_OBJECT??'companies'}/records`;
 const headers={Authorization:`Bearer ${process.env.ATTIO_API_KEY}`,'Content-Type':'application/json'};
 const found=await fetch(`${base}/query`,{method:'POST',headers,body:JSON.stringify({filter:{[ATTR.contactEmail]:{$eq:contact.email}},limit:2})});
 if(!found.ok)throw Error(`Attio lookup failed (${found.status})`);
 const data=(await found.json()).data;
 // Never restart or overwrite prior outreach, including stopped and unsubscribed records.
 if(data?.length)return {skipped:'Already exists in Attio; its sequence was not changed.'};
 const values={ [ATTR.companyName]:`${company} — ${contact.name}`,[ATTR.contactEmail]:contact.email,[ATTR.contactName]:contact.name,[ATTR.contactTitle]:contact.title??'', [ATTR.emailSource]:formatEmailSource(contact.emailSource),[ATTR.summary]:summary??'',[ATTR.website]:website??'',[ATTR.sourceDeck]:`${mode==='investment'?'ui-investment':'ui'}:${jobId}`,[ATTR.sequenceStatus]:'queued',[ATTR.sequenceStage]:0,[ATTR.touchCount]:0 };
 const r=await fetch(base,{method:'POST',headers,body:JSON.stringify({data:{values}})});
 if(!r.ok)throw Error(`Attio creation failed (${r.status}); review before retrying`);
 const id=(await r.json()).data?.id?.record_id;if(typeof id!=='string')throw Error('Attio creation returned no record ID; review before retrying');return {id};
}
export async function activateTarget(id:string, note='Launched after recipient review in Signal Desk'){
 const r=await fetch(`https://api.attio.com/v2/objects/${process.env.ATTIO_OBJECT??'companies'}/records/${id}`,{method:'PATCH',headers:{Authorization:`Bearer ${process.env.ATTIO_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({data:{values:{[ATTR.sequenceStatus]:'active',[ATTR.nextTouchAt]:new Date().toISOString(),[ATTR.reviewNote]:note}}})});
 if(!r.ok)throw Error(`Attio activation failed (${r.status}); review the record before retrying`);
}
