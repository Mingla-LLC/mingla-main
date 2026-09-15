/**
 * Issue #3380 — THE ONE SET OF RULES FOR A PHONE NUMBER A PERSON TYPES.
 *
 * Every Mingla surface that asks a guest or a host for a phone number turns
 * what they typed into E.164 here, and so does the server that receives it.
 * Before this file there were three answers to "is 0803 123 4567 a phone
 * number?": the Business checkout said yes on +234, the ordering server said no
 * (it only knew "+…" or ten US digits), and the host sheets said no unless it
 * started with "+". A Lagos guest typing the number the way every Nigerian
 * writes it hit all three.
 *
 * WHY IT IS DEPENDENCY-FREE. This file is imported by the Business app (Metro,
 * web and native), the Explorer app, jest, and Supabase Edge Functions (Deno,
 * hosted bundler). It must not import anything — not React Native, not the
 * country directory (which carries React types), not another package.
 *
 * WHAT IT WILL NOT DO. It never guesses a country. The country always comes
 * from the person (the picker they can see) or from a "+" they typed. It never
 * turns a number into a DIFFERENT number to make it pass: a Nigerian mobile
 * typed under the UK flag is refused with a message that names Nigeria, not
 * quietly saved as a UK number that reaches a stranger.
 *
 * Relationship to `packages/card-identity/phone.mjs`: that owner makes a
 * VENUE's stored number dialable and resolves identity evidence for RSVP, Stay
 * and People (issue #1857). This one owns live ENTRY — the rules a form applies
 * while someone types, including the mobile-only checks and the error copy.
 */

export type PhoneEntryMode = "mobile" | "any";

export type PhoneEntryProblem =
  | "empty"
  | "country_required"
  | "wrong_country"
  | "too_short"
  | "too_long"
  | "not_mobile"
  | "invalid";

export type PhoneEntryResult =
  | {
      ok: true;
      /** Canonical `+<country><number>`. */
      e164: string;
      /**
       * The country the number belongs to. Equals the selected country unless
       * the person typed or pasted a different `+code`, in which case the
       * picker should follow it.
       */
      countryIso: string | null;
    }
  | {
      ok: false;
      problem: PhoneEntryProblem;
      /** Plain-English, specific, safe to show under the field. */
      message: string;
      /** Set when the digits are a real number for ANOTHER country we know. */
      suggestedCountryIso: string | null;
      /** Set when a typed `+code` names a country (so the picker can follow). */
      countryIso: string | null;
    };

interface NumberingRule {
  /** Countries sharing this plan. The first is the one a bare dial code means. */
  readonly isos: readonly string[];
  /** Country calling code, digits only. */
  readonly dial: string;
  /** National trunk prefix dropped in E.164, or null when there is none. */
  readonly trunk: "0" | null;
  /** Valid national significant number lengths (after the trunk prefix). */
  readonly lengths: readonly number[];
  /** Shape of a MOBILE national significant number, when we can state it. */
  readonly mobile: RegExp | null;
  /** Structural shape every number must have, when we can state it. */
  readonly shape: RegExp | null;
  /** "Nigerian mobile numbers…", "UK numbers…". */
  readonly adjective: string;
  /** How the country's own people write a mobile number. */
  readonly example: string;
  readonly mobileHint: string;
}

/**
 * ONLY COUNTRIES WE CAN STATE CONFIDENTLY. The set and the lengths are exactly
 * the ones issue #2462 characterised for checkout (so moving checkout onto this
 * file changes no answer it gives); the mobile shapes are new and are applied
 * only where a form asks for a number it will TEXT.
 *
 * An unlisted country falls through to the generic E.164 check. This table can
 * only make validation stricter for numbers we understand — it must never start
 * rejecting a country nobody has characterised.
 */
