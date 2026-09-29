import { z } from 'zod';

export const publicUrl = z.string().url().max(2000).refine(value => {
 const u=new URL(value);
 return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.includes('.')&&!/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)&&!u.hostname.endsWith('.local')&&!u.hostname.includes(':');
}, 'Use a public HTTPS URL');
export const criteriaSchema=z.object({
 thesis:z.string().trim().min(10).max(2000), sectors:z.string().max(500), stages:z.string().max(300), geographies:z.string().max(300), keywords:z.string().max(500), exclusions:z.string().max(500),
 kinds:z.array(z.enum(['Hiring','Product','Partnership','Fundraising'])).min(1).max(4),
 watchlist:z.array(z.string().trim().min(2).max(150)).max(20),
 sources:z.array(publicUrl).max(12),
 intervalHours:z.number().int().min(6).max(168), enabled:z.boolean(),
}).strict();
export type SignalCriteria=z.infer<typeof criteriaSchema>;
export const emptyCriteria:SignalCriteria={thesis:'',sectors:'',stages:'',geographies:'',keywords:'',exclusions:'',kinds:['Hiring','Product','Partnership','Fundraising'],watchlist:[],sources:[],intervalHours:24,enabled:false};
export const signalResultSchema=z.object({
 events:z.array(z.object({
  id:z.string().regex(/^[a-f0-9]{64}$/),companyKey:z.string().min(3).max(250),company:z.string().min(2).max(150),website:publicUrl,
  kind:z.enum(['Hiring','Product','Partnership','Fundraising']),title:z.string().min(10).max(300),summary:z.string().max(2000),
  sector:z.string().max(150),stage:z.string().max(100),geography:z.string().max(150),
  eventDate:z.string().nullable(),observedAt:z.string().datetime(),
  evidence:z.array(z.object({url:publicUrl,quote:z.string().min(20).max(1000),fetchedAt:z.string().datetime()})).min(1).max(4),
  scores:z.object({fit:z.number().min(0).max(100),recency:z.number().min(0).max(100),strength:z.number().min(0).max(100),confidence:z.number().min(0).max(100)}),
  reasons:z.array(z.string().max(600)).max(8),caveats:z.array(z.string().max(600)).max(8),
 }).strict()).max(10),
 sources:z.array(z.object({url:publicUrl,status:z.enum(['ok','failed']),error:z.string().max(500).optional(),contentHash:z.string().max(64),excerpt:z.string().max(12000),fetchedAt:z.string().datetime()})).max(24),
 discovery:z.object({provider:z.literal('Crustdata'),status:z.enum(['succeeded','failed']),count:z.number().int().min(0).max(10),error:z.string().max(500).optional()}).optional(),
 warnings:z.array(z.string().max(500)).max(30),status:z.enum(['succeeded','partial','failed']),
}).strict();
