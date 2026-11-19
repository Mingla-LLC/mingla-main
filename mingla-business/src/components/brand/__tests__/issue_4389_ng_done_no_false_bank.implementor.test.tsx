/**
 * #4389 P8 rework (Constitution 9) — a Nigeria brand on the hold rail finishes
 * setup ("can take money") with no bank. Its done screen said "Bank connected.
 * You're ready to sell." It now says so only when the server reports a bank
 * (`bank_connected`); otherwise "You're ready to sell. Add a bank in Payouts
 * to get paid."
 *
 * FAILS ON REVERT: render `C.f4.ngDone` unconditionally in DoneStep → N1;
 * drop `bankConnected` from parseBrandSetupFacts → N3.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/brand/__tests__/issue_4389_ng_done_no_false_bank.implementor.test.tsx
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import React from "react";

import {
  BrandCreationFlow,
  allText,
  byTestId,
  checklistAt,
  harness,
  mount,
  resetHarness,
  unmountAll,
  TestRenderer,
} from "./issue4389FlowHarness";
import { BRAND_SETUP_COPY } from "../brandSetupCopy";
import { parseBrandSetupFacts } from "../../../services/brandSetupService";

const ID = "43890000-0000-4000-8000-0000000000b8";
const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
  });
};
const ng = (bankConnected: boolean): NonNullable<typeof harness.checklist> =>
  checklistAt("done", { provider: "paystack", payoutCountry: "NG", currency: "NGN", stripeState: "none", bankConnected });

describe("#4389 P8 rework — the Nigeria done line never claims a bank it does not have", () => {
  beforeEach(() => resetHarness());
  afterEach(() => unmountAll());

  test("copy", () => {
    expect(BRAND_SETUP_COPY.f4.ngDone).toBe("Bank connected. You're ready to sell.");
    expect(BRAND_SETUP_COPY.f4.ngReadyNoBank).toBe("You're ready to sell. Add a bank in Payouts to get paid.");
  });

  test("N1: hold rail, no bank → ready to sell, add a bank; never 'Bank connected'", async () => {
    harness.checklist = ng(false);
    const t = await mount(<BrandCreationFlow brandId={ID} onExit={() => undefined} />);
    await flush();
    expect(byTestId(t, "brand-setup-ng-done-line").length).toBeGreaterThan(0);
    expect(allText(t)).toContain(BRAND_SETUP_COPY.f4.ngReadyNoBank);
    expect(allText(t)).not.toMatch(/bank connected/i);
  });

  test("N2: a bank attached → 'Bank connected. You're ready to sell.'", async () => {
    harness.checklist = ng(true);
    const t = await mount(<BrandCreationFlow brandId={ID} onExit={() => undefined} />);
    await flush();
    expect(allText(t)).toContain(BRAND_SETUP_COPY.f4.ngDone);
    expect(allText(t)).not.toContain(BRAND_SETUP_COPY.f4.ngReadyNoBank);
  });

  test("N3: the fact comes from the server's bank_connected (old bodies: details meant a bank)", () => {
    const base = { provider: "paystack", details: true, complete: true };
    expect(parseBrandSetupFacts({ ...base, bank_connected: false }).bankConnected).toBe(false);
    expect(parseBrandSetupFacts({ ...base, bank_connected: true }).bankConnected).toBe(true);
    expect(parseBrandSetupFacts(base).bankConnected).toBe(true);
    expect(parseBrandSetupFacts({ provider: "paystack", details: false }).bankConnected).toBe(false);
  });
});
