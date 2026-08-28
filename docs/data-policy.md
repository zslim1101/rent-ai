# Data policy

What this site collects, what it publishes, and what it never stores. Written to
be read by a lawyer as well as by whoever next works on the code.

**Status: draft, not yet reviewed by counsel. No collector has been built and no
portal data has been collected.** The positions below are engineering decisions
made in anticipation of legal review, not legal advice.

Last updated: 13 August 2026.

## The short version

We publish facts and our own analysis. We do not publish anyone else's writing,
photographs, or personal data. A link back to the source is a courtesy, not a
licence, and nothing here relies on one making republication lawful — because it
does not.

## What we publish

Per unit: bedrooms, bathrooms, floor area, asking rent, furnishing state, the
name of the portal it appeared on, and a link to it. Plus, where we have enough
data, our own written assessment.

Per development: address, completion year, unit count, maintenance charge,
parking ratio, lift count, fibre availability, nearest station and walking time.
Medians and per-square-foot figures we compute ourselves. Review themes.

That is the entire published surface. `scripts/check-publishable.mjs` asserts it
against an allowlist and fails the build on anything else.

## What we never publish

- **Photographs.** Not hotlinked, not thumbnailed, not cached.
- **Advertiser description text.** Not quoted, not excerpted, not paraphrased
  closely enough to matter.
- **Agent names, agency names, phone numbers, emails.** These are never even
  stored — the collector drops them at the point of parsing, so there is nothing
  on disk to leak.

## What we store privately

`data/raw/` holds the collected records, including advertiser description text.
It is gitignored, it never reaches Firestore, and description text is deleted
30 days after collection (`purgeExpiredDescriptions` in `scripts/derive.mjs`).

Description text exists in the store for one reason: it is the input to the
analysis step. A model reads it and forms a view; the sentence that reaches the
page is ours. Reading someone's writing to form an opinion about the thing it
describes is a different act from republishing that writing, and the boundary is
enforced in the prompt (`SYSTEM_PROMPT` in `scripts/analyse.mjs`) and again by
the length caps in `scripts/check-publishable.mjs`.

## Why the boundary is enforced in code

The site's data lives in Firestore. A Firebase project ID is public — it is in
the hosting URL — and Firestore exposes a public REST endpoint. **Anything a
security rule marks readable is effectively published, whether or not a page
renders it.** `firestore.rules` therefore opens exactly one collection for
reading and denies everything else through a catch-all.

That means there is no checkpoint after `data/buildings.json`. A comment
describing the boundary protects it until the first person who does not read the
comment. A build that fails protects it afterwards.

## Legal basis, as we understand it

Three regimes apply in Malaysia, and a backlink addresses none of them:

**Copyright Act 1987.** Photographs and description text are protected works,
generally owned by whoever created them and typically licensed or assigned to
the portal under its terms. Copying them infringes regardless of attribution.
Facts — a price, a bedroom count, a floor area — are not protected. Our medians,
indices and written analysis are our own works.

Note also **s.36A**, which prohibits circumventing technological protection
measures. This is why no collector will defeat bot protection: see the per-source
positions below.

**Contract.** Portal terms of use forbid automated access and republication.
This is the live exposure even where copyright is not engaged, and it is a
contract question rather than an IP one.

**Personal Data Protection Act 2010.** Agent names and contact numbers are
personal data. We hold none, which is the cheapest possible compliance posture.

## Access: what we are actually served

Tested 14 August 2026 with `npm run probe` and then `npm run collect` — a stock
Chromium identifying itself as `RentAIBot/0.1` with a contact URL, 20–45 seconds
between page loads, no stealth tooling of any kind.

| Source | Plain `curl` | robots.txt | Identified browser |
|---|---|---|---|
| **iProperty** | 403 | 200, permits listing paths, no crawl-delay | 200, 200, **challenge** |
| **PropertyGuru** | 403, Cloudflare interstitial | 403 to curl; 200 via browser, 48 rules, permits our paths | 200, 200, **challenge** |
| **Mudah** | 200 | 200, prose prohibition on automated access | not attempted |

