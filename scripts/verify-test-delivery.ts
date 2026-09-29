import 'dotenv/config';
import { slashyCall } from '../src/reply/tools.js';
import { AttioStore } from '../src/attio/client.js';
import { readConversation } from '../src/reply/messages.js';
import { testDeliveryRecord } from '../src/send/test-delivery.js';

const id=process.argv[2] ?? process.env.TEST_ONLY_RECORD_ID;
const recipient=process.env.TEST_DELIVERY_RECIPIENT;
if(!id||id!==process.env.TEST_ONLY_RECORD_ID||!recipient){console.error('Run prepare:test first, then: npm run verify:test -- <record-id>');process.exit(1);}
const call=slashyCall({
  claudeBin:process.env.CLAUDE_BIN??`${process.env.HOME}/.local/bin/claude`,model:process.env.SEND_MODEL??'claude-haiku-4-5',
  timeoutMs:Number(process.env.REPLY_TIMEOUT_MS??120000),oauthToken:process.env.CLAUDE_CODE_OAUTH_TOKEN,apiKey:process.env.ANTHROPIC_API_KEY,
});
const store=new AttioStore(process.env.ATTIO_API_KEY??'');
const record=testDeliveryRecord(await store.getById(id));
const conversation=await readConversation(call,record,process.env.SENDER_INBOX??'');
await store.setThread(id,conversation.threadId);
console.log(`Verified delivered to ${recipient}`);
console.log(`  subject: ${conversation.subject}`);
console.log(`  Gmail thread: ${conversation.threadId}`);
console.log('  Attio thread_id updated');
