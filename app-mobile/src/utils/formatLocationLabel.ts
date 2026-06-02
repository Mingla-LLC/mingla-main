/**
 * formatLocationLabel — ORCH-1058 [Collab deck location chips + smarter no-overlap feedback]
 *
 * Single owner for participant location-label presentation in the collab-deck
 * empty state. Pulls together three concerns that previously had no home:
 *
 *  1. GPS LOCATION TRANSPARENCY (CORRECTION 2026-06-02, operator-reversed). A
 *     participant who shares live GPS (`use_gps_location === true`) now renders
 *     their RESOLVED reverse-geocoded location as a short "City, ST" label —
 *     the SAME format as an explicit-location participant — so the group can SEE
 *     where each person actually is and diagnose a geometry problem at a glance.
 *     (During the investigated incident a flapping GPS would correctly show
 *     "Washington, DC" then "Raleigh, NC" — that visibility is the whole point.)
 *     The earlier "Sharing live location" privacy guard was REMOVED. If a GPS
 *     user has no resolved location string yet, the label degrades to the
 *     pending "getting a fix" state — never a blank, never a stale city.
 *
 *  2. "City, ST" formatting. Verbose Google/TM reverse-geocode strings
 *     ("Raleigh, Wake County, North Carolina, United States") condense to a
 *     short, scannable label ("Raleigh, NC"), with graceful fallbacks for
 *     non-US, missing-state, and city-only inputs.
 *
 *  3. The shared US/country lookup tables. `US_STATE_CODES` + `COUNTRY_NAME_TO_CODE`
 *     used to live only inside `CityPickerSheet`; they now live here and are
 *     re-exported so the picker and the collab-deck share one owner (Constitution #2).
 *
 * Presentation only — the intersection geometry uses the raw coords. See
 * `collabDeadEndBannerService.classifyIntersectionCase`.
 *
 * Spec: Mingla_Artifacts/specs/DESIGN_ORCH-1058_COLLAB_LOCATION_CHIPS.md §1–§2.
 */

// ---------------------------------------------------------------------------
// Shared lookup tables (moved here from CityPickerSheet — one owner)
// ---------------------------------------------------------------------------

export const US_STATE_CODES = new Set<string>([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

export const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  USA: 'US',
  'United States': 'US',
  'United States of America': 'US',
  UK: 'GB',
  'United Kingdom': 'GB',
  Canada: 'CA',
  Mexico: 'MX',
  France: 'FR',
  Germany: 'DE',
  Spain: 'ES',
  Italy: 'IT',
  Japan: 'JP',
  Australia: 'AU',
  Brazil: 'BR',
};

/**
 * Full US state/territory NAME → 2-letter code. The codebase had no such map
 * before ORCH-1058 (CityPickerSheet only handled already-abbreviated
 * "City, ST, USA"). Google reverse-geocode emits the spelled-out state name,
 * so this map is required to condense it to "City, ST".
 */
export const US_STATE_NAME_TO_CODE: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
  'District of Columbia': 'DC',
};

/** Display-only override: GB renders as the friendlier "UK" on a chip (spec §2.3). */
const COUNTRY_CODE_DISPLAY_OVERRIDE: Record<string, string> = {
  GB: 'UK',
};

// ---------------------------------------------------------------------------
// City, ST formatter (spec §2)
// ---------------------------------------------------------------------------

const US_COUNTRY_CODE = 'US';

/**
 * Condense a verbose reverse-geocode string to a short "City, ST" / "City, CC"
 * / "City" label. Never echoes the raw country tail. Never truncates text
 * (layout ellipsizes — see CollabLocationChips). See spec §2 worked vectors.
 */
export function formatCityState(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return 'Location set';
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) return 'Location set';

  const city = parts[0];

  // City-only input ("Raleigh") → verbatim.
  if (parts.length === 1) return city;

  const lastPart = parts[parts.length - 1];
  const countryCode = COUNTRY_NAME_TO_CODE[lastPart] ?? null;

  if (countryCode === US_COUNTRY_CODE) {
    // Scan the middle tokens (everything between city and country) for a state.
    // County tokens ("Wake County") are skipped. First state hit wins.
    for (let i = 1; i < parts.length - 1; i += 1) {
      const token = parts[i];
      if (/ County$/i.test(token)) continue;

      const upper = token.toUpperCase();
      if (US_STATE_CODES.has(upper)) {
        return `${city}, ${upper}`;
      }
      const byName = US_STATE_NAME_TO_CODE[token];
      if (byName) {
        return `${city}, ${byName}`;
      }
    }
    // US but no parseable state → city-only (never show "United States").
    return city;
  }

  if (countryCode) {
    const display = COUNTRY_CODE_DISPLAY_OVERRIDE[countryCode] ?? countryCode;
    return `${city}, ${display}`;
  }

  // Unrecognized country → city-only (never echo the raw tail).
  return city;
}

/**
 * Full-name expansion for the screen-reader label. Mirrors `formatCityState`
 * but spells the US state out ("Raleigh, North Carolina") for VoiceOver
 * clarity. GPS participants reuse this expansion (their label is a real city);
 * the pending kind resolves its own a11y string at the chip.
 */
