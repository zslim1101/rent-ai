/**
 * Merge hand-gathered development facts back into data/buildings.json.
 *
 *   node scripts/import-facts.mjs                 apply data/building-facts.csv
 *   node scripts/import-facts.mjs --dry-run       show what would change
 *   node scripts/import-facts.mjs --template      regenerate the CSV from current data
 *
 * These are the facts no portal will give us — maintenance fee, lift count,
 * parking ratio, walk to the station — and the reason the site exists rather
 * than being a mirror of PropertyGuru. They are gathered by hand, one
 * development at a time, so this exists to keep that work out of a JSON file
 * where a stray comma breaks the build.
 *
 * The rules that matter:
 *   - A blank cell means "still unknown" and leaves the existing value alone.
 *     It never overwrites something already filled in with nothing.
 *   - `-` in a cell means "checked, genuinely none" — for a walk-up with no
 *     lift, or a development with no parking allocation. That writes a real 0
 *     or empty list rather than leaving the field looking unresearched.
 *   - Numbers are validated. A lift count of "about 4" or a fee of "RM0.33/sqft"
 *     is rejected with the row number rather than silently becoming NaN.
 *
 * Rerunnable: import, collect more, import again. Nothing is lost between runs.
 *
 * ## Where a fact came from
 *
 * A second file, data/building-facts-sources.csv, records provenance:
 *
 *   slug,field,confidence,sources,checkedAt
 *   ritze-perdana-2,totalUnits,verified,https://a/ https://b/,2026-08-16
 *
 * It is long-format — one row per fact rather than one row per development —
 * because the alternative is twenty-odd columns nobody can read, and because a
 * research pass naturally produces exactly these rows: a field, what was found,
 * and where.
 *
 * `confidence` is `verified` (two independent sources agree, or one that is
 * authoritative for that field) or `unverified` (one second-hand source that
 * could be stale or could be about the development next door). The site renders
 * the difference, so getting it wrong here misleads a reader — when in doubt,
 * `unverified` is the honest call.
 *
 * A provenance row for a field that has no value is an error, not a warning:
 * it means the value failed to import and the citation is now pointing at a
 * blank.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = join(root, 'data/building-facts.csv');
const SOURCES_PATH = join(root, 'data/building-facts-sources.csv');
const OUT_PATH = join(root, 'data/buildings.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const template = args.includes('--template');

/** Columns that live on the building itself rather than under `facts`. */
const TOP_LEVEL = new Set(['completionYear', 'totalUnits']);

/** Every column the importer understands, and how to read each one. */
const FIELDS = {
  completionYear: { type: 'int', label: 'year the development was completed' },
  totalUnits: { type: 'int', label: 'number of units in the development' },
  maintenancePsf: { type: 'float', label: 'maintenance fee per sqft, in RM' },
  parkingPerUnit: { type: 'float', label: 'parking bays per unit' },
  liftCount: { type: 'int', label: 'passenger lifts serving the residential floors' },
  fibreProviders: { type: 'list', label: 'fibre providers, space separated' },
  nearestStation: { type: 'text', label: 'nearest LRT/MRT station' },
  walkMinutesToStation: { type: 'int', label: 'walking minutes to that station' },
};

const COLUMNS = ['slug', 'name', 'area', 'address', ...Object.keys(FIELDS)];

/** The provenance file's columns, and the only two confidence values. */
const SOURCE_COLUMNS = ['slug', 'field', 'confidence', 'sources', 'checkedAt'];
const CONFIDENCE = new Set(['verified', 'unverified']);

// ------------------------------------------------------------------ template

