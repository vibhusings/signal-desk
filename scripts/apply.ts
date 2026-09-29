import 'dotenv/config';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { discoverContacts } from '../src/sourcing/discover.js';
import { upsertOutreachTarget } from '../src/sourcing/attio-sourcing.js';
import { formatEmailSource } from '../src/sourcing/types.js';

const args = process.argv.slice(2);
const company = args.find((a) => !a.startsWith('--'));
const shouldWrite = args.includes('--write');
const maxContacts = Number(args.find((a) => a.startsWith('--max='))?.slice('--max='.length) ?? 5);

if (!company || !Number.isInteger(maxContacts) || maxContacts < 1 || maxContacts > 20) {
  console.error('Usage: npm run apply -- "<company name>" [--max=5] [--write]');
  console.error('       Without --write this only reports what it found.');
  process.exit(1);
}

async function main() {
  console.log(`\nResearching ${company}...\n`);
  mkdirSync('.spike', { recursive: true });
  const auditPath = resolve('.spike', `discovery-${Date.now()}.log`);
  console.log(`  Raw tool evidence: ${auditPath}`);

  const result = await discoverContacts(
    {
      claudeBin: process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`,
      model: process.env.DISCOVER_MODEL ?? 'claude-sonnet-5',
      timeoutMs: Number(process.env.DISCOVER_TIMEOUT_MS ?? 300_000),
      oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxContacts,
      onEvent: ({ type, block }) => {
        appendFileSync(auditPath, JSON.stringify({ at: new Date().toISOString(), type, block }) + '\n', { mode: 0o600 });
        if (type === 'tool_use' && block.name !== 'ToolSearch') {
          console.log(`  ${block.name.replace('mcp__slashy__', '')} ${JSON.stringify(block.input)}`);
        }
      },
    },
    company!,
  );

  if (result.error) console.error(`  ! ${result.error}\n`);
  console.log(`  fetched ${result.fetchedChars.toLocaleString()} chars of page content`);
  console.log('  Published = present on the cited scraped page; mailbox deliverability is not checked.');
  if (result.summary) console.log(`  summary: ${result.summary}`);
  else console.log(`  \x1b[33m! no company summary — the copy will be generic\x1b[0m`);
  if (result.website) console.log(`  verified website: ${result.website}`);

  if (!result.contacts.length) {
    console.log('\n  No contacts found. Nothing to write.\n');
    process.exit(result.error ? 1 : 0);
  }

  // Published vs guessed is the number that decides whether this list is safe to send
  // to, so it leads the summary rather than hiding in a column.
  const published = result.contacts.filter((c) => c.emailSource.kind === 'published');
  console.log(`  ${result.contacts.length} contacts — ${published.length} published, ${result.contacts.length - published.length} guessed\n`);

  for (const c of result.contacts) {
    const mark = c.emailSource.kind === 'published' ? '\x1b[32m✓\x1b[0m' : '\x1b[33m?\x1b[0m';
    console.log(`  ${mark} ${c.email.padEnd(34)} ${(c.title ?? '').slice(0, 28).padEnd(30)} ${c.name}`);
    console.log(`      ${formatEmailSource(c.emailSource)}`);
  }

  for (const d of result.demoted) console.log(`\n  \x1b[33m! demoted:\x1b[0m ${d}`);

  if (!shouldWrite) {
    console.log('\nDry run. Re-run with --write to add these to Attio as queued records.\n');
    return;
  }

  console.log('');
  for (const c of result.contacts) {
    try {
      const outcome = await upsertOutreachTarget(process.env.ATTIO_API_KEY ?? '', {
        companyName: `${company} — ${c.name}`,
        email: c.email,
        contactName: c.name.split(' ')[0],
        contactTitle: c.title,
        emailSource: formatEmailSource(c.emailSource),
        sourceLabel: `application:${company}`,
        companySummary: result.summary,
        website: result.website,
      });
      console.log(`  ${outcome} ${c.email}`);
    } catch (err) {
      console.error(`  x ${c.email}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `\nWritten as \x1b[1mqueued\x1b[0m — nothing sends until you review them in Attio and set ` +
    `sequence_status to active. Check the guessed addresses first.\n`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
