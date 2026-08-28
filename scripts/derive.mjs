/**
 * Turn collected listings into published numbers.
 *
 *   node scripts/derive.mjs           derive every building found in data/raw/
 *   node scripts/derive.mjs --slug x  just one
 *
 * Reads data/raw/<slug>.json, computes medians, and writes the publishable
 * fields back into data/buildings.json. Building-level facts (lifts, parking,
 * fibre) and reviews are left alone — those are hand-maintained and don't come
 * from listings.
 *
 * Everything here is arithmetic. Nothing in this file calls a model, and that
 * is deliberate: a median is a median, and asking a language model for one
 * costs money and introduces a chance of it being wrong. The model's turn comes
 * in scripts/analyse.mjs, which is handed these numbers and asked only for
 * judgement.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(root, 'data/raw');
const OUT_PATH = join(root, 'data/buildings.json');
const SAMPLE_PATH = join(root, 'data/buildings.sample.json');

/**
 * Keep in step with LOW_CONFIDENCE_THRESHOLD in src/lib/format.ts. A .mjs
 * script can't import a .ts module without a build step, so the value is
 * repeated here and scripts/check-publishable.mjs fails if the two drift.
 */
const LOW_CONFIDENCE_THRESHOLD = 5;

/** Description text older than this is stripped from the raw store. */
const DESCRIPTION_RETENTION_DAYS = 30;

/** The only listing fields that may be published. Mirrors raw-types.ts. */
const PUBLISHABLE_LISTING_FIELDS = [
  'beds',
  'baths',
  'sqft',
  'priceMyr',
  'furnishing',
  'source',
  'sourceUrl',
];

const args = process.argv.slice(2);
const onlySlug = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;

if (!existsSync(RAW_DIR)) {
  console.error(
    `No data/raw/ directory.\n\n` +
      `Derivation reads collected listings from data/raw/<slug>.json. That folder is\n` +
      `gitignored and lives only on the machine that collected the data. Create it and\n` +
      `add at least one file before running this.`,
  );
  process.exit(1);
}

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Adverts that agree on every number we hold are one row, not five.
 *
 * Nearly half the collected adverts have a twin: 71 clusters across the first
 * real corpus, the largest being eight copies of one Empire City studio. Left
 * alone they weight that unit eight times in every median.
 *
 * What we cannot do is call them the same unit. The payload has no unit number,
 * so "one flat advertised by eight agents" and "eight identical studios in the
 * same block" are indistinguishable from here — `copies` records how many
 * adverts share these numbers and lets the page say that, without claiming
 * which it is.
 */
function collapseDuplicates(listings) {
  const groups = new Map();

  for (const listing of listings) {
    const key = [listing.beds, listing.baths, listing.sqft, listing.priceMyr].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(listing);
  }

  return [...groups.values()].map((group) => {
    // Keep the earliest sighting. `firstSeen` is our own observation and the
    // basis of any days-on-market figure, so it should survive a collapse.
    const [earliest] = [...group].sort((a, b) => Date.parse(a.firstSeen ?? 0) - Date.parse(b.firstSeen ?? 0));
    return { ...earliest, copies: group.length };
  });
}

/**
 * How this unit is priced against the ones a tenant would actually weigh it
 * against: same development, same bedroom count.
 *
 * A percentile rather than a percentage off. "Cheaper per sqft than 80% of
 * comparable units here" is self-calibrating — it still means something in a
 * development where everything is expensive, where a fixed "20% below market"
 * band would either never fire or fire constantly.
 *
 * Anything more than THIRTY_PERCENT below its cohort median is marked `check`
 * rather than crowned. At that distance the likeliest explanations are a
 * mis-keyed floor area, a room being sold as a unit, or bait — and on the
 * current data they are nearly all Empire City, where merging six blocks puts
 * 342 sqft studios in the same cohort as 1,000 sqft duplexes.
 */
const SUSPICIOUSLY_CHEAP = -0.3;

