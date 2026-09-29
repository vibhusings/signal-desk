import { sqliteTable, text, primaryKey, index } from 'drizzle-orm/sqlite-core';
export const companies = sqliteTable('companies', {
  ownerId: text('owner_id').notNull(),
  id: text('id').notNull(),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.ownerId, table.id] })]);

export const outreachJobs = sqliteTable('outreach_jobs', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  action: text('action').notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull(),
  result: text('result'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const outreachRunner = sqliteTable('outreach_runner', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  snapshot: text('snapshot').notNull().default('{}'),
  updatedAt: text('updated_at').notNull(),
});
export const runnerCredentials = sqliteTable('runner_credentials', {
  ownerId: text('owner_id').primaryKey(),
  keyId: text('key_id').notNull(),
  ciphertext: text('ciphertext').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const runnerSlashy = sqliteTable('runner_slashy', {
  ownerId: text('owner_id').primaryKey(),
  keyId: text('key_id').notNull(),
  ciphertext: text('ciphertext').notNull(),
  clientId: text('client_id').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const slashyOauthPending = sqliteTable('slashy_oauth_pending', {
  state: text('state').primaryKey(),
  ownerId: text('owner_id').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: text('expires_at').notNull(),
});
export const slashyOauthClient = sqliteTable('slashy_oauth_client', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const signalSettings=sqliteTable('signal_settings',{
 ownerId:text('owner_id').primaryKey(),data:text('data').notNull(),updatedAt:text('updated_at').notNull(),nextScanAt:text('next_scan_at'),
});
export const signalRuns=sqliteTable('signal_runs',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),status:text('status').notNull(),criteria:text('criteria').notNull(),
 createdAt:text('created_at').notNull(),startedAt:text('started_at'),completedAt:text('completed_at'),result:text('result'),
},t=>[index('signal_runs_owner_status').on(t.ownerId,t.status)]);
export const signalEvents=sqliteTable('signal_events',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),companyKey:text('company_key').notNull(),data:text('data').notNull(),
 status:text('status').notNull().default('New'),firstSeen:text('first_seen').notNull(),lastSeen:text('last_seen').notNull(),runId:text('run_id').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.id]}),index('signal_events_owner_company').on(t.ownerId,t.companyKey)]);
export const signalSources=sqliteTable('signal_sources',{
 ownerId:text('owner_id').notNull(),url:text('url').notNull(),data:text('data').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.url]})]);
export const signalObservations=sqliteTable('signal_observations',{
 ownerId:text('owner_id').notNull(),runId:text('run_id').notNull(),url:text('url').notNull(),data:text('data').notNull(),observedAt:text('observed_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.runId,t.url]})]);

export const crmSettings=sqliteTable('crm_settings',{
 ownerId:text('owner_id').primaryKey(),data:text('data').notNull(),nextScanAt:text('next_scan_at'),nextAttioAt:text('next_attio_at'),webhookHash:text('webhook_hash'),
});
export const crmJobs=sqliteTable('crm_jobs',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),kind:text('kind').notNull(),payload:text('payload').notNull(),status:text('status').notNull(),createdAt:text('created_at').notNull(),startedAt:text('started_at'),result:text('result'),
});
export const crmSources=sqliteTable('crm_sources',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),data:text('data').notNull(),analysis:text('analysis'),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.id]})]);
export const crmContacts=sqliteTable('crm_contacts',{
 ownerId:text('owner_id').notNull(),email:text('email').notNull(),relationship:text('relationship').notNull().default('Contact'),
},t=>[primaryKey({columns:[t.ownerId,t.email]})]);
