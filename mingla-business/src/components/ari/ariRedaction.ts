/**
 * #4389 AR-3 / A5 — bank, card and ID numbers never leave the phone in a
 * chat message. Any run of 8 or more digits (and card-style 4-4-4 groups) is
 * replaced with dots before send, so the number reaches neither Ari nor the
 * server.
 *
 * MINGLA-INVARIANT: I-4389-ARI-CLIENT-REDACTS-DIGITS | issue #4389 | the Ari composer redacts every run of 8+ digits (and 4-digit groups of 3+) before a message is sent | issue_4389_ari_setup_cards.implementor.test.ts
 */
const LONG_DIGITS = /\d{8,}/g;
const GROUPED_DIGITS = /\b\d{4}(?:[ -]\d{4}){2,}\b/g;

export function redactSensitiveDigits(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  const dots = (match: string): string => {
    redacted = true;
    return match.replace(/\d/g, "•");
  };
  const out = text.replace(GROUPED_DIGITS, dots).replace(LONG_DIGITS, dots);
  return { text: out, redacted };
}

/**
 * #4389 AR-12 — the host tells Ari to skip payments ("skip the bank", "do it
 * later", "free events only"). The chat then shows the same "Only free events
 * for now?" words and buttons as the K1 sheet, so a skip is never silent. The
 * message is still sent; this only decides whether the card shows.
 */
const SKIP_WORDS = /\b(skip|later|not now|another time|no bank|without (?:a |my )?bank|don'?t have (?:a |my )?bank)\b/i;
const PAYMENT_WORDS = /\b(bank|payments?|payouts?|get paid|stripe|setup|set up|this step|that step|it)\b/i;
const FREE_ONLY = /\bfree (?:events? )?only\b|\bonly free events?\b/i;

export function wantsToSkipPayments(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 200) return false;
  if (FREE_ONLY.test(t)) return true;
  return SKIP_WORDS.test(t) && PAYMENT_WORDS.test(t);
}
