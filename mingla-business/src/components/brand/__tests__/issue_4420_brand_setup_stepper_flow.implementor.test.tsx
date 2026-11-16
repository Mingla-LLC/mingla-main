/**
 * #4420 B7 — rendered: on Get paid (payments not started) pressing "Bank
 * country" in the stepper reopens Bank country, exactly like "Change"; once
 * payments have started the same press does nothing (it is locked). No save
 * is triggered by a stepper press.
 *
 * FAILS-ON-REVERT: dropping the flow's onStepPress → setBackTo("country")
 * fails T1; ignoring the stripeState rule fails T2.
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
  resetHarness,
  unmountAll,
} from "./issue4389FlowHarness";

const ID = "44200000-0000-4000-8000-0000000000b7";
const el = (): React.ReactElement => <BrandCreationFlow brandId={ID} onExit={() => undefined} />;

describe("#4420 B7 brand setup stepper (rendered)", () => {
  beforeEach(() => resetHarness());
  afterEach(() => unmountAll());

  test("T1: Get paid → press Bank country → Bank country, nothing saved", async () => {
    harness.checklist = checklistAt("pay");
    const t = await mount(el());
    expect(byTestId(t, "brand-setup-pay-continue").length + byTestId(t, "brand-setup-stepper").length).toBeGreaterThan(0);
    await press(byTestId(t, "brand-setup-stepper-step-1")[0]);
    expect(byTestId(t, "brand-setup-country-continue")).toHaveLength(1);
    expect(harness.saveCountry).not.toHaveBeenCalled();
  });

  test("T2: payments started → the press keeps Get paid", async () => {
    harness.checklist = checklistAt("pay", { stripeState: "started" });
    const t = await mount(el());
    await press(byTestId(t, "brand-setup-stepper-step-1")[0]);
    expect(byTestId(t, "brand-setup-country-continue")).toHaveLength(0);
  });

  test("T3: Name never reopens once the brand exists", async () => {
    harness.checklist = checklistAt("pay");
    const t = await mount(el());
    await press(byTestId(t, "brand-setup-stepper-step-0")[0]);
    expect(byTestId(t, "brand-setup-name")).toHaveLength(0);
  });
});
