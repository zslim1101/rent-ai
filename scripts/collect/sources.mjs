/**
 * The portals, and where we stand with each.
 *
 * `enabled` is a decision, not a capability. A source switched off here is one
 * we can technically reach and have chosen not to — the reason travels with the
 * flag so nobody has to reconstruct it later.
 */

export const SOURCES = {
  iproperty: {
    name: 'iProperty',
    origin: 'https://www.iproperty.com.my',
    enabled: true,
    /**
     * robots.txt permits listing paths — no Disallow covers them, and there is
     * no crawl-delay. A plain curl still gets 403, which is the WAF rather than
     * the rules file talking. Whether it serves an honest browser is what the
     * probe is for.
     */
    searchPaths: ['/rent/ara-damansara/'],
    /**
     * Searching by building name rather than by area. The area pages return
     * every property type across the district, which then has to be matched
     * back to a development anyway — and matching is where listings get
     * attached to the wrong building. Asking for the name directly means far
     * fewer page loads for the same result, which is also the polite option.
     */
    searchUrl: (name) => `https://www.iproperty.com.my/rent/all-residential/?q=${encodeURIComponent(name)}`,
  },

  propertyguru: {
    name: 'PropertyGuru',
    origin: 'https://www.propertyguru.com.my',
    enabled: true,
    /**
     * Cloudflare serves a "Just a moment…" JS interstitial to plain clients —
     * even robots.txt is behind it, so we cannot currently read the rules at
     * all. A real browser executes that challenge as a matter of course, which
     * is the intended path rather than a bypass. If it instead detects
     * automation and blocks us, that is a no and we stop.
     */
    searchPaths: ['/property-for-rent?freetext=Ara%20Damansara'],
    searchUrl: (name) =>
      `https://www.propertyguru.com.my/property-for-rent?freetext=${encodeURIComponent(name)}`,
  },

  mudah: {
    name: 'Mudah',
    origin: 'https://www.mudah.my',
    enabled: false,
    /**
     * Off by default, and this is the one case where the technical picture and
     * the right answer point opposite ways. Mudah has no bot protection — it
     * serves anything. Its robots.txt opens with a sentence in plain English:
     * "It is expressly forbidden to use spiders or other automated methods to
     * access mudah.my. Only if mudah.my has given special permit such access is
     * allowed."
     *
     * Nothing about going slowly answers that. It is not a rate limit; it is a
     * refusal. The same file names the remedy — ask for the permit — so the
     * route to switching this on is `docs/data-policy.md`, not this line.
     *
     * The owner has said they want Mudah in scope. Left switched off so that
     * turning it on is a deliberate, attributable act rather than a default.
     */
    disabledReason:
      'robots.txt expressly forbids automated access and points to a permit process. Ask Mudah first.',
    searchPaths: ['/malaysia/properties-for-rent?q=ara%20damansara'],
    searchUrl: (name) =>
      `https://www.mudah.my/malaysia/properties-for-rent?q=${encodeURIComponent(name)}`,
  },
};

/**
 * What the site covers. Used to filter results down to it.
 *
 * Grew from the original Ara Damansara / Kelana Jaya corridor when Damansara
 * Perdana was collected in August 2026. Adding an area here is not what makes
 * it appear on the site — that takes a building in data/buildings.json and
 * listings attributed to it — but this is the list that says what we mean to
 * cover, so keep the two in step.
 */
export const AREAS = ['Ara Damansara', 'Kelana Jaya', 'Damansara Perdana'];
