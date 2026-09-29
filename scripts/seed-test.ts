import 'dotenv/config';
import { ATTR } from '../src/attio/schema.js';

/**
 * Seeds a handful of obviously-fake companies into Attio, all pointed at
 * TEST_RECIPIENT, so the scheduler + send path can be exercised end to end
 * without Apollo and without emailing anyone real.
 *
 * Upserts on source_website (same key ingestToAttio uses), so re-running is safe.
 * Leaves asset_class unset — it's a select attribute with no options created yet,
 * so writing an arbitrary value to it would likely fail; not needed to test sending.
 */

const BASE = 'https://api.attio.com/v2';
const apiKey = process.env.ATTIO_API_KEY;
const object = process.env.ATTIO_OBJECT ?? 'companies';
const testRecipient = process.env.TEST_RECIPIENT;
const dryRun = !process.argv.includes('--write');

if (!apiKey) {
  console.error('ATTIO_API_KEY is required (put it in .env)');
  process.exit(1);
}
if (!testRecipient) {
  console.error('TEST_RECIPIENT is required (put it in .env) — every seeded record sends here');
  process.exit(1);
}

const TEST_COMPANIES = [
  { name: 'Northwind Labs (TEST)', website: 'https://test-northwind.example', contact: 'Ana' },
  { name: 'Pier 9 Capital (TEST)', website: 'https://test-pier9.example', contact: 'Sam' },
  { name: 'Halcyon CRE (TEST)', website: 'https://test-halcyon.example', contact: 'Lee' },
];

async function seedOne(company: (typeof TEST_COMPANIES)[number], now: Date) {
  const values = {
    [ATTR.companyName]: company.name,
    [ATTR.website]: company.website,
    [ATTR.contactEmail]: testRecipient,
    [ATTR.contactName]: company.contact,
    [ATTR.sequenceStatus]: 'active',
    // A minute in the past so it's unambiguously due right away.
    [ATTR.nextTouchAt]: new Date(now.getTime() - 60_000).toISOString(),
  };

  if (dryRun) {
    console.log(`[dry run] would upsert "${company.name}" -> ${testRecipient}, active, due now`);
    return;
  }

  // Plain create, not the matching_attribute upsert — that requires the matching
  // attribute to be unique, and source_website can't be marked unique on this
  // workspace (Attio rejects it for text attributes here, plan-tier or otherwise).
  // Re-running this script will create duplicates; that's fine for throwaway test data.
  const res = await fetch(`${BASE}/objects/${object}/records`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { values } }),
  });
  if (!res.ok) {
    throw new Error(`POST ${company.website} -> ${res.status}: ${await res.text()}`);
  }
  console.log(`  seeded "${company.name}" -> ${testRecipient}`);
}

async function main() {
  const now = new Date();
  console.log(
    `${dryRun ? '[dry run] ' : ''}Seeding ${TEST_COMPANIES.length} test companies, ` +
      `all contacting ${testRecipient}...\n`,
  );
  for (const company of TEST_COMPANIES) {
    await seedOne(company, now);
  }
  if (dryRun) {
    console.log('\nDry run only — re-run with --write to actually create these in Attio.');
  } else {
    console.log(
      '\nDone. Next: run `npm run run:scheduler` (DRY_RUN=1 first to check the plan, ' +
        'then DRY_RUN=0 to actually send to yourself).',
    );
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
