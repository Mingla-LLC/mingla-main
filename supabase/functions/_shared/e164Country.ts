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
  ["+32", "BE"], // Belgium — present in production data
  ["+1", "US"], // NANP. See #1529 SPEC §11 Q1: a Canadian handset resolves to
  // "US". That is correct ROUTING (Twilio serves all of NANP) and is an
  // accepted, documented imprecision in the consent audit, whose current
  // alternative is NULL for every recipient. Splitting NANP by area code is a
  // registered follow-up, NOT this issue.
];

const E164_RE = /^\+[1-9][0-9]{1,14}$/;

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
  for (const [prefix, iso2] of CALLING_CODE_TO_ISO2) {
    if (e164.startsWith(prefix)) return iso2;
  }
  return null;
}
