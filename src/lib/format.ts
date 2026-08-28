/** Small formatting helpers, shared by the pages. */

export const myr = (n: number): string =>
  `RM${n.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`;

export const psf = (n: number): string => `RM${n.toFixed(2)}/sqft`;

export const sqft = (n: number): string => `${n.toLocaleString('en-MY')} sqft`;

export const furnishingLabel: Record<string, string> = {
  furnished: 'Fully furnished',
  partial: 'Partly furnished',
  bare: 'Unfurnished',
  /**
   * Not on the portal's search payload, so most collected units land here. Says
   * "we don't know" rather than implying bare, which is what a blank would.
   */
  unknown: 'Not stated',
};

/**
 * A studio is stored as zero bedrooms — the portal's own encoding, once its -1
 * is normalised — and "0 bed" is not what anyone calls it.
 */
export const bedLabel = (beds: number): string => (beds === 0 ? 'Studio' : `${beds} bed`);

/**
 * "A, B and C" — the areas the site covers, read from the data rather than
 * written down. Coverage grows a search at a time, and a hard-coded list is a
 * promise that quietly stops being true the moment it does.
 */
export function areaList(areas: string[]): string {
  const sorted = [...new Set(areas)].sort();
  if (sorted.length <= 1) return sorted[0] ?? '';
  return `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
}

/**
 * Medians drawn from a handful of listings are noise, not signal. Anything under
 * five gets flagged in the UI rather than presented as a finding.
 *
 * scripts/derive.mjs and scripts/analyse.mjs keep their own copies of this
 * number, because a .mjs script can't import a .ts module without a build step.
 * scripts/check-publishable.mjs fails the build if the three drift apart.
 */
export const LOW_CONFIDENCE_THRESHOLD = 5;

export const isLowConfidence = (listingCount: number): boolean =>
  listingCount < LOW_CONFIDENCE_THRESHOLD;

/**
 * Wording for a unit verdict.
 *
 * Phrased against the building rather than "the market", because that is what
 * the comparison actually was — the other units in the same block. Claiming
 * more than that would be overreach.
 */
export const verdictLabel: Record<string, string> = {
  'below-market': 'Cheaper than similar units here',
  'at-market': 'In line with similar units here',
  'above-market': 'Pricier than similar units here',
  unclear: 'Too few listings to say',
};

/**
 * Wording for the arithmetic value score.
 *
 * Phrased against the development, like the generated verdict, because that is
 * the comparison that was made — the other units in the same block with the
 * same bedroom count. It is not a claim about the corridor or the market.
 */
export const valueLabel: Record<string, string> = {
  'good-value': 'Cheaper than most here',
  typical: 'Typical for here',
  pricey: 'Pricier than most here',
  /** Not a compliment. Something about this listing does not add up. */
  check: 'Oddly cheap — check it',
};

export const valueTone: Record<string, string> = {
  'good-value': 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  typical: 'bg-stone-100 text-stone-600 ring-stone-200',
  pricey: 'bg-stone-100 text-stone-500 ring-stone-200',
  check: 'bg-amber-50 text-amber-800 ring-amber-200',
};

/** The sentence behind the chip, for a title attribute. */
export const valueDetail = (value: { cheaperThan: number; cohort: number; band: string }): string =>
  value.band === 'check'
    ? `More than 30% below the going rate for the ${value.cohort} comparable units here — likelier a mistake in the advert than a bargain`
    : `Cheaper per sqft than ${Math.round(value.cheaperThan * 100)}% of the ${value.cohort} comparable units in this development`;

/** Tailwind classes per verdict, kept next to the wording so they stay in step. */
export const verdictTone: Record<string, string> = {
  'below-market': 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  'at-market': 'bg-stone-100 text-stone-700 ring-stone-200',
  'above-market': 'bg-amber-50 text-amber-800 ring-amber-200',
  unclear: 'bg-stone-100 text-stone-500 ring-stone-200',
};
