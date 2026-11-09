// Issue #1529 — SHARED E.164 → ISO-2 country derivation.
//
// ===========================================================================
// WHY THIS FILE EXISTS. READ BEFORE CHANGING IT.
// ===========================================================================
// `notification_outbox.country_code` was born with four readers and ZERO
// writers (#1529, proven: 6/6 production rows NULL). Every notification
// therefore presented as `NULL`, the SMS adapter turned that into `"US"` via
// `?? "US"`, and so every Nigerian text was handed to Twilio under the US
// kill-switch while `sms_live_enabled.ng` — the switch that is supposed to hold
// Nigeria back — governed nothing at all.
//
// Before this module there were THREE private, mutually inconsistent copies of
// "turn a phone into a country" (#1529 F-7):
//   - marketing-send/index.ts:655        (+1/+234 only, else null)
//   - marketing-send/orch-1270-defer.test.ts:75  (a verbatim DUPLICATE, so the
//     test asserted against its own copy and would pass even if the production
//     copy were deleted — a textbook unfalsifiable test)
//   - notifyV2.ts:433                    (`startsWith("+234") ? "NG" : "US"`,
//     which mislabels every country that is neither US nor NG)
// This module is the single source of truth that replaces them.
//
// THE AUTHORITY IS THE HANDSET, NOT THE VENUE. Production contains the case
// that proves it: a Miami Beach property, a US-region brand, and a recipient
// holding a Nigerian phone (#1529 F-3). Venue- or brand-derived country returns
// "US" there and is exactly wrong; the destination number returns "NG" and is
// right. SMS routing selects a PROVIDER — Termii can only deliver to Nigerian
// MSISDNs, Twilio's toll-free is the US/RoW route — so it must follow the
// handset.
//
// NULL MEANS "NOT DERIVABLE". IT NEVER MEANS "US". That conflation is the whole
// bug. A caller that reintroduces a `?? "US"` default against this module's
// output has restored #1529.
//
// PARITY CONTRACT: this module and `public.mingla_e164_country()` /
// `public.mingla_e164_normalize()` (migration
// 20270211001529_issue_1529_notification_country_code.sql) MUST agree on every
// input. That is enforced behaviourally by `e164Country.issue1529.test.ts`
// (T-5), which reads its fixtures out of the SQL test file so the two suites
// cannot drift apart. If you change the rules here, change them there, and the
// fixture list is the single place both read.
// ===========================================================================

/**
 * The bounded calling-code → ISO-2 table.
 *
 * Deliberately BOUNDED to the countries with a live SMS route plus those
 * present in production data — an unmapped calling code resolves to `null`
 * ("we do not know"), never to a guess.
 *
 * THIS IS THE INTENDED EXTENSION POINT: adding a country is one entry here,
 * one entry in the SQL twin, and one fixture row in the T-5 parity fixture
 * block. Order matters — LONGEST PREFIX FIRST, so `+234` is tested before any
 * shorter prefix could shadow it.
 */
const CALLING_CODE_TO_ISO2: ReadonlyArray<readonly [string, string]> = [
  ["+234", "NG"], // Nigeria — the Termii route
  ["+44", "GB"], // United Kingdom — present in production data
  ["+33", "FR"], // France — present in production data (see below)
  ["+32", "BE"], // Belgium — present in production data
  ["+1", "US"], // NANP. See #1529 SPEC §11 Q1: a Canadian handset resolves to
  // "US". That is correct ROUTING (Twilio serves all of NANP) and is an
  // accepted, documented imprecision in the consent audit, whose current
  // alternative is NULL for every recipient. Splitting NANP by area code is a
  // registered follow-up, NOT this issue.
];

/**
 * Calling codes OBSERVED IN PRODUCTION `auth.users.phone` (2026-08-03).
 *
 * WHY THIS LIST EXISTS. The SPEC justified the bounded map on the stated basis
 * that the excluded population was "zero in production today". **That was
 * false.** A direct production query returned:
 *
 *     +1 → 26 · +234 → 18 · +44 → 3 · +32 → 2 · +33 → 2
 *
 * Two real users hold French handsets. Under a map that omitted `+33` they
 * would have failed closed with `country_unresolved` — no text, ever, by
 * construction — where on `origin/main` they were reached over Twilio. Failing
 * closed on a genuinely unknown calling code is correct; silently excluding
 * real users is not.
 *
 * EVERY ENTRY HERE MUST RESOLVE TO A COUNTRY. Both parity suites assert exactly
 * that, in both languages, so a production calling code with no mapping FAILS
 * CI instead of quietly becoming permanent non-delivery. **When Mingla reaches
 * a new market, add the calling code here AND to the table above** — the
 * failing test is the reminder, which is what stops this recurring.
 */
