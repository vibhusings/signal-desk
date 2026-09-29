import 'dotenv/config';
import { mkdirSync,writeFileSync } from 'node:fs';
import { collectSignals } from '../src/signals/collector.js';

// Read-only smoke test. Never writes to hosted records or invokes outreach tools.
const result=await collectSignals({claudeBin:process.env.CLAUDE_BIN??`${process.env.HOME}/.local/bin/claude`,model:process.env.SIGNAL_MODEL??process.env.DISCOVER_MODEL??'claude-sonnet-5',oauthToken:process.env.CLAUDE_CODE_OAUTH_TOKEN,apiKey:process.env.ANTHROPIC_API_KEY,timeoutMs:180000,onEvent:event=>{for(const b of event.message?.content??[])if(b.type==='text'&&b.text.includes('SIGNAL_JSON'))console.log(b.text);for(const b of event.message?.content??[])if(b.type==='tool_use'||b.type==='tool_result')console.log(JSON.stringify({type:b.type,name:b.name,inputKeys:b.input?Object.keys(b.input):[],isError:b.is_error,resultKeys:Array.isArray(b.content)?b.content.filter((c:any)=>c.type==='text').map((c:any)=>{try{return Object.keys(JSON.parse(c.text));}catch{return ['plain_text'];}}):typeof b.content}));}},{thesis:'Validation only: investigate one recent product announcement from Linear, citing the official changelog. Return no more than one event. Do not investigate additional companies.',sectors:'Developer tools',stages:'',geographies:'',keywords:'',exclusions:'',kinds:['Product'],watchlist:['Linear'],sources:['https://linear.app/changelog'],intervalHours:24,enabled:false});
mkdirSync('.runtime/signals',{recursive:true});writeFileSync('.runtime/signals/smoke.json',JSON.stringify(result,null,2),{mode:0o600});
console.log(JSON.stringify({status:result.status,events:result.events.length,sources:result.sources.map(s=>({url:s.url,status:s.status})),warnings:result.warnings},null,2));
if(result.status==='failed')process.exitCode=1;
