/**
 * Write our own read on each building and each unit.
 *
 *   node scripts/analyse.mjs                   every building whose inputs changed
 *   node scripts/analyse.mjs --slug kelana-puteri
 *   node scripts/analyse.mjs --force           ignore the hash and redo everything
 *   node scripts/analyse.mjs --estimate        count tokens and price it, call nothing
 *   node scripts/analyse.mjs --batch           whole corpus via the Batches API, 50% off
 *
 * Runs offline and writes into data/buildings.json. The site stays static — no
 * model is ever called while someone is looking at a page.
 *
 * Two things shape the design:
 *
 * The model is asked for judgement, not arithmetic. Medians, per-sqft figures
 * and bedroom breakdowns are computed in derive.mjs and handed over as input.
 * Asking for "8% above the median" would cost money to get a number we already
 * have, and would occasionally get it wrong.
 *
 * One call per building, not per unit. A unit's asking price only means
 * anything next to its neighbours, so the whole building goes in together and
 * the analysis for every unit in it comes back in one structured response.
 * Per-unit calls would multiply the bill by the number of units and produce
 * worse output.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(root, 'data/buildings.json');
const RAW_DIR = join(root, 'data/raw');

const MODEL = 'claude-opus-5';

/** Per million tokens, from the Claude API price list. */
const PRICE = { input: 5, output: 25, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 };

/**
 * Thinking is on by default on this model, and max_tokens caps thinking plus
 * response text together — so this needs headroom well past the size of the
 * JSON we're expecting back.
 */
const MAX_TOKENS = 16_000;

/**
 * Short structured output over a small amount of data. This is not a reasoning
 * task, and `medium` is strong on Opus 5. Worth a sweep against real buildings
 * before settling: `low` may well hold up, and it is the cheapest lever here.
 */
const EFFORT = 'medium';

/**
 * Safety classifiers can decline a request outright. Vanishingly unlikely for
 * rental listings, but a declined request otherwise just stops, so the API is
 * asked to re-run it on a fallback model instead. Set to false if the beta name
 * is ever retired — the script works fine without it.
 *
 * The Batches API rejects this parameter, so --batch runs without it.
 */
const USE_SERVER_SIDE_FALLBACK = true;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Keep in step with src/lib/format.ts. check-publishable.mjs enforces this. */
const LOW_CONFIDENCE_THRESHOLD = 5;

/**
 * Bump when the prompt or schema changes, so every building's stored hash stops
 * matching and the next run regenerates against the new instructions.
 */
const PROMPT_VERSION = 1;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);

const onlySlug = option('slug');
const force = flag('force');
const estimateOnly = flag('estimate');
const useBatch = flag('batch');

// ------------------------------------------------------------------- prompting

/**
 * Stable across every building, so it sits in the system prompt behind a cache
 * breakpoint. The per-building data goes in the user turn, after it — first
 * call writes the cache, the rest read it at about a tenth of the input price.
 */
const SYSTEM_PROMPT = `You write short, honest assessments of rental listings for a directory covering the Ara Damansara and Kelana Jaya corridor in Petaling Jaya, Malaysia.

You are given, for one development: its facts, the medians we have already computed, and each currently advertised unit. Some units include the text the advertiser wrote.

Your job is judgement — what a person comparing these units should notice. The arithmetic is done; you do not need to recompute or restate it.

How to weigh a unit:
- Compare it against the other units in the same building, especially those with the same bedroom count. That comparison is the whole point.
- Furnishing, size and floor area explain a lot of price difference. Say so when they do.
- Where advertiser text is present, use it to understand what is being offered — a recent renovation, an odd layout, an unusual lease term. Use it as evidence, never as material.
- If something looks like a mistake in the listing (a price or size that cannot be right), say that plainly rather than reasoning around it.

Hard rules:
- Never quote, paraphrase closely, or reproduce the advertiser's text. Read it, form your own view, write your own sentence. The wording that reaches the page must be yours.
- Never mention or infer an agent, agency, or contact detail.
- Do not invent facts. If the data does not support a claim, leave the claim out.
- With fewer than ${LOW_CONFIDENCE_THRESHOLD} listings in a building, the sample is too small to call a unit above or below market. Use the verdict "unclear" and say the sample is thin.
- Write plainly, in British English, for someone deciding where to rent. No marketing register, no adjectives doing work that numbers should do.

Length: each unit summary is one or two sentences. Each signal is a short phrase, not a sentence with a verdict in it. At most four signals per unit.`;

