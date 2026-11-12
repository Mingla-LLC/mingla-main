/**
 * #4389 P2 (retest) — F4 showed "You're all set." over "Payouts aren't
 * connected" while the account was active, and it never changed. The F4
 * OfferingChooser got no payoutState, so it fell back to its default
 * "not-connected"; nothing was stale on the server side.
 *
 * Fix: F4's payout line comes from the same refresh_status read as its
 * heading (f4PayoutState), and the brand's payout reads (connect status, brand
 * row, list) are invalidated when the checklist turns complete.
 *
 * FAILS ON REVERT: drop payoutState from F4's OfferingChooser → T1; drop the
 * complete-transition invalidation → T3.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import React from "react";

import {
  BrandCreationFlow,
  checklistAt,
  harness,
  mount,
  rerender,
  resetHarness,
  unmountAll,
  TestRenderer,
} from "./issue4389FlowHarness";
import { f4PayoutState } from "../BrandCreationFlow";

const ID = "43890000-0000-4000-8000-0000000000f4";
const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
  });
};

describe("#4389 P2 — F4 never says all set and not connected at once", () => {
  beforeEach(() => resetHarness());
  afterEach(() => unmountAll());

  test("T1: refresh_status submitted → no 'not connected' line (ready)", async () => {
    harness.refreshStatus.mockImplementation(() => Promise.resolve({ state: "submitted", due: [] }));
    harness.checklist = checklistAt("done");
    await mount(<BrandCreationFlow brandId={ID} onExit={() => undefined} />);
    await flush();
    expect(harness.offeringProps?.payoutState).toBe("ready");
  });

  test("T2: the line follows the same read as the heading", () => {
    expect(f4PayoutState("stripe", null, false)).toBe("loading");
    expect(f4PayoutState("stripe", { state: "submitted", due: [] }, false)).toBe("ready");
    expect(f4PayoutState("stripe", { state: "action_needed", due: ["x"] }, false)).toBe("restricted");
    expect(f4PayoutState("stripe", null, true)).toBe("unknown-error");
    expect(f4PayoutState("paystack", null, false)).toBe("ready");
    for (const s of [null, { state: "submitted" as const, due: [] }]) {
      expect(f4PayoutState("stripe", s, false)).not.toBe("not-connected");
    }
  });

  test("T3: the checklist turning complete refreshes the brand's payout reads", async () => {
    harness.checklist = checklistAt("pay");
    const t = await mount(<BrandCreationFlow brandId={ID} onExit={() => undefined} />);
    expect(harness.invalidate).not.toHaveBeenCalled();
    harness.checklist = { ...checklistAt("done"), facts: { ...checklistAt("done").facts, complete: true } as never };
    await rerender(t, <BrandCreationFlow brandId={ID} onExit={() => undefined} />);
    const keys = harness.invalidate.mock.calls.map((c) => JSON.stringify(c[0].queryKey));
    expect(keys).toContain(JSON.stringify(["brand-stripe-status", ID]));
    expect(keys).toContain(JSON.stringify(["brands", "detail", ID]));
  });
});
