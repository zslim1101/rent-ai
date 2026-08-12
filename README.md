# rent-ai

A rental directory for the Ara Damansara / Kelana Jaya corridor. Static Astro site,
building data in Firestore, deployed to Firebase Hosting.

One page per development, showing its facts, its computed rent metrics, a review
summary, and its current listings.

## Running it

```bash
npm install
npm run dev          # http://localhost:4321
```

Out of the box it reads `data/buildings.json`, so it runs with no Firebase project and
no credentials. The rows in there are placeholders — the site shows a banner saying so
until you replace them.

## Setting up Firebase

You only need this when you want the data to live in Firestore rather than the JSON file.

**1. Create the project** — [console.firebase.google.com](https://console.firebase.google.com)
→ *Add project*. Analytics is not needed.

**2. Create the database** — *Build → Firestore Database → Create database*. Choose
**Production mode**, location **`asia-southeast1`** (Singapore, nearest to KL).

**3. Register a web app** — *Project settings → General → Your apps → Web (`</>`)*. Copy
the config values into `.env`:

```bash
cp .env.example .env
```

Those keys ship in the client bundle by design. Access is controlled by
`firestore.rules`, not by keeping them secret.

**4. Get a service account key** — *Project settings → Service accounts → Generate new
private key*. Save it as `serviceAccount.json` in the repo root. It is gitignored, and
it grants full admin access, so it must stay out of version control.

**5. Install the CLI and pick the project**

```bash
npm i -g firebase-tools
firebase login
firebase use --add       # writes .firebaserc
```

**6. Push the data and the rules**

```bash
npm run seed                          # data/buildings.json -> Firestore
firebase deploy --only firestore:rules
```

**7. Read from Firestore** — set `PUBLIC_DATA_SOURCE=firestore` in `.env`, then
`npm run build`.

## Deploying

```bash
npm run deploy       # astro build && firebase deploy --only hosting
```

The build reads data at build time, so publishing new data means re-running the build.

## Data

`data/buildings.json` is the authoring format and the seed source. One entry per
development, keyed by `slug`. The shape is defined in `src/lib/types.ts`.

Two conventions worth keeping:

- **Listings are summaries, not copies.** Beds, baths, sqft, price, furnishing, and a
  link to the source. No photos, description text, agent names or phone numbers — we
  link out for those rather than reproduce them.
- **Thin data is labelled.** Medians drawn from fewer than five listings render with a
  "low" flag, and a review average is withheld below five reviews.

## Layout

```
data/buildings.json      building data (authoring format + seed source)
scripts/seed-firestore.mjs
src/lib/                 types, data loading, formatting
src/pages/               index and /building/[slug]
firestore.rules          public read on `buildings`, no client writes
firebase.json            hosting config
```
