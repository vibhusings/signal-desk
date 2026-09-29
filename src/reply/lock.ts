import { mkdirSync, openSync, writeFileSync, readFileSync, unlinkSync, closeSync } from 'node:fs';
/** Single-host scheduler lock shared by manual runs and launchd. */
export function schedulerLock(): () => void {
  mkdirSync('.runtime',{recursive:true}); const path='.runtime/scheduler.lock';
  try {
    const fd=openSync(path,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
    return () => { if(readFileSync(path,'utf8')===String(process.pid))unlinkSync(path); };
  } catch(e:any) {
    if(e.code!=='EEXIST')throw e;
    const pid=Number(readFileSync(path,'utf8'));
    if(!Number.isInteger(pid)||pid<=0)throw new Error('Invalid scheduler lock; review .runtime/scheduler.lock');
    try { process.kill(pid,0); } catch(err:any) { if(err.code==='ESRCH'){unlinkSync(path);return schedulerLock();}throw err; }
    throw new Error(`Scheduler already running (${pid})`);
  }
}
