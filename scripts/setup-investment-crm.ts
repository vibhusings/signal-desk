import 'dotenv/config';

// Idempotent provisioning; requires explicit --write for remote changes.
const key=process.env.CRM_ATTIO_API_KEY||process.env.ATTIO_API_KEY;
const slug=process.env.CRM_ATTIO_OBJECT||'investment_crm';
const write=process.argv.includes('--write');
if(!key)throw Error('Attio credential required');
async function api(path:string,method='GET',data?:unknown):Promise<any>{
 const r=await fetch('https://api.attio.com/v2'+path,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:data?JSON.stringify({data}):undefined,signal:AbortSignal.timeout(30000)});
 const b:any=await r.json();if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${b.message||b.code}`);return b.data;
}
const objects=await api('/objects');
if(!objects.some((o:any)=>o.api_slug===slug)){
 if(!write){console.log(`Would create ${slug} and its CRM attributes`);process.exit(0);}
 await api('/objects','POST',{api_slug:slug,singular_noun:'Investment CRM record',plural_noun:'Investment CRM'});
 console.log('Created '+slug);
}
const attrs=await api(`/objects/${slug}/attributes`);
for(const field of ['external_id','name','record_type','crm_context','relationship','contact_email','deal_status','arr','revenue','last_updated']){
 const old=attrs.find((a:any)=>a.api_slug===field);
 if(old){if(old.type!=='text'||old.is_archived||old.is_multiselect)throw Error('Incompatible existing attribute: '+field);continue;}
 if(write)await api(`/objects/${slug}/attributes`,'POST',{api_slug:field,description:'Managed by Signal Desk investment CRM synchronization.',title:field.split('_').map(x=>x[0].toUpperCase()+x.slice(1)).join(' '),type:'text',is_required:false,is_unique:false,is_multiselect:false,config:{}});
 console.log((write?'Created ':'Would create ')+field);
}
console.log(write?'Investment CRM schema ready':'Schema check complete');
