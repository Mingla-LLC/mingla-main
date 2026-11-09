/**
 * #4334 — ISO 3166-2 subdivision tables used to validate the region code the
 * address proxy returns.
 *
 * PURE: no Deno APIs and no remote imports, so the mingla-business jest suite
 * can import it directly (same rule as googleNormalize.ts).
 *
 * WHY: Google's `administrative_area_level_1.shortText` is the USPS code in the
 * US ("NC") but is often a long name elsewhere ("England", a Belgian province in
 * Dutch). `preferences.discover_city_state_code` is read as an ISO subdivision
 * code (Ticketmaster `stateCode`, discovery cache keys), so a region code is only
 * returned when it is a real ISO 3166-2 subdivision of the country, or when the
 * long name maps to one through ISO_3166_2_BY_NAME. Otherwise it is null — never
 * derived by slicing a name (INV-3).
 *
 * Coverage: every country present in production anchors and brands today
 * (US, NG, GB, BE) plus CA and GH. Source: ISO 3166-2 (codes are the part after
 * the country prefix).
 */

export const ISO_3166_2_SUBDIVISIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  US: new Set([
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
    "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
    "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
    "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "AS",
    "GU", "MP", "PR", "UM", "VI",
  ]),
  NG: new Set([
    "AB", "AD", "AK", "AN", "BA", "BE", "BO", "BY", "CR", "DE", "EB", "ED", "EK",
    "EN", "FC", "GO", "IM", "JI", "KD", "KE", "KN", "KO", "KT", "KW", "LA", "NA",
    "NI", "OG", "ON", "OS", "OY", "PL", "RI", "SO", "TA", "YO", "ZA",
  ]),
  GB: new Set(["ENG", "SCT", "WLS", "NIR"]),
  CA: new Set([
    "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
  ]),
  GH: new Set([
    "AA", "AF", "AH", "BE", "BO", "CP", "EP", "NE", "NP", "OT", "SV", "TV", "UE",
    "UW", "WN", "WP",
  ]),
  BE: new Set([
    "BRU", "VLG", "WAL", "VAN", "VBR", "VLI", "VOV", "VWV", "WBR", "WHT", "WLG",
    "WLX", "WNA",
  ]),
};

/**
 * Normalized long name → ISO 3166-2 code, per country. Keys are normalized the
 * same way as `normalizeName` in googleNormalize.ts (NFKD, diacritics stripped,
 * lower-case, punctuation to spaces, spaces collapsed).
 */
export const ISO_3166_2_BY_NAME: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  US: {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE",
    "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    "district of columbia": "DC", "puerto rico": "PR",
  },
  NG: {
    "abia": "AB", "adamawa": "AD", "akwa ibom": "AK", "anambra": "AN",
    "bauchi": "BA", "benue": "BE", "borno": "BO", "bayelsa": "BY",
    "cross river": "CR", "delta": "DE", "ebonyi": "EB", "edo": "ED",
    "ekiti": "EK", "enugu": "EN", "federal capital territory": "FC",
    "fct": "FC", "abuja federal capital territory": "FC", "gombe": "GO",
    "imo": "IM", "jigawa": "JI", "kaduna": "KD", "kebbi": "KE", "kano": "KN",
    "kogi": "KO", "katsina": "KT", "kwara": "KW", "lagos": "LA",
    "lagos state": "LA", "nasarawa": "NA", "niger": "NI", "ogun": "OG",
    "ondo": "ON", "osun": "OS", "oyo": "OY", "plateau": "PL", "rivers": "RI",
    "sokoto": "SO", "taraba": "TA", "yobe": "YO", "zamfara": "ZA",
  },
  GB: {
    "england": "ENG", "scotland": "SCT", "wales": "WLS", "cymru": "WLS",
    "northern ireland": "NIR",
  },
  CA: {
    "alberta": "AB", "british columbia": "BC", "manitoba": "MB",
    "new brunswick": "NB", "newfoundland and labrador": "NL",
    "nova scotia": "NS", "northwest territories": "NT", "nunavut": "NU",
    "ontario": "ON", "prince edward island": "PE", "quebec": "QC",
    "saskatchewan": "SK", "yukon": "YT",
  },
  GH: {
    "greater accra": "AA", "greater accra region": "AA", "ahafo": "AF",
    "ashanti": "AH", "ashanti region": "AH", "bono east": "BE", "bono": "BO",
    "central": "CP", "central region": "CP", "eastern": "EP",
    "eastern region": "EP", "north east": "NE", "northern": "NP",
    "northern region": "NP", "oti": "OT", "savannah": "SV", "volta": "TV",
    "volta region": "TV", "upper east": "UE", "upper west": "UW",
    "western north": "WN", "western": "WP", "western region": "WP",
  },
  BE: {
    "brussels": "BRU", "brussels capital region": "BRU",
    "brussels hoofdstedelijk gewest": "BRU",
    "region de bruxelles capitale": "BRU", "flanders": "VLG",
    "flemish region": "VLG", "vlaanderen": "VLG", "vlaams gewest": "VLG",
    "wallonia": "WAL", "wallonie": "WAL", "walloon region": "WAL",
    "region wallonne": "WAL", "antwerp": "VAN", "antwerpen": "VAN",
    "flemish brabant": "VBR", "vlaams brabant": "VBR", "limburg": "VLI",
    "east flanders": "VOV", "oost vlaanderen": "VOV", "west flanders": "VWV",
    "west vlaanderen": "VWV", "walloon brabant": "WBR", "brabant wallon": "WBR",
    "hainaut": "WHT", "liege": "WLG", "luxembourg": "WLX", "namur": "WNA",
  },
};
