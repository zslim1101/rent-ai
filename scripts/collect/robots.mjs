/**
 * robots.txt, treated as a gate rather than a formality.
 *
 * Two things this deliberately does that a permissive parser wouldn't:
 *
 * It reads the comments. Mudah's file carries its real instruction in a comment
 * above the directives — "It is expressly forbidden to use spiders or other
 * automated methods to access mudah.my" — while the directives themselves
 * happily Allow the listing paths. A parser that only reads directives would
 * conclude the opposite of what the operator plainly wrote. `prohibition` in
 * the returned object surfaces that text so a human decides.
 *
 * It fails closed. If robots.txt can't be fetched, nothing is allowed. Not
 * being able to read the rules is not the same as there being none.
 */

/** Comment phrasings that amount to "no automated access", however worded. */
const PROHIBITION_PATTERNS = [
  /expressly forbidden/i,
  /not permitted/i,
  /prohibit/i,
  /no (automated|robot|spider|scrap)/i,
  /forbidden to use (spiders|robots|automated)/i,
  /written permission/i,
  /special permit/i,
];

/**
 * Parse robots.txt into the group that applies to us, plus any prose
 * prohibition found in the comments.
 */
export function parseRobots(text, userAgent) {
  const lines = text.split(/\r?\n/);

  const prohibition = lines
    .filter((line) => line.trim().startsWith('#'))
    .map((line) => line.replace(/^\s*#\s?/, '').trim())
    .filter((line) => PROHIBITION_PATTERNS.some((pattern) => pattern.test(line)))
    .join(' ');

  // Collect rules per user-agent group. Comments are stripped only after the
  // prohibition scan above, so nothing prose is lost before it's read.
  const groups = new Map();
  let current = [];

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const [rawField, ...rest] = line.split(':');
    const field = rawField.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (field === 'user-agent') {
      const agent = value.toLowerCase();
      if (!groups.has(agent)) groups.set(agent, []);
      current = groups.get(agent);
    } else if (field === 'disallow' || field === 'allow') {
      current.push({ type: field, path: value });
    } else if (field === 'crawl-delay') {
      current.push({ type: 'crawl-delay', seconds: Number(value) || 0 });
    }
  }

  // Most specific matching group wins; fall back to the wildcard group.
  const ua = userAgent.toLowerCase();
  const named = [...groups.keys()].find((agent) => agent !== '*' && ua.includes(agent));
  const rules = groups.get(named ?? '*') ?? [];

  return {
    prohibition: prohibition || null,
    crawlDelaySeconds: rules.find((r) => r.type === 'crawl-delay')?.seconds ?? null,
    rules: rules.filter((r) => r.type !== 'crawl-delay'),
  };
}

/** robots.txt wildcards: `*` matches any run, a trailing `$` anchors the end. */
function matches(pattern, path) {
  if (pattern === '') return false;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const anchored = escaped.endsWith('\\$') ? `^${escaped.slice(0, -2)}$` : `^${escaped}`;
  return new RegExp(anchored).test(path);
}

/**
 * Longest matching rule wins, and Allow beats Disallow at equal length —
 * the conventional precedence.
 */
export function isAllowed(robots, path) {
  let decision = { allowed: true, length: -1 };

  for (const rule of robots.rules) {
    if (!matches(rule.path, path)) continue;
    const allowed = rule.type === 'allow';
    if (rule.path.length > decision.length || (rule.path.length === decision.length && allowed)) {
      decision = { allowed, length: rule.path.length };
    }
  }

  return decision.allowed;
}

/**
 * Fetch and parse robots.txt for an origin.
 *
 * Fetched with the same browser context that will do the collecting, so the
 * rules we read are the rules served to the client that will obey them.
 */
export async function fetchRobots(page, origin, userAgent) {
  const url = `${origin}/robots.txt`;

  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (error) {
    return { ok: false, reason: `could not load ${url}: ${error.message}` };
  }

  const status = response?.status() ?? 0;
  if (status !== 200) {
    return { ok: false, status, reason: `${url} returned HTTP ${status}` };
  }

  const body = await page.evaluate(() => document.body?.innerText ?? '');

  // A robots.txt that comes back as a rendered HTML page is a challenge or an
  // error page wearing the right URL, not a rules file.
  if (/<html|just a moment|enable javascript/i.test(body.slice(0, 400))) {
    return { ok: false, status, reason: `${url} served an HTML interstitial, not a rules file` };
  }

  return { ok: true, status, ...parseRobots(body, userAgent), raw: body };
}
