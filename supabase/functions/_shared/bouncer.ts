// ORCH-0588 Slice 1 — Bouncer v2 pure logic.
//
// Imported by run-bouncer/index.ts (Deno edge fn) and bouncer.test.ts (Deno tests).
// Zero side effects, zero IO. Pure functions only.
//
// Invariant I-BOUNCER-DETERMINISTIC: NO AI, NO keyword matching for category judgment.
// Type lists + data-integrity rules + cluster-aware website/hours requirements.

export type Cluster = 'A_COMMERCIAL' | 'B_CULTURAL' | 'C_NATURAL' | 'EXCLUDED';

export interface PlaceRow {
  id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  types: string[] | null;
  business_status: string | null;
  website: string | null;
  opening_hours: unknown; // jsonb — anything truthy means populated
  photos: unknown[] | null;
  stored_photo_urls: string[] | null;
  review_count: number | null;
  rating: number | null;
}

export interface BouncerVerdict {
  is_servable: boolean;
  cluster: Cluster;
  reasons: string[]; // empty when is_servable=true
}

// Universal exclusion. Always checked first.
export const EXCLUDED_TYPES: ReadonlyArray<string> = [
  'gym', 'fitness_center',
  'school', 'primary_school', 'secondary_school', 'university', 'preschool',
  'dog_park',
  'funeral_home', 'cemetery',
  'hospital', 'doctor', 'dentist', 'pharmacy', 'medical',
  'gas_station', 'car_repair', 'car_wash', 'car_dealer', 'car_rental',
  'bank', 'atm', 'post_office',
  'police', 'fire_station', 'local_government_office',
  'veterinary_care', 'storage', 'real_estate_agency',
];

// Cluster C — outdoor / natural places. No website / hours required.
export const NATURAL_TYPES: ReadonlyArray<string> = [
  'park', 'national_park', 'state_park',
  'botanical_garden', 'hiking_area', 'trail', 'beach',
  'wildlife_park', 'garden', 'nature_preserve',
  'marina', 'campground', 'picnic_ground',
  'scenic_spot', 'observation_deck',
];

// Cluster B — cultural / institutional. Website bypass possible if review_count>=500 AND rating>=4.5.
export const CULTURAL_TYPES: ReadonlyArray<string> = [
  'museum', 'art_gallery', 'library',
  'historical_landmark', 'historical_place',
  'movie_theater', 'performing_arts_theater',
  'cultural_center', 'tourist_attraction', 'plaza',
];

// Domain blocklist for B5 (own-domain rule). Social / aggregator / builder subdomains all fail.
export const SOCIAL_DOMAINS: ReadonlyArray<string> = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'linktr.ee', 'beacons.ai',
  'yelp.com', 'tripadvisor.com', 'opentable.com', 'resy.com',
  'doordash.com', 'ubereats.com', 'grubhub.com',
  'google.com', 'maps.google.com',
  'wixsite.com', 'wix.com', 'squarespace-preview.com',
  'sites.google.com', 'weebly.com', 'blogspot.com', 'wordpress.com',
  'carrd.co',
];

export function deriveCluster(types: string[] | null): Cluster {
  const t = types ?? [];
  if (t.some((x) => EXCLUDED_TYPES.includes(x))) return 'EXCLUDED';
  if (t.some((x) => NATURAL_TYPES.includes(x))) return 'C_NATURAL';
  if (t.some((x) => CULTURAL_TYPES.includes(x))) return 'B_CULTURAL';
  return 'A_COMMERCIAL';
}

export function isOwnDomain(website: string | null): boolean {
  if (!website || website.trim() === '') return false;
  const lower = website.toLowerCase();
  return !SOCIAL_DOMAINS.some((d) => lower.includes(d));
}

function hasGooglePhotos(place: PlaceRow): boolean {
  return Array.isArray(place.photos) && place.photos.length > 0;
}

function hasStoredPhotos(place: PlaceRow): boolean {
  return Array.isArray(place.stored_photo_urls) && place.stored_photo_urls.length > 0;
}

function hasOpeningHours(place: PlaceRow): boolean {
  // jsonb opening_hours — truthy if it's a non-empty object/array
  if (place.opening_hours == null) return false;
  if (typeof place.opening_hours === 'object') {
    return Object.keys(place.opening_hours as Record<string, unknown>).length > 0;
  }
  return false;
}

export function bounce(place: PlaceRow): BouncerVerdict {
  const cluster = deriveCluster(place.types);
  const reasons: string[] = [];

  // B1: type blocklist (short-circuit — no other reasons matter)
  if (cluster === 'EXCLUDED') {
    const matched = (place.types ?? []).find((t) => EXCLUDED_TYPES.includes(t));
    return { is_servable: false, cluster, reasons: [`B1:${matched ?? 'unknown'}`] };
  }

  // B2: business closed
  if (place.business_status === 'CLOSED_PERMANENTLY') {
    return { is_servable: false, cluster, reasons: ['B2:closed'] };
  }

  // B3: data integrity (name + lat + lng required)
  if (!place.name || place.lat == null || place.lng == null) {
    return { is_servable: false, cluster, reasons: ['B3:missing_required_field'] };
  }

  // B7: Google photos required (universal — applies to all clusters including Natural)
  if (!hasGooglePhotos(place)) reasons.push('B7:no_google_photos');

  // B8: stored (downloaded) photos required (universal)
  if (!hasStoredPhotos(place)) reasons.push('B8:no_stored_photos');

  // Cluster-specific rules
  if (cluster === 'A_COMMERCIAL') {
    // B4/B5 — website + own-domain
    if (!isOwnDomain(place.website)) {
      reasons.push(place.website ? 'B5:social_only' : 'B4:no_website');
    }
    // B6 — opening_hours
    if (!hasOpeningHours(place)) reasons.push('B6:no_hours');
  } else if (cluster === 'B_CULTURAL') {
    // Famous bypass — established institutions can pass without their own website
    const famousBypass =
      (place.review_count ?? 0) >= 500 && (place.rating ?? 0) >= 4.5;
    if (!famousBypass) {
      if (!isOwnDomain(place.website)) {
        reasons.push(place.website ? 'B5:social_only' : 'B4:no_website');
      }
    }
    if (!hasOpeningHours(place)) reasons.push('B6:no_hours');
  }
  // Cluster C (Natural) — no website / no hours requirement (parks, trails are 24/7).

  return {
    is_servable: reasons.length === 0,
    cluster,
    reasons,
  };
}
