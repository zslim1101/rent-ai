# The facts we still need, and where to get them

Every rent number on this site came from a portal. Every fact *about the buildings* is
still blank — and those are the ones a portal will not tell you, which is the whole
reason this site exists rather than being a mirror of PropertyGuru.

29 developments, 7 blank fields each. This is the manual half of the project.

## What's missing

Counted against `data/buildings.json` after the web pass of 16 Aug 2026:

| Field | Missing | Verified | What it means |
|---|---|---|---|
| `totalUnits` | 7 of 29 | 3 | Units in the development. Drives "units per lift". |
| `maintenancePsf` | 21 of 29 | 1 | Service charge per sqft per month, in RM. |
| `parkingPerUnit` | 28 of 29 | 0 | Bays allocated per unit. |
| `liftCount` | 29 of 29 | 0 | Passenger lifts serving residential floors. |
| `fibreProviders` | 29 of 29 | 0 | Which fibre you can actually get. |
| `nearestStation` | 28 of 29 | 0 | Nearest LRT/MRT station. |
| `walkMinutesToStation` | 29 of 29 | 0 | Walking minutes to it. |
| `completionYear` | 0 of 29 | 0 | Filled from listings where they agreed, or from the web. |

## What a web pass can and cannot do

Tried on 16 Aug 2026, across all 29. The result is worth writing down, because the
obvious next instinct is to try it again.

**It works for `totalUnits` and `completionYear`.** Directory and review pages —
StarProperty, iRumah, EdgeProp, developers' own microsites — publish those. 22 of 29 unit
counts came out of one afternoon.

