/**
 * A browser session that behaves like a considerate visitor and says who it is.
 *
 * The rule this file exists to hold: **we do not pretend to be someone else.**
 *
 * A real Chromium is a real Chromium — driving one is not deception. Making a
 * non-browser look like a browser is. So this sets an honest user agent naming
 * the project with a contact URL, and it deliberately does none of the things a
 * stealth scraper does: no `navigator.webdriver` patching, no fingerprint
 * spoofing, no proxy rotation, no CAPTCHA solving, no retrying a block with a
 * different identity.
 *
 * If a site declines to serve this, that is an answer and the run stops. The
 * temptation at that moment is to install playwright-extra and a stealth
 * plugin. Don't. That is the line between using a browser and defeating a
 * control, and it is the line that keeps this on the right side of Malaysia's
 * Computer Crimes Act 1997 s.3 and the Copyright Act 1987 s.36A.
 */

import { chromium } from 'playwright';

/**
 * Names the project and offers a way to complain. An operator who wants us gone
 * can identify us in their logs and tell us — which is the whole point of
 * being identifiable.
 */
export const USER_AGENT =
  'RentAIBot/0.1 (+https://github.com/zslim1101/rent-ai; building-level rent analytics; contact via repository issues)';

/** Pacing defaults. Slow enough that we cost the operator nothing noticeable. */
const DEFAULT_MIN_DELAY_MS = 20_000;
const DEFAULT_MAX_DELAY_MS = 45_000;

/** Signs that we have been shown the door rather than the page. */
const BLOCK_SIGNATURES = [
  /just a moment/i,
  /checking your browser/i,
  /enable javascript and cookies to continue/i,
  /access denied/i,
  /you have been blocked/i,
  /unusual traffic/i,
  /are you a robot/i,
  /captcha/i,
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Session {
  #browser;
  #context;
  #page;
  #lastRequestAt = 0;

  constructor({ headed = false, minDelayMs = DEFAULT_MIN_DELAY_MS, maxDelayMs = DEFAULT_MAX_DELAY_MS } = {}) {
    this.headed = headed;
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.pagesLoaded = 0;
  }

  async start() {
    this.#browser = await chromium.launch({ headless: !this.headed });
    this.#context = await this.#browser.newContext({
      userAgent: USER_AGENT,
      locale: 'en-MY',
      timezoneId: 'Asia/Kuala_Lumpur',
      viewport: { width: 1280, height: 900 },
    });
    this.#page = await this.#context.newPage();
    return this;
  }

  get page() {
    return this.#page;
  }

  /**
   * Wait out the gap since the last request, with jitter.
   *
   * Jitter isn't here to look human — we've already said what we are. It's here
   * because a metronome is a worse neighbour than a varying interval: it can
   * line up with someone else's traffic pattern and cluster load.
   */
  async #pace(crawlDelaySeconds) {
    const floor = crawlDelaySeconds ? crawlDelaySeconds * 1000 : this.minDelayMs;
    const target = floor + Math.random() * Math.max(0, this.maxDelayMs - floor);
    const waited = Date.now() - this.#lastRequestAt;
    const remaining = target - waited;

    if (this.#lastRequestAt > 0 && remaining > 0) {
      process.stdout.write(`    waiting ${Math.round(remaining / 1000)}s\r`);
      await sleep(remaining);
    }
    this.#lastRequestAt = Date.now();
  }

  /**
   * Load one page.
   *
   * Returns `{ blocked: true }` rather than throwing, because being blocked is
   * a normal outcome to report and act on, not an exception to retry around.
   */
  async visit(url, { crawlDelaySeconds = null } = {}) {
    await this.#pace(crawlDelaySeconds);

    let response;
    try {
      response = await this.#page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch (error) {
      return { url, ok: false, blocked: false, error: error.message };
    }

    const status = response?.status() ?? 0;
    this.pagesLoaded++;

    // Give a client-rendered page a moment to put something on screen. Not a
    // wait for a challenge to pass — a challenge that needs waiting out is a
    // block, and reported as one below.
    await this.#page.waitForTimeout(2500);

    const text = await this.#page.evaluate(() => document.body?.innerText ?? '');
    const title = await this.#page.title();
    const signature = BLOCK_SIGNATURES.find((p) => p.test(title) || p.test(text.slice(0, 1200)));

    const blocked = status === 403 || status === 429 || status === 503 || Boolean(signature);

    return {
      url,
      ok: !blocked && status >= 200 && status < 400,
      status,
      title,
      blocked,
      blockReason: signature ? `matched ${signature}` : blocked ? `HTTP ${status}` : null,
      text,
    };
  }

  async close() {
    await this.#context?.close();
    await this.#browser?.close();
  }
}

/**
 * What to do when a site says no.
 *
 * Stated as a function so there is exactly one place that decides, and so the
 * decision is visible in a stack trace rather than scattered through adapters.
 */
export function halt(source, result) {
  console.error(
    `\n✗ ${source} declined to serve us (${result.blockReason}).\n\n` +
      `  Stopping. This is the site's answer and we take it.\n\n` +
      `  Do not respond to this by adding a stealth plugin, spoofing the user agent,\n` +
      `  rotating IPs, or solving the challenge. Those turn "we used a browser" into\n` +
      `  "we defeated an access control", which is a different act legally and a\n` +
      `  different act ethically. The honest routes are in docs/data-policy.md:\n` +
      `  ask for a permit, license the data, or collect it by hand.\n`,
  );
}
