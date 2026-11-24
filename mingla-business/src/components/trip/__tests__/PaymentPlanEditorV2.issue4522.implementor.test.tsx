// MINGLA-INVARIANT: I-4522-HOST-PLAN-V2 | issue #4522 | Host plan edits use the v2 limits, validate against the live package price, preserve v1 until explicit conversion and load through one lazy owner.
/**
 * Issue #4522 slice 3 — Host payment-plan v2 editor.
 *
 * Fails on revert: remove the price guard, restore a 13th payment, turn flex
 * on by default, mutate v1 without the conversion tap, stop sharing the first
 * plan, or eagerly import the editor from the pricing step -> red.
 */

import fs from "node:fs";
import path from "node:path";
import React, { act } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

import { PaymentPlanEditorV2 } from "../PaymentPlanEditorV2";
import {
  convertLegacyPlanToV2,
  DEFAULT_TRIP_PAYMENT_PLAN_V2,
  defaultCustomAmountsMinor,
  defaultFlexMinimumMinor,
  resizeCustomAmountsMinor,
  TRIP_PLAN_V2_EDITOR_RUNTIME,
  validateTripPaymentPlanV2,
  type TripPaymentPlanV2,
} from "../tripPlanV2EditorModel";
import { validateTripPackages } from "../tripPackagesValidation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Instance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Instance) => boolean) => Instance[];
}
interface Renderer {
  root: Instance;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
};

const mounted: Renderer[] = [];
const plan = (patch: Partial<TripPaymentPlanV2> = {}): TripPaymentPlanV2 => ({
  ...DEFAULT_TRIP_PAYMENT_PLAN_V2,
  deposit: { ...DEFAULT_TRIP_PAYMENT_PLAN_V2.deposit },
  flex: { enabled: false },
  ...patch,
});

const mount = (value: TripPaymentPlanV2, onChange = jest.fn()): Renderer => {
  let tree!: Renderer;
  act(() => {
    tree = TestRenderer.create(
      <PaymentPlanEditorV2
        value={value}
        onChange={onChange}
        totalAmountMinor={120_000}
        currency="USD"
        tripStartAt="2027-03-12T12:00:00.000Z"
        timeZone="Africa/Lagos"
        packageCount={2}
        sharePaymentPlan={false}
        onSharePaymentPlanChange={jest.fn()}
        showShareControl
        model={TRIP_PLAN_V2_EDITOR_RUNTIME}
      />,
    );
  });
  mounted.push(tree);
  return tree;
};

const byTestId = (tree: Renderer, testID: string): Instance => {
  const found = tree.root.findAll((node) => node.props.testID === testID);
  if (found.length === 0) throw new Error(`Missing ${testID}`);
  return found[0];
};

afterEach(() => {
  while (mounted.length > 0) {
    const tree = mounted.pop();
    if (tree !== undefined) act(() => tree.unmount());
  }
});

