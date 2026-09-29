import 'dotenv/config';
import { parsePitchDeck } from '../src/sourcing/parse-pitch-deck.js';
import { ApolloClient, domainFromWebsite } from '../src/sourcing/apollo.js';
import { ingestToAttio, type IngestRow } from '../src/sourcing/attio-sourcing.js';
import type { EnrichedContact } from '../src/sourcing/types.js';

const pdfPath = process.argv[2];
const shouldWrite = process.argv.includes('--write');

if (!pdfPath) {
  console.error('Usage: npm run ingest -- "<path to pitch deck pdf>" [--write]');
  process.exit(1);
}

async function main() {
  console.log(`\nParsing ${pdfPath}...`);
  const companies = parsePitchDeck(pdfPath);
  console.log(`  ${companies.length} companies found\n`);

  const apolloKey = process.env.APOLLO_API_KEY;
  const apollo = apolloKey ? new ApolloClient(apolloKey) : null;
  if (!apollo) {
    console.log('  APOLLO_API_KEY not set — skipping contact lookup, writing companies without contacts.\n');
  }

  const rows: IngestRow[] = [];
  for (const company of companies) {
    let contact: EnrichedContact | null = null;
    if (apollo) {
      const domain = domainFromWebsite(company.website);
      try {
        contact = await apollo.findContact(domain);
      } catch (err) {
        console.error(`  ! Apollo lookup failed for ${company.name} (${domain}): ${err}`);
      }
    }
    rows.push({ company, contact });
    const status = contact ? `${contact.name ?? '(no name)'} <${contact.email}>` : 'NO CONTACT';
    console.log(`  ${company.name.padEnd(28)} ${status}`);
  }

  const withContact = rows.filter((r) => r.contact).length;
  console.log(`\n  ${withContact}/${rows.length} have a contact.\n`);

  if (!shouldWrite) {
    console.log('  Dry run — nothing written. Re-run with --write to upsert into Attio as `queued`.');
    console.log('  Every record lands as `queued`, never `active` — review in Attio before activating any of them.\n');
    return;
  }

  const attioKey = process.env.ATTIO_API_KEY;
  if (!attioKey) {
    console.error('  --write requires ATTIO_API_KEY in .env');
    process.exit(1);
  }

  console.log('  Writing to Attio as `queued`...');
  const result = await ingestToAttio(attioKey, rows);
  console.log(`  wrote ${result.created} | no contact: ${result.noContact.length} | errors: ${result.errors.length}\n`);
  if (result.errors.length) {
    for (const e of result.errors) console.error(`    ${e.company}: ${e.error}`);
  }
}

main();
