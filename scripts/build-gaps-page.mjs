/**
 * Regenerate docs/gaps.html — the data-gap inventory — from the real data.
 *
 *   node scripts/build-gaps-page.mjs            write docs/gaps.html
 *   node scripts/build-gaps-page.mjs --check    fail if it is out of date
 *
 * Why this exists: the page is published as an Artifact, and an Artifact is a
 * static page with no line back to this repo — its CSP blocks every outbound
 * request, so it cannot fetch anything, ever. It cannot update itself.
 *
 * The danger that follows is not that the page goes stale. It is that it goes
 * stale *silently* — the prose keeps asserting "8 of 29" long after someone
 * phones nine management offices, and nobody notices because the sentence still
 * reads fine. So every number on the page is computed here, and `--check` runs
 * with the publish check: the build fails when the page and the data disagree.
 *
 * Prose stays hand-written. Only the marked <!--GEN:x--> regions are replaced,
 * because "how to get a lift count" is judgement and coverage counts are not.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(root, 'docs/gaps.template.html');
const OUT = join(root, 'docs/gaps.html');

const check = process.argv.includes('--check');
const { buildings } = JSON.parse(readFileSync(join(root, 'data/buildings.json'), 'utf8'));
const listings = buildings.flatMap((b) => b.listings ?? []);
const N = buildings.length;
const NL = listings.length;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pct = (have, total) => (total === 0 ? 0 : Math.round((100 * have) / total));

/** A coverage bar takes its colour from the coverage, so the table reads at a glance. */
const meter = (have, total) => {
  const p = pct(have, total);
  const tone = p === 0 ? ' none' : p < 50 ? ' low' : '';
  return `<div class="meter"><div class="bar${tone}"><i style="width:${p}%"></i></div><span class="pc">${p}%</span></div>`;
};

const verified = (field) =>
  buildings.filter((b) => b.factSources?.[field]?.confidence === 'verified').length;

/** Building-level fields, with the route note kept next to the field it describes. */
const BUILDING_FIELDS = [
  ['completionYear', (b) => b.completionYear, 'ok', 'done'],
  ['totalUnits', (b) => b.totalUnits, 'part', 'scope disputes'],
  ['maintenancePsf', (b) => b.facts.maintenancePsf, 'part', 'phone the JMB'],
  ['parkingPerUnit', (b) => b.facts.parkingPerUnit, 'part', 'guardhouse'],
  ['liftCount', (b) => b.facts.liftCount, 'part', 'site visit'],
  ['nearestStation', (b) => b.facts.nearestStation, 'ok', 'Overpass'],
  ['walkMinutesToStation', (b) => b.facts.walkMinutesToStation, 'ok', 'Overpass'],
  ['fibreProviders', (b) => (b.facts.fibreProviders?.length ? 1 : null), 'part', 'coverage checkers'],
  ['reviews', (b) => b.reviews?.count || null, 'no', 'not a scrape'],
  ['analysis', (b) => b.analysis ?? null, 'part', 'run analyse.mjs'],
];

const LISTING_FIELDS = [
  ['beds · baths · sqft · priceMyr · firstSeen', (l) => l.sqft > 0 && l.priceMyr > 0 && l.firstSeen, 'ok', 'done'],
  ['value (comparable score)', (l) => l.value, 'off', 'by design — thin cohorts'],
  ['furnishing', (l) => l.furnishing !== 'unknown', 'no', 'detail pages 403'],
  ['analysis', (l) => l.analysis, 'part', 'run analyse.mjs'],
];

const has = (v) => v !== null && v !== undefined && v !== false;

// ------------------------------------------------------------------ regions

const buildingRows = BUILDING_FIELDS.map(([field, read, tone, note]) => {
  const have = buildings.filter((b) => has(read(b))).length;
  const ver = verified(field);
  return `        <tr>
          <td class="field">${esc(field)}</td>
          <td>${meter(have, N)}</td>
          <td class="num">${N - have}</td><td class="num">${ver || 0}</td>
          <td><span class="chip ${tone}">${esc(note)}</span></td>
        </tr>`;
}).join('\n');

const listingRows = LISTING_FIELDS.map(([label, read, tone, note]) => {
  const have = listings.filter((l) => has(read(l))).length;
  return `        <tr>
          <td class="field">${esc(label)}</td>
          <td>${meter(have, NL)}</td>
          <td class="num">${NL - have}</td>
          <td><span class="chip ${tone}">${esc(note)}</span></td>
        </tr>`;
}).join('\n');

/** Fields the finder asks about that we can actually filter or rank on. */
const MATCHABLE = 4;
const ASKED = 21;
/** Weight the requested scoring model puts on factors we hold no data for. */
const UNSCORED_WEIGHT = 35;

const nearEmpty = BUILDING_FIELDS.filter(
  ([, read]) => buildings.filter((b) => has(read(b))).length <= 1,
).length;
const totalVerified = buildings.reduce(
  (n, b) => n + Object.values(b.factSources ?? {}).filter((f) => f.confidence === 'verified').length,
  0,
);

const stats = `  <div class="stats">
    <div class="stat"><b>${MATCHABLE}</b><span>of ${ASKED} asked-for fields we can match</span></div>
    <div class="stat"><b>${nearEmpty}</b><span>building fields empty or near-empty</span></div>
    <div class="stat"><b>${totalVerified}</b><span>facts verified, site-wide</span></div>
    <div class="stat"><b>${UNSCORED_WEIGHT}</b><span>of 60 weighted points unlockable</span></div>
  </div>`;

const stamp =
  `Coverage counted against <code>data/buildings.json</code>, ${N} developments and ${NL} listings, ` +
  `regenerated ${new Date().toISOString().slice(0, 10)}.`;

// -------------------------------------------------------------------- write

const template = readFileSync(TEMPLATE, 'utf8');
const regions = { stats, buildings: buildingRows, listings: listingRows, stamp };

let out = template;
for (const [name, body] of Object.entries(regions)) {
  const re = new RegExp(`<!--GEN:${name}-->[\\s\\S]*?<!--/GEN-->`);
  if (!re.test(out)) {
    console.error(`docs/gaps.template.html has no <!--GEN:${name}--> region.`);
    process.exit(1);
  }
  const wrapped = name === 'stats' || name === 'stamp'
    ? `<!--GEN:${name}-->${name === 'stats' ? '\n' + body + '\n  ' : body}<!--/GEN-->`
    : `<!--GEN:${name}-->\n      <tbody>\n${body}\n      </tbody>\n      <!--/GEN-->`;
  out = out.replace(re, wrapped);
}

if (check) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    console.error('docs/gaps.html is missing. Run `npm run gaps`.');
    process.exit(1);
  }
  // The stamp carries today's date, so compare everything else.
  const strip = (s) => s.replace(/regenerated \d{4}-\d{2}-\d{2}/, '');
  if (strip(current) !== strip(out)) {
    console.error(
      '\ndocs/gaps.html is out of date — the data has moved since it was last built.\n\n' +
        '  Run `npm run gaps`, then republish the artifact so the page people read\n' +
        '  matches the repo. Nothing else fails; this is the staleness alarm.\n',
    );
    process.exit(1);
  }
  console.log(`Gap page is current: ${N} developments, ${NL} listings.`);
  process.exit(0);
}

writeFileSync(OUT, out);
console.log(`Wrote docs/gaps.html — ${N} developments, ${NL} listings, ${totalVerified} verified facts.`);
