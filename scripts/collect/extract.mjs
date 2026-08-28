/**
 * Turn a rendered search page into facts.
 *
 * Both portals are the same platform underneath, so both ship their results as
 * a Next.js `__NEXT_DATA__` payload with an identical `listingsData` shape. We
 * read that rather than the rendered markup: it gives named numeric fields
 * instead of parsed strings, it doesn't break when a class name changes, and
 * — the part that matters here — it lets us name the fields we want instead of
 * hoovering up a card and stripping it afterwards.
 *
 * That distinction is the whole design. The payload contains, for every
 * listing: the agent's name, licence number, profile URL and avatar; the
 * advertiser's own description; a thumbnail; and often several dozen photo
 * URLs. All of it sits one property access away. `pickFacts` takes its fields
 * by name and never looks at the rest, and `assertNoContraband` fails loudly if
 * anything else ever appears in the output.
 *
 * Two entry points:
 *   `parseSearchPage`  every listing on the page, plus what the page says about
 *                      itself. Use this on a saved page, or when you want to see
 *                      what a search actually returned.
 *   `extractListings`  the same, narrowed to buildings we cover. This is what
 *                      the collector stores.
 *
 * One thing worth knowing about the URLs. PropertyGuru builds a listing URL
 * from the development, the intent and the agent's name —
 * `/property-listing/ara-damansara-for-rent-by-celine-chin-501677117` — so
 * storing it verbatim stores an agent name, which is the one thing
 * docs/data-policy.md says we never do. `canonicalUrl` reduces it to
 * `/property-listing/501677117`, which was checked in a browser on 14 Aug 2026:
 * 200, and PropertyGuru itself redirects to the named form. So the short form
 * is the default, and `stripUrlSlug: false` is the escape hatch if that ever
 * stops being true.
 */

/** The only fields we lift out of a listing. Everything else is left behind. */
const FACT_FIELDS = [
  'id',
  'beds',
  'baths',
  'sqft',
  'priceMyr',
  'propertyType',
  'buildYear',
  'furnishing',
  'source',
  'sourceUrl',
  'postedAt',
];

/** Key fragments that must never appear in an extracted record. */
const CONTRABAND = ['agent', 'description', 'photo', 'image', 'thumbnail', 'phone', 'avatar', 'licen'];

/** What the portal puts in `bedrooms` for a studio. Not a missing value. */
const STUDIO_BEDROOMS = -1;

/**
 * A room in someone's unit, advertised in the same results as whole units.
 *
 * The portal marks these only in the card's feature text — "Common Room",
 * "Master Room", "2 pax" — and gives them no floor area, so they would fail the
 * numeric checks anyway. Naming them matters because the *reason* matters: a
 * RM650 room is not a cheap unit, and letting one into a development's median
 * would drag it somewhere no tenant could actually rent. Counted separately so
 * a future session can see they were excluded on purpose.
 */
const ROOM_RENTAL = /\b(common|master|single|middle|partition)\s+room\b|\bpax\b/i;

