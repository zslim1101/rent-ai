/**
 * The shape of one building document.
 *
 * This is the contract between `data/buildings.json`, Firestore, and the pages.
 * One document per development (not per block) — keyed by `slug`.
 */

export type Furnishing = 'furnished' | 'partial' | 'bare';

/**
 * A listing summary. Deliberately narrow: measurements, price, and a link out.
 * No photos, no description text, no agent names or phone numbers — those belong
 * to whoever published them, so we link to the source rather than reproduce it.
 */
export interface Listing {
  beds: number;
  baths: number;
  sqft: number;
  priceMyr: number;
  furnishing: Furnishing;
  source: string;
  sourceUrl: string;
}

export interface BedroomStat {
  beds: number;
  medianRentMyr: number;
  count: number;
}

/** Everything we compute rather than copy. */
export interface Metrics {
  medianRentMyr: number;
  medianSqft: number;
  medianPsf: number;
  listingCount: number;
  byBedroom: BedroomStat[];
}

export interface ReviewTheme {
  label: string;
  sentiment: 'positive' | 'mixed' | 'negative';
  mentions: number;
}

export interface Reviews {
  count: number;
  average: number;
  themes: ReviewTheme[];
}

/** Hard facts about the building itself. */
export interface Facts {
  maintenancePsf: number | null;
  parkingPerUnit: number | null;
  liftCount: number | null;
  fibreProviders: string[];
  nearestStation: string | null;
  walkMinutesToStation: number | null;
}

export interface Building {
  slug: string;
  name: string;
  area: string;
  address: string;
  completionYear: number | null;
  totalUnits: number | null;
  facts: Facts;
  metrics: Metrics;
  reviews: Reviews;
  listings: Listing[];
  /** True while the row is placeholder data rather than something verified. */
  sample?: boolean;
}