function scoreValue(units) {
  const cohorts = new Map();
  for (const unit of units) {
    if (!cohorts.has(unit.beds)) cohorts.set(unit.beds, []);
    cohorts.get(unit.beds).push(unit);
  }

  for (const cohort of cohorts.values()) {
    // Too few to compare against is not a low score, it is no score. Same
    // threshold the rest of the site uses to decide a median is worth showing.
    if (cohort.length < LOW_CONFIDENCE_THRESHOLD) continue;

    const psfOf = (u) => u.priceMyr / u.sqft;
    const cohortMedian = median(cohort.map(psfOf));

    for (const unit of cohort) {
      const psf = psfOf(unit);
      const dearer = cohort.filter((other) => other !== unit && psfOf(other) > psf).length;
      const cheaperThan = dearer / (cohort.length - 1);
      const delta = (psf - cohortMedian) / cohortMedian;

      unit.value = {
        cheaperThan: Math.round(cheaperThan * 100) / 100,
        cohort: cohort.length,
        band:
          delta < SUSPICIOUSLY_CHEAP
            ? 'check'
            : cheaperThan >= 0.7
              ? 'good-value'
              : cheaperThan <= 0.3
                ? 'pricey'
                : 'typical',
      };
    }
  }

  return units;
}

/**
 * Median of each unit's own price-per-sqft — not the median rent divided by the
 * median size. Those two differ whenever the cheap units aren't also the small
 * ones, and the per-unit version is the one that answers "what does a square
 * foot cost here".
 */
function metricsFor(listings, advertCount) {
  const byBedroom = [...new Set(listings.map((l) => l.beds))]
    .sort((a, b) => a - b)
    .map((beds) => {
      const group = listings.filter((l) => l.beds === beds);
      return {
        beds,
        medianRentMyr: Math.round(median(group.map((l) => l.priceMyr))),
        count: group.length,
      };
    });

  return {
    medianRentMyr: Math.round(median(listings.map((l) => l.priceMyr))),
    medianSqft: Math.round(median(listings.map((l) => l.sqft))),
    medianPsf: round2(median(listings.filter((l) => l.sqft > 0).map((l) => l.priceMyr / l.sqft))),
    // Distinct units, after identical adverts are collapsed. This is the number
    // the page means when it says how much stock there is.
    listingCount: listings.length,
    // …and how many adverts those units were advertised through. The gap
    // between the two is how much of the market is the same flat, twice.
    advertCount,
    byBedroom,
  };
}

/**
 * Copy across only the allowed fields, by name.
 *
 * Written as a pick rather than a delete on purpose. A delete-list silently
 * passes through any field added to the raw shape later; a pick-list drops it.
 * When the two disagree, the safe direction is to publish less.
 */
function publishableListing(raw, previous) {
  const listing = {};
  for (const field of PUBLISHABLE_LISTING_FIELDS) listing[field] = raw[field];

  if (raw.id) listing.id = raw.id;
  if (raw.firstSeen) listing.firstSeen = raw.firstSeen;
  if (raw.fetchedAt) listing.lastSeen = raw.fetchedAt;

  // Both computed here, from numbers we already publish. Neither is anyone
  // else's content, which is why they are allowed to cross the boundary.
  if (raw.copies > 1) listing.copies = raw.copies;
  if (raw.value) listing.value = raw.value;

  // Carry any existing analysis forward. Whether it's stale is analyse.mjs's
  // call, made by comparing input hashes — derivation shouldn't throw away work
  // that may still be current.
  if (previous?.analysis) listing.analysis = previous.analysis;

  return listing;
}

/**
 * The build year the listings agree on, or null.
 *
 * Portals show it per listing, so a development's units should all report the
 * same one. If they don't, the disagreement is the finding — return null rather
 * than picking a winner by count.
 */
function agreedBuildYear(listings) {
  const years = new Set(listings.map((l) => l.buildYear).filter((y) => Number.isFinite(y)));
  return years.size === 1 ? [...years][0] : null;
}

/** Strip description text we no longer need, in place, in the raw store. */
function purgeExpiredDescriptions(path, raw) {
  const cutoff = Date.now() - DESCRIPTION_RETENTION_DAYS * 86_400_000;
  let purged = 0;

  for (const listing of raw.listings) {
    if (listing.descriptionText && Date.parse(listing.fetchedAt) < cutoff) {
      delete listing.descriptionText;
      purged++;
    }
  }

  if (purged > 0) {
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
    console.log(`  purged description text from ${purged} listing(s) over ${DESCRIPTION_RETENTION_DAYS} days old`);
  }
}

const published = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
const byslug = new Map(published.buildings.map((b) => [b.slug, b]));

/**
 * The placeholder file, if it exists.
 *
 * A building starts life there as an invented row and moves across the first
 * time it has real listings — which is exactly what deriving one means. Doing
 * the move here rather than asking someone to do it by hand keeps the two files
 * from both claiming the same slug, and means "collect, derive, done" still
 * works for a building that began as a placeholder.
 */