/** Pull the Next.js payload out of a rendered page. */
export function parsePayload(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** Locate the results array. Both portals put it in the same place. */
export function listingsFrom(payload) {
  return payload?.props?.pageProps?.pageData?.data?.listingsData ?? [];
}

/**
 * What the page says about the search it answered.
 *
 * Worth having because it is the difference between "this development has four
 * units" and "this is page one of seventy-nine and we stopped". A parse that
 * silently reads 20 of 1,562 results looks identical to a complete one.
 */
export function pageInfoFrom(payload) {
  const pageData = payload?.props?.pageProps?.pageData ?? {};
  const pagination = pageData.data?.paginationData ?? {};
  return {
    query: payload?.query?.freetext ?? null,
    listingType: payload?.query?.listingType ?? null,
    resultCount: Number(pageData.resultCount) || 0,
    currentPage: Number(pagination.currentPage) || 1,
    totalPages: Number(pagination.totalPages) || 1,
  };
}

/** One of the icon-and-text pairs under a card: beds, baths, parking, build year. */
function featureText(listing, dataAutomationId) {
  for (const group of listing.listingFeatures ?? []) {
    for (const item of Array.isArray(group) ? group : [group]) {
      if (item?.dataAutomationId === dataAutomationId) return item.text ?? null;
    }
  }
  return null;
}

/** Is this card a room inside someone's unit, rather than the unit itself? */
export function isRoomRental(listing) {
  for (const group of listing?.listingFeatures ?? []) {
    for (const item of Array.isArray(group) ? group : [group]) {
      if (typeof item?.text === 'string' && ROOM_RENTAL.test(item.text)) return true;
    }
  }
  return false;
}

/**
 * Strip the descriptive slug from a listing URL, leaving the id.
 *
 * PropertyGuru builds it from the development, the intent and the agent's name.
 * The id is the only part that identifies the listing; the rest is decoration
 * that happens to include personal data.
 */
export function canonicalUrl(url) {
  const match = url.match(/^(https?:\/\/[^/]+\/property-listing\/).*?(\d{6,})\/?$/);
  return match ? `${match[1]}${match[2]}` : url;
}

/** Does this URL carry more than an id in its path? */
export function urlHasSlug(url) {
  return typeof url === 'string' && canonicalUrl(url) !== url;
}

/**
 * Named reads. No spread, no rest, no "delete the bad keys" —
 * a delete-list silently passes through whatever the portal adds next.
 */
function pickFacts(entry, source, { stripUrlSlug = true } = {}) {
  const l = entry?.listingData;
  if (!l) return null;

  // A studio is reported as -1 bedrooms, which is a value, not an absence.
  // Reading it as a missing number drops every studio on the page — on the
  // saved Ara Damansara pages that is a third of the results, all of them
  // exactly the serviced-suite stock this site is about.
  const rawBeds = Number(l.bedrooms);
  const beds = rawBeds === STUDIO_BEDROOMS ? 0 : rawBeds;
  const baths = Number(l.bathrooms);
  const sqft = Number(l.floorArea);
  const priceMyr = Number(l.price?.value);

  // A listing missing any of these isn't a partial record, it's a different
  // kind of thing (a project ad, a land plot). Skip it rather than store zeros.
  // Beds is the exception: zero is a studio and a studio is a real unit.
  if (!Number.isFinite(beds) || beds < 0) return null;
  if (![baths, sqft, priceMyr].every((n) => Number.isFinite(n) && n > 0)) return null;

  // `externalId` is usually the id as a string and is occasionally null; `id`
  // has been present on every record seen. Prefer the one that is always there.
  const id = l.id ?? l.externalId;
  if (id == null) return null;

  const url = typeof l.url === 'string' ? l.url.split('?')[0] : null;
  const buildYear = Number((featureText(l, 'listing-card-v2-build-year') ?? '').match(/\d{4}/)?.[0]);

  return {
    id: `${source}-${id}`,
    beds,
    baths,
    sqft,
    priceMyr,
    // The portal's own controlled vocabulary — "Service Residence",
    // "2-storey Terraced House" — not the advertiser's wording. An area search
    // returns landed housing alongside condominiums, and this is what tells
    // them apart without reading anyone's copy.
    propertyType: l.property?.subTypeText ?? null,
    buildYear: Number.isFinite(buildYear) ? buildYear : null,
    source,
    sourceUrl: url && stripUrlSlug ? canonicalUrl(url) : url,
    // Not in the search payload. Left explicitly unknown rather than guessed
    // from the advertiser's wording, which would be both unreliable and a use
    // of their copy we don't need to make.
    furnishing: 'unknown',
    // Their posting date, which is a fact about the advert. Our own firstSeen
    // is set on merge and is the one we'd publish a days-listed figure from.
    postedAt: l.postedOn?.unix ? new Date(l.postedOn.unix * 1000).toISOString() : null,
  };
}

/** What the listing calls itself, used only to decide which building it belongs to. */
function labelFor(entry) {
  const l = entry?.listingData ?? {};
  return [l.localizedTitle, l.fullAddress, l.shortAddress, l.additionalData?.districtText]
    .filter(Boolean)
    .join(' | ');
}

/**
 * Guard rather than filter.
 *
 * If contraband ever reaches here, the right response is to stop and fix the
 * extractor, not to quietly strip it and carry on — a silent strip means the
 * next field they add rides along unnoticed.
 */
function assertNoContraband(record) {
  for (const key of Object.keys(record)) {
    const lower = key.toLowerCase();
    const hit = CONTRABAND.find((c) => lower.includes(c));
    if (hit) throw new Error(`extractor produced a "${key}" field — contains "${hit}". Fix pickFacts.`);

    // FACT_FIELDS is the list at the top of this file. Checking against it here
    // is what keeps that list true rather than a comment that used to be true.
    if (!FACT_FIELDS.includes(key)) {
      throw new Error(`extractor produced a "${key}" field, which isn't in FACT_FIELDS. Add it there deliberately or drop it.`);
    }
  }
  return record;
}

/**
 * Every listing on the page, with no view about which building it belongs to.
 *
 * Records carry a `label` — the listing's own title and address — which exists
 * so a caller can group or match on it. It is the advertiser's wording, so it
 * is attribution input and nothing else: `extractListings` drops it before the
 * record can reach the raw store, and it must never be published.
 */
export function parseSearchPage(html, { source, stripUrlSlug = true } = {}) {
  const empty = { listings: [], seen: 0, skipped: { rooms: 0, incomplete: 0 } };
  const payload = parsePayload(html);
  if (!payload) return { error: 'no __NEXT_DATA__ payload — page shape changed', ...empty };

  const entries = listingsFrom(payload);
  if (entries.length === 0) {
    return { error: 'payload had no listingsData', page: pageInfoFrom(payload), ...empty };
  }

  const listings = [];
  const skipped = { rooms: 0, incomplete: 0 };

  for (const entry of entries) {
    // Checked before the numeric tests, so a room is counted as a room rather
    // than as a listing with a missing floor area — which is what it looks like.
    if (isRoomRental(entry?.listingData)) {
      skipped.rooms++;
      continue;
    }

    const facts = pickFacts(entry, source, { stripUrlSlug });
    if (!facts) {
      skipped.incomplete++;
      continue;
    }
    listings.push({ ...assertNoContraband(facts), label: labelFor(entry) });
  }

  return { page: pageInfoFrom(payload), listings, seen: entries.length, skipped };
}

/**
 * Extract every listing on the page that belongs to one of `buildingNames`.
 *
 * Matching is deliberately conservative: the building's name must appear in the
 * listing's own title or address. A listing we can't confidently attribute is
 * dropped, because attaching a unit to the wrong development is worse than
 * having fewer units.
 */
export function extractListings(html, { source, buildingNames, stripUrlSlug = true }) {
  const { error, page, listings: all, seen, skipped } = parseSearchPage(html, { source, stripUrlSlug });
  if (error) return { error, listings: [] };

  const targets = buildingNames.map((name) => ({ name, needle: normalise(name) }));

  const listings = [];
  let unmatched = 0;

  for (const { label, ...facts } of all) {
    const target = targets.find((t) => normalise(label).includes(t.needle));
    if (!target) {
      unmatched++;
      continue;
    }
    listings.push({ ...facts, building: target.name });
  }

  return { listings, page, seen, skipped, unmatched };
}

/** Compare names the way a human would: ignoring case, punctuation and spacing. */
export function normalise(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export { FACT_FIELDS };
