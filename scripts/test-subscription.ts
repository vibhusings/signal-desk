import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {subscriptionEnv,subscriptionStatus} from '../src/bridge/claude-auth.js';
import {extractCrmSubscription} from '../src/crm/extract.js';
const dir=mkdtempSync(join(tmpdir(),'subscription-test-'));
const bin=join(dir,'claude');
function fake(body:string){writeFileSync(bin,`#!${process.execPath}\n${body}`,{mode:0o700});}
try {
 process.env.ANTHROPIC_API_KEY='must-not-leak';process.env.CLAUDE_CODE_OAUTH_TOKEN='must-not-leak';
 assert.equal(subscriptionEnv().ANTHROPIC_API_KEY,undefined);assert.equal(subscriptionEnv().CLAUDE_CODE_OAUTH_TOKEN,undefined);
 fake(`if(process.env.ANTHROPIC_API_KEY||process.env.CLAUDE_CODE_OAUTH_TOKEN)process.exit(1);console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',subscriptionType:'max'}))`);
 assert.equal((await subscriptionStatus(bin)).ready,true);
 fake(`console.log(JSON.stringify({loggedIn:true,authMethod:'api_key'}))`);
 assert.equal((await subscriptionStatus(bin)).ready,false);
 fake(`process.exit(1)`);assert.equal((await subscriptionStatus(bin)).ready,false);
 const valid={summary:'Nothing to extract',vcSource:false,vcEvidence:'',funds:[],deals:[],applications:[]};
 fake(`if(process.env.ANTHROPIC_API_KEY||process.env.CLAUDE_CODE_OAUTH_TOKEN)process.exit(1);if(!process.argv.includes('--strict-mcp-config')||process.argv[process.argv.indexOf('--tools')+1]!=='')process.exit(1);console.log(JSON.stringify({subtype:'success',result:JSON.stringify(${JSON.stringify(valid)})}))`);
 assert.deepEqual((await extractCrmSubscription(bin,{text:'Hello',title:'Test'})).analysis,valid);
 fake(`console.log(JSON.stringify({subtype:'error',is_error:true,result:'Usage limit'}))`);
 await assert.rejects(()=>extractCrmSubscription(bin,{text:'Hello'}));
 const fabricated={...valid,funds:[{name:{value:'Fake fund',quote:'Never stated'},details:null}]};
 fake(`console.log(JSON.stringify({subtype:'success',result:JSON.stringify(${JSON.stringify(fabricated)})}))`);
 await assert.rejects(()=>extractCrmSubscription(bin,{text:'Hello'}));
 console.log('Subscription login gating, credential isolation, tool-free CRM extraction, failure handling and evidence validation passed.');
}finally{rmSync(dir,{recursive:true,force:true});}
