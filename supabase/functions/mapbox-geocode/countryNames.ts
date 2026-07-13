/**
 * ORCH-1365 [location-search-relevance] — trailing-country parser for the
 * CONSUMER place-search (`suggest_places`) action ONLY. NEVER imported by the
 * business `suggest` path (`handleSuggest`/`buildSuggestUrl`), which stays
 * byte-identical and filter-free (INV-3 / ORCH-1079).
 *
 * WHY (runtime-proven — evidence/ORCH-1365/live_edge_fn_reproduction.txt, probes
 * C/D/G/J/K): a non-Lagos user typing "lekki nigeria" gets literal "Nigeria"
 * places + POIs and NO Lekki, Lagos — Mapbox Search Box fuzzy-matches the
 * trailing country WORD instead of reading it as context. A `country=` filter
 * alone (without stripping the word) does NOT rescue it (probe J); the word must
 * be STRIPPED from `q` and re-applied as a Mapbox `country` ISO 3166-1 alpha-2
 * bias (probe G/N → Lekki Lagos #1). Comma insertion (K) and /forward (H/I) also
 * fail.
 *
 * SAFETY (OQ-1 ruling — English country names + common aliases, strip ONLY a
 * recognized trailing country token): a trailing CITY word ("lekki london",
 * probe L) or a non-geographic word ("lekki phase", probe M) is NEVER stripped,
 * and a SINGLE-token query ("lekki") is never stripped (there must be ≥1 leading
 * token remaining). English-only trailing token for v1 (no locale/translation).
 *
 * Mapbox `country` format verified vs live docs
 * (https://docs.mapbox.com/api/search/search-box/): ISO 3166-1 alpha-2, lowercase.
 */

/**
 * Static English country-name → ISO 3166-1 alpha-2 table (lowercase keys +
 * lowercase codes). Bounded + in-repo (OQ-1). Includes the UN member states +
 * common aliases and multi-word official forms ("united kingdom", "united
 * states", "south africa", "united arab emirates", "south korea", …). Keys are
 * matched case-insensitively against the trailing 1–3 tokens of the query.
 */