describe("pure v2 plan editor rules", () => {
  test("the approved defaults are 25%, 3 payments, 30 days, auto on and flex off", () => {
    expect(DEFAULT_TRIP_PAYMENT_PLAN_V2).toEqual({
      v: 2,
      deposit: { mode: "percent", pct: 25 },
      count: 3,
      final_due_days_before_start: 30,
      auto_adjust: true,
      flex: { enabled: false },
      custom_amounts_minor: null,
    });
  });

  test("v1 is read-only until explicit conversion and keeps its deposit/count", () => {
    const legacy = {
      deposit_pct: 30,
      installments: [
        { ordinal: 1, pct: 40, days_after_booking: 30 },
        { ordinal: 2, pct: 30, days_after_booking: 60 },
      ],
    };
    expect(convertLegacyPlanToV2(legacy)).toEqual({
      ...DEFAULT_TRIP_PAYMENT_PLAN_V2,
      deposit: { mode: "percent", pct: 30 },
      count: 2,
    });
    expect(legacy.installments).toHaveLength(2);
  });

  test("live validation refuses deposit, count, final-day and flex values outside server limits", () => {
    expect(
      validateTripPaymentPlanV2(
        plan({ deposit: { mode: "amount", amount_minor: 120_001 } }),
        120_000,
      ).code,
    ).toBe("plan_deposit_invalid");
    expect(validateTripPaymentPlanV2(plan({ count: 13 }), 120_000).code).toBe(
      "plan_count_out_of_range",
    );
    expect(
      validateTripPaymentPlanV2(
        plan({ final_due_days_before_start: 181 }),
        120_000,
      ).code,
    ).toBe("plan_final_due_out_of_range");
    expect(
      validateTripPaymentPlanV2(
        plan({ flex: { enabled: true, min_payment_minor: 100_000 } }),
        120_000,
      ).code,
    ).toBe("plan_flex_min_above_balance");
  });

  test("flex defaults to 10% of the balance in whole units", () => {
    expect(defaultFlexMinimumMinor(plan(), 120_000)).toBe(9_000);
    expect(
      defaultFlexMinimumMinor(
        plan({ deposit: { mode: "amount", amount_minor: 25_000 } }),
        120_000,
      ),
    ).toBe(9_500);
  });

  test("custom amounts expose count minus one rows and the last balances itself", () => {
    const p = plan({ count: 4 });
    expect(defaultCustomAmountsMinor(p, 120_000)).toEqual([
      22_500,
      22_500,
      22_500,
    ]);
    expect(resizeCustomAmountsMinor([20_000], 4, 22_500)).toEqual([
      20_000,
      22_500,
      22_500,
    ]);
    const validation = validateTripPaymentPlanV2(
      plan({ count: 4, custom_amounts_minor: [20_000, 20_000, 20_000] }),
      120_000,
    );
    expect(validation.ok).toBe(true);
    expect(validation.customFinalMinor).toBe(30_000);
  });

  test("publish validation reads the live package price for a v2 plan", () => {
    const result = validateTripPackages([
      {
        name: "Standard",
        priceMajor: "100.00",
        capacity: 10,
        paymentPlan: plan({
          deposit: { mode: "amount", amount_minor: 10_001 },
        }),
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("deposit");
  });
});

describe("editor interaction and lazy ownership", () => {
  test("renders every approved control and the real schedule preview", () => {
    const tree = mount(plan());
    for (const id of [
      "trip-plan-v2-deposit-amount",
      "trip-plan-v2-deposit-percent",
      "trip-plan-v2-count-3",
      "trip-plan-v2-count-4",
      "trip-plan-v2-count-6",
      "trip-plan-v2-count-custom",
      "trip-plan-v2-final-days",
      "trip-plan-v2-auto-adjust",
      "trip-plan-v2-flex",
      "trip-plan-v2-share",
      "trip-plan-v2-custom",
      "trip-plan-v2-preview",
      "trip-plan-preview-slider",
    ]) {
      expect(byTestId(tree, id)).toBeDefined();
    }
  });

  test("count and flex taps emit v2 values without a dead control", () => {
    const onChange = jest.fn();
    const tree = mount(plan(), onChange);
    act(() => (byTestId(tree, "trip-plan-v2-count-4").props.onPress as () => void)());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ count: 4 }));

    const flexSwitch = byTestId(tree, "trip-plan-v2-flex").findAll(
      (node) => node.props.accessibilityLabel ===
        "Let travelers pay any amount toward their balance",
    )[0];
    act(() => (flexSwitch.props.onValueChange as (next: boolean) => void)(true));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        flex: { enabled: true, min_payment_minor: 9_000 },
      }),
    );
  });

  test("the pricing step owns exactly one lazy boundary and persistence strips the other shape", () => {
    const tripDir = path.resolve(__dirname, "..");
    const pricing = fs.readFileSync(
      path.join(tripDir, "TripCreatorStep4Pricing.tsx"),
      "utf8",
    );
    const editor = fs.readFileSync(
      path.join(tripDir, "PaymentPlanEditorV2.tsx"),
      "utf8",
    );
    const service = fs.readFileSync(
      path.resolve(tripDir, "../../services/tripsService.ts"),
      "utf8",
    );
    const publishedEditor = fs.readFileSync(
      path.join(tripDir, "EditPublishedTripScreen.tsx"),
      "utf8",
    );
    // [TEST-MOD-APPROVED #3281] The pricing step now owns two sibling lazy
    // boundaries, one per feature: the v2 plan editor and the #3281 Add-ons
    // card. Neither is nested inside the other; the plan editor still has one.
    expect(pricing.match(/React\.lazy\(/g)).toHaveLength(2);
    expect(pricing.match(/React\.lazy\(\(\) =>\s*import\("\.\/PaymentPlanEditorV2"\)/g)).toHaveLength(1);
    expect(pricing.match(/React\.lazy\(\(\) => import\("\.\.\/addOns\/AddOnsEntry"\)\)/g)).toHaveLength(1);
    expect(pricing).toContain('featureFlags.tripPlanV2');
    expect(pricing).toContain("Switch to the new plan setup");
    expect(pricing).toContain("defaultsNewPlanToShared");
    expect(pricing).toContain("sharePaymentPlan: true");
    const nativeSwitch = pricing.match(
      /<Switch[\s\S]*?payment plan switch/,
    )?.[0];
    expect(nativeSwitch).toContain("sharedFollower");
    expect(pricing).toMatch(
      /paymentPlan:\s*draft\.sharePaymentPlan === true\s*\? packages\[0\]\?\.paymentPlan \?\? null\s*:\s*null/,
    );
    expect(editor).not.toContain("React.lazy(");
    expect(editor).toContain("import type {");
    expect(editor).not.toContain("TRIP_PLAN_V2_EDITOR_RUNTIME");
    // #3281 boot room: one writer (withTierPlan) keeps exactly one plan shape
    // for both the update and the create path; the behaviour is pinned by
    // metaOrch1174_multiPackageAuthoring ("v2 replaces v1", "switching back").
    expect(service).toContain('["v" in plan && plan.v === 2 ? "payment_plan" : "installments"]: plan');
    expect(service).toContain("const { installments: _v1, payment_plan: _v2, ...rest } = metadata;");
    expect(service).toContain("withTierPlan(existingMetadata, patch.installmentSchedule)");
    expect(service).toContain("withTierPlan({}, patch.installmentSchedule)");
    expect(service).toContain("share_payment_plan: patch.sharePaymentPlan === true");
    expect(publishedEditor).not.toContain("v2PlanAuthoringLocked");
    expect(publishedEditor).toContain("metadata.payment_plan = editPkg.paymentPlan");
    expect(publishedEditor).toContain("validateTripPackages(editState.pricing.packages)");
  });
});

