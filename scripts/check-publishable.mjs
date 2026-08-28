/**
 * Refuse to publish anything that isn't ours to publish.
 *
 *   node scripts/check-publishable.mjs
 *
 * Runs before `npm run build` and `npm run seed`. It reads data/buildings.json
 * — the file that becomes both the website and the Firestore collection — and
 * fails if anything in it falls outside the narrow set of things we're entitled
 * to put on the internet.
 *
 * Why this exists as code rather than a note in CLAUDE.md: a Firebase project
 * ID is public, and Firestore has a public REST endpoint. Anything a rule marks
 * readable is effectively published whether or not a page renders it. So the
 * moment a description string reaches this file, it is out — there is no later
 * checkpoint. A convention protects that boundary until the first session that
 * hasn't read the convention. A failing exit code protects it after.
 *
 * Three checks:
 *   1. Listings carry an exact key set — a pick-list, not a deny-list.
 *   2. No key anywhere in the file looks like scraped content or personal data.
 *   3. The shared thresholds haven't drifted between their copies.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Exactly what a published listing may contain. Nothing else passes. */
const ALLOWED_LISTING_KEYS = new Set([
  'beds',
  'baths',
  'sqft',
  'priceMyr',
  'furnishing',
  'source',
  'sourceUrl',
  'id',
  'firstSeen',
  'lastSeen',
  'analysis',
  // Both computed by derive.mjs from figures already on this list: how many
  // adverts shared these numbers, and where the unit sits against comparable
  // units in the same development. Ours, arithmetic, nobody else's content.
  'copies',
  'value',
]);

/**
 * Key names that would mean something has gone wrong, wherever they appear.
 *
 * Substring matched and case-insensitive, so `agentName`, `agent_phone` and
 * `AGENTS` are all caught. This is the second line: check 1 already fixes the
 * listing shape, but this catches a leak into some other part of the tree.
 */
const FORBIDDEN_KEY_PATTERNS = [
  'description',
  'agent',
  'phone',
  'mobile',
  'whatsapp',
  'email',
  'photo',
  'image',
  'gallery',
  'thumbnail',
  'contact',
];

/** Our own written analysis is short by design. Anything longer is suspicious. */
const MAX_SUMMARY_CHARS = 400;
const MAX_SIGNAL_CHARS = 140;
const MAX_SIGNALS = 6;

/** Facts are short strings. A paragraph in a fact field means a paste happened. */
const MAX_FACT_CHARS = 512;

const failures = [];
const fail = (where, message) => failures.push(`${where}: ${message}`);

/**
 * Both data files, because both can end up on the internet.
 *
 * data/buildings.json is seeded and always rendered. The placeholder file is
 * rendered too whenever PUBLIC_INCLUDE_SAMPLE=true, and a build with that flag
 * on is still a published site — so it goes through the same boundary. It is
 * invented data rather than collected data, which makes a leak unlikely, not
 * impossible: the moment someone pastes a real listing into it to see how a
 * page looks, this is the check that notices.
 */
const files = ['data/buildings.json', 'data/buildings.sample.json'].filter((f) =>
  existsSync(join(root, f)),
);

/** [file, building] pairs, so a failure can name the file it came from. */
const entries = files.flatMap((file) => {
  const parsed = JSON.parse(readFileSync(join(root, file), 'utf8'));
  scanKeys(parsed, file);
  return (parsed.buildings ?? []).map((building) => [file, building]);
});

// ---------------------------------------------------------------- check 1 & 2

