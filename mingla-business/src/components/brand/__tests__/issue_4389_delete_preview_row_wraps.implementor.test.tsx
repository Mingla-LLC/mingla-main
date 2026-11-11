/**
 * #4389 P2 (retest, iPhone SE) — the delete preview's payment row ran
 * "Payment account" into "Will be closed when you…" with no space and clipped
 * the value. The row now stacks: label on line 1, the value on line 2 with a
 * gap; the value wraps (no numberOfLines) and is never truncated.
 *
 * FAILS ON REVERT: render the payment row as the side-by-side previewRow → T1.
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { StyleSheet, Text } from "react-native";

jest.mock("../../../hooks/useBrands", () => ({
  useBrandCascadePreview: jest.fn(),
  useSoftDeleteBrand: jest.fn(),
}));
jest.mock("../../../diagnostics/sentry", () => ({ captureException: jest.fn() }));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Sheet", () => ({ Sheet: () => null }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { ScrollView: RN.ScrollView };
});

/* eslint-disable import/first */
import { PaymentAccountPreviewRow } from "../BrandDeleteSheet";
import { BRAND_SETUP_COPY } from "../brandSetupCopy";
/* eslint-enable import/first */

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<Node | string>;
  findAll(p: (n: Node) => boolean): Node[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
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

describe("#4389 P2 — the delete preview payment row wraps, never clips", () => {
  test("T1: label and value stack on two lines with a gap; the value is never truncated", () => {
    TestRenderer.act(() => {
      tree = TestRenderer.create(<PaymentAccountPreviewRow hasAccount />);
    });
    const root = (tree as unknown as { root: Node }).root;
    const row = root.findAll((n) => typeof n.type === "string" && n.props.testID === "brand-delete-payment-account-row")[0] as Node;
    const style = StyleSheet.flatten(row.props.style as object) as Record<string, unknown>;
    expect(style.flexDirection).toBe("column");
    expect(Number(style.gap)).toBeGreaterThan(0);
    const texts = root.findAll((n) => n.type === Text);
    expect(texts.map((t) => t.props.children)).toEqual(["Payment account", BRAND_SETUP_COPY.delete.closedOnDelete]);
    const value = texts[1] as Node;
    expect(value.props.numberOfLines).toBeUndefined();
    expect((StyleSheet.flatten(value.props.style as object) as Record<string, unknown>).flexShrink).toBe(1);
  });

  test("T2: no account reads the 'none' value", () => {
    TestRenderer.act(() => {
      tree = TestRenderer.create(<PaymentAccountPreviewRow hasAccount={false} />);
    });
    const root = (tree as unknown as { root: Node }).root;
    expect(root.findAll((n) => n.type === Text).map((t) => t.props.children)).toContain(BRAND_SETUP_COPY.delete.none);
  });
});