// #4522 first screen test S-7 — the selected Amount/Percent label was
// near-white on paper white. FAILS ON REVERT: segmentOn on color.paper.
describe("#4522 S-7 deposit Amount/Percent switch is readable when selected", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { StyleSheet } = require("react-native") as typeof import("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ds = require("../../../constants/designSystem") as typeof import("../../../constants/designSystem");
  const luminance = (hex: string): number => {
    const v = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  test("the selected segment uses the house selected surface and passes WCAG AA", () => {
    const tree = mount(plan());
    const selectedMode = plan().deposit.mode;
    const seg = byTestId(tree, `trip-plan-v2-deposit-${selectedMode}`);
    const segStyle = StyleSheet.flatten(seg.props.style as never) as { backgroundColor?: string };
    expect(segStyle.backgroundColor).toBe(ds.materials.selected.solidFill);
    expect(segStyle.backgroundColor).not.toBe(ds.color.paper);
    const label = seg.findAll((n) => typeof n.props.style !== "undefined" && n.type === "Text")[0]
      ?? seg.findAll((n) => n.props.children === (selectedMode === "amount" ? "Amount" : "Percent"))[0];
    const textStyle = StyleSheet.flatten(label.props.style as never) as { color?: string };
    expect(textStyle.color).toBe(ds.color.textStrong);
    expect(contrast(textStyle.color as string, segStyle.backgroundColor as string)).toBeGreaterThanOrEqual(4.5);
  });
});


// #4522 first screen test S-17 — "Late booking: 1 payments instead of 3".
// FAILS ON REVERT: the count is printed with a fixed "payments".
describe("#4522 S-17 the late-booking line is singular for one payment", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PaymentPlanPreview, paymentsPhrase } = require("../PaymentPlanPreview") as typeof import("../PaymentPlanPreview");
  const textOf = (node: Instance): string =>
    node.findAll(() => true)
      .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
      .filter((c): c is string | number => typeof c === "string" || typeof c === "number")
      .join("");
  test("paymentsPhrase", () => {
    expect(paymentsPhrase(1)).toBe("1 payment");
    expect(paymentsPhrase(3)).toBe("3 payments");
  });
  test("38 days before departure on a 3-payment plan reads '1 payment instead of 3'", () => {
    let tree!: Renderer;
    act(() => {
      tree = TestRenderer.create(
        <PaymentPlanPreview
          plan={plan({ count: 3, final_due_days_before_start: 30, auto_adjust: true })}
          totalAmountMinor={120_000}
          currency="USD"
          tripStartAt="2027-03-12T12:00:00.000Z"
          timeZone="UTC"
        />,
      );
    });
    mounted.push(tree);
    act(() => {
      (byTestId(tree, "trip-plan-preview-38").props.onPress as () => void)();
    });
    const adjusted = byTestId(tree, "trip-plan-preview-adjusted");
    const line = textOf(adjusted);
    expect(line).toContain("1 payment instead of");
    expect(line).not.toContain("1 payments");
  });
});

// issue #4522 W-1 — the host preview books its simulated traveler on the trip's
// CALENDAR days (start stored as UTC midnight, #4420), in the trip zone. It
// used `start - N days`: the previous evening west of UTC, so a New York
// preview showed every date a day early (Dec 18 / Jan 14 / Feb 9).
describe("#4522 W-1 — preview dates are the server's dates", () => {
  test("a New York trip on 12 Mar: 60 days before books on 11 Jan; the final row is 10 Feb", async () => {
    const { previewBookedAt } = await import("../PaymentPlanPreview");
    const { computeTripPlanV2Schedule } = await import(
      "../../../../../packages/offering-rendering/tripPlanV2Math"
    );
    const start = new Date("2027-03-12T00:00:00Z");
    const booked = previewBookedAt(start, 60, 109, "America/New_York");
    expect(booked.toISOString()).toBe("2027-01-11T17:00:00.000Z");
    const schedule = computeTripPlanV2Schedule({
      lineNetMinor: 120_000,
      units: 1,
      plan: { v: 2, deposit: { mode: "amount", amount_minor: 30_000 }, count: 3, final_due_days_before_start: 30 },
      tripStartAt: start,
      timeZone: "America/New_York",
      bookedAt: previewBookedAt(start, 109, 109, "America/New_York", Date.parse("2026-11-23T15:00:00Z")),
    });
    expect(schedule.rows.map((row) => row.due_at)).toEqual([
      "2026-12-19T14:00:00Z",
      "2027-01-15T14:00:00Z",
      "2027-02-10T14:00:00Z",
    ]);
  });
});
