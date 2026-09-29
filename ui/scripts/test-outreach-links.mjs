import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { campaignLinksSql } from '../lib/outreach-links.ts';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE outreach_jobs (id TEXT, owner_id TEXT, action TEXT, payload TEXT, result TEXT, created_at TEXT)');
const insert = db.prepare('INSERT INTO outreach_jobs VALUES (?, ?, ?, ?, ?, ?)');
insert.run('launch', 'owner', 'launch', JSON.stringify({companyId:'research'}), JSON.stringify({outcomes:[{id:'recipient'}, {skipped:'Already exists'}]}), '2026-09-01');
for (let n=0;n<60;n++) insert.run(`recent-${n}`, 'owner', 'discover', '{}', null, '2026-09-15');
insert.run('other', 'other-owner', 'launch', JSON.stringify({companyId:'private-research'}), JSON.stringify({outcomes:[{id:'private-recipient'}]}), '2026-09-15');
insert.run('unlinked', 'owner', 'launch', '{}', JSON.stringify({outcomes:[{id:'unlinked-recipient'}]}), '2026-09-15');
const links = db.prepare(campaignLinksSql).all('owner');
assert.deepEqual(links.map(row=>({...row})), [{recordId:'recipient',companyId:'research'}]);
assert.equal(db.prepare('SELECT id FROM outreach_jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50').all('owner').some(row=>row.id==='launch'), false);
db.close();
console.log('Campaign research links survive activity pagination and exclude other owners and unlinked recipients.');
