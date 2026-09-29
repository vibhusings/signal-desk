export function weekOf(date:string){const d=new Date(date);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
// System mailboxes (no-reply, bounces) are real participants but never relationships.
export function isAutomatedSender(email:string){
 const local=String(email).toLowerCase().split('@')[0]??'';
 return local.includes('noreply')||/(^|[._+-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)([._+-]|$)/.test(local);
}
export function projectCrm(view:any){
 const applications=new Map<string,any>();
 const contacts=new Map<string,any>(),deals=new Map<string,any>(),funds=new Map<string,any>(),weeks=new Map<string,any>();
 const sources=[...(view.sources??[])].sort((a:any,b:any)=>a.occurredAt.localeCompare(b.occurredAt));
 for(const s of sources){
 const week=weekOf(s.occurredAt),w=weeks.get(week)??{week,contacts:new Set<string>(),sources:[],deals:[]};weeks.set(week,w);w.sources.push(s);
 const participants=(s.participants??[]).filter((p:any)=>p.email!==view.settings?.inbox);
 for(const p of participants){const c=contacts.get(p.email)??{email:p.email,name:p.name,relationship:view.relationships?.[p.email]??'Contact',lastTouch:null,sources:[],funds:[],deals:[]};
 if(p.name)c.name=p.name;c.sources.push(s);if(s.direction==='sent'||s.direction==='meeting'||s.direction==='note'){c.lastTouch=s.occurredAt;w.contacts.add(p.email);}contacts.set(p.email,c);}
 if(!s.analysis)continue;
 for(const a of s.analysis.applications??[]){
 if(!a.company||!a.role)continue;
 const base=a.company.value.toLowerCase().trim()+'|'+a.role.value.toLowerCase().trim();
 // Explicit requisitions remain separate. Ambiguous updates never merge multiple applications.
 const reference=a.reference?.value.toLowerCase().trim();
 const matches=[...applications.values()].filter(x=>x.base===base);
 const key=reference?base+'|'+reference:matches.length===1?matches[0].id:base+'|unspecified';
 const app=applications.get(key)??{id:key,base,company:a.company.value,role:a.role.value,contacts:[],sources:[],history:[]};
 for(const field of ['reference','url','appliedAt','deadline','nextStep','status'])if(a[field])app[field]=a[field];
 app.updatedAt=s.occurredAt;app.sources.push(s);app.history.push({date:s.occurredAt,...a,sourceId:s.id});
 for(const p of participants)if(!app.contacts.includes(p.email))app.contacts.push(p.email);
 applications.set(key,app);
 }
 for(const f of s.analysis.funds??[]){if(!f.name)continue;const key=f.name.value.toLowerCase().trim(),fund=funds.get(key)??{id:key,name:f.name.value,details:null,sources:[],contacts:[]};fund.details=f.details??fund.details;fund.sources.push(s);for(const p of participants){if(!fund.contacts.includes(p.email))fund.contacts.push(p.email);const c=contacts.get(p.email);if(!c.funds.includes(fund.name))c.funds.push(fund.name);}funds.set(key,fund);}
 for(const d of s.analysis.deals??[]){if(!d.company)continue;
 // Never merge rounds merely because they mention the same company.
 const key=d.company.value.toLowerCase().trim()+'|'+(d.round?.value.toLowerCase().trim()??'unspecified');
 const deal=deals.get(key)??{id:key,company:d.company.value,round:d.round?.value??'Unknown',sources:[],contacts:[],history:[]};
 for(const field of ['status','arr','revenue','amount','nextStep'])if(d[field])deal[field]=d[field];
 deal.updatedAt=s.occurredAt;deal.sources.push(s);deal.history.push({date:s.occurredAt,...d,sourceId:s.id});
 const label=`${deal.company} · ${deal.round}`;
 for(const p of participants){if(!deal.contacts.includes(p.email))deal.contacts.push(p.email);const c=contacts.get(p.email);if(c&&!c.deals.includes(label))c.deals.push(label);}
 deal.vcFriends=deal.contacts.filter((email:string)=>view.relationships?.[email]==='VC friend');deals.set(key,deal);w.deals.push({company:deal.company,status:d.status?.value??'Unknown',sourceId:s.id});
 }}
 return {applications:[...applications.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),contacts:[...contacts.values()],deals:[...deals.values()],funds:[...funds.values()],weeks:[...weeks.values()].map(w=>({...w,contacts:[...w.contacts]})).sort((a,b)=>b.week.localeCompare(a.week))};
}
