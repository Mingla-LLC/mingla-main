/**
 * #4389 (iPhone 15 screenshot of F4 "You're all set.") — the Tap to Pay on
 * iPhone card drew Apple's art at full width and its own 720×559 aspect ratio
 * (~260pt tall on an iPhone 15), so the button and the offering list fell far
 * below the fold. The design (.ttph .vis) is a 186pt band, overflow hidden,
 * with the art 330pt wide pinned right -26 / top -6.
 *
 * Render test: the real card is mounted on iPhone and the band and art it
 * draws carry those styles (jest has no layout engine, so the styles are the
 * contract). FAILS ON REVERT: the old `width: "100%", aspectRatio: 720 / 559`
 * art, or the band wrapper / its 186pt height removed.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

jest.mock("../../../../assets/tap-to-pay/ttp-visual.png", () => 1, { virtual: true });
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("../../../hooks/useTapToPaySettingsEntry", () => ({
  useTapToPaySettingsEntry: () => ({ label: "Tap to Pay on iPhone" }),
}));
jest.mock("../../../hooks/useTapToPayAvailability", () => ({ useTapToPayOnForBrand: () => false }));
jest.mock("../../../utils/tapToPayBrandEligible", () => ({ tapToPayBrandEligible: () => true }));
jest.mock("../../ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { Button: (p: { testID?: string }) => R.createElement(RN.View, { testID: p.testID }) };
});

import { Image, StyleSheet } from "react-native";
import { F4TapToPayCard, TTP_ART_WIDTH, TTP_BAND_HEIGHT } from "../../door/tap/F4TapToPayCard";

interface Node { type: unknown; props: Record<string, unknown>; parent: Node | null; findAll(p: (n: Node) => boolean): Node[] }
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): { root: Node; unmount(): void };
  act(cb: () => Promise<void> | void): Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flat = (n: Node): Record<string, unknown> =>
  (StyleSheet.flatten(n.props.style as never) ?? {}) as Record<string, unknown>;

let tree: { root: Node; unmount(): void } | null = null;
const mount = async (): Promise<Node> => {
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<F4TapToPayCard brandId="brand-1" provider="stripe" country="US" />);
  });
  return (tree as unknown as { root: Node }).root;
};

describe("#4389 — F4 Tap to Pay visual is a short cropped band", () => {
  beforeEach(() => {
    Object.defineProperty(require("react-native").Platform, "OS", { configurable: true, get: () => "ios" });
  });
  afterEach(async () => {
    if (tree !== null) await TestRenderer.act(() => tree?.unmount());
    tree = null;
  });

  test("B1: the band is 186pt and clips the art", async () => {
    const root = await mount();
    const band = root.findAll((n) => typeof n.type === "string" && n.props.testID === "brand-setup-ttp-band");
    expect(band).toHaveLength(1);
    expect(TTP_BAND_HEIGHT).toBe(186);
    expect(flat(band[0])).toMatchObject({ height: 186, overflow: "hidden" });
  });

  test("B2: the art sits inside the band, 330pt wide, never full-width by aspect ratio", async () => {
    const root = await mount();
    const art = root.findAll((n) => n.type === Image);
    expect(art).toHaveLength(1);
    let parent = art[0].parent;
    while (parent !== null && parent.props.testID !== "brand-setup-ttp-band") parent = parent.parent;
    expect(parent).not.toBeNull();
    expect(TTP_ART_WIDTH).toBe(330);
    const style = flat(art[0]);
    expect(style).toMatchObject({ position: "absolute", right: -26, top: -6, width: 330 });
    expect(style.aspectRatio).toBeUndefined();
    expect(style.width).not.toBe("100%");
  });
});
