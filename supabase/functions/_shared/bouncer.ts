// ORCH-0588 Slice 1 — Bouncer v2 pure logic.
// ORCH-0678 — extended with opts.skipStoredPhotoCheck for two-pass design.
//
// Imported by:
//   - run-bouncer/index.ts          → calls bounce(place); writes is_servable
//   - run-pre-photo-bouncer/index.ts → calls bounce(place, {skipStoredPhotoCheck:true});
//                                       writes passes_pre_photo_check
//   - _shared/__tests__/bouncer.test.ts (Deno tests)
//
// Zero side effects, zero IO. Pure functions only.
//
// Invariant I-BOUNCER-DETERMINISTIC: NO AI, NO keyword matching for category judgment.
// Type lists + data-integrity rules + cluster-aware website/hours requirements.
//
// I-TWO-PASS-BOUNCER-RULE-PARITY (ORCH-0678): rule body must remain identical across
// both passes. The skipStoredPhotoCheck flag is the ONLY allowed difference — it
// suppresses B8 in the pre-photo pass (the photo-download step happens between the
// two passes; pre-photo can't yet check stored photos because they don't exist yet).
// Adding any other pass-specific branch is a violation — file a new ORCH instead.

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

// ORCH-0631 — B9:child_venue allowlist. Case-insensitive exact-name matches
// that BYPASS the B9 patterns below. For legitimate venues whose names happen
// to match retailer patterns (camp/ironic naming, famous chains with retailer
// words in name, etc.). Keep small — most exceptions should live in the regex
// pattern guards (e.g., Target Field/Center already excluded in the target
// pattern). Add a row here only when a specific named venue is an established
// false positive we want to admit.
//
// Sync: also referenced by categoryPlaceTypes.isExcludedVenueName() via import.
export const CHILD_VENUE_ALLOWLIST: ReadonlyArray<string> = [
  // London queer nightclub/bar/restaurant — camp naming, not actually a
  // superstore. https://dalstonsuperstore.com. Not serving London today;
  // listed here so pool re-bounces admit it if London is ever seeded.
  'dalston superstore',
];

// ORCH-0631 — B9:child_venue patterns. REJECT sub-counters, departments, and
// vendor kiosks INSIDE big-box retailers. DO NOT reject the stores themselves —
// Walmart, Costco, Sam's Club, etc. are legitimate grocery/flowers destinations.
//
// The distinction:
//   ❌ REJECT: "Walmart Bakery", "Walmart Deli", "Walmart Garden Center",
//              "Sam's Club Cafe", "Costco Food Court" — these are counters.
//   ✅ ACCEPT: "Walmart", "Walmart Supercenter", "Walmart Neighborhood Market",
//              "Costco", "Sam's Club", "Asda Superstore" — these are whole stores,
//              valid for groceries + flowers categories.
//
// Why a dedicated rule instead of type-only filtering: Google tags "Walmart Bakery"
// as primary_type='bakery' — it legitimately passes the type gate. Only the name
// reveals it's a sub-counter not a standalone bakery.
//
// Matched by case-insensitive regex. Any hit → reject with reason 'B9:child_venue:<pattern>'.
// Allowlist (above) is checked first and short-circuits to "not a child venue".

// Sub-counter/department keywords that follow a retailer's brand prefix.
const COUNTER_SUFFIX = '(?:bakery|deli|cafe|food\\s*court|garden\\s*center|pharmacy|auto(?:motive)?|vision|tire|optical|photo|gas\\s*station|fuel|liquor|eye\\s*care|hair\\s*salon|nail\\s*salon)';

