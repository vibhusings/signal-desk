import type { ToolCall } from '../reply/tools.js';
import { plainReply } from '../reply/messages.js';
import { sourceSchema } from '../../ui/lib/crm-schema.js';
import { crmScopeReady, gmailCrmQuery, sourceMatchesCrmScope, type CrmScope } from '../../ui/lib/crm-scope.js';
export async function collectInbox(call:ToolCall,inbox:string,days:number,now=new Date(),scope?:CrmScope,wide=false){
 const since=new Date(now.getTime()-days*86400000),sources:any[]=[],warnings:string[]=[];
 if(!wide&&!crmScopeReady(scope))return {sources,partial:false,warnings:['No tracked companies or outreach contacts. Add companies in Signal Desk before checking the inbox.'],count:0};
 // A bounded, read-only scan. A truncated mailbox is explicitly partial and never advances a cursor.
 // Wide scans build the CRM from recent conversations instead of only companies already tracked.
 const scoped=wide?'':gmailCrmQuery(scope!);
 if(!wide&&scope&&(scope.emails.length>20||scope.domains.length>20||scope.companies.length>20))warnings.push('Search scope exceeds this scan budget; only the first 20 entries per category were searched.');
 // Slashy answers any query with operators (after:, -in:spam, names) from an index that has
 // missed new mail for 30+ minutes; a bare newer_than: listing reads its up-to-date store.
 // Wide scans therefore list by age only and apply the exact window, spam, trash and draft rules below.
 const listDays=Math.min(60,Math.max(1,Math.ceil((Date.now()-since.getTime())/86400000)+1));
 const q=wide?`newer_than:${listDays}d`:`after:${Math.floor(since.getTime()/1000)} before:${Math.floor(now.getTime()/1000)+1} -in:trash -in:spam${scoped?` (${scoped})`:''}`;
 // Listing is read-only: retry a failed tool invocation once, like thread reads.
 // Never retry an empty successful result or turn a persistent error into an empty import.
 const list=()=>call('list_messages',{inbox_email:inbox,q,maxResults:50});
 const result=await list().catch(()=>list());
 if(!Array.isArray(result.threads))throw Error('Mailbox returned no valid thread list');
 if(result.inbox_email&&result.inbox_email.toLowerCase()!==inbox.toLowerCase())throw Error('Mailbox identity mismatch');
 if(result.pagination?.has_more!==false)warnings.push('Mailbox coverage is partial: more messages may exist. Narrow the lookback window.');
 for(const t of result.threads.slice(0,25)){
 // Unsent drafts are listed under a draft_ ID; they are not correspondence.
 if(String(t.thread_id??'').startsWith('draft_'))continue;
 if(!/^[0-9a-f]{16}$/.test(t.thread_id??'')){warnings.push('A thread had an invalid ID.');continue;}
 // A Claude tool process occasionally ends without making the call; one retry, then report it.
 const readOnce=()=>call('read_thread',{inbox_email:inbox,thread_id:t.thread_id});
 try{const full=await readOnce().catch(()=>readOnce());
 if(full.inbox_email?.toLowerCase()!==inbox.toLowerCase()||full.thread_id!==t.thread_id||!Array.isArray(full.messages)||full.truncated||full.message_count!==full.messages.length)throw Error('Incomplete or mismatched thread');
 for(const m of full.messages){
 const labels=Array.isArray(m.labels)?m.labels.map((l:any)=>String(l).toUpperCase()):[];
 if(m.isDraft||m.isSpam||m.isTrash||m.is_draft||m.is_spam||m.is_trash||labels.some((l:string)=>['DRAFT','SPAM','TRASH'].includes(l)))continue;
 const at=Date.parse(m.date);if(!Number.isFinite(at))throw Error('Invalid message date');if(at<+since||at>+now)continue;
 if(!m.id||m.threadId!==t.thread_id||!m.from?.email||!Array.isArray(m.to)||typeof m.body!=='string')throw Error('Invalid message evidence');
 const from=String(m.from.email).toLowerCase(),to=m.to.map((p:any)=>String(p.email).toLowerCase());
 const sent=from===inbox.toLowerCase();if(!sent&&!to.includes(inbox.toLowerCase()))continue;
 const participants=[m.from,...m.to,...(Array.isArray(m.cc)?m.cc:[])].filter(p=>p?.email&&p.email.toLowerCase()!==inbox.toLowerCase()).map(p=>({email:p.email.toLowerCase(),name:typeof p.name==='string'?p.name:''}));
 const text=plainReply(m.body);if(!text)continue;if(text.length>16000)warnings.push(`Message ${m.id} was truncated to the extraction budget.`);
 const source=sourceSchema.parse({id:`email:${inbox.toLowerCase()}:${m.id}`,kind:'email',title:m.subject??full.subject??'',occurredAt:new Date(at).toISOString(),participants:[...new Map(participants.map(p=>[p.email,p])).values()],text:text.slice(0,16000),direction:sent?'sent':'received',url:`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(inbox)}#all/${t.thread_id}`});
 if(!wide&&!sourceMatchesCrmScope(source,scope))continue;
 sources.push(source);
 if(sources.length>=100||JSON.stringify(sources).length>550000){warnings.push('Reached the message or content budget.');return {sources,partial:true,warnings,count:sources.length};}
 }}catch{warnings.push(`Could not completely read thread ${t.thread_id}.`);}}
 if(result.threads.length>25)warnings.push('Reached 25-thread budget. Narrow the lookback window for more complete coverage.');
 return {sources,partial:warnings.length>0,warnings,count:sources.length};
}
