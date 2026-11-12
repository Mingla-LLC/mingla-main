/**
 * #4389 P3b — free-only was recorded once on a US brand whose host tapped
 * "Set up bank now". Only K1's secondary "Free events only for now" may record
 * it; the primary and every dismiss (swipe down, scrim tap, Android back — all
 * reach the Sheet's onClose) mean "Set up bank now". K1's content stays mounted
 * through the close animation, so a tap landing on the secondary as the sheet
 * closes used to record free-only; K1 now latches shut on dismiss.
 *
 * FAILS ON REVERT: drop the dismissed latch in K1Sheet → T3 (a tap during the
 * close records free-only); wire onClose to anything but bank-now → T2.
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
  type Tree,
} from "./issue4389FlowHarness";
import { BRAND_SETUP_COPY as C } from "../brandSetupCopy";

const ID = "43890000-0000-4000-8000-0000000000e1";

async function openK1(): Promise<Tree> {
  harness.checklist = checklistAt("pay");
  const t = await mount(<BrandCreationFlow brandId={ID} onExit={() => undefined} />);
  // Back from Get paid asks K1.
  await press(byLabel(t, C.common.back)[0]);
  expect(byTestId(t, "brand-setup-k1")).toHaveLength(1);
  return t;
}
const sheetClose = (t: Tree): (() => void) =>
  byTestId(t, "sheet")[0]?.props.onClose as () => void;

describe("#4389 P3b — only 'Free events only for now' records free-only", () => {
  beforeEach(() => resetHarness());
  afterEach(() => unmountAll());

  test("T1: 'Set up bank now' closes K1 and records nothing", async () => {
    const t = await openK1();
    await press(byLabel(t, C.k1.bankNow)[0]);
    expect(byTestId(t, "brand-setup-k1")).toHaveLength(0);
    expect(harness.markFreeOnlyMutate).not.toHaveBeenCalled();
    expect(harness.replace).not.toHaveBeenCalled();
  });

  test.each(["swipe down", "scrim tap", "Android back"])("T2: dismiss by %s = 'Set up bank now'", async () => {
    const t = await openK1();
    await TestRenderer.act(async () => sheetClose(t)());
    expect(byTestId(t, "brand-setup-k1")).toHaveLength(0);
    expect(harness.markFreeOnlyMutate).not.toHaveBeenCalled();
  });

  test("T3: a tap on the secondary while K1 is closing records nothing", async () => {
    const t = await openK1();
    const freeOnly = byLabel(t, C.k1.freeOnly)[0]?.props.onPress as () => void;
    await press(byLabel(t, C.k1.bankNow)[0]);
    await TestRenderer.act(async () => freeOnly());
    expect(harness.markFreeOnlyMutate).not.toHaveBeenCalled();

    const t2 = await openK1();
    const freeOnly2 = byLabel(t2, C.k1.freeOnly)[0]?.props.onPress as () => void;
    await TestRenderer.act(async () => sheetClose(t2)());
    await TestRenderer.act(async () => freeOnly2());
    expect(harness.markFreeOnlyMutate).not.toHaveBeenCalled();
  });

  test("T4: the secondary, while open, records free-only and goes Home", async () => {
    harness.markFreeOnlyMutate.mockImplementation((_v, o) => o.onSuccess?.());
    const t = await openK1();
    await press(byLabel(t, C.k1.freeOnly)[0]);
    expect(harness.markFreeOnlyMutate).toHaveBeenCalledTimes(1);
    expect(harness.replace).toHaveBeenCalledWith("/(tabs)/home?toast=free_only");
  });

  test("T5: reopened after a dismiss, the secondary works again", async () => {
    const t = await openK1();
    await TestRenderer.act(async () => sheetClose(t)());
    await press(byLabel(t, C.common.back)[0]);
    await press(byLabel(t, C.k1.freeOnly)[0]);
    expect(harness.markFreeOnlyMutate).toHaveBeenCalledTimes(1);
  });
});