**It does nothing for `liftCount`, `parkingPerUnit` or `fibreProviders`.** Not "thin" —
zero, across all 29. Nobody publishes them. Searches return facility lists ("parking,
gymnasium, squash court"), never counts. These need the guardhouse or a coverage checker,
exactly as listed below.

**`maintenancePsf` yields a number for about a fifth of them, none corroborated.** Every
figure found traces to a single review page or forum post with no date on it. They are in
the data as `unverified` and rendered as such. A phone call to the JMB replaces any of
them with something real.

**Two portals refuse automated fetches outright.** iProperty and EdgeProp return 403 to a
scripted request, the same wall `docs/data-policy.md` records for listing collection.
StarProperty and iRumah serve. Search-engine summaries reach the 403 sites' content, but
see below.

**Search summaries conflate neighbouring developments, and will do it confidently.** Three
caught in one sitting: an Empire *City* forum fee attributed to Empire *Damansara*; a
"3-minute walk to Sri Damansara Barat" for Damansara Perdana, which is a different
township across the NKVE; and Pinnacle Kelana Jaya described as next to Asia Jaya LRT,
which is a different Pinnacle. Every one of them was plausible. This is why the default
confidence is `unverified` and why single-source facts are tagged on the page.

**Where sources disagreed about scope, the field was left blank rather than guessed.**
Perdana View (388 condo units, or 448 including the serviced blocks?), Flora Damansara
(the "Flat" and the "Apartment" are two different buildings), Empire Damansara (a block
breakdown that sums to 1,671 against a stated 1,681). One page per development makes
these genuinely ambiguous, not merely unknown.

## Forums: the only source that has the operational facts

Tried 16 Aug 2026, after the directory pass. Worth its own section, because it reaches
fields nothing else does.

**Reddit is unreachable.** `reddit.com` is not accessible to our search agent or to
WebFetch — it fails at the network layer, not the parsing one. There is no version of this
that works, so don't plan around it.

**Lowyat works, and is the best source for the fields portals omit.** Owners' threads and
"is it worth buying" threads discuss exactly what a directory page never states: what the
fee actually is, whether the lifts break, how many bays a unit gets. It produced the
project's only `parkingPerUnit` (Ritze Perdana 1, one bay per unit), corroborated Ritze
Perdana 1's RM0.26 fee against PropSocial — the site's only `verified` maintenance figure
— corroborated D'Vervain's 1,066 units via a 604 + 462 tower breakdown, and gave The Arcuz
RM0.38 and Kelana Mahkota ~RM0.25.

**Individual thread pages 403 the fetcher.** Only the search index reaches them, so the
figures arrive through a summariser with no way to read the surrounding post. Treat every
one as `unverified` unless a second publisher says the same thing.

**Fees quoted in an advert can be back-calculated, and that is a weaker fact.** Kelana
Mahkota's RM0.25 comes from RM450 on 1,814 sqft and RM307 on 1,260 sqft — 0.248 and 0.244.
Two adverts on one forum is not two sources.

**A lift count still needs the building, not the thread.** A Metropolitan Square thread
states six lifts, and it was left out: the development is six blocks, so "six lifts" is
almost certainly per block. Recorded against a 1,929-unit development it would render
"322 units per lift" as a headline. Where a forum figure's scope is ambiguous and the page
computes something from it, leaving it blank is the safer error.

**Reviews were not attempted, and forums do not change that.** `reviews.count`, `average`
and `themes` stay empty on all 29. The available sources are other people's written reviews on PropSocial, iProperty and
Google Maps, and summarising them into themes republishes their content — the same
boundary `scripts/check-publishable.mjs` enforces for listing descriptions. Reviews need
to be first-party or licensed, not scraped. That is a product decision, not a gap in
this pass.

## Why these seven

They are the ones that change a decision and cannot be inferred from a listing:

- **Maintenance fee** is the second-biggest number a tenant pays and never appears in a
  rental advert. At RM0.35/sqft a 1,000 sqft unit carries RM350/month, which reorders any
  ranking by rent.
- **Units per lift** is the difference between a five-minute wait each morning and not.
  It needs `totalUnits` and `liftCount` together; the page already computes it.
- **Walk to the station** is the single most-asked question in this corridor, and
  "500m away" on a portal often means across a highway with no crossing.
- **Fibre** decides whether someone can work from home. Unifi coverage is not universal.

## How to gather them, cheapest first

**1. Walk-to-station and nearest station — Google Maps, ~2 minutes each.**
Drop the development's address in, pick the nearest LRT/MRT, and use walking directions.
Take the number Maps gives and round up. Check the route is actually walkable — if it
crosses the LDP with no pedestrian bridge, that matters more than the minutes.

**2. Completion year and total units — the developer's or JMB's page, or EdgeProp /
PropertyGuru's project page** (the project page, not a listing — that is published
reference data about the building, not someone's advert). Wikipedia and the Selangor
COB listings sometimes carry unit counts for larger schemes.

**3. Maintenance fee — hardest, most valuable.** In rough order of reliability:
   - The building's JMB/MC office, by phone. They will tell you the current rate.
   - An agent marketing a unit there — it is the first thing a tenant asks, so they know.
     Ask about a listing you found on the site.
   - Owner/tenant Facebook groups for the development, which usually exist.
   - Property forums (LowYat, EdgeProp comments) for a figure to verify, not to trust.

**4. Lifts and parking — a site visit, or ask the guardhouse.** For the Damansara Perdana
blocks you could cover Empire City, Empire Damansara and Metropolitan Square in one
afternoon: they are within walking distance of each other.

**5. Fibre — the providers' coverage checkers.** Unifi, Time and Maxis each have an
address lookup. Time in particular is building-by-building, and its presence is a genuine
selling point.

## Filling it in

Do not edit `data/buildings.json` by hand. Use the two sheets:

```bash
npm run facts -- --template   # regenerate both CSVs from current data
# … fill them in …
npm run facts -- --dry-run    # show what would change, write nothing
npm run facts                 # apply it
npm run build                 # see it on the site
```

**`data/building-facts.csv`** holds the values — one row per development, one column per
fact. Rows are ordered busiest first, so the developments where a blank costs the most
readers are at the top. Empire City alone is 70 units.

**`data/building-facts-sources.csv`** holds where each fact came from — one row per fact,
not per development:

```
slug,field,confidence,sources,checkedAt
ritze-perdana-2,maintenancePsf,verified,https://jmb-notice management-notice-lobby,2026-08-16
ritze-perdana-2,liftCount,unverified,https://forum.example/thread,2026-08-16
```

`confidence` is **`verified`** — two independent sources agree, or one that is
authoritative for that field — or **`unverified`**, a single second-hand source that could
be stale or could be about the development next door. The site renders the two
differently: a verified fact shows the date it was checked, an unverified one is tagged in
grey so nobody mistakes a forum post for a management notice. When in doubt, `unverified`
is the honest call. Marking something verified with only one source is rejected.

Rules the importer follows:

- **A blank cell means "still unknown"** and leaves whatever is there alone. Fill in five
  developments today and five next week; nothing is lost between runs.
- **A `-` means "I checked, there is none"** — a walk-up with no lift, a block with no
  allocated parking. That writes a real zero instead of leaving the field looking
  unresearched.
- **Numbers are validated.** `about 900` or `RM0.35/sqft` is rejected with the line
  number rather than quietly becoming a broken value on the site.
- **A citation for an empty field is an error**, not a warning — it means the value did
  not import and the source is now pointing at a blank.
- **`--dry-run` is exact.** It validates citations against the values the same run would
  write, so it never fails on input a real run would accept.

## What not to put in it

The same boundary as everywhere else in this project. Facts about the building are ours
to publish: fees, lifts, parking, distances, unit counts. Anything belonging to whoever
wrote a listing is not — no photos, no description text, no agent names or numbers, and
nothing copied out of a portal's own editorial write-up. See `docs/data-policy.md`.

If a fee came from a phone call, it is a fact you established. If it came from pasting a
portal's building profile, it is theirs.
