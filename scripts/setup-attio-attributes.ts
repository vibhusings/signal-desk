import 'dotenv/config';

/**
 * Creates every attribute listed in docs/attio-setup.md on the Companies object,
 * so you don't have to click through the Attio UI by hand.
 *
 * Select attributes (asset_class, sequence_status) are created first, then their
 * options are added via a separate call — Attio's API doesn't accept inline options
 * on attribute creation.
 *
 * `asset_class` ships with no preset options: docs/attio-setup.md only says
 * "VC, CRE, ..." (open-ended per vertical), so there's nothing authoritative to
 * seed it with. Add its options by hand in the UI, or pass --asset-class one,two,three.
 */

const BASE = 'https://api.attio.com/v2';
const apiKey = process.env.ATTIO_API_KEY;
const object = process.env.ATTIO_OBJECT ?? 'companies';
const dryRun = !process.argv.includes('--write');

if (!apiKey) {
  console.error('ATTIO_API_KEY is required (put it in .env)');
  process.exit(1);
}

type AttrType = 'text' | 'number' | 'date' | 'timestamp' | 'select';

interface AttrDef {
  slug: string;
  title: string;
  type: AttrType;
  options?: string[];
}

const assetClassFlag = process.argv.find((a) => a.startsWith('--asset-class='));
const assetClassOptions = assetClassFlag ? assetClassFlag.slice('--asset-class='.length).split(',') : [];

const ATTRIBUTES: AttrDef[] = [
  { slug: 'outreach_email', title: 'Outreach email', type: 'text' },
  { slug: 'outreach_contact', title: 'Outreach contact', type: 'text' },
  { slug: 'asset_class', title: 'Asset class', type: 'select', options: assetClassOptions },
  { slug: 'sequence_stage', title: 'Sequence stage', type: 'number' },
  {
    slug: 'sequence_status',
    title: 'Sequence status',
    type: 'select',
    options: ['queued', 'active', 'replied', 'booked', 'bounced', 'stopped', 'unsubscribed', 'needs_review'],
  },
  { slug: 'next_touch_at', title: 'Next touch at', type: 'timestamp' },
  { slug: 'last_touch_at', title: 'Last touch at', type: 'timestamp' },
  { slug: 'touch_count', title: 'Touch count', type: 'number' },
  { slug: 'claimed_at', title: 'Claimed at', type: 'timestamp' },
  { slug: 'last_send_key', title: 'Last send key', type: 'text' },
  { slug: 'last_message_id', title: 'Last message ID', type: 'text' },
  { slug: 'last_subject', title: 'Last subject', type: 'text' },
  { slug: 'review_note', title: 'Review note', type: 'text' },
  { slug: 'contact_title', title: 'Contact title', type: 'text' },
  { slug: 'email_source', title: 'Email source', type: 'text' },
  { slug: 'source_website', title: 'Source website', type: 'text' },
  { slug: 'company_summary', title: 'Company summary', type: 'text' },
  { slug: 'raised_amount', title: 'Raised amount', type: 'text' },
  { slug: 'source_deck', title: 'Source deck', type: 'text' },
];

async function call(path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    // Attio returns 400/409 with a "slug already exists" style error when re-run — treat as OK.
    if ((res.status === 400 || res.status === 409) && /already exists|duplicate|slug_conflict/i.test(text)) {
      return { alreadyExists: true };
    }
    throw new Error(`${init.method} ${path} -> ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function createAttribute(def: AttrDef) {
  const body = {
    data: {
      title: def.title,
      description: null,
      api_slug: def.slug,
      type: def.type,
      is_required: false,
      is_unique: false,
      is_multiselect: false,
      config: {},
    },
  };
  if (dryRun) {
    console.log(`[dry run] would create ${def.slug} (${def.type})`);
    return;
  }
  const result = await call(`/objects/${object}/attributes`, { method: 'POST', body: JSON.stringify(body) });
  console.log(result.alreadyExists ? `  ${def.slug} already exists, skipping` : `  created ${def.slug}`);

  for (const option of def.options ?? []) {
    const optResult = await call(`/objects/${object}/attributes/${def.slug}/options`, {
      method: 'POST',
      body: JSON.stringify({ data: { title: option } }),
    });
    console.log(optResult.alreadyExists ? `    option "${option}" already exists` : `    added option "${option}"`);
  }
}

async function main() {
  console.log(`${dryRun ? '[dry run] ' : ''}Setting up ${ATTRIBUTES.length} attributes on "${object}"...\n`);
  if (assetClassOptions.length === 0) {
    console.log('  (no --asset-class=... passed — asset_class will be created with no preset options)\n');
  }
  for (const def of ATTRIBUTES) {
    await createAttribute(def);
  }
  if (dryRun) {
    console.log('\nDry run only — re-run with --write to actually create these.');
  } else {
    console.log('\nDone. Verify in Attio: Companies object -> Attributes.');
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
