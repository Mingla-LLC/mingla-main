/**
 * #3645 — native payout setup (BrandOnboardView): leaving the Nigeria bank
 * form must reverse the pick (clear_provider) so the brand is not left on the
 * Nigerian rail by accident, and a failed switch in either direction must be
 * VISIBLE (the select_provider error used to be stored and never rendered).
 *
 * Append-only source guard, same style as the sibling
 * issue_3645_ng_select_provider.source.test.ts. The behavioural proof for the
 * shared rule lives in issue_3645_web_ng_select_provider.implementor.test.tsx.
 *
 * FAILS ON REVERT: restore the local-state-only backToPicker, or drop the
 * error banner above the bank form.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_native_clear_on_back.source.test.ts --runInBand
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY,
  PAYOUT_COUNTRY_SWITCH_FAILED_COPY,
  payoutCountrySwitchErrorCopy,
} from "../../../utils/payoutCountrySwitchCopy";

const SRC = readFileSync(
  join(__dirname, "..", "BrandOnboardView.tsx"),
  "utf8",
);

/** Code only: strips comments so a commented-out fix cannot satisfy a pin. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("#3645 — native: back from the Nigeria form clears the rail, failures show", () => {
  // Rework (PR #3805 P1-1): the handler that clears is the form's explicit
  // "Choose a different country" (`chooseDifferentCountry`). The top-bar Back
  // (`backToPicker`, a name pinned by the #971 suite) now only leaves.
  it("the top-bar Back is the screen's own exit and sends nothing", () => {
    expect(CODE).toMatch(/const backToPicker = onCancel;/);
    expect(CODE).toMatch(
      /renderTopBar\(\{\s*onBack:\s*backToPicker,\s*backLabel:\s*"Back"\s*\}\)/,
    );
  });

  it("choosing a different country calls clear_provider and only returns to the picker on success", () => {
    const start = CODE.indexOf("const chooseDifferentCountry");
    expect(start).toBeGreaterThanOrEqual(0);
    const region = CODE.slice(start, CODE.indexOf("return (", start));
    expect(region).toMatch(/clearPaystackProvider\.mutate\(\s*brand\.id/);
    // Rework 2: the clear is awaited as a promise (pending/callbacks owned by
    // the screen), so success is the `.then` and failure the `.catch`.
    const onSuccess = region.indexOf(".then(");
    const leaveForm = region.indexOf("setPaystackSelected(false)");
    const onFailure = region.indexOf(".catch(");
    expect(onSuccess).toBeGreaterThanOrEqual(0);
    expect(leaveForm).toBeGreaterThan(onSuccess);
    expect(onFailure).toBeGreaterThan(leaveForm);
    expect(region.slice(onFailure)).toMatch(/setErrorMessage\(/);
  });

  it("renders the stored switch error above the Nigeria bank form", () => {
    const branch = CODE.indexOf("brand !== null && paystackSelected");
    expect(branch).toBeGreaterThanOrEqual(0);
    const form = CODE.indexOf("<BrandPaystackOnboardView", branch);
    expect(form).toBeGreaterThan(branch);
    const region = CODE.slice(branch, form);
    expect(region).toContain("errorMessage !== null");
    expect(region).toContain('accessibilityRole="alert"');
    expect(region).toContain("{errorMessage}");
  });

  it("only the bank form's cancel and the explicit button clear; Back never does", () => {
    const uses = CODE.match(/chooseDifferentCountry/g) ?? [];
    // declaration + the failed-switch button + the form's onCancel
    expect(uses).toHaveLength(3);
    expect(CODE).toMatch(/onCancel=\{chooseDifferentCountry\}/);
    expect(CODE).not.toMatch(/onBack:\s*chooseDifferentCountry/);
    expect((CODE.match(/clearPaystackProvider\.mutate\(/g) ?? [])).toHaveLength(1);
  });

  it("the Nigeria pick stores provider-neutral copy, not the raw service error", () => {
    const start = CODE.indexOf("const handleCountryChange");
    const region = CODE.slice(start, start + 900);
    expect(region).toContain("describePayoutCountrySwitchFailure(err)");
    expect(region).not.toContain("err.message");
  });

  it("switch-failure copy never names a payment provider or echoes internals", () => {
    const raw = new Error(
      "selectPaystackProvider: stamp_failed (paystack_provider_select_stamp_retryable)",
    );
    expect(payoutCountrySwitchErrorCopy(raw)).toBe(PAYOUT_COUNTRY_SWITCH_FAILED_COPY);
    expect(
      payoutCountrySwitchErrorCopy(
        new Error("clearPaystackProvider: conflict (disconnect_first)"),
      ),
    ).toBe(PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY);
    expect(payoutCountrySwitchErrorCopy({ nope: true })).toBe(
      PAYOUT_COUNTRY_SWITCH_FAILED_COPY,
    );
    for (const copy of [
      PAYOUT_COUNTRY_SWITCH_FAILED_COPY,
      PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY,
    ]) {
      expect(copy).not.toMatch(/stripe|paystack/i);
    }
  });
});
