import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePage1Xml } from '../src/sourcing/parse-pitch-deck.js';

const here = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); passed++; }
  catch (e) { console.log(`  \x1b[31m✗ ${name}\x1b[0m\n      ${(e as Error).message}`); failed++; }
}

console.log('\n\x1b[1mPitch deck parser\x1b[0m');

const fixture = readFileSync(join(here, 'fixtures/pitch-deck-sample.xml'), 'utf8');
const page1 = fixture.slice(0, fixture.indexOf('<page number="2"'));
const companies = parsePage1Xml(page1, 'fixture.pdf');

test('parses the right number of rows', () => {
  assert.equal(companies.length, 2);
});

test('single-line summary row is clean, no header bleed', () => {
  const c = companies[0];
  assert.equal(c.name, 'Alpha Corp');
  assert.equal(c.website, 'https://example.com');
  assert.equal(c.summary, "A single line summary for Alpha.");
  assert.equal(c.raisedRaw, '$1M');
  assert.equal(c.country, 'USA');
  assert.equal(c.university, 'CMU');
});

test('wrapped 2-line summary is NOT stolen by the row above', () => {
  const c = companies[1];
  assert.equal(c.name, 'Beta Inc');
  assert.equal(c.website, 'https://beta.example.com');
  assert.equal(
    c.summary,
    "First line of Beta's wrapped summary, which continues onto a second line below.",
  );
  // the bug this guards against: row 1's summary must NOT contain Beta's text
  assert.ok(!companies[0].summary.includes('Beta'), 'row 1 leaked row 2\'s summary');
});

test('page-2 content never leaks into any row', () => {
  const joined = JSON.stringify(companies);
  assert.ok(!joined.includes('Sponsor content'), 'page 2 leaked into page 1 rows');
});

test('title and column headers do not leak into row 1', () => {
  const c = companies[0];
  for (const bad of ['University Pitch Day', 'PNP University', 'Startup', 'Raised', 'Country']) {
    assert.ok(!c.name.includes(bad) && !c.summary.includes(bad) && !c.raisedRaw.includes(bad),
      `row 1 leaked header/title text: "${bad}"`);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