const RULES: readonly NumberingRule[] = [
  {
    isos: ["NG"],
    dial: "234",
    trunk: "0",
    lengths: [10],
    // 070x, 080x, 081x, 090x, 091x (and the 071x block).
    mobile: /^[789][01]\d{8}$/,
    shape: null,
    adjective: "Nigerian",
    example: "0803 123 4567",
    mobileHint: "start with 07, 08 or 09",
  },
  {
    isos: ["US", "CA"],
    dial: "1",
    trunk: null,
    lengths: [10],
    mobile: null,
    // Area code and exchange both start 2–9 in the North American plan.
    shape: /^[2-9]\d{2}[2-9]\d{6}$/,
    adjective: "US and Canadian",
    example: "(415) 555-0123",
    mobileHint: "",
  },
  {
    isos: ["GB"],
    dial: "44",
    trunk: "0",
    lengths: [9, 10],
    // 071–075 and 077–079 (070 is personal numbering, 076 pagers), plus
    // the Isle of Man's 07624.
    mobile: /^7(?:[1-57-9]\d{8}|624\d{6})$/,
    shape: null,
    adjective: "UK",
    example: "07700 900123",
    mobileHint: "start with 07",
  },
  {
    isos: ["GH"],
    dial: "233",
    trunk: "0",
    lengths: [9],
    mobile: null,
    shape: null,
    adjective: "Ghanaian",
    example: "024 123 4567",
    mobileHint: "",
  },
  {
    isos: ["KE"],
    dial: "254",
    trunk: "0",
    lengths: [9],
    mobile: null,
    shape: null,
    adjective: "Kenyan",
    example: "0712 345678",
    mobileHint: "",
  },
  {
    isos: ["ZA"],
    dial: "27",
    trunk: "0",
    lengths: [9],
    mobile: null,
    shape: null,
    adjective: "South African",
    example: "071 234 5678",
    mobileHint: "",
  },
  {
    isos: ["IE"],
    dial: "353",
    trunk: "0",
    lengths: [9],
    mobile: null,
    shape: null,
    adjective: "Irish",
    example: "085 123 4567",
    mobileHint: "",
  },
];

/**
 * Italy, San Marino and Vatican City: the leading zero is PART of the number
 * (`+39 06 …`) and must be kept. Stripping is the default everywhere else.
 */
const KEEPS_LEADING_ZERO = new Set(["39", "378", "379"]);

const E164_RE = /^\+[1-9][0-9]{1,14}$/;
const ISO_RE = /^[A-Z]{2}$/;
const SUPPORTED_PHONE_ENTRY_RE = /^\+?[0-9\s().-]+$/;

const ruleForIso = (iso: string | null | undefined): NumberingRule | null => {
  if (typeof iso !== "string") return null;
  const upper = iso.trim().toUpperCase();
  return RULES.find((rule) => rule.isos.includes(upper)) ?? null;
};

const ruleForDial = (dial: string): NumberingRule | null =>
  RULES.find((rule) => rule.dial === dial) ?? null;

const dialDigits = (dialCode: string | null | undefined): string | null => {
  if (typeof dialCode !== "string") return null;
  const digits = dialCode.replace(/\D/g, "");
  return /^[1-9]\d{0,3}$/.test(digits) ? digits : null;
};

/** `+234` for a country we characterise, else null. */
export const phoneDialCodeForCountry = (
  iso: string | null | undefined,
): string | null => {
  const rule = ruleForIso(iso);
  return rule === null ? null : `+${rule.dial}`;
};

/** The countries this file can validate beyond generic E.164. */
export const characterisedPhoneCountries = (): string[] =>
  RULES.flatMap((rule) => [...rule.isos]).sort();

const primaryIso = (rule: NumberingRule, selected: string | null): string =>
  selected !== null && rule.isos.includes(selected) ? selected : rule.isos[0];

const fits = (rule: NumberingRule, nsn: string, mode: PhoneEntryMode): boolean => {
  if (!rule.lengths.includes(nsn.length)) return false;
  if (rule.shape !== null && !rule.shape.test(nsn)) return false;
  if (mode === "mobile" && rule.mobile !== null && !rule.mobile.test(nsn)) {
    return false;
  }
  return true;
};

/**
 * Which OTHER country these digits are a real number for, if any. Used only to
 * explain a refusal — never to accept a number. Only plans with a distinctive
 * shape can be named (a bare "9 digits" fits half the world), and when two
 * plans both fit, neither is named.
 */
