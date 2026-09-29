import 'dotenv/config';
import { ATTR } from '../src/attio/schema.js';

const id=process.argv[2]??process.env.TEST_ONLY_RECORD_ID;
if(!id||id!==process.env.TEST_ONLY_RECORD_ID||!process.env.ATTIO_API_KEY){console.error('Run prepare:test first, then: npm run arm:reply-test -- <record-id>');process.exit(1);}
const object=process.env.ATTIO_OBJECT??'companies';
const res=await fetch(`https://api.attio.com/v2/objects/${object}/records/${id}`,{
  method:'PATCH',headers:{Authorization:`Bearer ${process.env.ATTIO_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify({data:{values:{
    [ATTR.sequenceStatus]:'active',
    [ATTR.nextTouchAt]:new Date(Date.now()+24*3600000).toISOString(),
    [ATTR.reviewNote]:'TEST ONLY: armed for reply and calendar processing; no outreach due for 24 hours',
  }}}),
});
if(!res.ok)throw new Error(`Attio PATCH -> ${res.status}: ${await res.text()}`);
console.log(`Armed ${id} for reply processing`);
console.log('  status: active');
console.log('  next outreach: held for 24 hours');
