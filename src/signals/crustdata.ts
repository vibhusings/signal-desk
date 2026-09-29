import type { Criteria } from './collector.js';
export type CrustdataCandidate={name:string;website:string;description:string;country:string;headcount:number|null};
export type CrustdataDiscovery={provider:'Crustdata';status:'succeeded'|'failed';count:number;error?:string};
export async function searchCrustdata(key:string,criteria:Criteria,fetcher:typeof fetch=fetch):Promise<{candidates:CrustdataCandidate[];discovery:CrustdataDiscovery}>{
 const query=[criteria.thesis,criteria.sectors&&`Sectors: ${criteria.sectors}`,criteria.keywords&&`Keywords: ${criteria.keywords}`,criteria.stages&&`Stages: ${criteria.stages}`,criteria.geographies&&`Geographies: ${criteria.geographies}`,criteria.exclusions&&`Exclude: ${criteria.exclusions}`].filter(Boolean).join('\n').slice(0,4000);
 if(!query.trim())return {candidates:[],discovery:{provider:'Crustdata',status:'failed',count:0,error:'Add investment criteria before using Crustdata discovery.'}};
 try{
  const response=await fetcher('https://api.crustdata.com/company/search',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-api-version':'2025-11-01'},body:JSON.stringify({search:{query,mode:'hybrid'},limit:10,fields:['basic_info.name','basic_info.primary_domain','basic_info.description','locations.country','headcount.total']})});
  if(!response.ok){const reason=response.status===401?'API key was rejected.':response.status===402?'Provider credits or billing need attention.':response.status===403?'Your key or plan cannot access company search.':response.status===429?'Rate limit reached; try a later scan.':`Company search failed (HTTP ${response.status}).`;return {candidates:[],discovery:{provider:'Crustdata',status:'failed',count:0,error:reason}};}
  const body:any=await response.json();if(!Array.isArray(body.companies))throw Error('Invalid response');
  const candidates:CrustdataCandidate[]=[];
  for(const c of body.companies.slice(0,10)){
   const b=c?.basic_info,domain=typeof b?.primary_domain==='string'?b.primary_domain.trim().toLowerCase():'';
   if(typeof b?.name!=='string'||!b.name.trim()||!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)||domain.endsWith('.local')||candidates.some(x=>x.website===`https://${domain}/`))continue;
   candidates.push({name:b.name.slice(0,150),website:`https://${domain}/`,description:String(b.description??'').slice(0,1500),country:String(c.locations?.country??'Unknown').slice(0,150),headcount:Number.isFinite(c.headcount?.total)?c.headcount.total:null});
  }
  return {candidates,discovery:{provider:'Crustdata',status:'succeeded',count:candidates.length}};
 }catch{return {candidates:[],discovery:{provider:'Crustdata',status:'failed',count:0,error:'Company search could not complete or returned an invalid response. Web research continued.'}};}
}
