/**
 * issue #4420 D-C1 / §4.1 / D-C2c — checkout wears the host's colours.
 *
 *   C-1 with no host palette the checkout tokens ARE Graphite, value for value
 *       (so every screen outside a checkout scope is unchanged);
 *   C-2 with a host palette the tokens and stylesheets re-point at it (page,
 *       ink, accent first colour, status colours), and switch back;
 *   C-3 the step bar: done + current filled, the rest not, spoken
 *       "Step x of y"; desktop shows the named steps instead;
 *   C-4 "Payment not completed" is an alert banner carrying the step's own
 *       message (copy unchanged);
 *   C-5 the desktop stub carries the offering band and the perforation;
 *   C-6 the native PaymentSheet takes the host palette (and nothing on
 *       Graphite).
 *
 * Fails-on-revert: a token that stays Graphite on a host page, a stylesheet
 * built once at module load, a step bar that fills the wrong segments, a
 * toast instead of the banner, or a PaymentSheet without the palette fails.
 */
import React from "react";
import { StyleSheet, Text } from "react-native";
import { createThemePalette, resolveTheme } from "@mingla/offering-rendering";

import { color as graphite } from "../../../constants/designSystem";
import {
  checkoutStyles,
  color,
  setActiveCheckoutPalette,
} from "../checkoutTheme";
import { paymentSheetAppearanceFor } from "../../../payments/paymentSheetAppearance";

let wideDesktop = false;
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: wideDesktop, isWeb: true, width: 1440 }),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/IconChrome", () => ({
  IconChrome: (props: Record<string, unknown>) =>
    jest.requireActual<typeof import("react")>("react").createElement("IconChrome", props),
}));
jest.mock("expo-linear-gradient", () => ({
  LinearGradient: () => null,
}));
jest.mock("../CartContext", () => ({
  useCart: () => ({ lines: [], quote: null }),
}));

type Node = { type: unknown; props: Record<string, unknown> };
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: { findAll: (p: (n: Node) => boolean) => Node[] } };
  act: (fn: () => void) => void;
};

const light = createThemePalette(resolveTheme({ color: "#0b6e4f" } as never, null));
const dark = createThemePalette(resolveTheme({ color: "#ff6b35" } as never, null));

afterEach(() => setActiveCheckoutPalette(null));

describe("issue #4420 — checkout in the host's colours", () => {
  test("C-1 no host palette ⇒ the tokens are Graphite", () => {
    setActiveCheckoutPalette(null);
    expect(color.canvas).toBe(graphite.canvas);
    expect(color.text1).toBe(graphite.text1);
    expect(color.fill.inset).toBe(graphite.fill.inset);
    expect({ ...color }.accent).toBe(graphite.accent);
  });

  test("C-2 a host palette re-points tokens and sheets, and switches back", () => {
    const sheet = checkoutStyles(() =>
      StyleSheet.create({ page: { backgroundColor: color.canvas }, ink: { color: color.text1 } }),
    );
    setActiveCheckoutPalette(light);
    expect(color.canvas).toBe(light.page);
    expect(color.text1).toBe(light.primaryText);
    expect(color.canvas).not.toBe(graphite.canvas);
    expect(StyleSheet.flatten(sheet.page).backgroundColor).toBe(light.page);
    setActiveCheckoutPalette(dark);
    expect(StyleSheet.flatten(sheet.page).backgroundColor).toBe(dark.page);
    expect(StyleSheet.flatten(sheet.ink).color).toBe(dark.primaryText);
    setActiveCheckoutPalette(null);
    expect(StyleSheet.flatten(sheet.page).backgroundColor).toBe(graphite.canvas);
  });

  test("C-3 the step bar fills done + current, spoken Step x of y", () => {
    const { CheckoutHeader, checkoutStepStates } = require("../CheckoutHeader");
    expect(checkoutStepStates(1, 3)).toEqual(["done", "current", "next"]);
    setActiveCheckoutPalette(light);
    wideDesktop = false;
    let tree!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <CheckoutHeader stepIndex={1} totalSteps={3} title="Your details" onBack={() => undefined} />,
      );
    });
    const ids = tree.root
      .findAll((n) => typeof n.props.testID === "string" && String(n.props.testID).startsWith("checkout-step-segment-"))
      .filter((n) => typeof n.type === "string")
      .map((n) => n.props.testID);
    expect(ids).toEqual([
      "checkout-step-segment-done",
      "checkout-step-segment-current",
      "checkout-step-segment-next",
    ]);
    expect(
      tree.root.findAll((n) => n.props.accessibilityLabel === "Step 2 of 3").length,
    ).toBeGreaterThan(0);
    wideDesktop = true;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <CheckoutHeader stepIndex={2} totalSteps={3} title="Payment" onBack={() => undefined} />,
      );
    });
    const names = tree.root
      .findAll((n) => n.type === Text)
      .map((n) => n.props.children)
      .filter((c) => c === "Tickets" || c === "Details" || c === "Payment");
    expect(names).toEqual(["Payment", "Tickets", "Details", "Payment"]);
    expect(tree.root.findAll((n) => n.props.testID === "checkout-step-bar")).toHaveLength(0);
    wideDesktop = false;
  });

  test("C-4 a failed payment is an alert banner with the step's own message", () => {
    const { CheckoutStatusBanner } = require("../CheckoutHeader");
    let tree!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <CheckoutStatusBanner
          tone="error"
          title="Payment not completed"
          body="Your payment didn't go through, so no tickets were issued."
        />,
      );
    });
    const banner = tree.root.findAll((n) => n.props.accessibilityRole === "alert")[0];
    expect(banner).toBeDefined();
    const text = tree.root.findAll((n) => n.type === Text).map((n) => n.props.children);
    expect(text).toEqual([
      "Payment not completed",
      "Your payment didn't go through, so no tickets were issued.",
    ]);
  });

  test("C-5 the desktop stub carries the offering band and the perforation", () => {
    const { CheckoutOrderSummary } = require("../CheckoutOrderSummary");
    let tree!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <CheckoutOrderSummary
          wide
          bottomInset={0}
          stub={{ title: "Graphite Rooftop Night", eyebrow: "Sat 19 Dec", coverUrl: null }}
        >
          <Text>Continue</Text>
        </CheckoutOrderSummary>,
      );
    });
    const has = (id: string): boolean =>
      tree.root.findAll((n) => n.props.testID === id).length > 0;
    expect(has("checkout-stub-band")).toBe(true);
    expect(has("checkout-stub-perforation")).toBe(true);
    const text = tree.root.findAll((n) => n.type === Text).map((n) => n.props.children);
    expect(text).toContain("Graphite Rooftop Night");
    expect(text).toContain("All-in price. Taxes and fees included.");
  });

  test("C-6 the native PaymentSheet takes the host palette", () => {
    expect(paymentSheetAppearanceFor(null)).toBeUndefined();
    const sheet = paymentSheetAppearanceFor(dark);
    expect(sheet?.colors.background).toBe(dark.page);
    expect(sheet?.colors.primaryText).toBe(dark.primaryText);
    expect(sheet?.shapes.borderRadius).toBe(12);
    expect(sheet?.primaryButton.shapes.borderRadius).toBe(999);
    expect(sheet?.colors.componentBackground).toMatch(/^#/);
  });
});
