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
