import 'dotenv/config';
import { ATTR } from '../src/attio/schema.js';

const id=process.argv[2];
const apiKey=process.env.ATTIO_API_KEY;
const object=process.env.ATTIO_OBJECT ?? 'companies';
if(!id||!apiKey){console.error('Usage: npm run show:record -- <attio-record-id>');process.exit(1);}
const res=await fetch(`https://api.attio.com/v2/objects/${object}/records/${id}`,{headers:{Authorization:`Bearer ${apiKey}`}});
if(!res.ok)throw new Error(`Attio GET -> ${res.status}: ${await res.text()}`);
const record=(await res.json()).data;
const first=(slug:string)=>{
  const cell=record.values?.[slug]?.[0];
  if(!cell)return null;
  const raw=cell.value??cell.option??cell.full_name??cell.email_address;
  return raw&&typeof raw==='object'&&'title' in raw?raw.title:raw??null;
};
console.log(JSON.stringify({
  record_id:record.id.record_id,
  company:first(ATTR.companyName),email:first(ATTR.contactEmail),contact:first(ATTR.contactName),
  contact_title:first(ATTR.contactTitle),email_source:first(ATTR.emailSource),website:first(ATTR.website),
  company_summary:first(ATTR.summary),raised_amount:first(ATTR.raisedRaw),source_deck:first(ATTR.sourceDeck),
  status:first(ATTR.sequenceStatus),stage:first(ATTR.sequenceStage),
  touch_count:first(ATTR.touchCount),last_touch_at:first(ATTR.lastTouchAt),next_touch_at:first(ATTR.nextTouchAt),
  last_message_id:first(ATTR.lastMessageId),last_subject:first(ATTR.lastSubject),thread_id:first(ATTR.threadId),review_note:first(ATTR.reviewNote),
},null,2));