**A one-page probe is not a result.** The probe loaded a single page per portal,
both returned 200, and that briefly looked like permission. The collection run
loaded three and both portals served the first two and challenged the third —
same request number, different URL shapes, both sites. That is Cloudflare bot
management becoming confident it is looking at automation, not a quirk of a URL.

So the honest reading is the opposite of the probe's: **iProperty and
PropertyGuru do not serve automated collection.** They tolerate a couple of
requests and then stop, which is a soft refusal rather than a hard one, but a
refusal. Getting past it needs fingerprint patching, a stealth plugin, or
solving the challenge — the three things the collector exists not to do.

Whether a much slower cadence (minutes, not seconds) would stay under the
threshold is untested. Going slower is not evasion — it reduces load rather than
disguising anything — so it is a legitimate thing to try. But the challenge fired
on request count rather than on any sign of haste, so detection rather than rate
is the likelier trigger, and it should not be assumed to work.

## Per-source position

| Source | Position |
|---|---|
| **iProperty** | **Not collecting** — declines automated access after a couple of requests. Configured and working; it stops when told to. Its area landing pages are served more readily than keyword search, so a slower area-based crawl is the one untried variation. |
| **PropertyGuru** | **Not collecting**, identical behaviour and identical stopping point. Largest inventory of the three, so also the most exposure if the terms question ever came to a head. |
| **Mudah** | **Not collecting.** Its robots.txt opens: *"It is expressly forbidden to use spiders or other automated methods to access mudah.my. Only if mudah.my has given special permit such access is allowed."* Mudah has no bot protection at all — it is the only one of the three that would let us collect freely — which is exactly why the written refusal is the whole answer. Disabled in `scripts/collect/sources.mjs`; the same file names the remedy, which is to ask. |
| **NAPIC / JPPH** | Licensed and citable. NAPIC's Open Sales Data sits behind user registration and a Tableau front end, covers **sales transactions rather than rents**, and lags. Rental data is JPPH's subscription or special-request product (+603 8886 9000). Worth pursuing for credibility regardless of the portals. |

**Terms of use are moot for now** — all three portals are declining us one way or
another, so the contract question never arises. It would arise the moment a
permit is granted, which is a good reason for any permit request to be explicit
about what we would collect, how often, and what we would publish.

## Collector rules

Binding on any collector that gets built:

1. Fetch `robots.txt` first and honour it. Treat a written prohibition in the
   preamble as binding even where the directives would permit the path.
2. Identify the crawler in the user agent, with a contact URL.
3. Rate-limit to human pace. No parallelism across a single host.
4. Do not defeat bot protection, solve CAPTCHAs, rotate IPs to evade blocking,
   or use residential proxies. A 403 is an answer.
5. Drop agent name, phone, email and photo URLs at parse time.
6. Write only to `data/raw/`. Never to Firestore.
7. Stop on the first sign the operator objects.

## Takedown

A named contact address goes on the site before launch, with a commitment to
respond within a stated number of working days and to remove disputed data
without argument while the complaint is assessed. Removing a building is a JSON
edit and a redeploy; there is no reason to be slow about it.

**Still to do:** publish the contact address and the response commitment on the
site itself. This is not yet done.

## Open questions for counsel

1. Does the selection and arrangement of listing facts attract compilation
   copyright in Malaysia, and if so, does extracting the facts from a portal's
   compilation amount to taking a substantial part of it?
2. Are the portals' browsewrap terms enforceable against a party that never
   registered an account or clicked through them?
3. Does accessing a page that returns 403 to automated clients — using a real
   browser, at human pace, without defeating the protection — engage s.3 of the
   Computer Crimes Act 1997 or s.36A of the Copyright Act 1987?
4. Does storing advertiser description text privately, purely as input to
   generating original commentary, engage copyright when nothing derived from it
   is published verbatim?
5. Does publishing derived medians alongside a link to the source alter the
   analysis in either direction?
6. What licence terms attach to NAPIC open data and JPPH subscription data, and
   do they permit republication of derived figures?
