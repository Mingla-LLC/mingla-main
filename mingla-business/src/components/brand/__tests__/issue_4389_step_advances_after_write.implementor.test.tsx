/**
 * #4389 P1 — after F1 the flow opens `/brand/{id}/setup?step=country`.
 * Saving the bank country reached the database but the screen stayed on F2
 * (iOS and web): `deriveSetupStep(checklist, "country")` kept honouring the
 * URL's requested step because "country" is not past the first open step.
 *
 * Fix: the requested step is honoured when the flow opens and consumed by a
 * successful write (or by the server's first open step moving on), so the
 * step comes from the refreshed checklist alone.
 *
 * FAILS ON REVERT: derive from `requestedStep` directly (drop the `requested`
 * state / advanceAfterWrite) → T1 and T2 stay on F2 / F3.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import React from "react";

import {
  BrandCreationFlow,
  byTestId,
  checklistAt,
  harness,
  mount,
  press,
  rerender,
  resetHarness,
  unmountAll,
} from "./issue4389FlowHarness";

const ID = "43890000-0000-4000-8000-0000000000a1";
const el = (step: "country" | "pay" | "done" | null): React.ReactElement => (
  <BrandCreationFlow brandId={ID} requestedStep={step} onExit={() => undefined} />
);

describe("#4389 P1 — every step advances after a successful write", () => {
  beforeEach(() => resetHarness());
  afterEach(() => unmountAll());

  test("T1: F2 → F3 after the country save, though the URL still says step=country", async () => {
    harness.checklist = checklistAt("country");
    harness.saveCountry.mockImplementation((_c, o) => o.onSuccess?.());
    const t = await mount(el("country"));
    expect(byTestId(t, "brand-setup-country-continue")).toHaveLength(1);

    await press(byTestId(t, "payout-country-list-row-US")[0]);
    await press(byTestId(t, "brand-setup-country-continue")[0]);
    expect(harness.saveCountry).toHaveBeenCalledTimes(1);
    expect(harness.refetches).toBeGreaterThan(0);

    // The refetch answers: the country is saved, F3 is the first open step.
    harness.checklist = checklistAt("pay");
    await rerender(t, el("country"));
    expect(byTestId(t, "brand-setup-country-continue")).toHaveLength(0);
    expect(byTestId(t, "brand-setup-pay-continue")).toHaveLength(1);
  });

  test("T2: a requested F3 (step=pay&k1=1) gives way when the server finishes payments", async () => {
    harness.checklist = checklistAt("pay");
    const t = await mount(el("pay"));
    expect(byTestId(t, "brand-setup-pay-continue")).toHaveLength(1);
    harness.checklist = checklistAt("done");
    await rerender(t, el("pay"));
    expect(byTestId(t, "brand-setup-pay-continue")).toHaveLength(0);
  });

  test("T3: a deep link back to F2 is still honoured while nothing changed", async () => {
    harness.checklist = checklistAt("pay");
    const t = await mount(el("country"));
    expect(byTestId(t, "brand-setup-country-continue")).toHaveLength(1);
    await rerender(t, el("country"));
    expect(byTestId(t, "brand-setup-country-continue")).toHaveLength(1);
  });

  test("T4: a request past the first open step is still clamped (never done early)", async () => {
    harness.checklist = checklistAt("country");
    const t = await mount(el("done"));
    expect(byTestId(t, "brand-setup-country-continue")).toHaveLength(1);
  });
});
