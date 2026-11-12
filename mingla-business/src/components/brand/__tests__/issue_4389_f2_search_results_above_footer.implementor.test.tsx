/**
 * #4389 P1 (retest, iPhone SE): with the keyboard up, F2 search "Niger" found
 * Nigeria but the only result sat behind the Continue footer; the tap hit the
 * disabled Continue and nothing was selected.
 *
 * Fix: with the keyboard up and nothing picked, F2 shows no footer (Continue
 * would be disabled anyway), so the results get the room above the keyboard.
 * Once a result is picked, Continue comes back; "Save and finish later" stays
 * hidden while the keyboard is up (as the design hides it).
 *
 * FAILS ON REVERT: render the footer regardless of the keyboard → T1, T2.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import React from "react";

import {
  BrandCreationFlow,
  byLabel,
  byTestId,
  checklistAt,
  harness,
  mount,
  press,
  resetHarness,
  unmountAll,
  TestRenderer,
} from "./issue4389FlowHarness";
import { BRAND_SETUP_COPY as C } from "../brandSetupCopy";

const ID = "43890000-0000-4000-8000-0000000000f1";
const el = <BrandCreationFlow brandId={ID} requestedStep="country" onExit={() => undefined} />;

describe("#4389 P1 — F2 search results are never behind the footer", () => {
  beforeEach(() => {
    resetHarness();
    harness.checklist = checklistAt("country");
  });
  afterEach(() => unmountAll());

  test("T1: keyboard up, nothing picked: no footer; the first result is tappable and selects", async () => {
    harness.keyboardUp = true;
    const t = await mount(el);
    const search = byTestId(t, "payout-country-list-search")[0];
    await TestRenderer.act(async () => (search?.props.onChangeText as (v: string) => void)("Niger"));
    expect(byTestId(t, "brand-setup-country-footer")).toHaveLength(0);
    const rows = t.root.findAll((n) => typeof n.type === "string" && /^payout-country-list-row-/.test(String(n.props.testID)));
    expect(rows.length).toBeGreaterThan(0);
    await press(rows[0]);
    // Picked: Continue is back (enabled), "Save and finish later" still hidden.
    const cta = byTestId(t, "brand-setup-country-continue");
    expect(cta).toHaveLength(1);
    expect(cta[0]?.props.disabled).toBe(false);
    expect(byLabel(t, C.common.later)).toHaveLength(0);
  });

  test("T2: keyboard down: the full footer (Continue and Save and finish later)", async () => {
    const t = await mount(el);
    expect(byTestId(t, "brand-setup-country-footer")).toHaveLength(1);
    expect(byLabel(t, C.common.later)).toHaveLength(1);
  });
});
