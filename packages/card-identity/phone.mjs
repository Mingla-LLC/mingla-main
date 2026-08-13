/**
 * Issue #1703 — turning a venue's stored number into one that dials.
 *
 * THE DEFECT. `place_pool` holds 32,332 phone numbers and ZERO international
 * ones. Every stored value is in LOCAL format: `(919) 419-9222`,
 * `01279 942348`, `0803 482 1689`. The app dialled
 * `tel:${phone.replace(/[^0-9+]/g, '')}` — the local digits — so a number only
 * connected if the caller happened to be standing in that country. Tap a London
 * pub from the United States and the call fails.
 *
 * `formatPhoneDisplay` in `packages/phone-input/countries.ts` exists and is a
 * stub: `return phone;`. It is not used here and is not made to do this job —
 * that module is for a USER entering their own number in a picker that already
 * knows the country; this is for a VENUE whose country comes from a database
 * column. Different inputs, different failure modes.
 *
 * WHY THIS IS A PLAIN .mjs FILE IN THIS PACKAGE. The CI guard, Node consumers,
 * Metro consumers, and Supabase's hosted ESZip bundler all import this exact ESM
 * owner. It is RN-free, dependency-free, and pure.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WILL NOT DO
 *
 * It does not guess. Given a country it cannot resolve, or digits that do not
 * fit that country's plan, it returns the number UNCHANGED and says so — the
 * caller then dials exactly what it dials today, which is correct domestically
 * and no worse than the status quo abroad. Inventing a prefix would produce a
 * number that dials a stranger.
 */

'use strict';

/**
 * The eight countries the pool actually contains, plus the trunk-prefix rule
 * each one uses. Phone numbers exist for only three of them today (US 19,707,
 * GB 9,151, NG 3,472); the rest are here because `place_pool` holds places in
 * those countries and a number could arrive on any refresh.
 *
 * `trunk` is the national prefix a caller dials INSIDE the country and must DROP
 * when dialling in: '0' across Europe and Nigeria, and none in the North
 * American Numbering Plan, where the leading 1 is the country code itself.
 *
 * `nsnLengths` is the number of digits a valid subscriber number has once the
 * trunk prefix is gone. It is what makes this refuse rather than guess: a value
 * outside the list is not a number of that country, whatever the column says.
 */
const PLANS = {
  US: { dial: '1', trunk: null, nsnLengths: [10] },
  CA: { dial: '1', trunk: null, nsnLengths: [10] },
  GB: { dial: '44', trunk: '0', nsnLengths: [9, 10] },
  NG: { dial: '234', trunk: '0', nsnLengths: [8, 9, 10] },
  FR: { dial: '33', trunk: '0', nsnLengths: [9] },
  DE: { dial: '49', trunk: '0', nsnLengths: [6, 7, 8, 9, 10, 11] },
  BE: { dial: '32', trunk: '0', nsnLengths: [8, 9] },
  ES: { dial: '34', trunk: null, nsnLengths: [9] },
  PT: { dial: '351', trunk: null, nsnLengths: [9] },
};

/**
 * @typedef {Object} DialablePhone
 * @property {string} display  what a human reads
 * @property {string} tel      what goes after `tel:` — E.164 when resolvable
 * @property {boolean} international  true when `tel` carries a country code
 */

/**
 * @param {string|null|undefined} raw          the stored national number
 * @param {string|null|undefined} countryCode  ISO-3166-1 alpha-2, or null
 * @returns {DialablePhone|null}  null when there is no number at all — the
 *   caller must then render NO control, not a disabled one.
 */
function dialablePhone(raw, countryCode) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // An already-international number is left exactly as it is. Google returns
  // these for some rows and re-deriving one would be a chance to corrupt it.
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    if (digits === '') return null;
    return { display: trimmed, tel: `+${digits}`, international: true };
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits === '') return null;

  const cc = typeof countryCode === 'string' ? countryCode.trim().toUpperCase() : '';
  const plan = PLANS[cc];

  // No country, or one we have no plan for: dial what we were given. Correct
  // inside that country, unchanged from today's behaviour everywhere else, and
  // honestly reported as not international so the UI can say so if it wants to.
  if (!plan) return { display: trimmed, tel: digits, international: false };

  let nsn = digits;
  if (plan.trunk && nsn.startsWith(plan.trunk)) {
    nsn = nsn.slice(plan.trunk.length);
  } else if (!plan.trunk && nsn.length === plan.dial.length + plan.nsnLengths[0]
    && nsn.startsWith(plan.dial)) {
    // NANP numbers are sometimes stored as 1XXXXXXXXXX. Strip the country code
    // rather than prepending a second one.
    nsn = nsn.slice(plan.dial.length);
  }

  if (!plan.nsnLengths.includes(nsn.length)) {
    // The digits do not fit this country's numbering plan, so either the number
    // or the country is wrong. Do not manufacture an E.164 out of a mismatch.
    return { display: trimmed, tel: digits, international: false };
  }

  return {
    // THE DISPLAY KEEPS THE VENUE'S OWN GROUPING. Rebuilding it from the digits
    // would mean writing a grouping rule per country — `(919) 419-9222` vs
    // `020 7946 0000` vs `0803 482 1689` — and getting one wrong makes a real
    // number look fake. Google's national format IS the locally conventional
    // grouping, so the only edit is removing the trunk prefix (which must not
    // appear in an international number) and prepending the dial code.
    display: `+${plan.dial} ${stripLeadingTrunk(trimmed, plan.trunk)}`,
    tel: `+${plan.dial}${nsn}`,
    international: true,
  };
}

/**
 * Remove the trunk prefix from a formatted string WITHOUT touching its
 * separators. Operates on the first digit only, so `(0)20 7946` and `020 7946`
 * both lose exactly one character and keep everything else.
 */
function stripLeadingTrunk(formatted, trunk) {
  if (!trunk) return formatted.trim();
  for (let i = 0; i < formatted.length; i += 1) {
    const ch = formatted[i];
    if (ch < '0' || ch > '9') continue;
    if (ch !== trunk) return formatted.trim();
    return (formatted.slice(0, i) + formatted.slice(i + 1)).replace(/^[^\d+]+/, '').trim();
  }
  return formatted.trim();
}

/** The countries this module can produce an international number for. */
function supportedDialCountries() {
  return Object.keys(PLANS).sort();
}

const STRICT_E164 = /^\+[1-9][0-9]{7,14}$/;

/**
 * Resolve user-entered phone evidence without guessing a handset country.
 * Strict E.164 always wins and is preserved byte-for-byte. National input is
 * accepted only when the explicit ISO country lets the existing plan owner
 * prove a strict E.164 result.
 */
function resolveUserPhoneE164(raw, countryIso) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (STRICT_E164.test(trimmed)) return trimmed;
  if (typeof countryIso !== 'string' || !/^[A-Z]{2}$/.test(countryIso)) return null;
  const resolved = dialablePhone(trimmed, countryIso);
  if (!resolved || resolved.international !== true || !STRICT_E164.test(resolved.tel)) {
    return null;
  }
  return resolved.tel;
}

export {
  dialablePhone,
  resolveUserPhoneE164,
  supportedDialCountries,
  PLANS as PHONE_PLANS,
};