export const CHILD_VENUE_NAME_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  // Walmart sub-counters (NOT "Walmart", "Walmart Supercenter", "Walmart Neighborhood Market")
  { pattern: new RegExp(`^\\s*walmart\\s+${COUNTER_SUFFIX}\\b`, 'i'), label: 'walmart_counter' },
  // Sam's Club sub-counters
  { pattern: new RegExp(`^\\s*sam'?s\\s+club\\s+${COUNTER_SUFFIX}\\b`, 'i'), label: 'sams_club_counter' },
  // Costco sub-counters
  { pattern: new RegExp(`^\\s*costco\\s+${COUNTER_SUFFIX}\\b`, 'i'), label: 'costco_counter' },
  // BJ's Wholesale sub-counters
  { pattern: new RegExp(`^\\s*bj'?s\\s+${COUNTER_SUFFIX}\\b`, 'i'), label: 'bjs_counter' },
  // Target sub-counters (Target Cafe, Target Starbucks, etc.) — NOT Target Field/Center (stadium/arena)
  { pattern: /^\s*target\s+(?!field\b|center\b)(cafe|starbucks|pharmacy|optical|photo)\b/i, label: 'target_counter' },
  // Kroger / Harris Teeter / Publix / Wegmans sub-counters (floral already handled via groceries category)
  { pattern: new RegExp(`^\\s*(kroger|harris\\s+teeter|publix|wegmans|whole\\s+foods|food\\s+lion|trader\\s+joe'?s)\\s+${COUNTER_SUFFIX}\\b`, 'i'), label: 'supermarket_counter' },
  // Parenthetical "(Inside X)" — vendor kiosks: "MUNCHIT CAFE (Inside ALNOOR MARKET)"
  { pattern: /\(\s*inside\s+[A-Za-z]/i, label: 'inside_parenthetical' },
  // Pipe "| Inside X": "Synergy Face + Body | Inside The Beltline"
  { pattern: /\|\s*inside\s+[A-Za-z]/i, label: 'inside_pipe' },
  // "X at Walmart / at Target / at Costco" — 3rd-party kiosks INSIDE a retailer
  // (e.g., "Starbucks at Walmart", "McDonald's at Walmart")
  { pattern: /\bat\s+(walmart|target|costco|sam'?s\s+club|bj'?s)\b/i, label: 'at_retailer' },
];

/**
 * Returns true if the name is on the B9 allowlist (exact case-insensitive match).
 * Short-circuits the child-venue check for legitimate false-positive venues.
 */
export function isChildVenueAllowlisted(name: string | null): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  return CHILD_VENUE_ALLOWLIST.some((allowed) => allowed.toLowerCase() === normalized);
}

/**
 * B9: returns the matching label if the name indicates a retail sub-venue, else null.
 * Exported so seeding can short-circuit before the row even enters the pool.
 * Allowlist is checked first — allowlisted names always return null.
 */
export function matchChildVenuePattern(name: string | null): string | null {
  if (!name) return null;
  if (isChildVenueAllowlisted(name)) return null;
  for (const { pattern, label } of CHILD_VENUE_NAME_PATTERNS) {
    if (pattern.test(name)) return label;
  }
  return null;
}

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

export function bounce(
  place: PlaceRow,
  opts?: { skipStoredPhotoCheck?: boolean },
): BouncerVerdict {
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

  // B9: child-venue (ORCH-0631) — short-circuit. Big-box retailer sub-venues and
  // "inside [store]" kiosks never qualify as standalone destinations regardless
  // of photos/hours/cluster. Examples: Walmart Bakery, Sam's Club Cafe, Walmart
  // Garden Center, "MUNCHIT CAFE (Inside ALNOOR MARKET)".
  const childVenueLabel = matchChildVenuePattern(place.name);
  if (childVenueLabel) {
    return { is_servable: false, cluster, reasons: [`B9:child_venue:${childVenueLabel}`] };
  }

  // B7: Google photos required (universal — applies to all clusters including Natural).
  // Always checked, including in pre-photo pass — no point queueing zero-photo-metadata
  // rows for download.
  if (!hasGooglePhotos(place)) reasons.push('B7:no_google_photos');

  // B8: stored (downloaded) photos required (universal in final pass; SKIPPED in
  // pre-photo pass per ORCH-0678 two-pass design — pre-photo runs B1-B7+B9 only,
  // so a place can clear pre-photo, get its photos downloaded, then clear final).
  if (!opts?.skipStoredPhotoCheck && !hasStoredPhotos(place)) {
    reasons.push('B8:no_stored_photos');
  }

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
