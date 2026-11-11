/**
 * #4389 P1 — on F1 and on F2's search the keyboard top sat at 539pt while
 * Continue sat at 746–806pt, and a swipe did not dismiss the keyboard.
 *
 * Fix (the repo's keyboard pattern, ORCH-0892 / #1850): the step column is the
 * library KeyboardAvoidingView (SmartKeyboardAvoidingView) with
 * behavior="padding" and the Done-bar budget DONE_BAR_OCCUPIED, so the footer
 * CTA is lifted above the keyboard; every scrolling step body dismisses the
 * keyboard on drag.
 *
 * FAILS ON REVERT: render the column as a plain View again → T1 (no avoider
 * around the CTA); drop keyboardDismissMode → T2.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import React from "react";
import { ScrollView } from "react-native";

import {
  BrandCreationFlow,
  byTestId,
  checklistAt,
  harness,
  mount,
  resetHarness,
  unmountAll,
  type Node,
  type Tree,
} from "./issue4389FlowHarness";
// eslint-disable-next-line import/first
import { KeyboardAvoidingView } from "../../../wrappers/SmartKeyboardAvoidingView";
import { DONE_BAR_OCCUPIED } from "../../../wrappers/SmartScrollView";

const ID = "43890000-0000-4000-8000-0000000000b1";

function avoiderAround(t: Tree, ctaTestId: string): Node | null {
  const avoiders = t.root.findAll((n) => n.type === KeyboardAvoidingView);
  for (const a of avoiders) {
    if (a.findAll((n) => typeof n.type === "string" && n.props.testID === ctaTestId).length > 0) return a;
  }
  return null;
}

describe("#4389 P1 — the step CTA stays above the keyboard", () => {
  beforeEach(() => resetHarness());
  afterEach(() => unmountAll());

  test("T1: F1 and F2 footers sit inside the keyboard-avoiding column", async () => {
    const f1 = await mount(<BrandCreationFlow brandId={null} onExit={() => undefined} />);
    const nameCta = "brand-setup-name-continue";
    expect(byTestId(f1, nameCta)).toHaveLength(1);
    const a1 = avoiderAround(f1, nameCta);
    expect(a1).not.toBeNull();
    expect(a1?.props.behavior).toBe("padding");
    expect(a1?.props.keyboardVerticalOffset).toBe(DONE_BAR_OCCUPIED);

    harness.checklist = checklistAt("country");
    const f2 = await mount(<BrandCreationFlow brandId={ID} requestedStep="country" onExit={() => undefined} />);
    expect(avoiderAround(f2, "brand-setup-country-continue")).not.toBeNull();
    expect(avoiderAround(f2, "payout-country-list-search")).not.toBeNull();
  });

  test("T2: a swipe on the step body dismisses the keyboard (F1, F2)", async () => {
    const f1 = await mount(<BrandCreationFlow brandId={null} onExit={() => undefined} />);
    harness.checklist = checklistAt("country");
    const f2 = await mount(<BrandCreationFlow brandId={ID} requestedStep="country" onExit={() => undefined} />);
    for (const t of [f1, f2]) {
      const scrolls = t.root.findAll((n) => n.type === ScrollView);
      expect(scrolls.length).toBeGreaterThan(0);
      for (const s of scrolls) expect(s.props.keyboardDismissMode).toBe("on-drag");
    }
  });
});