/** The shape we require back. Strict: no extra keys, everything required. */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['building', 'units'],
  properties: {
    building: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'strengths', 'caveats'],
      properties: {
        summary: { type: 'string', description: 'Two or three sentences on the development as a rental proposition.' },
        strengths: { type: 'array', items: { type: 'string' }, description: 'Up to four short phrases.' },
        caveats: { type: 'array', items: { type: 'string' }, description: 'Up to four short phrases. Say so if there are none.' },
      },
    },
    units: {
      type: 'array',
      description: 'One entry per unit given, in the same order, matched by id.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict', 'summary', 'signals'],
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['below-market', 'at-market', 'above-market', 'unclear'] },
          summary: { type: 'string' },
          signals: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

// --------------------------------------------------------------------- inputs

/**
 * What the model sees. Assembled from the raw store (for advertiser text, which
 * never leaves this machine) and the derived metrics.
 */
function buildInput(building) {
  const rawPath = join(RAW_DIR, `${building.slug}.json`);
  const rawById = existsSync(rawPath)
    ? new Map(JSON.parse(readFileSync(rawPath, 'utf8')).listings.map((l) => [l.id, l]))
    : new Map();

  return {
    name: building.name,
    area: building.area,
    completionYear: building.completionYear,
    totalUnits: building.totalUnits,
    facts: building.facts,
    metrics: building.metrics,
    units: building.listings.map((l) => ({
      id: l.id,
      beds: l.beds,
      baths: l.baths,
      sqft: l.sqft,
      priceMyr: l.priceMyr,
      pricePsf: l.sqft > 0 ? Math.round((l.priceMyr / l.sqft) * 100) / 100 : null,
      furnishing: l.furnishing,
      daysListed: l.firstSeen
        ? Math.round((Date.now() - Date.parse(l.firstSeen)) / 86_400_000)
        : null,
      advertiserText: rawById.get(l.id)?.descriptionText ?? null,
    })),
  };
}

const hashOf = (input) =>
  createHash('sha256')
    .update(JSON.stringify({ input, model: MODEL, promptVersion: PROMPT_VERSION, effort: EFFORT }))
    .digest('hex')
    .slice(0, 16);

function requestFor(input) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify(input) }],
  };
}

// -------------------------------------------------------------------- applying

/** Pull the JSON body out of a response, with the failure modes named. */
function parseResult(message, slug) {
  if (message.stop_reason === 'refusal') {
    throw new Error(`${slug}: the request was declined (${message.stop_details?.category ?? 'no category'})`);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error(`${slug}: hit max_tokens (${MAX_TOKENS}) — output truncated. Raise it or lower effort.`);
  }
  const text = message.content.find((block) => block.type === 'text')?.text;
  if (!text) throw new Error(`${slug}: no text block in the response`);
  return JSON.parse(text);
}

function applyResult(building, result, inputHash) {
  const provenance = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    listingCount: building.listings.length,
    inputHash,
  };

  building.analysis = { ...result.building, provenance };

  const byId = new Map(result.units.map((u) => [u.id, u]));
  let matched = 0;

  for (const listing of building.listings) {
    const unit = byId.get(listing.id);
    if (!unit) continue;
    const { id, ...analysis } = unit;
    listing.analysis = { ...analysis, provenance };
    matched++;
  }

  if (matched < building.listings.length) {
    console.warn(`  ! ${building.slug}: ${building.listings.length - matched} unit(s) came back unmatched`);
  }
}

function costOf(usage) {
  const perToken = (n, price) => ((n ?? 0) * price) / 1_000_000;
  return (
    perToken(usage.input_tokens, PRICE.input) +
    perToken(usage.cache_creation_input_tokens, PRICE.input * PRICE.cacheWriteMultiplier) +
    perToken(usage.cache_read_input_tokens, PRICE.input * PRICE.cacheReadMultiplier) +
    perToken(usage.output_tokens, PRICE.output)
  );
}

// ------------------------------------------------------------------------ run

const published = JSON.parse(readFileSync(OUT_PATH, 'utf8'));

const targets = published.buildings
  .filter((b) => !onlySlug || b.slug === onlySlug)
  .filter((b) => b.listings?.length > 0);