/** Walk every key in the tree, reporting any that matches a forbidden pattern. */
function scanKeys(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => scanKeys(item, `${path}[${i}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    const hit = FORBIDDEN_KEY_PATTERNS.find((pattern) => lower.includes(pattern));
    if (hit) fail(`${path}.${key}`, `key looks like scraped content or personal data ("${hit}")`);
    scanKeys(child, `${path}.${key}`);
  }
}

for (const [i, [file, building]] of entries.entries()) {
  const at = `${file} ${building.slug ?? `buildings[${i}]`}`;

  for (const [j, listing] of (building.listings ?? []).entries()) {
    const where = `${at}.listings[${j}]`;

    for (const key of Object.keys(listing)) {
      if (!ALLOWED_LISTING_KEYS.has(key)) {
        fail(where, `unexpected field "${key}". Published listings carry facts and a link, nothing else`);
      }
    }

    for (const [key, value] of Object.entries(listing)) {
      if (typeof value === 'string' && value.length > MAX_FACT_CHARS) {
        fail(where, `"${key}" is ${value.length} characters — too long to be a fact`);
      }
    }

    checkAnalysis(listing.analysis, `${where}.analysis`, ['summary', 'signals']);
  }

  checkAnalysis(building.analysis, `${at}.analysis`, ['summary', 'strengths', 'caveats']);
  checkFactSources(building, at);
}

/**
 * A citation has to point at something and say how much it is worth.
 *
 * The page renders `verified` differently from `unverified`, so a malformed or
 * over-claimed entry here is not a data-quality nit — it is the site telling a
 * reader that a number is corroborated when nobody corroborated it.
 */
function checkFactSources(building, at) {
  for (const [field, source] of Object.entries(building.factSources ?? {})) {
    const where = `${at}.factSources.${field}`;

    if (!['verified', 'unverified'].includes(source?.confidence)) {
      fail(where, `confidence is ${JSON.stringify(source?.confidence)} — expected verified or unverified`);
    }
    if (!Array.isArray(source?.sources) || source.sources.length === 0) {
      fail(where, 'no sources — a citation that cites nothing should not be published as one');
    }
    if (source?.confidence === 'verified' && (source.sources?.length ?? 0) < 2) {
      fail(where, 'marked verified with a single source');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source?.checkedAt ?? '')) {
      fail(where, `checkedAt is ${JSON.stringify(source?.checkedAt)} — expected an ISO date`);
    }

    // The field it describes must actually have a value, or the page shows a
    // provenance chip attached to an em dash.
    const value = field in building ? building[field] : building.facts?.[field];
    if (value === null || value === undefined) {
      fail(where, `${field} has no value, so this citation describes a blank`);
    }
  }
}

/**
 * Generated analysis is ours, so the concern here isn't ownership — it's that a
 * model handed the listing's own words could quote them back at length. Short
 * caps make that visible.
 */
function checkAnalysis(analysis, where, listFields) {
  if (!analysis) return;

  if (typeof analysis.summary === 'string' && analysis.summary.length > MAX_SUMMARY_CHARS) {
    fail(where, `summary is ${analysis.summary.length} characters (cap ${MAX_SUMMARY_CHARS})`);
  }

  for (const field of listFields) {
    const list = analysis[field];
    if (!Array.isArray(list)) continue;
    if (list.length > MAX_SIGNALS) fail(where, `${field} has ${list.length} entries (cap ${MAX_SIGNALS})`);
    for (const [k, entry] of list.entries()) {
      if (typeof entry === 'string' && entry.length > MAX_SIGNAL_CHARS) {
        fail(where, `${field}[${k}] is ${entry.length} characters (cap ${MAX_SIGNAL_CHARS})`);
      }
    }
  }

  if (!analysis.provenance?.model || !analysis.provenance?.generatedAt) {
    fail(where, 'analysis without provenance — we should always be able to say when and by what');
  }
}

// -------------------------------------------------------------------- check 3

/**
 * The threshold lives in three places: format.ts for the UI, derive.mjs for the
 * pipeline, and analyse.mjs for the prompt. A .mjs script can't import the .ts
 * one without a build step, so instead of pretending they're a single constant,
 * check that they agree.
 */
function thresholdIn(file, pattern) {
  const source = readFileSync(join(root, file), 'utf8');
  const match = source.match(pattern);
  return match ? Number(match[1]) : null;
}

const thresholds = {
  'src/lib/format.ts': thresholdIn('src/lib/format.ts', /LOW_CONFIDENCE_THRESHOLD\s*=\s*(\d+)/),
  'scripts/derive.mjs': thresholdIn('scripts/derive.mjs', /LOW_CONFIDENCE_THRESHOLD\s*=\s*(\d+)/),
  'scripts/analyse.mjs': thresholdIn('scripts/analyse.mjs', /LOW_CONFIDENCE_THRESHOLD\s*=\s*(\d+)/),
};

const distinct = new Set(Object.values(thresholds).filter((v) => v !== null));
if (distinct.size > 1) {
  fail(
    'LOW_CONFIDENCE_THRESHOLD',
    `disagrees across files — ${Object.entries(thresholds)
      .map(([file, value]) => `${file}=${value}`)
      .join(', ')}`,
  );
}

/**
 * The same drift check for the "too cheap to believe" line.
 *
 * derive.mjs marks anything this far below its cohort `check` rather than
 * crowning it; the homepage ranker has to agree, or the front page recommends
 * exactly the listings the rest of the site distrusts. That is not theoretical
 * — it happened, and two Empire City studios came top of the picks.
 */
const suspicious = {
  'scripts/derive.mjs': thresholdIn('scripts/derive.mjs', /SUSPICIOUSLY_CHEAP\s*=\s*(-?[\d.]+)/),
  'src/pages/index.astro': thresholdIn('src/pages/index.astro', /SUSPICIOUSLY_CHEAP\s*=\s*(-?[\d.]+)/),
};

const distinctSuspicious = new Set(Object.values(suspicious).filter((v) => v !== null));
if (distinctSuspicious.size > 1) {
  fail(
    'SUSPICIOUSLY_CHEAP',
    `disagrees across files — ${Object.entries(suspicious)
      .map(([file, value]) => `${file}=${value}`)
      .join(', ')}`,
  );
}

// --------------------------------------------------------------------- report

if (failures.length > 0) {
  console.error(`\nPublish check failed — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(
    `\nNothing was written or uploaded. Fix the above, or widen the allowlist in\n` +
      `scripts/check-publishable.mjs if the new field really is ours to publish.\n`,
  );
  process.exit(1);
}

for (const file of files) {
  const mine = entries.filter(([f]) => f === file).map(([, b]) => b);
  const listings = mine.reduce((n, b) => n + (b.listings?.length ?? 0), 0);
  console.log(`Publish check passed: ${file} — ${mine.length} buildings, ${listings} listings, nothing out of bounds.`);
}
