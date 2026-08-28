/**
 * The store under data/raw/.
 *
 * One file per building, holding collected listings before anything is
 * published. Gitignored, never seeded — `scripts/derive.mjs` reads it and
 * decides what crosses into data/buildings.json.
 *
 * Shared by the collector and by scripts/parse-page.mjs so that a page fetched
 * by Playwright and a page saved from a browser land in the store the same way.
 * Two copies of a merge that maintains `firstSeen` would eventually disagree,
 * and the one that got it wrong would be silently wrong.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const RAW_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../data/raw');

/**
 * Merge listings into data/raw/<slug>.json.
 *
 * `firstSeen` is preserved across runs and is the only date here that is ours:
 * it records when *we* first saw a unit advertised, which is what a
 * days-on-market figure should be built from rather than the portal's own
 * posting date. Where we have never seen the unit before, the portal's posting
 * date is the better estimate than "now", so it seeds the value.
 */
export function mergeIntoRawStore(slug, listings, { rawDir = RAW_DIR } = {}) {
  if (listings.length === 0) return { added: 0, updated: 0 };

  mkdirSync(rawDir, { recursive: true });
  const path = join(rawDir, `${slug}.json`);
  const store = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { slug, listings: [] };

  const existing = new Map(store.listings.map((l) => [l.id, l]));
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;

  // `building` and `label` are how a listing was attributed, not facts about
  // the unit. They are dropped here rather than stored: the file is named for
  // the building, and the label is the advertiser's wording.
  for (const { building, label, postedAt, ...facts } of listings) {
    const previous = existing.get(facts.id);
    if (previous) updated++;
    else added++;
    existing.set(facts.id, {
      ...facts,
      firstSeen: previous?.firstSeen ?? postedAt ?? now,
      fetchedAt: now,
    });
  }

  store.listings = [...existing.values()];
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
  return { added, updated };
}
