/**
 * Parse saved search pages into listing facts.
 *
 *   node scripts/parse-page.mjs ara1.html ara2.html
 *   node scripts/parse-page.mjs ara*.html --group
 *   node scripts/parse-page.mjs ara*.html --raw        into data/raw/, ready to derive
 *
 * The collector fetches and parses in one go, which is fine when it can fetch.
 * Neither portal currently serves it (see docs/data-policy.md), so a page saved
 * from a browser is the only input there is. This reads such a file through
 * exactly the same extractor the collector uses — same field allowlist, same
 * contraband guard, same building matching — so what comes out here is what
 * would have come out there.
 *
 * Only --raw and --out write anything. --raw writes data/raw/<slug>.json, which
 * is the collector's store and is gitignored; `npm run derive` is still what
 * moves numbers into data/buildings.json, and `npm run check` is still what
 * decides whether they may be published.
 *
 * Options:
 *   --raw              merge into data/raw/<slug>.json, attributing by building
 *   --out <file>       write the parsed listings as JSON, attributed or not
 *   --group            summarise by development rather than listing every unit
 *   --source <key>     override the portal, normally inferred from the page
 *   --keep-url-slug    keep the portal's full URL, agent's name and all
 */

import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePayload, parseSearchPage, urlHasSlug, normalise } from './collect/extract.mjs';
import { mergeIntoRawStore, RAW_DIR } from './collect/raw-store.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const VALUE_OPTIONS = ['--out', '--source'];
const paths = args.filter((a, i) => !a.startsWith('--') && !VALUE_OPTIONS.includes(args[i - 1]));

/**
 * A directory means every file under it, subfolders included. Saved pages
 * arrive a search at a time — twenty pages in a folder named for the area — so
 * `extracted-data` should mean all of it, and `extracted-data/*` expanding to a
 * mix of files and folders should not be a reason to fail.
 */
function expand(path) {
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.'))
    .flatMap((d) => expand(join(path, d.name)));
}

const files = paths.flatMap(expand);

const outPath = value('--out');
const sourceOverride = value('--source');
const stripUrlSlug = !flag('--keep-url-slug');
const grouped = flag('--group');
const toRaw = flag('--raw');

if (files.length === 0) {
  console.error(
    'Usage: node scripts/parse-page.mjs <saved-page.html> [more.html ...] [options]\n\n' +
      '  --raw              merge into data/raw/<slug>.json, attributing by building\n' +
      '  --out <file>       write the parsed listings as JSON\n' +
      '  --group            summarise by development\n' +
      '  --source <key>     override the portal, normally inferred from the page\n' +
      '  --keep-url-slug    keep the portal\'s full URL, agent\'s name and all\n',
  );
  process.exit(1);
}

/** Which portal a page came from, read off the page rather than assumed. */
const HOSTS = ['propertyguru', 'iproperty', 'mudah'];

function sourceOf(payload) {
  const baseUrl = payload?.props?.pageProps?.pageData?.data?.paginationData?.baseUrl ?? '';
  const firstUrl = payload?.props?.pageProps?.pageData?.data?.listingsData?.[0]?.listingData?.url ?? '';
  const haystack = `${baseUrl} ${firstUrl}`.toLowerCase();
  return HOSTS.find((needle) => haystack.includes(needle)) ?? null;
}

// ------------------------------------------------------------------- parsing

/** id -> listing. Search pages overlap, and the same unit runs for weeks. */
const byId = new Map();
const pages = [];
let duplicates = 0;

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const payload = parsePayload(html);
  const source = sourceOverride ?? sourceOf(payload);

  if (!source) {
    console.error(
      `✗ ${file}: can't tell which portal this came from. Pass --source propertyguru (or iproperty, mudah).`,
    );
    process.exit(1);
  }

  const { error, page, listings, seen, skipped } = parseSearchPage(html, { source, stripUrlSlug });

  if (error) {
    console.error(`✗ ${file}: ${error}`);
    continue;
  }

  for (const listing of listings) {
    if (byId.has(listing.id)) duplicates++;
    byId.set(listing.id, listing);
  }

  pages.push({ file, source, ...page, seen, kept: listings.length, ...skipped });
}

const listings = [...byId.values()];

// -------------------------------------------------------------------- report

console.log('\n═══ Pages ═══\n');
for (const p of pages) {
  console.log(
    `  ${p.file.padEnd(24)} ${p.source.padEnd(13)} "${p.query ?? '?'}" ${p.listingType ?? ''}\n` +
      `  ${''.padEnd(24)} page ${p.currentPage} of ${p.totalPages}, ` +
      `${p.kept} listings parsed of ${p.seen} on the page` +
      `${p.rooms > 0 ? `, ${p.rooms} room rental${p.rooms === 1 ? '' : 's'}` : ''}` +
      `${p.incomplete > 0 ? `, ${p.incomplete} incomplete` : ''}`,
  );
}

const rooms = pages.reduce((n, p) => n + p.rooms, 0);
const incomplete = pages.reduce((n, p) => n + p.incomplete, 0);
if (rooms > 0 || incomplete > 0) {
  console.log(
    `\n  Left out: ${rooms} room rental(s) — a room in someone's unit, not a unit, and priced\n` +
      `  like one; and ${incomplete} listing(s) missing a floor area, price or bathroom count.`,
  );
}

