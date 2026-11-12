// Issue #3355 Wave D — the personal-data rules Ari memory and gap logging share.
//
// ariSensitiveReason mirrors public.ari_memory_sensitive_reason (migration
// 20280702063355): the edge refuses first, in plain words, and the SQL check
// is the server's last word for every writer. scrubAriExcerpt keeps gap
// excerpts PII-minimised: emails, phone numbers and card-like numbers become
// placeholders and the text is capped.
//
// Leaf module: no imports, safe for every edge function and test.

export type AriSensitiveReason =
  | "contact_details"
  | "payment_details"
  | "id_details";

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// #3355 rework 1 (tester P3-15): an email written out to dodge a filter
// ("ada [at] gmail [dot] com", "ada at gmail dot com").
const AT_WORD = String.raw`(?:\s*[[({]\s*at\s*[\])}]\s*)`;
const DOT_WORD = String.raw`(?:\s*[[({]\s*dot\s*[\])}]\s*|\s+dot\s+)`;
const COMMON_TLD =
  "(?:com|net|org|co|io|ng|uk|gh|ke|za|edu|gov|me|info|biz|app|dev|ai|africa)";
const EMAIL_SPELLED = new RegExp(
  String
    .raw`[a-z0-9._%+-]+${AT_WORD}[a-z0-9-]+(?:(?:${DOT_WORD}|\.)[a-z0-9-]+)*(?:${DOT_WORD}|\.)[a-z]{2,6}\b|[a-z0-9._%+-]+(?:\s+at\s+|\s*@\s*)[a-z0-9-]+(?:${DOT_WORD}[a-z0-9-]+)*${DOT_WORD}${COMMON_TLD}\b`,
  "gi",
);
/** "my pin is 4455", "PIN: 1234". */
const PIN_DIGITS =
  /\bpin(?:\s+(?:code|number|no\.?))?\s*(?:is|:|=|-)?\s*\d{4,8}\b/i;
const ID_WORDS =
  /\b(password|passcode|passwd|pin code|one[- ]time code|otp|bvn|nin|ssn|social security|passport( number| no)?|national id|id number|driver'?s licen[cs]e)\b/i;
const PAYMENT_WORDS =
  /\b(cvv|cvc|iban|swift|sort code|routing number|account number|acct no|card number)\b/i;
const DATES = [
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g,
  /\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g,
  /\d{1,2}:\d{2}/g,
];
const DIGIT_RUN = /\+?\d(?:[ ().-]?\d){6,}/g;

function withoutDates(text: string): string {
  let out = text;
  for (const pattern of DATES) out = out.replace(pattern, " ");
  return out;
}

function runReason(run: string): AriSensitiveReason | null {
  const digits = run.replace(/\D/g, "");
  if (run.startsWith("+")) return "contact_details";
  if (digits.length >= 13 && digits.length <= 19) return "payment_details";
  if (digits.length >= 7) return "contact_details";
  return null;
}

/** Why a note must not be stored (payment, ID or contact details), or null. */
export function ariSensitiveReason(text: string): AriSensitiveReason | null {
  // Full-width and other compatibility digits read as plain digits.
  const value = String(text ?? "").normalize("NFKC");
  if (new RegExp(EMAIL.source, "i").test(value)) return "contact_details";
  if (new RegExp(EMAIL_SPELLED.source, "i").test(value)) {
    return "contact_details";
  }
  if (ID_WORDS.test(value) || PIN_DIGITS.test(value)) return "id_details";
  if (PAYMENT_WORDS.test(value)) return "payment_details";
  for (const run of withoutDates(value).match(DIGIT_RUN) ?? []) {
    const reason = runReason(run);
    if (reason) return reason;
  }
  return null;
}

/** The host-facing reason a note was not kept. */
export function ariSensitiveRefusal(reason: AriSensitiveReason): string {
  switch (reason) {
    case "contact_details":
      return "I don't keep emails or phone numbers in memory, so I didn't save that.";
    case "payment_details":
      return "I don't keep card or bank details in memory, so I didn't save that.";
    case "id_details":
      return "I don't keep passwords or ID numbers in memory, so I didn't save that.";
    default: {
      const never: never = reason;
      return never;
    }
  }
}

export const ARI_EXCERPT_MAX = 240;

/**
 * A PII-minimised excerpt: emails, phone numbers and card-like numbers are
 * replaced (dates and times stay), whitespace is folded, and the text is
 * capped at `max` characters.
 */
export function scrubAriExcerpt(text: string, max = ARI_EXCERPT_MAX): string {
  let value = String(text ?? "").normalize("NFKC").replace(/\s+/g, " ")
    .trim();
  value = value.replace(EMAIL, "[email]").replace(EMAIL_SPELLED, "[email]")
    .replace(
      /(\bpin(?:\s+(?:code|number|no\.?))?\s*(?:is|:|=|-)?\s*)\d{4,8}\b/gi,
      "$1[number]",
    );
  // Protect dates and times, scrub long digit runs, then restore.
  const kept: string[] = [];
  for (const pattern of DATES) {
    value = value.replace(pattern, (match) => {
      kept.push(match);
      return `\uE000${kept.length - 1}\uE001`;
    });
  }
  value = value.replace(DIGIT_RUN, (run) => {
    const reason = runReason(run);
    if (reason === "payment_details") return "[number]";
    if (reason === "contact_details") return "[phone]";
    return run;
  });
  value = value.replace(
    /\uE000(\d+)\uE001/g,
    (_m, index: string) => kept[Number(index)] ?? "",
  );
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
