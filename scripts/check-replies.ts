import 'dotenv/config';
import { AttioStore } from '../src/attio/client.js';
import { slashyCall } from '../src/reply/tools.js';
import { readCalendar, freeSlots, availabilityPolicy, availabilityBody } from '../src/reply/calendar.js';
import { readConversation, latestReply, replyIntent } from '../src/reply/messages.js';
const inbox=process.env.SENDER_INBOX??'';
if(!inbox)throw Error('Set SENDER_INBOX to the connected Slashy inbox.');
const call=slashyCall({claudeBin:process.env.CLAUDE_BIN??`${process.env.HOME}/.local/bin/claude`,model:process.env.SEND_MODEL??'claude-haiku-4-5',timeoutMs:120000,oauthToken:process.env.CLAUDE_CODE_OAUTH_TOKEN,apiKey:process.env.ANTHROPIC_API_KEY});
console.log('READ ONLY: checks calendar and reply evidence; no emails, events, or Attio records are changed.');
const c=await readCalendar(call,inbox);
console.log(`Calendar connected: ${c.events.length} events, complete selected-calendar result.`);
const p=availabilityPolicy();console.log(availabilityBody(freeSlots(c,new Date(),p),p,process.env.SENDER_NAME??'Vibhu').join('\n'));
const store=new AttioStore(process.env.ATTIO_API_KEY??'');let records=await store.findReplyCandidates();
if(process.env.TEST_ONLY_RECORD_ID)records=records.filter(r=>r.id===process.env.TEST_ONLY_RECORD_ID&&r.contactEmail===process.env.TEST_RECIPIENT);
console.log(`${records.length} reply candidates in Attio; inspecting up to 3.`);
for(const r of records.slice(0,3)){
 try{const conv=await readConversation(call,r,inbox);const m=latestReply(conv,r,inbox);console.log(`${r.contactEmail}: ${conv.threadId}: ${m?`reply ${m.id} (${replyIntent(m.body)})`:'no recipient reply'}`);}
 catch(e){console.error(`${r.contactEmail}: ${e}`);process.exitCode=1;}
}
