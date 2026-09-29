import { z } from 'zod';
export const participantSchema=z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase()),name:z.string().max(200).default('')}).strict();
export const sourceSchema=z.object({
 id:z.string().min(1).max(300),kind:z.enum(['email','attio','granola','note']),title:z.string().max(500),
 occurredAt:z.string().datetime({offset:true}),participants:z.array(participantSchema).max(100),
 text:z.string().min(1).max(100000),direction:z.enum(['sent','received','meeting','note']),
 url:z.string().max(2000).refine(s=>!s||/^https:\/\//.test(s)).default(''),
}).strict();
export const settingsSchema=z.object({inbox:z.string().email().max(254).transform(s=>s.toLowerCase()),enabled:z.boolean(),lookbackDays:z.number().int().min(1).max(90),attioEnabled:z.boolean()}).strict();
const fact=z.object({value:z.string().min(1).max(2000),quote:z.string().min(5).max(3000)}).strict().nullable();
const applicationSchema=z.object({
 company:fact,role:fact,reference:fact,url:fact,appliedAt:fact,deadline:fact,nextStep:fact,
 status:z.object({value:z.enum(['Applied','Interview','Offer','Rejected','Withdrawn']),quote:z.string().min(5).max(3000)}).strict().nullable(),
}).strict();
export const analysisSchema=z.object({applications:z.array(applicationSchema).max(20).optional(),summary:z.string().max(5000),vcSource:z.boolean(),vcEvidence:z.string().max(3000),
 funds:z.array(z.object({name:fact,details:fact})).max(20),
 deals:z.array(z.object({company:fact,round:fact,status:fact,arr:fact,revenue:fact,amount:fact,nextStep:fact})).max(20),
 outreachDecision:z.object({decision:z.enum(['pass','invest','none']),quote:z.string().max(3000)}).strict().nullable().optional(),
}).strict();
// Conservative confirmation gate. Interest, planned applications and negated
// confirmations cannot establish Applied; ambiguous wording remains unknown.
export function confirmsApplication(quote:string){
 const q=quote.toLowerCase().replace(/[’]/g,"'");
 if(/\b(not|never|haven't|hasn't|didn't|don't|no|yet|if|will|plan|planning|intend|before)\b/.test(q))return false;
 return /\b(?:i|you|we)\s+(?:have\s+|successfully\s+)?(?:applied|submitted (?:my|your|an|the) application)\b|\b(?:received|submitted|completed)\s+(?:your|my|the|an)\s+application\b|\bapplication\s+(?:(?:has been|was|is)\s+)?(?:successfully\s+)?(?:submitted|received|complete)\b|\bthank(?:s| you) for applying\b|\bstatus\s*:\s*applied\b/.test(q);
}
// Models echo typographic punctuation as ASCII (I’m -> I'm, – -> -) and reflow whitespace.
// Compare with only those normalised on both sides; every word must still match verbatim.
export const evidenceText=(s:string)=>s.replace(/[“”„″]/g,'"').replace(/[‘’‚′]/g,"'").replace(/[‒–—]/g,'-').replace(/[\u00a0\u202f\u2009]/g,' ').replace(/\s+/g,' ').trim();
export function groundedAnalysis(raw:unknown,text:string){
 const a=analysisSchema.parse(raw);
 const source=evidenceText(text),has=(quote:string)=>source.includes(evidenceText(quote));
 if(a.vcSource&&(!a.vcEvidence||!has(a.vcEvidence)))throw Error('VC classification lacks source evidence');
 for(const record of [...a.funds,...a.deals,...(a.applications??[])])for(const v of Object.values(record))if(v&&!has(v.quote))throw Error('Extracted fact lacks source evidence');
 if(a.outreachDecision&&a.outreachDecision.decision!=='none'&&(a.outreachDecision.quote.length<5||!has(a.outreachDecision.quote)))throw Error('Outreach decision lacks source evidence');
 for(const app of a.applications??[])if(app.status?.value==='Applied'&&!confirmsApplication(app.status.quote))app.status=null;
 return a;
}