const coverage = pages[0];
if (coverage && coverage.resultCount > listings.length) {
  console.log(
    `\n  Note: the search reports ${coverage.resultCount.toLocaleString('en-MY')} results across ` +
      `${coverage.totalPages} pages.\n` +
      `  These ${pages.length} page(s) are a sample of it, not the market. Medians below are the sample's.`,
  );
}

if (duplicates > 0) console.log(`\n  ${duplicates} listing(s) appeared on more than one page; kept once.`);

const withSlug = listings.filter((l) => urlHasSlug(l.sourceUrl)).length;
if (withSlug > 0) {
  console.log(
    `\n  --keep-url-slug: ${withSlug} of ${listings.length} URLs carry the agent's name in the path.\n` +
      `  Storing them stores a name. Drop the flag unless you have a reason.`,
  );
}

// --------------------------------------------------------- listings or groups

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const money = (n) => `RM${Math.round(n).toLocaleString('en-MY')}`;
const bedLabel = (beds) => (beds === 0 ? 'studio' : `${beds} bed`);
const title = (listing) => listing.label.split(' | ')[0];

if (grouped) {
  /**
   * Group on the listing's own title. It is the advertiser's wording, so this
   * is a rough cut for reading the page — attribution to a building, below, is
   * what decides where a unit actually goes.
   */
  const groups = new Map();
  for (const l of listings) {
    const key = normalise(title(l));
    if (!groups.has(key)) groups.set(key, { title: title(l), listings: [] });
    groups.get(key).listings.push(l);
  }

  console.log(`\n═══ ${groups.size} developments, ${listings.length} listings ═══\n`);

  for (const group of [...groups.values()].sort((a, b) => b.listings.length - a.listings.length)) {
    const psf = median(group.listings.map((l) => l.priceMyr / l.sqft));
    const types = [...new Set(group.listings.map((l) => l.propertyType).filter(Boolean))];
    console.log(
      `  ${group.title.slice(0, 44).padEnd(46)} ${String(group.listings.length).padStart(3)} ` +
        `${group.listings.length === 1 ? 'unit ' : 'units'}  ` +
        `median ${money(median(group.listings.map((l) => l.priceMyr))).padStart(8)}  ` +
        `${psf.toFixed(2).padStart(5)} psf  ${types.join(', ')}`,
    );
  }
} else {
  console.log(`\n═══ ${listings.length} listings ═══\n`);
  for (const l of [...listings].sort((a, b) => a.priceMyr - b.priceMyr)) {
    console.log(
      `  ${l.id.padEnd(24)} ${bedLabel(l.beds).padEnd(7)} ${String(l.baths).padStart(2)} bath  ` +
        `${String(l.sqft).padStart(5)} sqft  ${money(l.priceMyr).padStart(9)}  ` +
        `${(l.propertyType ?? '').slice(0, 24).padEnd(24)} ${title(l).slice(0, 40)}`,
    );
  }
}

// ------------------------------------------------------------- attribution

/**
 * Attach each listing to a building we cover, by the same conservative rule the
 * collector uses: the building's name must appear in the listing's own title or
 * address. Anything we can't place is reported and dropped — putting a unit
 * under the wrong development is worse than having fewer units.
 */
function attribute(all) {
  const published = JSON.parse(readFileSync(join(root, 'data/buildings.json'), 'utf8'));
  const targets = published.buildings.map((b) => ({ slug: b.slug, name: b.name, needle: normalise(b.name) }));

  const bySlug = new Map();
  const unplaced = [];

  for (const listing of all) {
    const target = targets.find((t) => normalise(listing.label).includes(t.needle));
    if (!target) {
      unplaced.push(listing);
      continue;
    }
    if (!bySlug.has(target.slug)) bySlug.set(target.slug, []);
    bySlug.get(target.slug).push(listing);
  }

  return { bySlug, unplaced };
}

if (toRaw) {
  const { bySlug, unplaced } = attribute(listings);

  console.log(`\n═══ Into data/raw/ ═══\n`);

  if (bySlug.size === 0) {
    console.error(
      `  Nothing matched a building in data/buildings.json, so nothing was written.\n\n` +
        `  Attribution is by name: the building's name has to appear in the listing's own\n` +
        `  title or address. Add the development to data/buildings.json first — derive.mjs\n` +
        `  computes numbers, it doesn't invent buildings.\n`,
    );
  }

  for (const [slug, group] of bySlug) {
    const { added, updated } = mergeIntoRawStore(slug, group);
    console.log(`  ${slug.padEnd(32)} ${String(group.length).padStart(3)} listings → ${added} new, ${updated} updated`);
  }

  if (unplaced.length > 0) {
    const titles = new Map();
    for (const l of unplaced) titles.set(title(l), (titles.get(title(l)) ?? 0) + 1);
    console.log(`\n  ${unplaced.length} listing(s) matched no building we cover, and were dropped:\n`);
    for (const [name, count] of [...titles].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(3)} × ${name}`);
    }
  }

  if (bySlug.size > 0) {
    console.log(`\n  Written to ${RAW_DIR}. Run \`npm run derive\` to turn it into published numbers.`);
  }
}

// ----------------------------------------------------------------- write out

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        parsedAt: new Date().toISOString(),
        pages: pages.map(({ file, source, query, currentPage, totalPages, resultCount }) => ({
          file,
          source,
          query,
          currentPage,
          totalPages,
          resultCount,
        })),
        listings,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nWrote ${listings.length} listings to ${outPath}`);
  console.log(
    `This is collected data, not published data. It belongs under data/raw/, and the\n` +
      `\`label\` field is attribution input only — derive.mjs decides what gets published.`,
  );
}