const escape = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function writeTemplate(buildings) {
  const rows = [...buildings]
    // Busiest first: the development with the most units is the one where a
    // missing maintenance fee costs the most readers.
    .sort((a, b) => b.metrics.listingCount - a.metrics.listingCount)
    .map((b) =>
      [
        b.slug,
        b.name,
        b.area,
        b.address,
        b.completionYear,
        b.totalUnits,
        b.facts.maintenancePsf,
        b.facts.parkingPerUnit,
        b.facts.liftCount,
        b.facts.fibreProviders?.join(' ') ?? '',
        b.facts.nearestStation,
        b.facts.walkMinutesToStation,
      ]
        .map(escape)
        .join(','),
    );

  writeFileSync(CSV_PATH, `${[COLUMNS.join(','), ...rows].join('\n')}\n`);
  console.log(`Wrote data/building-facts.csv — ${rows.length} developments, busiest first.`);

  // Only ever created, never overwritten: it accumulates a row per fact as the
  // research happens, and regenerating the value template shouldn't throw that
  // away. Deleting it is an explicit act.
  if (!existsSync(SOURCES_PATH)) {
    writeFileSync(SOURCES_PATH, `${SOURCE_COLUMNS.join(',')}\n`);
    console.log('Wrote data/building-facts-sources.csv — header only, one row per fact.');
  }
}

// --------------------------------------------------------------------- parse

/** Minimal RFC4180 reader: quoted fields, doubled quotes, commas inside them. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const problems = [];

/**
 * Read one cell.
 *
 * Returns `undefined` for "leave it alone" and a value for "write this",
 * because null is itself a meaningful value here — it is what "checked, none"
 * writes for a text field.
 */
function readCell(raw, field, line) {
  const value = raw?.trim() ?? '';
  if (value === '') return undefined;

  const { type, label } = FIELDS[field];

  // The explicit "I checked, there is none" marker.
  if (value === '-') {
    if (type === 'list') return [];
    if (type === 'text') return null;
    return 0;
  }

  if (type === 'text') return value;
  if (type === 'list') return value.split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase());

  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    problems.push(`line ${line}: ${field} is "${value}" — expected ${label} as a plain number, or "-" for none`);
    return undefined;
  }
  if (type === 'int' && !Number.isInteger(n)) {
    problems.push(`line ${line}: ${field} is "${value}" — expected a whole number`);
    return undefined;
  }
  return n;
}

// --------------------------------------------------------------------- apply

const data = JSON.parse(readFileSync(OUT_PATH, 'utf8'));

if (template) {
  writeTemplate(data.buildings);
  process.exit(0);
}

if (!existsSync(CSV_PATH)) {
  console.error(
    `No data/building-facts.csv.\n\n` +
      `Run \`npm run facts -- --template\` to generate it, fill in what you can find,\n` +
      `then run this again. Blank cells are left alone, so it is fine to do a few at a time.`,
  );
  process.exit(1);
}

const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
const header = rows.shift().map((h) => h.trim());
const index = Object.fromEntries(header.map((h, i) => [h, i]));

if (index.slug === undefined) {
  console.error('data/building-facts.csv has no `slug` column. Regenerate it with --template.');
  process.exit(1);
}

const bySlug = new Map(data.buildings.map((b) => [b.slug, b]));
const changes = [];

/**
 * Values this run would write, keyed `slug.field`.
 *
 * Kept even under --dry-run, where nothing is assigned. Without it the
 * provenance pass reads the old nulls and reports every new citation as
 * pointing at a blank — so a dry run would fail on exactly the input that a
 * real run accepts, which is the one thing a dry run must never do.
 */
const pending = new Map();

rows.forEach((row, i) => {
  const line = i + 2; // 1-based, plus the header
  const slug = row[index.slug]?.trim();
  const building = bySlug.get(slug);

  if (!building) {
    problems.push(`line ${line}: no development with slug "${slug}" in data/buildings.json`);
    return;
  }

  for (const field of Object.keys(FIELDS)) {
    if (index[field] === undefined) continue;

    const value = readCell(row[index[field]], field, line);
    if (value === undefined) continue;

    const target = TOP_LEVEL.has(field) ? building : building.facts;
    const before = target[field];
    pending.set(`${slug}.${field}`, value);

    const same = Array.isArray(value) ? JSON.stringify(before) === JSON.stringify(value) : before === value;
    if (same) continue;

    changes.push(`${slug}.${field}: ${JSON.stringify(before ?? null)} → ${JSON.stringify(value)}`);
    if (!dryRun) target[field] = value;
  }
});

