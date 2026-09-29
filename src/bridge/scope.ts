import type { OutreachStore } from '../types.js';
/** Bound UI-triggered scheduler passes to the exact locally registered records. */
export function scopeStore(store:OutreachStore, ids:string[]):OutreachStore {
 const allowed=[...new Set(ids)];
 if(!allowed.length||allowed.some(id=>!/^[0-9a-f-]{36}$/i.test(id)))throw new Error('Invalid UI campaign scope');
 const all=()=>Promise.all(allowed.map(id=>store.getById(id)));
 const guard=(id:string)=>{if(!allowed.includes(id))throw new Error('Record outside UI campaign scope');};
 return {
  async getById(id){guard(id);return store.getById(id);},
  async findDue(now,limit){return (await all()).filter(r=>r.sequenceStatus==='active'&&r.nextTouchAt&&Date.parse(r.nextTouchAt)<=+now).sort((a,b)=>Date.parse(a.nextTouchAt!)-Date.parse(b.nextTouchAt!)).slice(0,limit);},
  async findAwaitingReply(limit){return (await all()).filter(r=>r.sequenceStatus==='active'&&r.touchCount>0).slice(0,limit);},
  async findReplyCandidates(){return (await all()).filter(r=>r.touchCount>0&&r.lastTouchAt&&Date.parse(r.lastTouchAt)>Date.now()-30*86400000&&['active','replied','stopped'].includes(r.sequenceStatus));},
  setThread(id,thread){guard(id);return store.setThread(id,thread);},
  claim(id,at){guard(id);return store.claim(id,at);},
  releaseClaim(id){guard(id);return store.releaseClaim(id);},
  recordSend(id,patch){guard(id);return store.recordSend(id,patch);},
  park(id,status,note){guard(id);return store.park(id,status,note);},
 };
}
