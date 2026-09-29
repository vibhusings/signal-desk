import assert from 'node:assert/strict';
import { firstReferral, outsideUserMandate, recommendationEmail, vcFriendsForStartup } from '../ui/lib/vc-intro.js';

const criteria = { sectors: 'Developer tools', stages: 'Seed', geographies: 'US' };
const match = { company: 'Acme', sector: 'Developer tools', stage: 'Seed', geography: 'US' };
const outside = { company: 'Northwind', sector: 'Climate', stage: 'Series B', geography: 'Germany' };
assert.equal(outsideUserMandate(match, criteria), false);
assert.equal(outsideUserMandate({ ...match, stage: 'Unknown' }, criteria), false);
assert.equal(outsideUserMandate(outside, criteria), true);
assert.equal(outsideUserMandate(outside, { sectors: '', stages: '', geographies: '' }), false);

const friend = {
  email: 'maya@north.fund',
  name: 'Maya',
  relationship: 'VC friend',
  funds: ['North Fund'],
  sources: [{ text: 'Maya said North Fund leads Series B climate rounds in Germany.', analysis: { funds: [] } }],
};
const other = { ...friend, email: 'sam@other.fund', name: 'Sam', sources: [{ text: 'Sam invests in consumer social pre-seed.', analysis: { funds: [] } }] };
const plain = { ...friend, email: 'pat@example.com', relationship: 'Contact' };
const result = vcFriendsForStartup(outside, [plain, other, friend]);
assert.deepEqual(result.matches.map(item => item.email), ['maya@north.fund']);
assert.match(result.matches[0].quote, /Series B climate/);
assert.equal(vcFriendsForStartup(outside, [other]).matches.length, 0);
assert.match(vcFriendsForStartup({ sector: 'Unknown', stage: 'Unknown', geography: 'Unknown' }, [friend]).note, /unknown/i);
const seriesA = { company: 'Northwind', round: 'Series A', contacts: ['founder@northwind.com'] };
const seedCriteria = { sectors: '', stages: 'Seed', geographies: '' };
const seriesFriend = { ...friend, sources: [{ text: 'Maya said North Fund leads Series A rounds.', analysis: { funds: [] as never[] } }] };
assert.equal(firstReferral({ ...seriesA, round: 'Seed' }, seedCriteria, [seriesFriend]).outside, false);
const referred = firstReferral(seriesA, seedCriteria, [plain, other, seriesFriend]);
assert.equal(referred.outside, true);
assert.equal(referred.match?.email, 'maya@north.fund');
assert.equal(firstReferral({ ...seriesA, contacts: ['maya@north.fund'] }, seedCriteria, [seriesFriend]).match, null);
const mail = recommendationEmail({ company: 'Northwind', round: 'Series A', friendName: 'Maya Chen', quote: referred.match!.quote, userStages: 'Seed', senderName: 'Vibhu Singh' });
assert.match(mail.subject, /Northwind Series A/);
assert.match(mail.body, /outside my range/);
assert.match(mail.body, /Series A rounds/);
assert.match(mail.body, /have not committed to invest/);
console.log('VC intro matching passed: mandate check, friend evidence, unrelated contacts excluded, and one Series A referral.');