if (targets.length === 0) {
  console.error(onlySlug ? `No building with slug "${onlySlug}", or it has no listings.` : 'No buildings with listings.');
  process.exit(1);
}

const jobs = [];
for (const building of targets) {
  const input = buildInput(building);
  const inputHash = hashOf(input);

  if (!force && building.analysis?.provenance?.inputHash === inputHash) {
    console.log(`· ${building.slug}: unchanged since last run, skipping`);
    continue;
  }
  jobs.push({ building, input, inputHash });
}

if (jobs.length === 0) {
  console.log('\nNothing to do. Pass --force to regenerate anyway.');
  process.exit(0);
}

const client = new Anthropic();

if (estimateOnly) {
  let inputTokens = 0;
  for (const { building, input } of jobs) {
    const { input_tokens } = await client.messages.countTokens({
      model: MODEL,
      system: [{ type: 'text', text: SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    });
    inputTokens += input_tokens;
    console.log(`  ${building.slug}: ${input_tokens.toLocaleString('en-MY')} input tokens`);
  }

  // Output is the unknown here — a summary plus a few lines per unit, with
  // thinking on top. This assumes roughly 150 output tokens per unit, which is
  // a guess worth replacing with a measurement after the first real run.
  const units = jobs.reduce((n, j) => n + j.input.units.length, 0);
  const outputTokens = units * 150;
  const cost = costOf({ input_tokens: inputTokens, output_tokens: outputTokens });

  console.log(
    `\n${jobs.length} buildings, ${units} units.\n` +
      `~${inputTokens.toLocaleString('en-MY')} input + ~${outputTokens.toLocaleString('en-MY')} output tokens\n` +
      `≈ $${cost.toFixed(2)} at ${MODEL} list price, before cache reads (which cut the input side by ~90%)\n` +
      `≈ $${(cost / 2).toFixed(2)} via --batch\n\n` +
      `No API calls were made beyond token counting.`,
  );
  process.exit(0);
}

let spend = 0;

if (useBatch) {
  // Results come back in any order, so everything is keyed by custom_id. Never
  // by position — that is the classic way to attach one building's analysis to
  // another building.
  console.log(`Submitting ${jobs.length} buildings as a batch...`);

  const batch = await client.messages.batches.create({
    requests: jobs.map(({ building, input }) => ({
      custom_id: building.slug,
      params: requestFor(input),
    })),
  });

  console.log(`Batch ${batch.id} submitted. Most finish within the hour; the cap is 24.`);

  let status = batch;
  while (status.processing_status !== 'ended') {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    status = await client.messages.batches.retrieve(batch.id);
    process.stdout.write(`\r  ${status.request_counts.succeeded} done, ${status.request_counts.processing} running   `);
  }
  console.log('');

  const jobBySlug = new Map(jobs.map((j) => [j.building.slug, j]));

  for await (const entry of await client.messages.batches.results(batch.id)) {
    const job = jobBySlug.get(entry.custom_id);
    if (!job) continue;

    if (entry.result.type !== 'succeeded') {
      console.error(`✗ ${entry.custom_id}: ${entry.result.type}`);
      continue;
    }

    applyResult(job.building, parseResult(entry.result.message, entry.custom_id), job.inputHash);
    spend += costOf(entry.result.message.usage) / 2; // batch pricing is half
    console.log(`✓ ${entry.custom_id}`);
  }
} else {
  // Sequential on purpose. A cache entry is only readable once the first
  // response has started coming back, so parallel calls would each pay the full
  // input price and none would read what the others are writing.
  for (const { building, input, inputHash } of jobs) {
    const request = requestFor(input);

    const message = USE_SERVER_SIDE_FALLBACK
      ? await client.beta.messages.create({ ...request, betas: [FALLBACK_BETA], fallbacks: 'default' })
      : await client.messages.create(request);

    applyResult(building, parseResult(message, building.slug), inputHash);

    spend += costOf(message.usage);
    const cached = message.usage.cache_read_input_tokens ?? 0;
    console.log(
      `✓ ${building.slug}: ${building.listings.length} units` +
        `${cached > 0 ? `, ${cached.toLocaleString('en-MY')} tokens read from cache` : ''}`,
    );
  }
}

writeFileSync(OUT_PATH, `${JSON.stringify(published, null, 2)}\n`);
console.log(`\nWrote data/buildings.json. Spent about $${spend.toFixed(2)}.`);
console.log(`Run \`npm run check\` before publishing.`);
