/**
 * META-ORCH-1161 Sub-A.2 (P1-1 REWORK) — disabled-Pay dead-tap regression test.
 *
 * Context: the tester (TEST_META-ORCH-1161_SUBA2_CONSENT_CAPTURE.md §3 P1-1)
 * found that tapping the GREYED Pay button with the consent box unchecked gave
 * ZERO feedback — the specced red flash + "Please agree to continue." helper
 * (DESIGN §S3.4) was unreachable dead code, a Constitution Rule 1 dead-tap.
 *
 * The fix wraps the Pay button in a tap-capturing Pressable that, while the
 * button is disabled, routes the tap to `showConsentHint`, whose show/no-show
 * decision is the pure predicate `shouldShowConsentHintOnDisabledTap`. This test
 * pins that predicate: a disabled-Pay tap with valid fields + unchecked box MUST
 * surface the helper, and MUST NOT surface it when fields are still invalid
 * (the field errors carry the message there).
 *
 * fails-on-revert: delete the `!params.termsAccepted` term in
 * `shouldShowConsentHintOnDisabledTap` (so it returns `params.fieldsValid`) →
 * the "checked box → no helper" assertion fails; delete the `params.fieldsValid`
 * term → the "fields invalid → no helper (errors carry it)" assertion fails.
 */

import { describe, expect, test } from "@jest/globals";

import {
  isContinueDisabled,
  shouldShowConsentHintOnDisabledTap,
} from "../checkoutConsentGate";

describe("META-ORCH-1161 Sub-A.2 — disabled-Pay tap surfaces the consent hint (P1-1)", () => {
  test("the exact dead-tap case: fields valid, box UNCHECKED → button disabled AND a captured tap shows the helper", () => {
    const fieldsValid = true;
    const termsAccepted = false;

    // The button is greyed in this case...
    expect(
      isContinueDisabled({ fieldsValid, termsAccepted, submitting: false }),
    ).toBe(true);

    // ...and a tap on the greyed button MUST surface the consent helper
    // (no silent dead tap — Constitution Rule 1 / DESIGN §S3.4).
    expect(
      shouldShowConsentHintOnDisabledTap({ fieldsValid, termsAccepted }),
    ).toBe(true);
  });

  test("box already checked → no consent helper (the box is not the blocker)", () => {
    expect(
      shouldShowConsentHintOnDisabledTap({
        fieldsValid: true,
        termsAccepted: true,
      }),
    ).toBe(false);
  });

  test("fields still invalid → no consent helper (the field errors carry the message, no double-messaging)", () => {
    expect(
      shouldShowConsentHintOnDisabledTap({
        fieldsValid: false,
        termsAccepted: false,
      }),
    ).toBe(false);
    expect(
      shouldShowConsentHintOnDisabledTap({
        fieldsValid: false,
        termsAccepted: true,
      }),
    ).toBe(false);
  });
});
