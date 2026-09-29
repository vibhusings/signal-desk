export async function ensureCrustdata(db:{prepare:(sql:string)=>{run:()=>Promise<unknown>}}){
 await db.prepare('CREATE TABLE IF NOT EXISTS runner_crustdata (owner_id TEXT PRIMARY KEY,key_id TEXT NOT NULL,ciphertext TEXT NOT NULL,updated_at TEXT NOT NULL)').run();
}