// ---------------------------------------------------------------- provenance

/**
 * Apply data/building-facts-sources.csv on top of the values just written.
 *
 * Runs second on purpose. A citation is only meaningful once the value it cites
 * is in place, and checking afterwards is what lets a row for an empty field be
 * reported as the mistake it is.
 */
function applySources() {
  if (!existsSync(SOURCES_PATH)) return;

  const sourceRows = parseCsv(readFileSync(SOURCES_PATH, 'utf8'));
  if (sourceRows.length === 0) return;

  const head = sourceRows.shift().map((h) => h.trim());
  const at = Object.fromEntries(head.map((h, i) => [h, i]));

  for (const column of SOURCE_COLUMNS) {
    if (at[column] === undefined) {
      problems.push(`data/building-facts-sources.csv has no \`${column}\` column`);
      return;
    }
  }

  sourceRows.forEach((row, i) => {
    const line = i + 2;
    const where = `sources line ${line}`;
    const cell = (column) => row[at[column]]?.trim() ?? '';

    const slug = cell('slug');
    const field = cell('field');
    const confidence = cell('confidence');
    const checkedAt = cell('checkedAt');
    const sources = cell('sources').split(/\s+/).filter(Boolean);

    const building = bySlug.get(slug);
    if (!building) {
      problems.push(`${where}: no development with slug "${slug}"`);
      return;
    }
    if (!FIELDS[field]) {
      problems.push(`${where}: "${field}" is not a fact this importer knows — one of ${Object.keys(FIELDS).join(', ')}`);
      return;
    }
    if (!CONFIDENCE.has(confidence)) {
      problems.push(`${where}: confidence is "${confidence}" — expected verified or unverified`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) {
      problems.push(`${where}: checkedAt is "${checkedAt}" — expected an ISO date like 2026-08-16`);
      return;
    }
    if (sources.length === 0) {
      problems.push(`${where}: no sources. A provenance row that cites nothing records nothing`);
      return;
    }
    // Two independent sources is what the word means. One source that happens
    // to be authoritative is a judgement call the CSV can't express, so it is
    // spelled out as a second entry ("management notice, lobby") rather than
    // being waved through here.
    if (confidence === 'verified' && sources.length < 2) {
      problems.push(
        `${where}: ${field} is marked verified with one source. Cite the second, or mark it unverified`,
      );
      return;
    }

    // What the value will be once this run finishes, not what it was — under
    // --dry-run nothing has been assigned yet.
    const key = `${slug}.${field}`;
    const value = pending.has(key) ? pending.get(key) : TOP_LEVEL.has(field) ? building[field] : building.facts[field];

    if (value === null || value === undefined) {
      problems.push(
        `${where}: ${slug}.${field} has no value, so this citation points at a blank. ` +
          `Fill the cell in data/building-facts.csv, or drop this row`,
      );
      return;
    }

    const record = { confidence, sources, checkedAt };
    const before = building.factSources?.[field];
    if (JSON.stringify(before) === JSON.stringify(record)) return;

    changes.push(`${slug}.factSources.${field}: ${confidence}, ${sources.length} source(s)`);
    if (dryRun) return;

    building.factSources ??= {};
    building.factSources[field] = record;
  });
}

applySources();

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) — nothing was written:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

if (changes.length === 0) {
  console.log('Nothing to change. Every filled-in cell already matches data/buildings.json.');
  process.exit(0);
}

console.log(`${dryRun ? 'Would apply' : 'Applied'} ${changes.length} change(s):\n`);
for (const c of changes) console.log(`  ${c}`);

if (dryRun) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

writeFileSync(OUT_PATH, `${JSON.stringify(data, null, 2)}\n`);
console.log(`\nWrote data/buildings.json. Run \`npm run build\` to see it, \`npm run seed\` to publish it.`);
