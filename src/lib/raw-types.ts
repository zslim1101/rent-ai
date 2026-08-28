/**
 * The shape of collected listing data, before anything is published.
 *
 * This is deliberately a separate type from `Listing` in `types.ts`, not an
 * extension of it. The two describe different things: this one describes what
 * we hold on disk, that one describes what the world sees. Keeping them
 * unrelated means you cannot pass one where the other is expected, and a
 * raw record cannot drift into a published file by accident.
 *
 * Nothing of this shape is ever written to `data/buildings.json` or pushed to
 * Firestore. It lives in `data/raw/`, which is gitignored.
 */

import type { Furnishing } from './types';

/**
 * One collected listing.
 *
 * There are no agent name or phone fields, and adding them would be a mistake
 * rather than an omission. Malaysia's PDPA treats both as personal data, and
 * the cheapest way to never mishandle personal data is to never hold it — the
 * collector drops those fields where it parses, so they touch no disk at all.
 */
export interface RawListing {
  /** Stable across refreshes, so a unit can be followed rather than re-counted. */
  id: string;

  /** Facts. These are the only fields that survive into the published file. */
  beds: number;
  baths: number;
  sqft: number;
  priceMyr: number;
  furnishing: Furnishing;

  /** Which portal, and the page this came from. */
  source: string;
  sourceUrl: string;

  /**
   * The listing's own words.
   *
   * Input to the analysis step and nothing else — never rendered, never copied
   * into a published field, never quoted back. It is someone else's writing,
   * and reading it to form our own opinion is a different act from
   * republishing it. `purgeExpired()` in `scripts/derive.mjs` strips it once
   * it is 30 days old, so the store doesn't accumulate text we no longer need.
   */
  descriptionText?: string;

  /** ISO timestamps. `firstSeen` survives a refresh; `fetchedAt` does not. */
  firstSeen: string;
  fetchedAt: string;
}

/** One building's collected listings, as stored at `data/raw/<slug>.json`. */
export interface RawBuilding {
  slug: string;
  listings: RawListing[];
}

/** Fields of a `RawListing` that may cross into published data. */
export const PUBLISHABLE_LISTING_FIELDS = [
  'beds',
  'baths',
  'sqft',
  'priceMyr',
  'furnishing',
  'source',
  'sourceUrl',
] as const;
