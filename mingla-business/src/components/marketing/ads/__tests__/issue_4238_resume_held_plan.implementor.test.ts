// MINGLA-INVARIANT: I-4238-AD-RESUME-HELD | issue #4238 | a Host ad plan whose budget is already held (funded_held, staff_approved, creating_paused_objects, creation_failed_retryable) resumes to Launch: the Review step asks for no top-up and Launch does not hold the money a second time.
/**
 * #4238 — Tinoe's Yard trial (18 Nov 2026). Mingla approved the brand's first
 * ad (state staff_approved, ₦28,050 held). Resuming it showed "Top up
 * ₦33,000 to launch" because the shortfall counted only spare credit, and its
 * Launch called fund again, which the server refuses (ad_plan_not_fundable).
 *
 * FAILS-ON-REVERT:
 *  - hostAdPlanHoldPlaced must be true for every held state, false otherwise.
 *  - the screen's shortfall must be zero for a held plan.
 *  - the screen's launch must skip fundHostAdPlan for a held plan.
 *
 * Real logic is tested for real; the screen wiring is checked in its source,
 * the convention this directory uses for HostAdCreateScreen.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

import {
  HOST_AD_HOLD_PLACED_STATES,
  hostAdPlanHoldPlaced,
  hostAdTopUpNeededCents,
} from "../hostAdBuilderModel";

const screen = readFileSync(
  join(__dirname, "../../../../screens/hostAds/HostAdCreateScreen.tsx"),
  "utf8",
);
const service = readFileSync(
  join(__dirname, "../../../../services/hostAdPlanService.ts"),
  "utf8",
);

describe("#4238 resuming a plan whose budget is already held", () => {
  test("held states are exactly the ones launchHostAdPlan launches from a hold", () => {
    expect([...HOST_AD_HOLD_PLACED_STATES].sort()).toEqual(
      ["creating_paused_objects", "creation_failed_retryable", "funded_held", "staff_approved"],
    );
    for (const state of HOST_AD_HOLD_PLACED_STATES) {
      expect(hostAdPlanHoldPlaced(state)).toBe(true);
      expect(service).toContain(`"${state}"`);
    }
  });

  test("states without a hold still need funding", () => {
    for (const state of [
      null,
      undefined,
      "",
      "draft",
      "validating",
      "ready_for_funding",
      "staff_review_required",
      "changes_requested",
      "staff_rejected",
      "cancelled_before_create",
    ]) {
      expect(hostAdPlanHoldPlaced(state)).toBe(false);
    }
  });

  test("with ₦0 spare credit a fresh plan needs the full top-up (unchanged)", () => {
    expect(hostAdTopUpNeededCents(3_300_000, 0)).toBe(3_300_000);
  });

  test("the Review shortfall is zero once the budget is held", () => {
    expect(screen).toMatch(
      /const holdPlaced = hostAdPlanHoldPlaced\(activePlanState\);\s*const topUpNeeded =\s*walletCreditCents === null \|\| holdPlaced \? 0 :/,
    );
  });

  test("Launch does not hold the money again for a held plan", () => {
    const start = screen.indexOf("const handleLaunchConfirmed");
    const end = screen.indexOf("const handleCancelBeforeCreate");
    expect(start).toBeGreaterThan(0);
    const launch = screen.slice(start, end);
    const guard = launch.indexOf("hostAdPlanHoldPlaced(activePlanState)");
    const fund = launch.indexOf("await fundHostAdPlan(");
    expect(guard).toBeGreaterThan(0);
    expect(fund).toBeGreaterThan(guard);
    expect(launch).toMatch(/hostAdPlanHoldPlaced\(activePlanState\)\s*\?\s*\(activePlanState as string\)\s*:/);
  });
});
