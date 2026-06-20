/**
 * META-ORCH-1161 Sub-A.2 — TESTER adversarial regression test (different angle).
 *
 * The implementor's happy-path test (consentService.orch1161.test.ts) proves the
 * service PASSES the constant THROUGH verbatim. It does NOT detect drift in the
 * constant ITSELF: if a future edit paraphrases, truncates, or re-words
 * CONSENT_DISCLOSURE_TEXT, that test still passes (it compares the call payload
 * to the same — now-drifted — constant). The legal burden-of-proof artifact
 * would silently degrade.
 *
 * This adversarial test PINS the constant to a FROZEN, char-for-char snapshot of
 * the COPY §1b legal-authority string (length 1071), so ANY edit to the recorded
 * disclosure text fails CI loudly — a true drift detector independent of the
 * pass-through path.
 *
 * fails-on-revert: change a single character / truncate / paraphrase
 * CONSENT_DISCLOSURE_TEXT in `consentDisclosure.ts` → this test FAILS.
 *
 * Authority: Mingla_Artifacts/design/ORCH-1161/COPY_META-ORCH-1161_CONSENT_AND_MESSAGE_TEMPLATES.md §1b
 * Contract:  SPEC §8.1 / DEC-186 / R-8 — disclosure_text recorded VERBATIM, no paraphrase.
 */

import { describe, expect, test } from "@jest/globals";

import {
  CONSENT_DISCLOSURE_TEXT,
  CONSENT_TERMS_BODY,
  CONSENT_VISIBLE_LABEL_LINK,
  CONSENT_VISIBLE_LABEL_PREFIX,
  CONSENT_VISIBLE_LABEL_SUFFIX,
  DISCLOSURE_VERSION,
} from "../../constants/consentDisclosure";

// FROZEN snapshot of COPY §1b with all placeholders FILLED (Mingla LLC / URLs).
// Char-for-char copy of the legal authority. Do NOT "fix" this to match a drifted
// constant — if they diverge, the CONSTANT changed and that is the defect.
const FROZEN_DISCLOSURE_1B =
  "I agree to Mingla's Terms & Conditions and Privacy Policy, and I consent to receive from Mingla LLC and the businesses I book with: (1) transactional and account messages including booking and reservation confirmations, changes, cancellations, refunds, waitlist updates, and payment notices; (2) event and reservation reminders for this booking and for future events; and (3) marketing and promotional messages, including offers and announcements from venues and experience brands. These messages may be sent by email, in-app notification, push notification, and recurring automated text message (SMS) to the phone number I provide. Message frequency varies. Msg & data rates may apply. Consent to texts is not a condition of any purchase. Reply STOP to any text to opt out, or HELP for help; you can also unsubscribe from email via the link in any message or change your preferences in the Mingla app at any time. Full terms: https://www.usemingla.com/terms-of-service | Privacy: https://www.usemingla.com/privacy-policy | SMS terms: https://www.usemingla.com/sms-terms.";

describe("META-ORCH-1161 Sub-A.2 — TESTER: disclosure-text drift guard (legal authority)", () => {
  test("CONSENT_DISCLOSURE_TEXT is BYTE-IDENTICAL to the frozen COPY §1b string (no paraphrase, no truncation)", () => {
    // Length first — catches truncation immediately with a clean diff.
    expect(CONSENT_DISCLOSURE_TEXT.length).toBe(FROZEN_DISCLOSURE_1B.length);
    expect(CONSENT_DISCLOSURE_TEXT.length).toBe(1071);
    // Full byte-for-byte equality — catches ANY single-char paraphrase.
    expect(CONSENT_DISCLOSURE_TEXT).toBe(FROZEN_DISCLOSURE_1B);
  });

  test("the recorded disclosure carries EVERY hard-required element (INVESTIGATE §3 / COPY §1b checklist)", () => {
    const required = [
      "Mingla LLC", // legal entity / sender identity
      "transactional and account messages", // transactional scope
      "marketing and promotional messages", // marketing scope
      "recurring automated text message (SMS)", // SMS auto-dial disclosure
      "Message frequency varies.", // frequency
      "Msg & data rates may apply.", // rate disclosure
      "Consent to texts is not a condition of any purchase.", // TCPA mitigation
      "Reply STOP to any text to opt out, or HELP for help", // STOP/HELP
      "https://www.usemingla.com/terms-of-service", // T&C URL
      "https://www.usemingla.com/privacy-policy", // privacy URL
      "https://www.usemingla.com/sms-terms.", // SMS terms URL + terminal period (no truncation)
    ];
    for (const element of required) {
      expect(CONSENT_DISCLOSURE_TEXT).toContain(element);
    }
    // Must terminate exactly with the SMS-terms URL + period — proves no tail truncation.
    expect(
      CONSENT_DISCLOSURE_TEXT.endsWith(
        "SMS terms: https://www.usemingla.com/sms-terms.",
      ),
    ).toBe(true);
  });

  test("supporting consent strings are non-empty and carry the legal entity + version pin", () => {
    // §2 body must name the legal entity + address (burden-of-proof body).
    expect(CONSENT_TERMS_BODY.length).toBeGreaterThan(1000);
    expect(CONSENT_TERMS_BODY).toContain("Mingla LLC");
    expect(CONSENT_TERMS_BODY).toContain("700 Corporate Center Dr, Raleigh, NC 27607");
    // §1a visible label parts present + the underlined link token is the exact phrase.
    expect(CONSENT_VISIBLE_LABEL_PREFIX.length).toBeGreaterThan(0);
    expect(CONSENT_VISIBLE_LABEL_LINK).toBe("terms and conditions");
    expect(CONSENT_VISIBLE_LABEL_SUFFIX).toContain("Reply STOP to opt out");
    // Version pin is a non-empty constant (audit-trail anchor).
    expect(typeof DISCLOSURE_VERSION).toBe("string");
    expect(DISCLOSURE_VERSION.length).toBeGreaterThan(0);
  });
});