export const PRODUCTION_CALLING_CODES: ReadonlyArray<string> = [
  "+1",
  "+234",
  "+44",
  "+33",
  "+32",
];

const E164_RE = /^\+[1-9][0-9]{1,14}$/;

/**
 * Minimum total digits (calling code + national number) for a plausible MSISDN.
 *
 * #1529 P3-1: `E164_RE` alone accepts any 2–15 digit string, so `'+234'`
 * resolved to NG and `'+1 (800) FLOWERS'` stripped down to `'+1800'` and
 * resolved to US. Neither is a reachable handset, and handing a malformed
 * MSISDN to a live provider is not something to delegate to the provider.
 * The shortest real E.164 numbers (Saint Helena `+290 XXXX`, Niue `+683 XXXX`)
 * total 7 digits, so 7 is the conservative floor.
 *
 * Applied to COUNTRY derivation ONLY, never to normalisation — the normaliser's
 * contract (what a syntactically valid E.164 string is) stays unchanged, so a
 * short fragment still normalises and simply resolves to no country.
 */
const MIN_E164_DIGITS = 7;

/**
 * Normalise a raw stored phone into strict E.164, or `null` if it cannot be.
 *
 * THIS IS WHAT MAKES THE NIGERIAN STAY PATH WORK AT ALL (#1529 F-2). Supabase
 * stores `auth.users.phone` WITHOUT the leading `+` — all 51 phones in
 * production, zero exceptions — while the dispatcher classifies a contact as a
 * phone only when it starts with `+` (`notifyV2.ts:90`). So every Stay SMS row
 * was dropped as `no_contact` before country was ever consulted. Prepending the
 * `+` here is a hard prerequisite for #1529's own acceptance criterion, not a
 * cosmetic tidy-up.
 *
 * Steps (mirrored exactly in `public.mingla_e164_normalize`):
 *   1. Reject null/blank, and reject anything containing `@` — an email is not
 *      a phone. Without this guard `user2000@example.com` would strip down to
 *      the digits `2000` and masquerade as the valid E.164 `+2000`.
 *   2. Keep a leading `+`, drop every other non-digit (spaces, dashes,
 *      parentheses), then prepend `+` when the result is bare digits.
 *   3. Return `null` unless the result is strict E.164.
 */
export function normalizeE164(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // An email is never a phone. Guarded BEFORE digit-stripping, because
  // stripping would otherwise mine digits out of the local part.
  if (trimmed.includes("@")) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = (hasPlus ? trimmed.slice(1) : trimmed).replace(/[^0-9]/g, "");
  if (digits === "") return null;

  const candidate = `+${digits}`;
  return E164_RE.test(candidate) ? candidate : null;
}

/**
 * Derive the ISO-2 country of the RECIPIENT HANDSET from a contact value.
 *
 * Returns `null` when the contact is absent, is an email, is not valid E.164,
 * or carries a calling code outside {@link CALLING_CODE_TO_ISO2}.
 *
 * `null` is the honest "not derivable" answer. Callers MUST NOT coerce it to a
 * country — that coercion is precisely the #1529 defect.
 */
export function countryFromE164(raw: string | null | undefined): string | null {
  const e164 = normalizeE164(raw);
  if (e164 === null) return null;
  // #1529 P3-1 — too few digits to be a reachable handset. `'+234'` is the
  // calling code, not a phone number, and must not resolve to Nigeria.
  if (e164.length - 1 < MIN_E164_DIGITS) return null;
  for (const [prefix, iso2] of CALLING_CODE_TO_ISO2) {
    if (e164.startsWith(prefix)) return iso2;
  }
  return null;
}

// ===========================================================================
// #4273 — MARKETING country resolution. SEPARATE from countryFromE164 above.
// ===========================================================================
// countryFromE164 is the TRANSACTIONAL authority (verification, tickets, RSVP,
// notifications) and is byte-for-byte main's: NG, GB, FR, BE and all of NANP
// as "US", gated by main's two switches. Marketing texts (Blast, offering
// invites) resolve with smsMarketingCountry instead: every payout country a
// host can pick (34 Stripe + NG), Canada split out by area code, and every
// other NANP member (Caribbean, Bermuda, US territories Twilio prices
// separately) resolved to ITS OWN country, which marketing does not text, so
// it is honestly skipped. Ghana, South Africa, the Philippines and Kenya stay
// unmapped (Seth, 2026-11-08). The SQL twin is
// public.mingla_sms_marketing_country (parity: issue_4273_sms_all_countries
// pg17 T-H and the Deno T-H that reads the same fixture rows).

