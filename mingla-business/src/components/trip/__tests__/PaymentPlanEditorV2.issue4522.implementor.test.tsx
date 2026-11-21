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
    expect(pricing.match(/React\.lazy\(/g)).toHaveLength(1);
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
    expect(service).toContain("payment_plan: patch.installmentSchedule");
    expect(service).toContain("installments: _stripExistingV1");
    expect(service).toContain("payment_plan: _stripExistingV2");
    expect(service).toContain("share_payment_plan: patch.sharePaymentPlan === true");
    expect(publishedEditor).toContain("v2PlanAuthoringLocked");
  });
});