const otherCountryFor = (
  digits: string,
  exclude: NumberingRule | null,
): NumberingRule | null => {
  const matches = new Set<NumberingRule>();
  for (const rule of RULES) {
    if (rule === exclude) continue;
    if (rule.mobile === null && rule.shape === null) continue;
    if (
      rule.trunk !== null &&
      digits.startsWith(rule.trunk) &&
      fits(rule, digits.slice(rule.trunk.length), "mobile")
    ) {
      matches.add(rule);
    }
    if (
      digits.length > rule.dial.length &&
      digits.startsWith(rule.dial) &&
      fits(rule, digits.slice(rule.dial.length), "mobile")
    ) {
      matches.add(rule);
    }
    if (rule.trunk !== null && rule.mobile !== null && fits(rule, digits, "mobile")) {
      matches.add(rule);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
};

const countryName = (rule: NumberingRule, iso: string | null): string => {
  const names: Record<string, string> = {
    NG: "Nigeria",
    US: "the United States",
    CA: "Canada",
    GB: "the United Kingdom",
    GH: "Ghana",
    KE: "Kenya",
    ZA: "South Africa",
    IE: "Ireland",
  };
  const code = primaryIso(rule, iso);
  return names[code] ?? code;
};

const refuse = (
  problem: PhoneEntryProblem,
  message: string,
  suggested: NumberingRule | null = null,
  countryIso: string | null = null,
): PhoneEntryResult => ({
  ok: false,
  problem,
  message,
  suggestedCountryIso: suggested === null ? null : suggested.isos[0],
  countryIso,
});

const wrongCountry = (
  selectedDial: string,
  other: NumberingRule,
  countryIso: string | null,
): PhoneEntryResult =>
  refuse(
    "wrong_country",
    `That looks like a ${other.adjective} number, not a +${selectedDial} one. ` +
      `Change the country to ${countryName(other, null)} (+${other.dial}).`,
    other,
    countryIso,
  );

const lengthMessage = (rule: NumberingRule, nsn: string, mode: PhoneEntryMode): string => {
  const wanted = rule.lengths.join(" or ");
  const kind = mode === "mobile" && rule.mobile !== null ? "mobile numbers" : "numbers";
  const after = rule.trunk !== null ? " after the 0" : "";
  return `${rule.adjective} ${kind} have ${wanted} digits${after} — you entered ${nsn.length}.`;
};

/** Validate a national significant number against a known plan. */
const judge = (
  rule: NumberingRule,
  nsn: string,
  rawDigits: string,
  mode: PhoneEntryMode,
  selectedIso: string | null,
  typedCountry: boolean,
): PhoneEntryResult => {
  // Only a typed "+code" may move the picker; a national number belongs to the
  // country the person chose, even when that plan is shared (+1 US/Canada).
  const countryIso = typedCountry ? primaryIso(rule, selectedIso) : selectedIso;
  if (fits(rule, nsn, mode)) {
    return { ok: true, e164: `+${rule.dial}${nsn}`, countryIso };
  }
  const echoIso = typedCountry ? countryIso : null;
  const other = typedCountry ? null : otherCountryFor(rawDigits, rule);
  if (other !== null) return wrongCountry(rule.dial, other, echoIso);
  if (!rule.lengths.includes(nsn.length)) {
    return refuse(
      nsn.length < Math.min(...rule.lengths) ? "too_short" : "too_long",
      lengthMessage(rule, nsn, mode),
      null,
      echoIso,
    );
  }
  if (rule.shape !== null && !rule.shape.test(nsn)) {
    return refuse(
      "invalid",
      `That isn't a valid ${rule.adjective} number. Check it looks like ${rule.example}.`,
      null,
      echoIso,
    );
  }
  return refuse(
    "not_mobile",
    `${rule.adjective} mobile numbers ${rule.mobileHint}, like ${rule.example}.`,
    null,
    echoIso,
  );
};

export interface PhoneEntryOptions {
  /** ISO 3166-1 alpha-2 of the country the picker shows. */
  countryIso?: string | null;
  /**
   * The picker's dial code (`+61`). Needed only for countries this file does
   * not characterise; a characterised country's own dial code always wins.
   */
  dialCode?: string | null;
  /**
   * `mobile` (default) when the number will be TEXTED — a UK landline is
   * refused. `any` for a venue's or brand's contact line.
   */
  mode?: PhoneEntryMode;
}

/**
 * Turn what a person typed into E.164, or say exactly what is wrong.
 *
 *   parsePhoneEntry("0803 123 4567", { countryIso: "NG" })   → +2348031234567
 *   parsePhoneEntry("803 123 4567",  { countryIso: "NG" })   → +2348031234567
 *   parsePhoneEntry("+234 803 123 4567", { countryIso: "US" })→ +2348031234567, countryIso NG
 *   parsePhoneEntry("07700 900123",  { countryIso: "GB" })   → +447700900123
 *   parsePhoneEntry("(415) 555-0123",{ countryIso: "US" })   → +14155550123
 *   parsePhoneEntry("08031234567",   { countryIso: "GB" })   → refused, suggests NG
 */
export const parsePhoneEntry = (
  raw: string | null | undefined,
  options: PhoneEntryOptions = {},
): PhoneEntryResult => {
  const mode: PhoneEntryMode = options.mode ?? "mobile";
  const selectedIso =
    typeof options.countryIso === "string" &&
    ISO_RE.test(options.countryIso.trim().toUpperCase())
      ? options.countryIso.trim().toUpperCase()
      : null;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") {
    return refuse("empty", "Enter a phone number.");
  }
  if (!SUPPORTED_PHONE_ENTRY_RE.test(text)) {
    return refuse(
      "invalid",
      "Enter a phone number using only digits and normal phone punctuation.",
    );
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length === 0 || /^0+$/.test(digits)) {
    return refuse("empty", "Enter a phone number.");
  }

  const selectedRule = ruleForIso(selectedIso);
  const selectedDial = selectedRule?.dial ?? dialDigits(options.dialCode);

  // ── A "+" (or the 00 international prefix) means the person told us the
  //    country themselves. Honour it, even if the picker says otherwise.
  const compact = text.replace(/[\s().-]/g, "");
  if (compact.startsWith("+") || /^00[1-9]/.test(compact)) {
    const intl = compact.startsWith("+") ? digits : digits.slice(2);
    const rule =
      selectedDial !== null && intl.startsWith(selectedDial)
        ? ruleForDial(selectedDial)
        : RULES.find((candidate) => intl.startsWith(candidate.dial)) ?? null;
    if (rule !== null) {
      let nsn = intl.slice(rule.dial.length);
      // "+234 (0) 803…" and "+44 07700…": the trunk zero never belongs after
      // a country code. Dropping it is not a guess — no number starts with it.
      if (rule.trunk !== null) nsn = nsn.replace(/^0+/, "");
      return judge(rule, nsn, intl, mode, selectedIso, true);
    }
    const e164 = `+${intl}`;
    if (E164_RE.test(e164) && intl.length >= 8) {
      const keepIso =
        selectedDial !== null && intl.startsWith(selectedDial) ? selectedIso : null;
      return { ok: true, e164, countryIso: keepIso };
    }
    return refuse(
      intl.length < 8 ? "too_short" : "too_long",
      "That international number doesn't look complete. Check the country code and number.",
    );
  }

  // ── A national number needs a country.
  if (selectedDial === null) {
    return refuse("country_required", "Choose your country code first.");
  }

  const rule = ruleForDial(selectedDial);
  if (rule === null) {
    // Uncharacterised country — the generic E.164 path, unchanged from #2462.
    let nsn = digits;
    if (!KEEPS_LEADING_ZERO.has(selectedDial)) nsn = nsn.replace(/^0+/, "");
    // The person pasted their country code without the "+", and keeping it
    // would overflow E.164's 15 digits — only then is it certainly a duplicate.
    if (
      nsn.startsWith(selectedDial) &&
      selectedDial.length + nsn.length > 15
    ) {
      nsn = nsn.slice(selectedDial.length);
    }
    const e164 = `+${selectedDial}${nsn}`;
    if (E164_RE.test(e164)) return { ok: true, e164, countryIso: selectedIso };
    const other = otherCountryFor(digits, null);
    if (other !== null) return wrongCountry(selectedDial, other, null);
    return refuse("invalid", "Enter a valid phone number for the country you chose.");
  }

  let nsn = digits;
  if (rule.trunk === null) {
    // No trunk prefix in this plan: a leading 0 is not something to strip, it
    // is proof the number belongs to a different country. Refuse and say so.
    if (nsn.startsWith("0")) {
      const other = otherCountryFor(digits, rule);
      if (other !== null) return wrongCountry(rule.dial, other, null);
      return refuse(
        "invalid",
        `${rule.adjective} numbers don't start with 0. Check the country code next to the field.`,
      );
    }
  } else {
    nsn = nsn.replace(/^0+/, "");
  }

  // The person typed their country code as well ("2348031234567" under +234,
  // "14155550123" under +1). Only trusted when what is left is a length we
  // recognise AND the whole thing is not — so a real US number in area code
  // 234 keeps its area code.
  if (
    nsn.length > rule.dial.length &&
    nsn.startsWith(rule.dial) &&
    rule.lengths.includes(nsn.length - rule.dial.length) &&
    !rule.lengths.includes(nsn.length)
  ) {
    nsn = nsn.slice(rule.dial.length);
  }

  return judge(rule, nsn, digits, mode, selectedIso, false);
};

/**
 * Checkout's historical signature (dial code + digits → E.164 or null), now a
 * view over `parsePhoneEntry` in `any` mode so checkout and ordering can never
 * disagree about a number again.
 */
export const composePhoneE164 = (
  countryDialCode: string,
  localDigits: string,
): string | null => {
  const dial = dialDigits(countryDialCode);
  if (dial === null) return null;
  const rule = ruleForDial(dial);
  const result = parsePhoneEntry(localDigits, {
    countryIso: rule?.isos[0] ?? null,
    dialCode: `+${dial}`,
    mode: "any",
  });
  return result.ok ? result.e164 : null;
};

// ---------------------------------------------------------------------------
// Formatting as you type
// ---------------------------------------------------------------------------

const group = (digits: string, sizes: readonly number[]): string => {
  const parts: string[] = [];
  let index = 0;
  for (const size of sizes) {
    if (index >= digits.length) break;
    parts.push(digits.slice(index, index + size));
    index += size;
  }
  if (index < digits.length) parts.push(digits.slice(index));
  return parts.join(" ");
};

/**
 * How a national number is written in its own country, built from the digits
 * alone. Only characterised countries are grouped; anything else keeps the
 * digits exactly as typed (minus stray letters) so we never impose a grouping
 * that makes a real number look wrong.
 */
export const formatPhoneNational = (
  countryIso: string | null | undefined,
  text: string,
): string => {
  const digits = text.replace(/\D/g, "");
  const rule = ruleForIso(countryIso);
  if (rule === null || digits.length === 0) {
    return text.replace(/[^\d+\s()-]/g, "");
  }
  if (rule.dial === "1") {
    const lead = digits.startsWith("1") ? "1 " : "";
    const rest = digits.startsWith("1") ? digits.slice(1) : digits;
    if (rest.length <= 3) return `${lead}${rest}`;
    if (rest.length <= 6) return `${lead}(${rest.slice(0, 3)}) ${rest.slice(3)}`;
    return `${lead}(${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`;
  }
  const hasTrunk = rule.trunk !== null && digits.startsWith(rule.trunk);
  if (rule.dial === "44") {
    const london = hasTrunk ? digits.startsWith("02") : digits.startsWith("2");
    if (london) return group(digits, hasTrunk ? [3, 4, 4] : [2, 4, 4]);
    return group(digits, hasTrunk ? [5, 6] : [4, 6]);
  }
  if (rule.dial === "254") return group(digits, hasTrunk ? [4, 6] : [3, 6]);
  // NG, GH, ZA, IE: 0XX XXX XXXX / XX XXX XXXX style.
  if (rule.dial === "234") return group(digits, hasTrunk ? [4, 3, 4] : [3, 3, 4]);
  return group(digits, hasTrunk ? [3, 3, 4] : [2, 3, 4]);
};

export interface PhoneEditResult {
  text: string;
  /** Where the cursor belongs in `text`. */
  cursor: number;
}

/**
 * Reformat after an edit WITHOUT losing the person's place. The cursor is
 * pinned to "after the Nth digit", which survives any regrouping.
 *
 * Deleting a separator alone would otherwise be undone by the reformat, so a
 * backspace over a space (digits unchanged, text shorter) removes the digit
 * before it — what the person meant.
 */
export const reformatPhoneEdit = (input: {
  countryIso: string | null | undefined;
  previousText: string;
  nextText: string;
  /** Cursor position in `nextText`; defaults to its end. */
  cursor?: number;
}): PhoneEditResult => {
  let next = input.nextText;
  let cursor = Math.max(0, Math.min(input.cursor ?? next.length, next.length));
  const previousDigits = input.previousText.replace(/\D/g, "");
  const nextDigits = next.replace(/\D/g, "");
  if (
    next.length < input.previousText.length &&
    nextDigits === previousDigits &&
    cursor > 0
  ) {
    // Find the digit immediately before the cursor and drop it.
    let index = cursor - 1;
    while (index >= 0 && !/\d/.test(next[index] ?? "")) index -= 1;
    if (index >= 0) {
      next = next.slice(0, index) + next.slice(index + 1);
      cursor = index;
    }
  }
  const digitsBeforeCursor = next.slice(0, cursor).replace(/\D/g, "").length;
  const text = formatPhoneNational(input.countryIso, next);
  if (ruleForIso(input.countryIso) === null) {
    return { text, cursor: Math.min(cursor, text.length) };
  }
  let seen = 0;
  let position = 0;
  if (digitsBeforeCursor > 0) {
    for (; position < text.length; position += 1) {
      if (/\d/.test(text[position] ?? "")) seen += 1;
      if (seen === digitsBeforeCursor) {
        position += 1;
        break;
      }
    }
  }
  return { text, cursor: Math.min(position, text.length) };
};

/**
 * The picker's starting country: the venue's or brand's country when the page
 * knows it, otherwise the device's region, otherwise nothing. `isKnown` is the
 * host's country directory (so an unrecognised code can never become a flag).
 */
export const resolvePhoneStartCountry = (
  candidates: ReadonlyArray<string | null | undefined>,
  isKnown: (iso: string) => boolean,
): string | null => {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const iso = candidate.trim().toUpperCase();
    if (ISO_RE.test(iso) && isKnown(iso)) return iso;
  }
  return null;
};
