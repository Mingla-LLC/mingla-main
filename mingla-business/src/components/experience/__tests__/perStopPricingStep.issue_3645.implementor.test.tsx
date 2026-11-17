/* eslint-disable import/first */
/**
 * issue #3645 bundle 2A — the Pricing step in per-stop mode, rendered for real.
 * A paid experience whose stops total 0 is not free (the server refuses it),
 * so the step says so instead of "Free for buyers", the free switch is on
 * this screen, and Continue shows why it is held.
 */
import React from "react";

import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestInstance | string)[];
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => { root: TestInstance; unmount: () => void };
  act: (fn: () => void) => void;
};

const probe = (name: string) => (props: Record<string, unknown>) =>
  require("react").createElement(name, props, props.children as React.ReactNode);
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/Input", () => ({ Input: probe("InputProbe") }));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: probe("GlassCardProbe") }));
jest.mock("../../ui/ExtraGuestsField", () => ({ ExtraGuestsField: (): null => null }));
jest.mock("../../trip/LazyRefundPolicyEditor", () => ({ LazyRefundPolicyEditor: (): null => null }));
jest.mock("../../pricing/LazyWhoCoversCostsSection", () => ({ WhoCoversCostsSection: probe("CostsProbe") }));

import { ExperiencePricingStep } from "../ExperiencePricingStep";
import type { ExperienceStopDraft } from "../experienceWizardTypes";
import { emptyPriceOption } from "../experienceWizardTypes";

const stop = (i: number, priceMajor: string): ExperienceStopDraft =>
  ({ clientId: `s${i}`, placeName: `Stop ${i}`, priceMajor } as unknown as ExperienceStopDraft);

const render = (opts: { isFree: boolean; prices: string[]; showErrors: boolean }) => {
  const setIsFree = jest.fn();
  const noop = (): void => undefined;
  let tree!: { root: TestInstance; unmount: () => void };
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <ExperiencePricingStep
        {...({
          currencySymbol: "₦",
          currency: "NGN",
          pricingMode: "per_stop",
          setPricingMode: noop,
          stops: opts.prices.map((p, i) => stop(i + 1, p)),
          setStops: noop,
          wholePriceMajor: "",
          setWholePriceMajor: noop,
          priceOptions: [emptyPriceOption()],
          setPriceOptions: noop,
          isFree: opts.isFree,
          setIsFree,
          capacity: "10",
          setCapacity: noop,
          unlimited: false,
          setUnlimited: noop,
          pricingSwitches: {},
          setPricingSwitches: noop,
          brandDefaults: { passTax: false, passMinglaFee: false, passServiceFee: false },
          takeRateBps: 450,
          paymentProvider: "paystack",
          paymentCountry: "NG",
          vatRegistered: false,
          onEditDefaults: noop,
          onSetupVat: noop,
          showErrors: opts.showErrors,
          privateGuestList: false,
          setPrivateGuestList: noop,
          hideRemainingCount: false,
          setHideRemainingCount: noop,
          extraGuestCount: 0,
          setExtraGuestCount: noop,
          refundPolicy: null,
          setRefundPolicy: noop,
        } as unknown as React.ComponentProps<typeof ExperiencePricingStep>)}
      />,
    );
  });
  return { tree, setIsFree };
};

const allText = (node: TestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(allText).join(" ");

describe("issue #3645 2A — per-stop Pricing step", () => {
  test("stops at 0, not free: never 'Free for buyers'; the free switch is here; Continue says why", () => {
    const { tree, setIsFree } = render({ isFree: false, prices: ["", "0"], showErrors: true });
    const text = allText(tree.root);
    expect(text).not.toContain("Free for buyers");
    expect(text).toContain("No price yet. Give at least one stop a price, or mark the experience free.");
    const [error] = tree.root.findAll((n) => n.props.testID === "experience-pricing-per-stop-unpriced" && typeof n.type === "string");
    expect(allText(error)).toBe("Give at least one stop a price, or mark the experience free.");
    const toggles = tree.root.findAll((n) => n.props.accessibilityLabel === "This experience is free" && typeof n.props.onPress === "function");
    expect(toggles.length).toBeGreaterThan(0);
    TestRenderer.act(() => { (toggles[0].props.onPress as () => void)(); });
    expect(setIsFree).toHaveBeenCalledWith(true);
    tree.unmount();
  });

  test("sub-unit stops count as 0, as the server sums them", () => {
    const { tree } = render({ isFree: false, prices: ["0.004", "0.004"], showErrors: true });
    expect(tree.root.findAll((n) => n.props.testID === "experience-pricing-per-stop-unpriced" && typeof n.type === "string")).toHaveLength(1);
    tree.unmount();
  });

  test("the costs preview, the Total and the published ticket use one total (each stop rounded first)", () => {
    // 3 × 0.006: unrounded that is 1.8 minor units (2); the server sends 1 per stop = 3.
    const { tree } = render({ isFree: false, prices: ["0.006", "0.006", "0.006"], showErrors: true });
    const [costs] = tree.root.findAll((n) => n.type === "CostsProbe");
    expect(costs.props.previewBaseCents).toBe(3);
    tree.unmount();
  });

  test("before Continue is pressed there is no inline error", () => {
    const { tree } = render({ isFree: false, prices: ["", ""], showErrors: false });
    expect(tree.root.findAll((n) => n.props.testID === "experience-pricing-per-stop-unpriced")).toHaveLength(0);
    tree.unmount();
  });

  test("one priced stop is a price: no error, the summary names the total", () => {
    const { tree } = render({ isFree: false, prices: ["", "1500"], showErrors: true });
    expect(tree.root.findAll((n) => n.props.testID === "experience-pricing-per-stop-unpriced")).toHaveLength(0);
    expect(allText(tree.root)).toMatch(/Stops add up to/);
    tree.unmount();
  });

  test("marked free: the stop prices are hidden and buyers are told it is free", () => {
    const { tree } = render({ isFree: true, prices: ["", ""], showErrors: true });
    const text = allText(tree.root);
    expect(text).toContain("Free for buyers");
    expect(text).not.toContain("PER-STOP PRICES");
    expect(tree.root.findAll((n) => n.props.testID === "experience-pricing-per-stop-unpriced")).toHaveLength(0);
    tree.unmount();
  });
});
