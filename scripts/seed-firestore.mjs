/**
 * Push data/buildings.json into the Firestore `buildings` collection.
 *
 *   node scripts/seed-firestore.mjs        # upsert every building
 *
 * Needs serviceAccount.json in the repo root (Firebase console -> Project
 * settings -> Service accounts -> Generate new private key). That file is
 * gitignored and must stay that way — it grants full admin access to the project.
 *
 * Documents are keyed by slug, so re-running overwrites rather than duplicating.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const credentialsPath = join(root, 'serviceAccount.json');

if (!existsSync(credentialsPath)) {
  console.error(
    'Missing serviceAccount.json in the repo root.\n\n' +
      'Firebase console -> Project settings -> Service accounts -> Generate new private key,\n' +
      'then save the downloaded file as serviceAccount.json.',
  );
  process.exit(1);
}

const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
const { buildings } = JSON.parse(readFileSync(join(root, 'data/buildings.json'), 'utf8'));

initializeApp({ credential: cert(credentials) });
const db = getFirestore();

// Firestore caps a batch at 500 writes; chunking keeps this correct if the
// building list grows past that.
const CHUNK = 400;

for (let i = 0; i < buildings.length; i += CHUNK) {
  const chunk = buildings.slice(i, i + CHUNK);
  const batch = db.batch();

  for (const { slug, ...fields } of chunk) {
    batch.set(db.collection('buildings').doc(slug), fields);
  }

  await batch.commit();
  console.log(`Wrote ${chunk.length} buildings (${i + chunk.length}/${buildings.length})`);
}

console.log(`\nDone. ${buildings.length} buildings in project ${credentials.project_id}.`);
console.log('Set PUBLIC_DATA_SOURCE=firestore in .env to read from Firestore instead of JSON.');
process.exit(0);
