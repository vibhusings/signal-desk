'use client';
import { useEffect,useRef,useState } from 'react';
import { FileText,ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { encryptResumeEnvelope,MAX_RESUME_BYTES } from '@/lib/resume-envelope';
type Status={configured:boolean;active:boolean;filename:string|null;size:number|null;runnerOnline:boolean;slashyConnected:boolean;exchange:{algorithm:string;keyId:string;publicKey:string}|null;runnerError:string|null;upload:{status:string;error:string|null}|null};
const TYPES=new Set(['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
export default function ResumeSettings(){
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');const input=useRef<HTMLInputElement>(null);
 async function refresh():Promise<Status>{const r=await fetch('/api/resume',{cache:'no-store'}),b=await r.json() as Status & {error?:string};if(!r.ok)throw Error(b.error??'Could not load resume status');setStatus(b);return b;}
 useEffect(()=>{let live=true;const load=()=>refresh().catch(e=>{if(live)setError(e.message)});load();const timer=setInterval(load,5000);return()=>{live=false;clearInterval(timer)};},[]);
 async function upload(file:File){setBusy(true);setError('');setMessage('');try{
  if(!TYPES.has(file.type))throw Error('Choose a PDF, DOC, or DOCX resume.');if(file.size>MAX_RESUME_BYTES)throw Error('Resume must be 500 KB or smaller.');
  const current=await refresh();if(!current.runnerOnline||!current.exchange)throw Error('The cloud runner must be online.');if(!current.slashyConnected)throw Error('Connect Slashy before uploading a resume.');
  const envelope=await encryptResumeEnvelope(current.exchange.publicKey,current.exchange.keyId,new Uint8Array(await file.arrayBuffer()));
  const r=await fetch('/api/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),filename:file.name,mimeType:file.type,size:file.size,keyId:current.exchange.keyId,envelope})});const b=await r.json() as {error?:string};if(!r.ok)throw Error(b.error??'Could not queue resume upload');
  setMessage('Resume encrypted and queued. It becomes available after Slashy confirms the upload.');await refresh();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);if(input.current)input.current.value='';}}
 async function remove(){setBusy(true);setError('');setMessage('');try{const r=await fetch('/api/resume',{method:'DELETE'}),b=await r.json() as {error?:string};if(!r.ok)throw Error(b.error??'Could not remove resume');setMessage('Resume removed. Job-application launches are blocked until another resume is uploaded.');await refresh();}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <section className="panel api-key-panel"><div className="credential-heading"><span className="connection-icon"><FileText size={20}/></span><div><h2>Job-application resume</h2><p className="muted">Attached only to job-application outreach. Investment outreach never uses this file.</p></div><Badge variant="outline">{status?.active?'Ready':status?.configured?'Activating':status?.upload?.status==='running'||status?.upload?.status==='queued'?'Uploading':'Not configured'}</Badge></div>
 <input ref={input} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy||!status?.runnerOnline||!status?.slashyConnected} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file)}}/>
 <div className="credential-actions">{status?.configured&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void remove()}>Remove resume</Button>}</div>
 {status?.filename&&<p><strong>{status.filename}</strong>{status.size?` · ${Math.ceil(status.size/1024)} KB`:''}</p>}
 <p className="credential-security"><ShieldCheck size={16}/>The browser encrypts the file to the runner. Signal Desk stores the encrypted upload temporarily and then retains only the Slashy file ID.</p>
 {!status?.slashyConnected&&<p className="muted">Connect Slashy above before adding a resume.</p>}{status?.upload?.error&&<div className="error">{status.upload.error}</div>}{status?.runnerError&&<div className="error">{status.runnerError}</div>}{message&&<div className="notice">{message}</div>}{error&&<div className="error">{error}</div>}</section>;
}
