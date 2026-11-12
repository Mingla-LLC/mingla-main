/**
 * #4389 (retest r3, iPhone SE) — picking a search result with the keyboard up
 * brought the footer back and left only a sliver of the picked row above it.
 * The picked row is now scrolled fully into view when it is picked and when
 * the footer reappears.
 *
 * FAILS ON REVERT: drop the reveal effect in CountryStep → T1 (no scroll).
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
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
  TestRenderer,
} from "./issue4389FlowHarness";
import { revealOffset } from "../BrandCreationFlow";

const ID = "43890000-0000-4000-8000-0000000000f2";
const wait = async (ms: number): Promise<void> => {
  await TestRenderer.act(async () => {
    await new Promise<void>((r) => setTimeout(r, ms));
  });
};

describe("#4389 — the picked F2 row is scrolled into view", () => {
  beforeEach(() => {
    resetHarness();
    harness.checklist = checklistAt("country");
  });
  afterEach(() => unmountAll());

  test("T1: keyboard up, pick a result → the list scrolls so the whole row clears the footer", async () => {
    harness.keyboardUp = true;
    const scrollTo = jest.fn();
    // SE with the keyboard up and the footer back: viewport 120..300; the
    // picked row's bottom at 330 (only a sliver shows).
    const createNodeMock = (el: { props: Record<string, unknown> }): unknown => {
      const id = String(el.props.testID ?? "");
      if (id === "brand-setup-country-scroll") {
        return { measureInWindow: (cb: (...a: number[]) => void) => cb(0, 120, 375, 180), scrollTo };
      }
      if (id.startsWith("payout-country-list-row-")) {
        return { measureInWindow: (cb: (...a: number[]) => void) => cb(0, 278, 375, 52) };
      }
      return {};
    };
    const t = await mount(<BrandCreationFlow brandId={ID} requestedStep="country" onExit={() => undefined} />, { createNodeMock });
    await TestRenderer.act(async () => (byTestId(t, "payout-country-list-search")[0]?.props.onChangeText as (v: string) => void)("Niger"));
    const row = t.root.findAll((n) => typeof n.type === "string" && /^payout-country-list-row-/.test(String(n.props.testID)))[0];
    await press(row);
    await wait(120);
    expect(scrollTo).toHaveBeenCalled();
    const y = (scrollTo.mock.calls.at(-1)?.[0] as { y: number }).y;
    // 278 + 52 + 16 margin - 300 = 46
    expect(y).toBe(46);
  });

  test("T2: the offset rule (below, above, already shown)", () => {
    expect(revealOffset({ y: 278, height: 52 }, { y: 120, height: 180 }, 0)).toBe(46);
    expect(revealOffset({ y: 100, height: 52 }, { y: 120, height: 180 }, 50)).toBe(14);
    expect(revealOffset({ y: 150, height: 52 }, { y: 120, height: 180 }, 10)).toBeNull();
  });
});