const MARKETING_CALLING_CODE_TO_ISO2: ReadonlyArray<readonly [string, string]> =
  [
    ["+234", "NG"], // Nigeria — the Termii route
    ["+351", "PT"],
    ["+352", "LU"],
    ["+353", "IE"],
    ["+354", "IS"],
    ["+356", "MT"],
    ["+357", "CY"],
    ["+358", "FI"],
    ["+359", "BG"],
    ["+370", "LT"],
    ["+371", "LV"],
    ["+372", "EE"],
    ["+385", "HR"],
    ["+386", "SI"],
    ["+420", "CZ"],
    ["+421", "SK"],
    ["+423", "LI"],
    ["+30", "GR"],
    ["+31", "NL"],
    ["+32", "BE"],
    ["+33", "FR"],
    ["+34", "ES"],
    ["+36", "HU"],
    ["+39", "IT"],
    ["+40", "RO"],
    ["+41", "CH"],
    ["+43", "AT"],
    ["+44", "GB"],
    ["+45", "DK"],
    ["+46", "SE"],
    ["+47", "NO"],
    ["+48", "PL"],
    ["+49", "DE"],
    ["+1", "US"], // split below: CA by area code, other NANP members out
  ];

/**
 * #4273 — Canadian geographic NANP area codes (CRTC). Mirrored in the SQL twin.
 */
export const CANADIAN_AREA_CODES: ReadonlyArray<string> = [
  "204",
  "226",
  "236",
  "249",
  "250",
  "257",
  "263",
  "289",
  "306",
  "343",
  "354",
  "365",
  "367",
  "368",
  "382",
  "403",
  "416",
  "418",
  "428",
  "431",
  "437",
  "438",
  "450",
  "468",
  "474",
  "506",
  "514",
  "519",
  "548",
  "579",
  "581",
  "584",
  "587",
  "604",
  "613",
  "639",
  "647",
  "672",
  "683",
  "705",
  "709",
  "742",
  "753",
  "778",
  "780",
  "782",
  "807",
  "819",
  "825",
  "867",
  "873",
  "879",
  "902",
  "905",
  "942",
];
const CANADIAN_AREA_CODE_SET = new Set(CANADIAN_AREA_CODES);

/**
 * #4273 — NANP area codes that are NOT the 50 US states or Canada: the
 * Caribbean and Atlantic members, plus the US territories Twilio prices as
 * their own countries (PR, VI, GU, MP, AS). Each resolves to its own ISO-2,
 * which marketing does not text. Mirrored in the SQL twin.
 */
export const NANP_OTHER_AREA_CODES: ReadonlyArray<readonly [string, string]> = [
  ["242", "BS"],
  ["246", "BB"],
  ["264", "AI"],
  ["268", "AG"],
  ["284", "VG"],
  ["340", "VI"],
  ["345", "KY"],
  ["441", "BM"],
  ["473", "GD"],
  ["649", "TC"],
  ["658", "JM"],
  ["664", "MS"],
  ["670", "MP"],
  ["671", "GU"],
  ["684", "AS"],
  ["721", "SX"],
  ["758", "LC"],
  ["767", "DM"],
  ["784", "VC"],
  ["787", "PR"],
  ["809", "DO"],
  ["829", "DO"],
  ["849", "DO"],
  ["868", "TT"],
  ["869", "KN"],
  ["876", "JM"],
  ["939", "PR"],
];
const NANP_OTHER = new Map(NANP_OTHER_AREA_CODES);

/** #4273 — every country marketing SMS can be priced, switched and sent to. */
export const MAPPED_COUNTRIES: ReadonlyArray<string> = [
  ...new Set([...MARKETING_CALLING_CODE_TO_ISO2.map(([, iso2]) => iso2), "CA"]),
].sort();

/**
 * #4273 — the ISO-2 country a MARKETING text to this number goes to, or null.
 * A non-null answer outside {@link MAPPED_COUNTRIES} (a Caribbean NANP number,
 * for example) is a real country Mingla does not text: it reads "can't text
 * their country yet" in the quote and is never attempted at send.
 */
export function smsMarketingCountry(
  raw: string | null | undefined,
): string | null {
  const e164 = normalizeE164(raw);
  if (e164 === null) return null;
  if (e164.length - 1 < MIN_E164_DIGITS) return null;
  for (const [prefix, iso2] of MARKETING_CALLING_CODE_TO_ISO2) {
    if (!e164.startsWith(prefix)) continue;
    if (iso2 !== "US") return iso2;
    const areaCode = e164.slice(2, 5);
    if (CANADIAN_AREA_CODE_SET.has(areaCode)) return "CA";
    return NANP_OTHER.get(areaCode) ?? "US";
  }
  return null;
}
