import type { Building, Listing } from './types';
import local from '../../data/buildings.json';
import placeholders from '../../data/buildings.sample.json';

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

/**
 * Whether to show the placeholder buildings.
 *
 *   PUBLIC_INCLUDE_SAMPLE=true   add data/buildings.sample.json to whatever the
 *                                source returned
 *   anything else                (default) real buildings only
 *
 * They come from the local file in both modes, deliberately. `npm run seed`
 * uploads data/buildings.json and nothing else, so invented rents never reach
 * Firestore — where, given a public project ID and a public REST endpoint, they
 * would be readable by anyone whether or not a page rendered them.
 *
 * Read at build time like everything else here, so flipping it means a rebuild
 * (or a dev-server restart).
 */
const INCLUDE_SAMPLE = import.meta.env.PUBLIC_INCLUDE_SAMPLE === 'true';

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

/** The placeholder rows, or none. Flagged `sample: true` so the UI can mark them. */
function samples(): Building[] {
  if (!INCLUDE_SAMPLE) return [];
  return (placeholders as { buildings: Building[] }).buildings.map((b) => ({ ...b, sample: true }));
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

  cache = [...buildings, ...samples()].sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export async function getBuilding(slug: string): Promise<Building | undefined> {
  return (await getBuildings()).find((b) => b.slug === slug);
}

/** True while any row on the site is still placeholder data. */
export async function hasSampleData(): Promise<boolean> {
  return (await getBuildings()).some((b) => b.sample);
}

/**
 * True when placeholder and real rows sit side by side.
 *
 * Worth distinguishing from `hasSampleData`, because the honest warning differs:
 * "all of this is invented" and "some of this is invented, and here is which"
 * ask different things of the reader.
 */
export async function hasMixedData(): Promise<boolean> {
  const buildings = await getBuildings();
  return buildings.some((b) => b.sample) && buildings.some((b) => !b.sample);
}

/** One listing, carrying enough of its building to stand on its own in a list. */
export interface ListingWithBuilding extends Listing {
  buildingName: string;
  buildingSlug: string;
  area: string;
  walkMinutesToStation: number | null;
  /** Asking rent per square foot, which is how you compare unlike units. */
  pricePsf: number;
  /** Carried down from the building: this row is a placeholder, not a real advert. */
  sample: boolean;
  /**
   * The building facts a shortlist card needs to explain itself, and to say
   * what it can't. Carried on the listing rather than looked up per card so a
   * card renders from one object — and so `unknownFacts` is computed once, in
   * the place that knows the difference between "null" and "nobody checked".
   */
  completionYear: number | null;
  totalUnits: number | null;
  maintenancePsf: number | null;
  /** True when the fee is there but rests on a single uncorroborated source. */
  maintenanceUnverified: boolean;
  nearestStation: string | null;
  /** Human-readable labels for the facts still missing on this development. */
  unknownFacts: string[];
}

/** The gathered facts a reader would expect a directory to have, and their labels. */
const FACT_LABELS: Array<[keyof Building['facts'], string]> = [
  ['liftCount', 'lifts'],
  ['parkingPerUnit', 'parking'],
  ['walkMinutesToStation', 'walk to LRT'],
  ['maintenancePsf', 'maintenance fee'],
];

/** Every listing across every building, flattened for the all-listings page. */
export async function getAllListings(): Promise<ListingWithBuilding[]> {
  const buildings = await getBuildings();

  return buildings.flatMap((b) =>
    b.listings.map((l) => ({
      ...l,
      buildingName: b.name,
      buildingSlug: b.slug,
      area: b.area,
      walkMinutesToStation: b.facts.walkMinutesToStation,
      pricePsf: l.sqft > 0 ? l.priceMyr / l.sqft : 0,
      sample: b.sample === true,
      completionYear: b.completionYear,
      totalUnits: b.totalUnits,
      maintenancePsf: b.facts.maintenancePsf,
      maintenanceUnverified: b.factSources?.maintenancePsf?.confidence === 'unverified',
      nearestStation: b.facts.nearestStation,
      unknownFacts: FACT_LABELS.filter(([key]) => b.facts[key] === null).map(([, label]) => label),
    })),
  );
}
