import { execFileSync } from 'node:child_process';
import type { SourcedCompany } from './types.js';

interface TextEl {
  top: number;
  left: number;
  text: string;
  href: string | null;
}

/**
 * Parses pdftohtml's page-1 XML for the Plug & Play "University Pitch Day" table
 * format (# | Startup | Brief Summary | Raised | Country | University).
 *
 * The row number in the '#' column anchors each row, but a multi-line summary cell
 * can render ABOVE its own row's number (the row's height is set by its tallest
 * column, so a 2-line summary starts higher than the single-line name/number do).
 * A naive "next anchor's top" interval therefore steals the first summary line from
 * the row below. Nearest-anchor-by-vertical-distance assignment avoids that, and was
 * verified against a real 39-row deck: every row resolved with a website (0 misses).
 */
export function parsePage1Xml(xml: string, sourceDeck: string): SourcedCompany[] {
  const els: TextEl[] = [];
  const textRe = /<text top="(\d+)" left="(\d+)" width="\d+" height="\d+" font="\d+">(.*?)<\/text>/gs;
  let m: RegExpExecArray | null;
  while ((m = textRe.exec(xml))) {
    const [, topS, leftS, innerRaw] = m;
    let inner = innerRaw;
    let href: string | null = null;
    const hrefMatch = /^<a href="([^"]+)">(.*)<\/a>$/s.exec(inner);
    if (hrefMatch) {
      href = hrefMatch[1];
      inner = hrefMatch[2];
    }
    const text = inner.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    els.push({ top: Number(topS), left: Number(leftS), text, href });
  }

  const anchors = els
    .filter((e) => e.left >= 20 && e.left <= 32 && /^\d{1,2}$/.test(e.text))
    .sort((a, b) => a.top - b.top);
  if (anchors.length === 0) return [];

  // A wrapped summary cell can start above its own row's anchor (see the comment
  // above), which means content above the FIRST row's anchor is ambiguous — it could
  // be a genuine multi-line row-1 summary, or it could be the table header / page
  // title bleeding in, with nothing above row 1 to out-compete it. Row spacing is a
  // reasonable proxy for how far a wrapped cell can reach above its own anchor, so
  // anything further above row 1 than that is treated as not belonging to the table.
  const rowGap = anchors.length > 1 ? anchors[1].top - anchors[0].top : 20;
  const tableTop = anchors[0].top - rowGap / 2;

  const nearestRow = (top: number): number => {
    let best = 0;
    let bestDist = Math.abs(top - anchors[0].top);
    for (let i = 1; i < anchors.length; i++) {
      const d = Math.abs(top - anchors[i].top);
      if (d < bestDist) { best = i; bestDist = d; }
    }
    return best;
  };

  const columnOf = (left: number): 'name' | 'summary' | 'raised' | 'country' | 'university' => {
    if (left < 130) return 'name';
    if (left < 650) return 'summary';
    if (left < 740) return 'raised';
    if (left < 800) return 'country';
    return 'university';
  };

  type Bucket = Record<'name' | 'summary' | 'raised' | 'country' | 'university', [number, string][]> & {
    website: string | null;
  };
  const buckets: Bucket[] = anchors.map(() => ({
    name: [], summary: [], raised: [], country: [], university: [], website: null,
  }));

  for (const e of els) {
    if (e.left <= 32) continue; // the '#' column itself
    if (e.top < tableTop) continue; // page title / table header, not row data
    const row = nearestRow(e.top);
    const col = columnOf(e.left);
    buckets[row][col].push([e.top, e.text]);
    if (col === 'name' && e.href) buckets[row].website = e.href;
  }

  const join = (pairs: [number, string][]) =>
    pairs.sort((a, b) => a[0] - b[0]).map(([, t]) => t).join(' ').trim();

  return anchors.map((_, i) => ({
    name: join(buckets[i].name),
    website: buckets[i].website ?? '',
    summary: join(buckets[i].summary),
    raisedRaw: join(buckets[i].raised),
    country: join(buckets[i].country),
    university: join(buckets[i].university) || undefined,
    sourceDeck,
  }));
}

/** Shells to `pdftohtml` (poppler-utils) and parses page 1. Throws with install
 *  instructions if the binary is missing, rather than a bare ENOENT. */
export function parsePitchDeck(pdfPath: string): SourcedCompany[] {
  let xml: string;
  try {
    xml = execFileSync('pdftohtml', ['-xml', '-stdout', pdfPath], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error('pdftohtml not found. Install poppler: brew install poppler');
    }
    throw err;
  }
  const page2 = xml.indexOf('<page number="2"');
  const page1 = page2 === -1 ? xml : xml.slice(0, page2);
  return parsePage1Xml(page1, pdfPath.split('/').pop() ?? pdfPath);
}
