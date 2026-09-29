import { workspaceDb } from '@/db/workspace';
import { criteriaSchema, signalResultSchema } from './signal-schema';

export async function claimSignalScan(owner:string){
 const db=workspaceDb(),now=new Date().toISOString();
 // A timed-out read-only scan can be run again; an interrupted email is never replayed here.
 await db.prepare("UPDATE signal_runs SET status='failed', completed_at=?, result=? WHERE owner_id=? AND status='running' AND started_at < ?").bind(now,JSON.stringify({warnings:['Scan interrupted or exceeded 20 minutes. Run a new scan.']}),owner,new Date(Date.now()-20*60000).toISOString()).run();
 const setting=await db.prepare('SELECT data,next_scan_at FROM signal_settings WHERE owner_id=?').bind(owner).first<{data:string;next_scan_at:string|null}>();
 if(setting){
  const criteria=criteriaSchema.parse(JSON.parse(setting.data));
  if(criteria.enabled&&setting.next_scan_at&&setting.next_scan_at<=now){
   const next=new Date(Date.now()+criteria.intervalHours*3600000).toISOString();
   await db.batch([
    db.prepare("INSERT INTO signal_runs (id,owner_id,status,criteria,created_at) SELECT ?,?,'queued',?,? WHERE NOT EXISTS (SELECT 1 FROM signal_runs WHERE owner_id=? AND status IN ('queued','running')) AND EXISTS (SELECT 1 FROM signal_settings WHERE owner_id=? AND next_scan_at=?)").bind(crypto.randomUUID(),owner,setting.data,now,owner,owner,setting.next_scan_at),
    db.prepare('UPDATE signal_settings SET next_scan_at=? WHERE owner_id=? AND next_scan_at=?').bind(next,owner,setting.next_scan_at),
   ]);
  }
 }
 const run=await db.prepare("UPDATE signal_runs SET status='running',started_at=? WHERE id=(SELECT id FROM signal_runs WHERE owner_id=? AND status='queued' ORDER BY created_at LIMIT 1) AND status='queued' AND NOT EXISTS (SELECT 1 FROM signal_runs WHERE owner_id=? AND status='running') RETURNING id,criteria").bind(now,owner,owner).first<{id:string;criteria:string}>();
 if(!run)return {run:null};
 const sources=await db.prepare('SELECT data FROM signal_sources WHERE owner_id=? ORDER BY updated_at DESC LIMIT 24').bind(owner).all<{data:string}>();
 const events=await db.prepare('SELECT data FROM signal_events WHERE owner_id=? ORDER BY last_seen DESC LIMIT 30').bind(owner).all<{data:string}>();
 return {run:{id:run.id,criteria:JSON.parse(run.criteria),previousSources:sources.results.map(s=>JSON.parse(s.data)),previousEvents:events.results.map(e=>JSON.parse(e.data))}};
}

export async function completeSignalScan(owner:string,id:string,input:unknown){
 const result=signalResultSchema.parse(input),db=workspaceDb(),now=new Date().toISOString();
 const run=await db.prepare('SELECT status FROM signal_runs WHERE id=? AND owner_id=?').bind(id,owner).first<{status:string}>();
 if(!run)throw Error('Unknown scan');
 if(run.status!=='running')return {ok:true};
 const statements=[];
 for(const event of result.events){
  const previous=await db.prepare('SELECT id,data FROM signal_events WHERE owner_id=? AND company_key=?').bind(owner,event.companyKey).all<{id:string;data:string}>();
  const duplicate=previous.results.find(row=>{
   const p=JSON.parse(row.data);if(p.kind!==event.kind||(p.eventDate&&event.eventDate&&p.eventDate!==event.eventDate))return false;
   const a=new Set<string>(p.title.toLowerCase().match(/[a-z0-9]{3,}/g)??[]),b=new Set<string>(event.title.toLowerCase().match(/[a-z0-9]{3,}/g)??[]);
   return p.evidence.some((e:any)=>event.evidence.some(q=>q.url===e.url))||[...a].filter(t=>b.has(t)).length/Math.max(1,Math.min(a.size,b.size))>=0.7;
  });
  if(duplicate)statements.push(db.prepare('UPDATE signal_events SET last_seen=? WHERE owner_id=? AND id=?').bind(now,owner,duplicate.id));
  else statements.push(db.prepare("INSERT INTO signal_events (owner_id,id,company_key,data,status,first_seen,last_seen,run_id) VALUES (?,?,?,?,'New',?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET last_seen=excluded.last_seen").bind(owner,event.id,event.companyKey,JSON.stringify(event),now,now,id));
 }
 for(const source of result.sources){
  statements.push(db.prepare('INSERT INTO signal_observations (owner_id,run_id,url,data,observed_at) VALUES (?,?,?,?,?) ON CONFLICT(owner_id,run_id,url) DO NOTHING').bind(owner,id,source.url,JSON.stringify(source),now));
  if(source.status==='ok')statements.push(db.prepare('INSERT INTO signal_sources (owner_id,url,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,url) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(owner,source.url,JSON.stringify(source),now));
 }
 statements.push(db.prepare("UPDATE signal_runs SET status=?,completed_at=?,result=? WHERE id=? AND owner_id=? AND status='running'").bind(result.status,now,JSON.stringify({count:result.events.length,discovery:result.discovery,warnings:result.warnings,sources:result.sources.map(s=>({url:s.url,status:s.status,error:s.error}))}),id,owner));
 await db.batch(statements);return {ok:true};
}
