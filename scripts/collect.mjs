/**
 * Collect listing facts from the portals, politely and under our own name.
 *
 *   node scripts/collect.mjs --probe            can we be served at all?
 *   node scripts/collect.mjs --source iproperty
 *   node scripts/collect.mjs --building kelana-puteri
 *
 * Watching it work:
 *
 *   node scripts/collect.mjs --headed --delay 5 --keep-open --source propertyguru
 *
 *   --headed     a real browser window instead of a hidden one
 *   --delay N    N seconds between page loads instead of 20–45, so it is
 *                followable. For watching only; leave it off for real runs
 *   --keep-open  hold the browser open at the end so you can read the page
 *   --include-disabled  also run sources switched off in sources.mjs
 *
 * Start with --probe. It fetches robots.txt through the same browser that would
 * do the collecting, checks the paths we want against it, loads one listing
 * page per source, and reports what happened — without extracting anything.
 * It answers "will they serve us" before any question about what to take.
 *
 * The pacing and identification rules live in collect/session.mjs, and the
 * reason they are not negotiable is at the top of that file.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Session, USER_AGENT, halt } from './collect/session.mjs';
import { fetchRobots, isAllowed } from './collect/robots.mjs';
import { extractListings } from './collect/extract.mjs';
import { mergeIntoRawStore } from './collect/raw-store.mjs';
import { SOURCES } from './collect/sources.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);

const probeOnly = flag('probe');
const headed = flag('headed');
const only = option('source');
const includeDisabled = flag('include-disabled');

/**
 * Watching a run at production pacing means staring at a spinner for most of a
 * minute between pages. `--delay 5` makes it followable. Only sensible for a
 * handful of loads while you watch — the 20–45s default is what an unattended
 * run should use.
 */
const delayOverride = option('delay') ? Number(option('delay')) * 1000 : null;

/** Hold the browser open at the end so you can read whatever is on screen. */
const keepOpen = flag('keep-open');

const selected = Object.entries(SOURCES).filter(([key, source]) => {
  if (only) return key === only;
  return source.enabled || includeDisabled;
});

if (selected.length === 0) {
  console.error(only ? `No source called "${only}".` : 'No sources enabled.');
  process.exit(1);
}

/** The developments this site covers. Names come from the published data. */
const onlyBuilding = option('building');
const buildings = JSON.parse(readFileSync(join(root, 'data/buildings.json'), 'utf8'))
  .buildings.filter((b) => !onlyBuilding || b.slug === onlyBuilding)
  .map((b) => ({ slug: b.slug, name: b.name }));

console.log(`Identifying as:\n  ${USER_AGENT}\n`);
if (!probeOnly) console.log(`Collecting for ${buildings.length} building(s).\n`);

// A probe is one page per source, so it can go faster than a collection run
// without being discourteous.
const session = await new Session({
  headed,
  minDelayMs: delayOverride ?? (probeOnly ? 5_000 : 20_000),
  maxDelayMs: delayOverride ?? (probeOnly ? 8_000 : 45_000),
}).start();

const findings = [];

