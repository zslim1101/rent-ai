/**
 * The shape of one building document.
 *
 * This is the contract between `data/buildings.json`, Firestore, and the pages.
 * One document per development (not per block) — keyed by `slug`.
 */

/**
 * `unknown` is not a missing value — it is what we know. Furnishing isn't in
 * either portal's search payload, and guessing it from the advertiser's
 * description would be both unreliable and a use of their words we don't need
 * to make. See scripts/collect/extract.mjs.
 */
export type Furnishing = 'furnished' | 'partial' | 'bare' | 'unknown';

/**
 * A listing summary. Deliberately narrow: measurements, price, and a link out.
 * No photos, no description text, no agent names or phone numbers — those belong
 * to whoever published them, so we link to the source rather than reproduce it.
 *
 * `scripts/check-publishable.mjs` asserts this key set exactly. Widening the
 * interface without widening that script's allowlist fails the build, which is
 * the point: the boundary is checked, not merely documented.
 */
/**
 * Where a unit sits against the ones a tenant would weigh it against: same
 * development, same bedroom count. Computed arithmetically in derive.mjs, not
 * generated — `analysis` is the generated one.
 */
export interface ValueScore {
  /** Share of comparable units that cost more per sqft, 0–1. */
  cheaperThan: number;
  /** How many comparable units the score is drawn from. Never below 5. */
  cohort: number;
  /**
   * `check` means implausibly cheap for its cohort — likelier a mis-keyed floor
   * area or a room advertised as a unit than a bargain, so it is surfaced as a
   * question rather than a recommendation.
   */
  band: 'good-value' | 'typical' | 'pricey' | 'check';
}

export interface Listing {
  /** Stable across refreshes, carried over from the raw record. */
  id?: string;
  beds: number;
  baths: number;
  sqft: number;
  priceMyr: number;
  furnishing: Furnishing;
  source: string;
  sourceUrl: string;
  /**
   * How many adverts carried these exact numbers. Present only when above 1.
   * Deliberately not called "duplicates": we cannot tell one flat advertised
   * five times from five identical flats, and this number is true either way.
   */
  copies?: number;
  /** Absent when the development has fewer than five comparable units. */
  value?: ValueScore;
  /**
   * When we first saw this unit advertised. Days-on-market falls out of it, and
   * that is a fact about our own observation rather than anything we took from
   * a portal — which makes it one of the few numbers here that is wholly ours.
   */
  firstSeen?: string;
  lastSeen?: string;
  analysis?: UnitAnalysis;
}

/**
 * Where a piece of generated analysis came from, so a stale or thin one is
 * visible rather than implied.
 */
export interface Provenance {
  generatedAt: string;
  /** Model ID, recorded because output shifts between models. */
  model: string;
  /** How many listings backed the judgement. */
  listingCount: number;
  /** Hash of the inputs, so unchanged buildings can be skipped on a re-run. */
  inputHash: string;
}

/** Our read on one unit. Our words, our opinion, our copyright. */
export interface UnitAnalysis {
  verdict: 'below-market' | 'at-market' | 'above-market' | 'unclear';
  /** One or two sentences. */
  summary: string;
  /** Short observations worth surfacing on their own. */
  signals: string[];
  provenance: Provenance;
}

/** Our read on a whole development. */
export interface BuildingAnalysis {
  summary: string;
  strengths: string[];
  caveats: string[];
  provenance: Provenance;
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
  /** Distinct units, after identical adverts are collapsed into one. */
  listingCount: number;
  /** Adverts behind those units. Higher than listingCount where agents overlap. */
  advertCount?: number;
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

/**
 * How much weight a gathered fact carries.
 *
 * `verified` — two independent sources agree, or one that is authoritative for
 * the field: a management notice, a strata AGM document, the developer's own
 * specification.
 * `unverified` — a single second-hand source that could be stale or could be
 * about a neighbouring development: a forum post, a listing blurb, an undated
 * directory page.
 *
 * The distinction exists because the alternative is worse than an empty cell.
 * A maintenance fee read off a management notice and one found in a years-old
 * forum thread are the same number and are not the same claim, and "—" is more
 * honest than either if the reader cannot tell which they are looking at. So
 * this is rendered, not merely stored — see the building page.
 */
export type FactConfidence = 'verified' | 'unverified';

export interface FactSource {
  confidence: FactConfidence;
  /**
   * Where the value came from. URLs where there is one, a short label where
   * there isn't ("management notice, lobby"). Plural because `verified` means
   * two agreed, and dropping one of them loses the evidence for the claim.
   */
  sources: string[];
  /** ISO date the sources were last read. These numbers go stale. */
  checkedAt: string;
}

export interface Building {
  slug: string;
  name: string;
  area: string;
  address: string;
  completionYear: number | null;
  totalUnits: number | null;
  facts: Facts;
  /**
   * Provenance for the gathered fields, keyed by field name.
   *
   * Building-level rather than inside `Facts` because two of the fields it
   * covers — `completionYear` and `totalUnits` — are not in `Facts`, and one
   * map that covers every gathered field beats two that each cover half.
   *
   * A field absent from this map makes no claim about its own sourcing. That is
   * the right reading for `completionYear`, which derive.mjs also fills from
   * agreeing listings without anybody looking anything up.
   */
  factSources?: Record<string, FactSource>;
  metrics: Metrics;
  reviews: Reviews;
  listings: Listing[];
  analysis?: BuildingAnalysis;
  /** Which portals and datasets the listings came from. */
  sources?: string[];
  /** ISO date of the last derivation run that touched this building. */
  updatedAt?: string;
  /** True while the row is placeholder data rather than something verified. */
  sample?: boolean;
}
