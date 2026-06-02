/**
 * formatLocationLabel — ORCH-1058 [Collab deck location chips + smarter no-overlap feedback]
 *
 * Single owner for participant location-label presentation in the collab-deck
 * empty state. Pulls together three concerns that previously had no home:
 *
 *  1. The GPS PRIVACY GUARD (load-bearing). A participant who shares live GPS
 *     (`use_gps_location === true`) MUST NEVER render a place name — not the
 *     resolved city, not the county, nothing — even when the client has written
 *     a reverse-geocoded `custom_location` / `custom_lat`/`custom_lng` for them.
 *     The label resolves to a privacy-positive phrase instead. This is the leak
 *     the ORCH-1058 investigation found.
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
 * Privacy only governs the DISPLAY STRING — the intersection geometry still uses
 * the raw coords. See `collabDeadEndBannerService.classifyIntersectionCase`.
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
 * clarity. GPS / pending kinds resolve their own a11y strings at the chip.
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

const GPS_PHRASE_OTHER = 'Sharing live location';
const GPS_PHRASE_SELF = 'Sharing your location';
const GPS_PHRASE_INLINE = 'sharing live location';
const PINNED_PHRASE = 'A pinned spot';
const NOT_SET_PHRASE = 'Location not set yet';

type ResolveInput = {
  prefs: Record<string, unknown> | null | undefined;
  /** True when the label is for the viewer's own chip (first-person copy). */
  isSelf?: boolean;
};

/**
 * Resolve one participant's location label with the §1 privacy precedence:
 *
 *   use_gps_location === true            → GPS phrase (NEVER the resolved city)
 *   explicit place string present        → formatCityState(custom_location)
 *   custom_lat/lng present, no string     → "A pinned spot"
 *   else                                  → "Location not set yet"
 */
export function resolveParticipantLocationLabel(
  input: ResolveInput,
): ResolvedParticipantLocation {
  const prefs = input.prefs ?? {};

  // 1. GPS privacy guard — load-bearing. Wins over any written string/coords.
  if (prefs.use_gps_location === true) {
    const label = input.isSelf ? GPS_PHRASE_SELF : GPS_PHRASE_OTHER;
    return { kind: 'gps', label, a11yLabel: GPS_PHRASE_INLINE };
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

/** Inline GPS phrase for chat banners (lowercase, mid-sentence). */
export const GPS_INLINE_PHRASE = GPS_PHRASE_INLINE;
