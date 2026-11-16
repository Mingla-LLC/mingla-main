/**
 * issue #4420 — public checkout audit: the narrow sticky bar is opaque and the
 * scroll pads by its MEASURED height, so the last ticket tier is never stuck
 * under the bar (a fixed 140 hid "Press Pass" on a five-tier event).
 *
 * Fails-on-revert: drop onBarHeight from the bar's onLayout, put the glass
 * fill back, or return a route to the fixed `insets.bottom + 140` padding.
 */
import React from "react";
import { Text } from "react-native";
import fs from "fs";
import path from "path";

jest.mock("../CartContext", () => ({
  useCart: () => ({ lines: [], quote: null }),
}));

const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => {
    root: { findAll: (p: (n: { props: Record<string, unknown> }) => boolean) => Array<{ props: Record<string, unknown> }> };
    unmount: () => void;
  };
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flat = (style: unknown): Record<string, unknown> =>
  ([] as unknown[])
    .concat(style as unknown[])
    .flat(4)
    .reduce<Record<string, unknown>>(
      (acc, part) => (part && typeof part === "object" ? { ...acc, ...(part as object) } : acc),
      {},
    );

describe("issue #4420 — checkout sticky bar", () => {
  test("the narrow bar reports its height and paints an opaque fill", async () => {
    const { CheckoutOrderSummary } = require("../CheckoutOrderSummary");
    const { materials } = require("../../../constants/designSystem");
    const heights: number[] = [];
    let tree!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <CheckoutOrderSummary wide={false} bottomInset={34} onBarHeight={(h: number) => heights.push(h)}>
          <Text>Continue</Text>
        </CheckoutOrderSummary>,
      );
    });
    const bar = tree.root.findAll((n) => n.props.testID === "checkout-bottom-bar")[0];
    expect(flat(bar.props.style).backgroundColor).toBe(materials.chrome.solidFill);
    const onLayout = bar.props.onLayout as (e: unknown) => void;
    expect(typeof onLayout).toBe("function");
    await TestRenderer.act(async () => {
      onLayout({ nativeEvent: { layout: { height: 211.4, width: 390, x: 0, y: 0 } } });
    });
    expect(heights).toEqual([212]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("every buyer-web checkout pads its scroll by the measured bar", () => {
    for (const route of [
      "checkout/[eventId]/index.tsx",
      "checkout-experience/[experienceEventId]/index.tsx",
      "checkout-trip/[tripEventId]/index.tsx",
    ]) {
      const source = fs.readFileSync(path.join(__dirname, "../../../../app", route), "utf8");
      expect(source).toContain("onBarHeight={setBarHeight}");
      expect(source).toContain("Math.max(insets.bottom + 140, barHeight + space[4])");
    }
  });
});
