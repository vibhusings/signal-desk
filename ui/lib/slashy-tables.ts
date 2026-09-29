export async function ensureSlashyTables(db: { prepare: (sql: string) => { run: () => Promise<unknown> } }) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS runner_slashy (
    owner_id TEXT PRIMARY KEY NOT NULL,
    key_id TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    client_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS slashy_oauth_client (
    id TEXT PRIMARY KEY NOT NULL,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS slashy_oauth_pending (
    state TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`).run();
}
