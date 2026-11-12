/**
 * #4389 (device r4) — T1 "Where will you take card payments?": Save address
 * sat under the keyboard. The page column is now the keyboard-avoiding
 * wrapper (behavior padding + the Done-bar budget), with Save in its footer
 * outside the scroll body, as brand setup's steps do.
 *
 * FAILS ON REVERT: render the column as a plain View again → T1.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "b-t1" }),
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../../../src/wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { ScrollView: RN.ScrollView, DONE_BAR_OCCUPIED: 53 };
});
jest.mock("../../../../src/components/location/AddressInput", () => ({ AddressInput: () => null }));
jest.mock("../../../../src/components/ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { Button: (p: { testID?: string }) => R.createElement(RN.View, { testID: p.testID }) };
});
jest.mock("../../../../src/hooks/useBrandSetupChecklist", () => ({
  useBrandSetupChecklist: () => ({ data: { facts: { payoutCountry: "US" } }, isLoading: false, isError: false }),
  useSetTapLocationAddress: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../../src/lib/netinfoSafe", () => ({ useNetInfoSafe: () => ({ isConnected: true }) }));

import { ScrollView } from "react-native";
import { KeyboardAvoidingView } from "../../../../src/wrappers/SmartKeyboardAvoidingView";
const TapAddressRoute = (require("../tap-to-pay/address") as { default: React.FC }).default;

interface Node { type: unknown; props: Record<string, unknown>; parent: Node | null; findAll(p: (n: Node) => boolean): Node[] }
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): { root: Node; unmount(): void };
  act(cb: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: { root: Node; unmount(): void } | null = null;
afterEach(() => {
  if (tree !== null) TestRenderer.act(() => tree?.unmount());
  tree = null;
});
const isInside = (n: Node, a: Node): boolean => {
  for (let p: Node | null = n.parent; p !== null; p = p.parent) if (p === a) return true;
  return false;
};

describe("#4389 — T1 keeps Save address above the keyboard", () => {
  test("T1: Save sits in the keyboard-avoiding column, outside the scroll body", () => {
    TestRenderer.act(() => {
      tree = TestRenderer.create(<TapAddressRoute />);
    });
    const root = (tree as unknown as { root: Node }).root;
    const kav = root.findAll((n) => n.type === KeyboardAvoidingView)[0];
    expect(kav).toBeDefined();
    expect(kav?.props.behavior).toBe("padding");
    // Done bar (53) + the top safe area the page pads above the column (20).
    expect(kav?.props.keyboardVerticalOffset).toBe(53 + 20);
    const save = root.findAll((n) => typeof n.type === "string" && n.props.testID === "tap-address-save")[0] as Node;
    expect(isInside(save, kav as Node)).toBe(true);
    expect(root.findAll((n) => n.type === ScrollView).some((s) => isInside(save, s))).toBe(false);
  });
});