export const COUNTRY_NAME_TO_ISO: Readonly<Record<string, string>> = {
  // ── Common aliases first (documented intent) ────────────────────────────
  "uk": "gb",
  "u.k.": "gb",
  "united kingdom": "gb",
  "great britain": "gb",
  "britain": "gb",
  "england": "gb",
  "scotland": "gb",
  "wales": "gb",
  "northern ireland": "gb",
  "usa": "us",
  "u.s.a.": "us",
  "us": "us",
  "u.s.": "us",
  "united states": "us",
  "united states of america": "us",
  "america": "us",
  "uae": "ae",
  "u.a.e.": "ae",
  "united arab emirates": "ae",
  "emirates": "ae",

  // ── Full English country names → alpha-2 ─────────────────────────────────
  "afghanistan": "af",
  "albania": "al",
  "algeria": "dz",
  "andorra": "ad",
  "angola": "ao",
  "antigua and barbuda": "ag",
  "argentina": "ar",
  "armenia": "am",
  "australia": "au",
  "austria": "at",
  "azerbaijan": "az",
  "bahamas": "bs",
  "bahrain": "bh",
  "bangladesh": "bd",
  "barbados": "bb",
  "belarus": "by",
  "belgium": "be",
  "belize": "bz",
  "benin": "bj",
  "bhutan": "bt",
  "bolivia": "bo",
  "bosnia and herzegovina": "ba",
  "bosnia": "ba",
  "botswana": "bw",
  "brazil": "br",
  "brunei": "bn",
  "bulgaria": "bg",
  "burkina faso": "bf",
  "burundi": "bi",
  "cabo verde": "cv",
  "cape verde": "cv",
  "cambodia": "kh",
  "cameroon": "cm",
  "canada": "ca",
  "central african republic": "cf",
  "chad": "td",
  "chile": "cl",
  "china": "cn",
  "colombia": "co",
  "comoros": "km",
  "congo": "cg",
  "democratic republic of the congo": "cd",
  "dr congo": "cd",
  "costa rica": "cr",
  "croatia": "hr",
  "cuba": "cu",
  "cyprus": "cy",
  "czechia": "cz",
  "czech republic": "cz",
  "denmark": "dk",
  "djibouti": "dj",
  "dominica": "dm",
  "dominican republic": "do",
  "ecuador": "ec",
  "egypt": "eg",
  "el salvador": "sv",
  "equatorial guinea": "gq",
  "eritrea": "er",
  "estonia": "ee",
  "eswatini": "sz",
  "swaziland": "sz",
  "ethiopia": "et",
  "fiji": "fj",
  "finland": "fi",
  "france": "fr",
  "gabon": "ga",
  "gambia": "gm",
  "georgia": "ge",
  "germany": "de",
  "ghana": "gh",
  "greece": "gr",
  "grenada": "gd",
  "guatemala": "gt",
  "guinea": "gn",
  "guinea-bissau": "gw",
  "guyana": "gy",
  "haiti": "ht",
  "honduras": "hn",
  "hungary": "hu",
  "iceland": "is",
  "india": "in",
  "indonesia": "id",
  "iran": "ir",
  "iraq": "iq",
  "ireland": "ie",
  "israel": "il",
  "italy": "it",
  "ivory coast": "ci",
  "cote d'ivoire": "ci",
  "jamaica": "jm",
  "japan": "jp",
  "jordan": "jo",
  "kazakhstan": "kz",
  "kenya": "ke",
  "kiribati": "ki",
  "kosovo": "xk",
  "kuwait": "kw",
  "kyrgyzstan": "kg",
  "laos": "la",
  "latvia": "lv",
  "lebanon": "lb",
  "lesotho": "ls",
  "liberia": "lr",
  "libya": "ly",
  "liechtenstein": "li",
  "lithuania": "lt",
  "luxembourg": "lu",
  "madagascar": "mg",
  "malawi": "mw",
  "malaysia": "my",
  "maldives": "mv",
  "mali": "ml",
  "malta": "mt",
  "marshall islands": "mh",
  "mauritania": "mr",
  "mauritius": "mu",
  "mexico": "mx",
  "micronesia": "fm",
  "moldova": "md",
  "monaco": "mc",
  "mongolia": "mn",
  "montenegro": "me",
  "morocco": "ma",
  "mozambique": "mz",
  "myanmar": "mm",
  "burma": "mm",
  "namibia": "na",
  "nauru": "nr",
  "nepal": "np",
  "netherlands": "nl",
  "holland": "nl",
  "new zealand": "nz",
  "nicaragua": "ni",
  "niger": "ne",
  "nigeria": "ng",
  "north korea": "kp",
  "north macedonia": "mk",
  "macedonia": "mk",
  "norway": "no",
  "oman": "om",
  "pakistan": "pk",
  "palau": "pw",
  "palestine": "ps",
  "panama": "pa",
  "papua new guinea": "pg",
  "paraguay": "py",
  "peru": "pe",
  "philippines": "ph",
  "poland": "pl",
  "portugal": "pt",
  "qatar": "qa",
  "romania": "ro",
  "russia": "ru",
  "russian federation": "ru",
  "rwanda": "rw",
  "saint kitts and nevis": "kn",
  "saint lucia": "lc",
  "saint vincent and the grenadines": "vc",
  "samoa": "ws",
  "san marino": "sm",
  "sao tome and principe": "st",
  "saudi arabia": "sa",
  "senegal": "sn",
  "serbia": "rs",
  "seychelles": "sc",
  "sierra leone": "sl",
  "singapore": "sg",
  "slovakia": "sk",
  "slovenia": "si",
  "solomon islands": "sb",
  "somalia": "so",
  "south africa": "za",
  "south korea": "kr",
  "korea": "kr",
  "south sudan": "ss",
  "spain": "es",
  "sri lanka": "lk",
  "sudan": "sd",
  "suriname": "sr",
  "sweden": "se",
  "switzerland": "ch",
  "syria": "sy",
  "taiwan": "tw",
  "tajikistan": "tj",
  "tanzania": "tz",
  "thailand": "th",
  "timor-leste": "tl",
  "east timor": "tl",
  "togo": "tg",
  "tonga": "to",
  "trinidad and tobago": "tt",
  "tunisia": "tn",
  "turkey": "tr",
  "turkiye": "tr",
  "turkmenistan": "tm",
  "tuvalu": "tv",
  "uganda": "ug",
  "ukraine": "ua",
  "uruguay": "uy",
  "uzbekistan": "uz",
  "vanuatu": "vu",
  "vatican city": "va",
  "venezuela": "ve",
  "vietnam": "vn",
  "yemen": "ye",
  "zambia": "zm",
  "zimbabwe": "zw",
};

/** Longest multi-word country key is 5 tokens ("saint vincent and the
 *  grenadines"); cap the trailing-token window there. */
const MAX_COUNTRY_TOKENS = 5;

/**
 * Split a recognized trailing country name/alias off the raw query.
 *
 * Returns `{ query, country }` where `country` is the ISO 3166-1 alpha-2 code
 * (lowercase) when the trailing 1–MAX_COUNTRY_TOKENS tokens match a known country
 * name AND at least one leading token remains; otherwise `{ query }` with no
 * `country` (the original trimmed text, unchanged).
 *
 * Guards (SPEC §4.1 + OQ-1/OQ-3):
 *  - SINGLE-token queries are NEVER stripped ("lekki" → { query:"lekki" }).
 *  - only a recognized COUNTRY token is stripped ("lekki phase"/"lekki london"
 *    are left intact — probes L/M).
 *  - a bare country name with no leading place ("nigeria", "south africa") is
 *    NOT stripped either (there is no leading token to keep) → it searches the
 *    country as text (OQ-3 fallback), never an empty query.
 *  - longest trailing match wins ("lekki south africa" → za, not a 1-token miss).
 */
export function parseTrailingCountry(raw: string): {
  query: string;
  country?: string;
} {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { query: "" };

  // Tokenize on whitespace AND commas so "lekki, nigeria" tokenizes cleanly.
  const tokens = trimmed.split(/[\s,]+/).filter((t) => t.length > 0);
  if (tokens.length < 2) return { query: trimmed };

  // Try the longest trailing window first; require ≥1 leading token to remain.
  const maxWindow = Math.min(MAX_COUNTRY_TOKENS, tokens.length - 1);
  for (let n = maxWindow; n >= 1; n--) {
    const tail = tokens.slice(tokens.length - n).join(" ").toLowerCase();
    const iso = COUNTRY_NAME_TO_ISO[tail];
    if (iso) {
      const query = tokens.slice(0, tokens.length - n).join(" ");
      return { query, country: iso };
    }
  }

  return { query: trimmed };
}
