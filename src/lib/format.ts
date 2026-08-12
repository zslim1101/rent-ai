/** Small formatting helpers, shared by the pages. */

export const myr = (n: number): string =>
  `RM${n.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`;

export const psf = (n: number): string => `RM${n.toFixed(2)}/sqft`;

export const sqft = (n: number): string => `${n.toLocaleString('en-MY')} sqft`;

export const furnishingLabel: Record<string, string> = {
  furnished: 'Fully furnished',
  partial: 'Partly furnished',
  bare: 'Unfurnished',
};

/**
 * Medians drawn from a handful of listings are noise, not signal. Anything under
 * five gets flagged in the UI rather than presented as a finding.
 */
export const LOW_CONFIDENCE_THRESHOLD = 5;

export const isLowConfidence = (listingCount: number): boolean =>
  listingCount < LOW_CONFIDENCE_THRESHOLD;