const samples = existsSync(SAMPLE_PATH) ? JSON.parse(readFileSync(SAMPLE_PATH, 'utf8')) : null;
const sampleBySlug = new Map((samples?.buildings ?? []).map((b) => [b.slug, b]));
const promoted = [];

function promote(slug) {
  const building = sampleBySlug.get(slug);
  if (!building) return null;

  // It keeps `sample: true` on the way over, so the clearing step below runs and
  // strips the invented facts along with the flag.
  published.buildings.push(building);
  byslug.set(slug, building);
  sampleBySlug.delete(slug);
  promoted.push(slug);
  return building;
}

const rawFiles = readdirSync(RAW_DIR)
  .filter((f) => f.endsWith('.json'))
  .filter((f) => !onlySlug || f === `${onlySlug}.json`);

if (rawFiles.length === 0) {
  console.error(onlySlug ? `No data/raw/${onlySlug}.json.` : 'No .json files in data/raw/.');
  process.exit(1);
}

for (const file of rawFiles) {
  const path = join(RAW_DIR, file);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const slug = raw.slug ?? file.replace(/\.json$/, '');
  const building = byslug.get(slug) ?? promote(slug);

  if (!building) {
    console.warn(
      `! ${slug}: no such building in data/buildings.json or data/buildings.sample.json.\n` +
        `  Add the name, address and facts to data/buildings.json first — this script\n` +
        `  derives numbers, it doesn't invent buildings.`,
    );
    continue;
  }

  const previousById = new Map(building.listings.filter((l) => l.id).map((l) => [l.id, l]));

  // Collapse first, score second, publish third. Every median below is of
  // distinct units, so one flat advertised eight times counts once.
  const units = scoreValue(collapseDuplicates(raw.listings));

  building.listings = units.map((l) => publishableListing(l, previousById.get(l.id)));
  building.metrics = metricsFor(units, raw.listings.length);
  building.sources = [...new Set(raw.listings.map((l) => l.source))].sort();
  building.updatedAt = new Date().toISOString().slice(0, 10);

  // Real listings have replaced the placeholder ones, so the banner shouldn't
  // still be claiming otherwise.
  //
  // But dropping the flag is not only a banner change. Everything on a
  // `sample: true` row was invented — the lift count, the maintenance fee, the
  // review average, all of it — and this script only ever replaces listings and
  // metrics. Leaving the rest in place would quietly promote placeholders to
  // claims at the exact moment the "these are placeholders" notice disappears.
  // So they go back to unknown, which renders as "—", and wait for someone to
  // look them up.
  if (building.sample) {
    delete building.sample;
    building.facts = {
      maintenancePsf: null,
      parkingPerUnit: null,
      liftCount: null,
      fibreProviders: [],
      nearestStation: null,
      walkMinutesToStation: null,
    };
    building.reviews = { count: 0, average: 0, themes: [] };
    building.totalUnits = null;
    // And the citations go with the values they cite. A provenance record that
    // outlives its number is worse than none: it is a footnote on a blank.
    delete building.factSources;
    // The one hand-maintained fact the listings themselves state. Taken only
    // when they all agree; a disagreement means we don't know.
    building.completionYear = agreedBuildYear(raw.listings);
    console.log(`  ${slug}: dropped the sample flag, and cleared the placeholder facts and reviews with it`);
  }

  const thin = building.metrics.listingCount < LOW_CONFIDENCE_THRESHOLD;
  console.log(
    `✓ ${slug}: ${building.metrics.listingCount} listings, ` +
      `median RM${building.metrics.medianRentMyr.toLocaleString('en-MY')}, ` +
      `RM${building.metrics.medianPsf}/sqft${thin ? '  (thin — will render as low confidence)' : ''}`,
  );

  purgeExpiredDescriptions(path, raw);
}

published.buildings.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(OUT_PATH, `${JSON.stringify(published, null, 2)}\n`);

if (promoted.length > 0) {
  samples.buildings = [...sampleBySlug.values()];
  writeFileSync(SAMPLE_PATH, `${JSON.stringify(samples, null, 2)}\n`);
  console.log(`\nMoved out of the placeholder file, now that they have real listings: ${promoted.join(', ')}`);
}

console.log(`\nWrote data/buildings.json. Run \`npm run analyse\` next, then \`npm run seed\`.`);
