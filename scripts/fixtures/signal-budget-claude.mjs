#!/usr/bin/env node
const report=process.argv[process.argv.indexOf('--tools')+1]==='';
const url='https://acme.example/launch';
const quote='Acme launched a public API for developer tools and opened registration to developers.';
const emit=content=>console.log(JSON.stringify({message:{content}}));
if(report){
 emit([{type:'text',text:'SIGNAL_JSON '+JSON.stringify({company:'Acme',website:'https://acme.example',kind:'Product',title:'Acme launches developer API',summary:quote,sector:'Developer tools',eventDate:null,evidence:[{url,quote}]})}]);
}else{
 emit([{type:'tool_use',id:'page',name:'mcp__slashy__scrape_url',input:{url}}]);
 emit([{type:'tool_result',tool_use_id:'page',content:JSON.stringify({success:true,content:quote})}]);
 for(let i=0;i<9;i++)emit([{type:'tool_use',id:'search'+i,name:'mcp__slashy__web_search',input:{query:'startup'}}]);
 setInterval(()=>{},1000);
}