export function expandCityStateForA11y(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return 'location set';
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return 'location set';
  const city = parts[0];
  if (parts.length === 1) return city;

  const lastPart = parts[parts.length - 1];
  const countryCode = COUNTRY_NAME_TO_CODE[lastPart] ?? null;

  if (countryCode === US_COUNTRY_CODE) {
    for (let i = 1; i < parts.length - 1; i += 1) {
      const token = parts[i];
      if (/ County$/i.test(token)) continue;
      const upper = token.toUpperCase();
      if (US_STATE_CODES.has(upper)) {
        // Reverse-lookup the full name for VoiceOver clarity.
        const fullName = Object.keys(US_STATE_NAME_TO_CODE).find(
          (name) => US_STATE_NAME_TO_CODE[name] === upper,
        );
        return fullName ? `${city}, ${fullName}` : `${city}, ${upper}`;
      }
      if (US_STATE_NAME_TO_CODE[token]) {
        return `${city}, ${token}`;
      }
    }
    return city;
  }
  if (countryCode) {
    return city;
  }
  return city;
}

// ---------------------------------------------------------------------------
// Participant location resolver — the privacy precedence (spec §1)
// ---------------------------------------------------------------------------

export type ParticipantLocationKind = 'gps' | 'place' | 'pending';

export type ResolvedParticipantLocation = {
  kind: ParticipantLocationKind;
  /** Visible chip / inline label. */
  label: string;
  /** Screen-reader label (state spelled out for places; phrase for gps/pending). */
  a11yLabel: string;
};

const PINNED_PHRASE = 'A pinned spot';
const NOT_SET_PHRASE = 'Location not set yet';
const GPS_PENDING_PHRASE = 'Getting a fix…';

/**
 * Pick the GPS user's resolved reverse-geocoded location string from prefs.
 *
 * Verified against live `collaboration_sessions.participant_prefs` (ORCH-1058
 * correction probe, 2026-06-02): a GPS participant's resolved string lands at
 * the top-level `prefs.location` ("Raleigh, Wake County, North Carolina,
 * United States"), while `custom_location` is null. We also accept
 * `custom_location` as a defensive fallback so either write path resolves.
 */
function pickGpsResolvedString(prefs: Record<string, unknown>): string | null {
  const fromLocation = prefs.location;
  if (typeof fromLocation === 'string' && fromLocation.trim().length > 0) {
    return fromLocation.trim();
  }
  const fromCustom = prefs.custom_location;
  if (typeof fromCustom === 'string' && fromCustom.trim().length > 0) {
    return fromCustom.trim();
  }
  return null;
}

type ResolveInput = {
  prefs: Record<string, unknown> | null | undefined;
  /** True when the label is for the viewer's own chip (first-person copy). */
  isSelf?: boolean;
};

/**
 * Resolve one participant's location label with the §1 precedence:
 *
 *   use_gps_location === true + resolved string  → formatCityState(prefs.location)
 *   use_gps_location === true, no string yet      → "Getting a fix…" (pending)
 *   explicit place string present                 → formatCityState(custom_location)
 *   custom_lat/lng present, no string             → "A pinned spot"
 *   else                                          → "Location not set yet"
 *
 * CORRECTION (operator-reversed 2026-06-02): a GPS participant now renders their
 * REAL resolved city ("City, ST"), identical to an explicit-location participant
 * — transparency so the group can see where everyone actually is. `isSelf` no
 * longer changes a GPS label (the city is the city for everyone).
 */
export function resolveParticipantLocationLabel(
  input: ResolveInput,
): ResolvedParticipantLocation {
  const prefs = input.prefs ?? {};

  // 1. GPS participant — show their resolved City, ST (transparency). When the
  //    fix hasn't reverse-geocoded yet, degrade to pending — never blank/stale.
  if (prefs.use_gps_location === true) {
    const resolvedString = pickGpsResolvedString(prefs);
    if (resolvedString) {
      return {
        kind: 'gps',
        label: formatCityState(resolvedString),
        a11yLabel: expandCityStateForA11y(resolvedString),
      };
    }
    return { kind: 'pending', label: GPS_PENDING_PHRASE, a11yLabel: 'getting a location fix' };
  }

  // 2. Explicit place string.
  const customLocation = prefs.custom_location;
  if (typeof customLocation === 'string' && customLocation.trim().length > 0) {
    const raw = customLocation.trim();
    return {
      kind: 'place',
      label: formatCityState(raw),
      a11yLabel: expandCityStateForA11y(raw),
    };
  }

  // 3. Pinned coords with no string.
  const lat = Number(prefs.custom_lat);
  const lng = Number(prefs.custom_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { kind: 'place', label: PINNED_PHRASE, a11yLabel: PINNED_PHRASE.toLowerCase() };
  }

  // 4. Nothing yet.
  return { kind: 'pending', label: NOT_SET_PHRASE, a11yLabel: 'location not in yet' };
}
