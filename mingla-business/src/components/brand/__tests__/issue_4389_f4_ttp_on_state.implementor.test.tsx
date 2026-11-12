/**
 * #4389 (iPhone 15 "New User" recording 23:53, ~266 s and 278 s) — after Tap to
 * Pay on iPhone was ON for the brand on this phone, F4 "You're all set." still
 * showed the card with "Set up Tap to Pay on iPhone".
 *
 * The card lives in the door chunk (F4TapToPayCard, loaded on F4 through
 * LazyDoorSaleScreens) so its Tap to Pay modules stay out of the eager web
 * __common.
 *
 *   O1 on for this brand → "Tap to Pay on iPhone · On", no setup button;
 *   O2 on + an event to sell for now → "Take a payment" opens the door sale;
 *   O3 on + no event → no button;
 *   O4 not on → the setup card as before;
 *   O5 F4 renders the card through the lazy door chunk, iPhone only.
 *
 * FAILS ON REVERT: the `on` branch removed → O1/O2/O3.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";

let mockOn = false;
let mockHasEvent = false;
let mockEntry: { label: string } | null = { label: "Tap to Pay on iPhone" };
const mockOpenDoorSale = jest.fn(async () => "opened");
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));
jest.mock("../../../hooks/useTapToPaySettingsEntry", () => ({ useTapToPaySettingsEntry: () => mockEntry }));
jest.mock("../../../hooks/useTapToPayAvailability", () => ({ useTapToPayOnForBrand: () => mockOn }));
jest.mock("../../../utils/openDoorSale", () => ({
  hasDoorSaleEvent: async () => mockHasEvent,
  openDoorSale: (...a: unknown[]) => mockOpenDoorSale(...(a as [])),
}));
jest.mock("../../../utils/tapToPayBrandEligible", () => ({ tapToPayBrandEligible: () => true }));
jest.mock("../../ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return {
    Button: (p: { label: string; onPress: () => void; testID?: string }) =>
      R.createElement(RN.Pressable, { accessibilityLabel: p.label, onPress: p.onPress, testID: p.testID }),
  };
});

import { F4TapToPayCard } from "../../door/tap/F4TapToPayCard";

interface Node { type: unknown; props: Record<string, unknown>; children: Array<Node | string>; findAll(p: (n: Node) => boolean): Node[] }
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): { root: Node; unmount(): void };
  act(cb: () => Promise<void> | void): Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const textOf = (n: Node | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(" "));
const byId = (root: Node, id: string): Node[] => root.findAll((n) => typeof n.type === "string" && n.props.testID === id);

let tree: { root: Node; unmount(): void } | null = null;
const open = async (): Promise<Node> => {
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<F4TapToPayCard brandId="brand-1" provider="stripe" country="US" />);
  });
  await TestRenderer.act(async () => {
    for (let i = 0; i < 4; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
  });
  return (tree as unknown as { root: Node }).root;
};

describe("#4389 — F4 shows Tap to Pay on iPhone as On once it is on for this phone and brand", () => {
  beforeEach(() => {
    Object.defineProperty(require("react-native").Platform, "OS", { configurable: true, get: () => "ios" });
    mockOn = false;
    mockHasEvent = false;
    mockEntry = { label: "Tap to Pay on iPhone" };
    mockOpenDoorSale.mockClear();
    mockPush.mockClear();
  });
  afterEach(async () => {
    if (tree !== null) await TestRenderer.act(() => tree?.unmount());
    tree = null;
  });

  test("O1: on → '· On', never the setup button", async () => {
    mockOn = true;
    const root = await open();
    expect(textOf(root)).toContain("Tap to Pay on iPhone · On");
    expect(byId(root, "brand-setup-ttp-setup")).toHaveLength(0);
  });

  test("O2: on with an event to sell → Take a payment opens the door sale", async () => {
    mockOn = true;
    mockHasEvent = true;
    const root = await open();
    const btn = byId(root, "brand-setup-ttp-take-payment");
    expect(btn.length).toBeGreaterThan(0);
    await TestRenderer.act(async () => (btn[0].props.onPress as () => void)());
    expect(mockOpenDoorSale).toHaveBeenCalledTimes(1);
  });

  test("O3: on with no event → no button", async () => {
    mockOn = true;
    const root = await open();
    expect(byId(root, "brand-setup-ttp-take-payment")).toHaveLength(0);
  });

  test("O4: not on → the setup card", async () => {
    const root = await open();
    expect(byId(root, "brand-setup-ttp-setup").length).toBeGreaterThan(0);
    expect(textOf(root)).not.toContain("· On");
  });

  test("O5: F4 renders the card through the lazy door chunk, iPhone only", () => {
    const flow = fs.readFileSync(path.join(__dirname, "..", "BrandCreationFlow.tsx"), "utf8");
    expect(flow).toMatch(/Platform\.OS === "ios" \? <LazyF4TapToPayCard brandId=\{brandId\}/);
    const screens = fs.readFileSync(path.join(__dirname, "..", "..", "door", "doorSaleScreens.ts"), "utf8");
    expect(screens).toContain('export { F4TapToPayCard } from "./tap/F4TapToPayCard";');
  });
});