try {
  for (const [key, source] of selected) {
    console.log(`\n── ${source.name} ${'─'.repeat(Math.max(0, 40 - source.name.length))}`);

    if (!source.enabled && !only) {
      console.log(`  skipped: ${source.disabledReason}`);
      continue;
    }
    if (!source.enabled) {
      console.log(`  ! enabled by hand for this run.\n    Standing reason it is off: ${source.disabledReason}`);
    }

    // 1. The rules, read through the browser that will follow them.
    const robots = await fetchRobots(session.page, source.origin, USER_AGENT);

    if (!robots.ok) {
      console.log(`  robots.txt: unreadable — ${robots.reason}`);
      console.log(`  → We cannot confirm what is permitted, so nothing is. Skipping.`);
      findings.push({ source: source.name, robots: 'unreadable', served: null, verdict: 'blocked' });
      continue;
    }

    console.log(`  robots.txt: HTTP ${robots.status}, ${robots.rules.length} rules` +
      (robots.crawlDelaySeconds ? `, crawl-delay ${robots.crawlDelaySeconds}s` : ''));

    if (robots.prohibition) {
      console.log(`  ! written prohibition: "${robots.prohibition}"`);
      console.log(`  → Directives are not the whole file. Skipping.`);
      findings.push({ source: source.name, robots: 'prohibited', served: null, verdict: 'prohibited' });
      continue;
    }

    // 2. Are the paths we actually want covered by those rules?
    const path = source.searchPaths[0];
    if (!isAllowed(robots, new URL(path, source.origin).pathname)) {
      console.log(`  ${path} is disallowed by robots.txt. Skipping.`);
      findings.push({ source: source.name, robots: 'disallowed', served: null, verdict: 'disallowed' });
      continue;
    }
    console.log(`  ${path}: allowed by robots.txt`);

    // 3. Will they actually serve us?
    const result = await session.visit(new URL(path, source.origin).href, {
      crawlDelaySeconds: robots.crawlDelaySeconds,
    });

    if (result.blocked) {
      console.log(`  page load: blocked (${result.blockReason})`);
      halt(source.name, result);
      findings.push({ source: source.name, robots: 'ok', served: false, verdict: 'blocked' });
      continue;
    }

    if (!result.ok) {
      console.log(`  page load: failed — ${result.error ?? `HTTP ${result.status}`}`);
      findings.push({ source: source.name, robots: 'ok', served: false, verdict: 'error' });
      continue;
    }

    // Rough signal that we got listings rather than a landing page.
    const priceHits = (result.text.match(/RM\s?[\d,]{3,}/g) ?? []).length;
    console.log(`  page load: HTTP ${result.status} — "${result.title.slice(0, 60)}"`);
    console.log(`  content: ${result.text.length.toLocaleString('en-MY')} chars, ${priceHits} RM figures`);

    findings.push({
      source: source.name,
      robots: 'ok',
      served: true,
      verdict: priceHits > 5 ? 'serving listings' : 'served, but no listing grid found',
    });

    if (probeOnly) continue;

    // ---- collection ------------------------------------------------------
    // One search per building, by name. Fewer page loads than walking the area
    // listings, and no guessing about which development a unit belongs to.
    for (const building of buildings) {
      const page = await session.visit(source.searchUrl(building.name), {
        crawlDelaySeconds: robots.crawlDelaySeconds,
      });

      if (page.blocked) {
        console.log(`\n  ${building.name}: blocked (${page.blockReason})`);
        halt(source.name, page);
        break;
      }
      if (!page.ok) {
        console.log(`\n  ${building.name}: ${page.error ?? `HTTP ${page.status}`}`);
        continue;
      }

      const html = await session.page.content();
      const { listings, error, seen, unmatched } = extractListings(html, {
        source: key,
        buildingNames: [building.name],
      });

      if (error) {
        console.log(`\n  ${building.name.padEnd(32)} ${error}`);
        continue;
      }

      const { added, updated } = mergeIntoRawStore(building.slug, listings);
      console.log(
        `\n  ${building.name.padEnd(32)} ${String(listings.length).padStart(2)} matched ` +
          `of ${String(seen).padStart(2)} on page → ${added} new, ${updated} updated`,
      );
    }
  }
} finally {
  if (keepOpen) {
    console.log(`\n[--keep-open] Browser is still up. Press Enter to close it.`);
    await new Promise((resolve) => process.stdin.once('data', resolve));
  }
  await session.close();
}

console.log(`\n\n═══ Findings ═══`);
for (const f of findings) {
  console.log(`  ${f.source.padEnd(14)} ${f.verdict}`);
}

const usable = findings.filter((f) => f.verdict === 'serving listings');
console.log(
  usable.length > 0
    ? `\n${usable.length} source(s) will serve an identified browser. Extraction is worth building for those.`
    : `\nNo source served us. That is the answer — see docs/data-policy.md for the routes that don't involve being served.`,
);

if (probeOnly) console.log(`\nProbe only: ${session.pagesLoaded} pages loaded, nothing extracted or stored.`);
