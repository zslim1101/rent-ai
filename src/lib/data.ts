import type { Building } from './types';
import local from '../../data/buildings.json';

/**
 * Where building data comes from.
 *
 *   PUBLIC_DATA_SOURCE=json       (default) read data/buildings.json
 *   PUBLIC_DATA_SOURCE=firestore  read the `buildings` collection
 *
 * Both are read at build time, so the deployed site is static either way.
 * Firestore reads use the public web SDK against public read rules, which means
 * the build needs no service account — only the seed script does.
 */
const SOURCE = import.meta.env.PUBLIC_DATA_SOURCE ?? 'json';

const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

function fromJson(): Building[] {
  return (local as { buildings: Building[] }).buildings;
}

async function fromFirestore(): Promise<Building[]> {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getFirestore, collection, getDocs } = await import('firebase/firestore');

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const snapshot = await getDocs(collection(getFirestore(app), 'buildings'));

  return snapshot.docs.map((doc) => ({ slug: doc.id, ...doc.data() }) as Building);
}

let cache: Building[] | null = null;

export async function getBuildings(): Promise<Building[]> {
  if (cache) return cache;

  let buildings: Building[];

  if (SOURCE === 'firestore') {
    if (!firebaseConfig.projectId) {
      // Misconfiguration should be loud but not fatal — a missing .env is the
      // most likely cause, and failing the whole build over it helps nobody.
      console.warn(
        '[data] PUBLIC_DATA_SOURCE=firestore but PUBLIC_FIREBASE_PROJECT_ID is unset. Falling back to data/buildings.json.',
      );
      buildings = fromJson();
    } else {
      buildings = await fromFirestore();
      if (buildings.length === 0) {
        console.warn('[data] Firestore `buildings` collection is empty. Did you run `npm run seed`?');
      }
    }
  } else {
    buildings = fromJson();
  }

  cache = buildings.sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export async function getBuilding(slug: string): Promise<Building | undefined> {
  return (await getBuildings()).find((b) => b.slug === slug);
}

/** True while any row on the site is still placeholder data. */
export async function hasSampleData(): Promise<boolean> {
  return (await getBuildings()).some((b) => b.sample);
}
