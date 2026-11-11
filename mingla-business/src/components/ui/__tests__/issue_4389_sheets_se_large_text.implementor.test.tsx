/**
 * #4389 — the longest sheets at iPhone SE size (375×667) with the largest
 * text: H2, the delete sheet's blocked step, and the brand switcher with 15
 * brands. The Sheet / TopSheet panels are stood in by a View of the real
 * panel height (computeSheetHeight / the TopSheet 70% ratio) so the rendered
 * tree is exactly what goes inside the panel.
 *
 * What is asserted (jest has no layout engine): the panel is bounded on the
 * SE; every button sits in the pinned footer, OUTSIDE the scroll body, which
 * is the flex:1 sibling before it, so long content (15 brands, wrapped text
 * at 200%) scrolls inside the panel and never pushes a button out of it.
 *
 * FAILS ON REVERT: H2 or the delete sheet back on one View/ScrollView with
 * the buttons inside it → T1 / T2; the switcher's "Create a new brand" moved
 * into its list → T3.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

const SE = { width: 375, height: 667, fontScale: 3.1 }; // iOS AX5 (largest).

jest.mock("react-native", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return Object.assign(Object.create(RN) as object, {
    useWindowDimensions: () => ({ width: 375, height: 667, scale: 2, fontScale: 3.1 }),
  });
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { ScrollView: RN.ScrollView, DONE_BAR_OCCUPIED: 53 };
});
jest.mock("../Sheet", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  const { computeSheetHeight } = jest.requireActual("../sheetSnapHeight") as typeof import("../sheetSnapHeight");
  return {
    Sheet: (p: { visible: boolean; snapPoint?: "half" | "full"; children?: React.ReactNode }) =>
      p.visible
        ? R.createElement(RN.View, { testID: "panel", style: { height: computeSheetHeight(p.snapPoint ?? "half", 667), overflow: "hidden" } }, p.children)
        : null,
  };
});
jest.mock("../TopSheet", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return {
    TopSheet: (p: { visible: boolean; children?: React.ReactNode }) =>
      p.visible ? R.createElement(RN.View, { testID: "panel", style: { height: 667 * 0.7, overflow: "hidden" } }, p.children) : null,
  };
});
jest.mock("../Button", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return {
    Button: (p: { label: string; onPress: () => void; testID?: string; disabled?: boolean }) =>
      R.createElement(RN.Pressable, { accessibilityLabel: p.label, onPress: p.onPress, testID: p.testID ?? "button", accessibilityRole: "button" }),
  };
});
jest.mock("../Icon", () => ({ Icon: () => null }));
jest.mock("../../../diagnostics/sentry", () => ({ captureException: jest.fn() }));
let mockSubmit: () => Promise<unknown> = () => Promise.resolve({ rejected: false });
jest.mock("../../../hooks/useBrands", () => ({
  useBrandCascadePreview: () => ({ data: { pastEventCount: 3, upcomingEventCount: 0, liveEventCount: 0, teamMemberCount: 4, hasStripeConnect: true }, isLoading: false, isError: false }),
  useSoftDeleteBrand: () => ({ mutateAsync: () => mockSubmit(), isPending: false }),
}));
// Switcher
const mockBrands = Array.from({ length: 15 }, (_, i) => ({ id: `b-${i}`, displayName: `A rather long brand name number ${i + 1}`, accountId: "u-1", role: "owner" }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" } }) }));
jest.mock("../../../hooks/useBrandListShim", () => ({
  useBrandListState: () => ({ brands: mockBrands, status: "success", isLoading: false }),
}));
jest.mock("../../../hooks/usePickBrand", () => ({ usePickBrand: () => jest.fn() }));
jest.mock("../../../hooks/useBrandSetupStates", () => ({
  useBrandSetupStates: () => ({ byId: { "b-0": { kind: "draft", doneCount: 1 }, "b-1": { kind: "free_only", doneCount: 2 } }, draftId: "b-0", isLoading: false }),
}));
jest.mock("../../../hooks/useBrandFollowerCount", () => ({ useBrandFollowerCounts: () => ({ data: {} }) }));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null }) => unknown) => sel({ currentBrandId: "b-3" }),
}));

import { ScrollView, StyleSheet } from "react-native";
import { HomeSetupPromptSheet } from "../../home/HomeSetupPromptSheet";
import { BrandDeleteSheet } from "../../brand/BrandDeleteSheet";
import { BrandSwitcherSheet } from "../../brand/BrandSwitcherSheet";
import { computeSheetHeight } from "../sheetSnapHeight";
import type { Brand } from "../../../store/currentBrandStore";

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  parent: Node | null;
  children: Array<Node | string>;
  findAll(p: (n: Node) => boolean): Node[];
}
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): { root: Node; unmount(): void };
  act(cb: () => void | Promise<void>): Promise<void> | void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let tree: { root: Node; unmount(): void } | null = null;
afterEach(() => {
  if (tree !== null) TestRenderer.act(() => tree?.unmount());
  tree = null;
});
async function render(el: React.ReactElement): Promise<Node> {
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(el);
  });
  return (tree as unknown as { root: Node }).root;
}
const isInside = (n: Node, a: Node): boolean => {
  for (let p: Node | null = n.parent; p !== null; p = p.parent) if (p === a) return true;
  return false;
};
const buttons = (root: Node): Node[] =>
  root.findAll((n) => typeof n.type === "string" && n.props.accessibilityRole === "button");
const flex = (n: Node): number | undefined => (StyleSheet.flatten(n.props.style as object) as { flex?: number }).flex;

/** Buttons are pinned: none in the scroll body; each after it, in the bounded panel. */
function expectPinned(root: Node, buttonLabels: string[]): void {
  const panel = root.findAll((n) => typeof n.type === "string" && n.props.testID === "panel")[0] as Node;
  const panelHeight = (StyleSheet.flatten(panel.props.style as object) as { height: number }).height;
  expect(panelHeight).toBeLessThanOrEqual(SE.height - 20 - 24);
  const scroll = root.findAll((n) => n.type === ScrollView);
  const body = scroll[0] as Node;
  expect(flex(body)).toBe(1);
  for (const label of buttonLabels) {
    const b = buttons(root).find((n) => n.props.accessibilityLabel === label);
    expect({ label, found: b !== undefined }).toEqual({ label, found: true });
    expect({ label, inPanel: isInside(b as Node, panel) }).toEqual({ label, inPanel: true });
    expect({ label, inScroll: scroll.some((s) => isInside(b as Node, s)) }).toEqual({ label, inScroll: false });
  }
}

describe(`#4389 — the longest sheets at SE ${SE.width}×${SE.height}, text ×${SE.fontScale}`, () => {
  test("T1: H2 (three missing items): Later and Finish setup stay pinned", async () => {
    const root = await render(
      <HomeSetupPromptSheet
        visible
        brandName="A brand with a very long name for the largest text size"
        facts={{ market: false, terms: false, details: false }}
        onLater={() => undefined}
        onFinish={() => undefined}
      />,
    );
    expect(computeSheetHeight("half", SE.height)).toBeLessThan(SE.height);
    const labels = buttons(root).map((b) => String(b.props.accessibilityLabel));
    expect(labels.length).toBe(2);
    expectPinned(root, labels);
  });

  test("T2: the delete sheet's blocked step: Close stays pinned", async () => {
    mockSubmit = () => Promise.resolve({ rejected: true, reason: "delete_blocked", upcomingEventCount: 0, blockers: [{ code: "payment_account_balance" }, { code: "checkout_in_progress" }, { code: "partner_payment_in_progress" }] });
    const brand = { id: "b-del", displayName: "Delete Me", accountId: "u-1", role: "owner" } as unknown as Brand;
    const root = await render(<BrandDeleteSheet visible brand={brand} accountId="u-1" onClose={() => undefined} />);
    const pressLabel = async (label: string): Promise<void> => {
      const b = buttons(root).find((n) => n.props.accessibilityLabel === label) as Node;
      await TestRenderer.act(async () => {
        await (b.props.onPress as () => Promise<void> | void)();
      });
    };
    await pressLabel("Continue");
    expectPinned(root, ["Back", "Type to confirm"]);
    await pressLabel("Type to confirm");
    const input = root.findAll((n) => typeof n.type === "string" && n.props.accessibilityLabel === "Confirmation brand name")[0] as Node;
    await TestRenderer.act(async () => (input.props.onChangeText as (v: string) => void)("Delete Me"));
    expectPinned(root, ["Back", "Delete brand"]);
    await pressLabel("Delete brand");
    expectPinned(root, ["Close"]);
  });

  test("T3: the switcher with 15 brands: the list scrolls inside; Create a new brand is pinned", async () => {
    const root = await render(<BrandSwitcherSheet visible onClose={() => undefined} title="Talk to Ari about" />);
    const panel = root.findAll((n) => typeof n.type === "string" && n.props.testID === "panel")[0] as Node;
    expect((StyleSheet.flatten(panel.props.style as object) as { height: number }).height).toBeLessThanOrEqual(SE.height - 96);
    const list = root.findAll((n) => n.type === ScrollView)[0] as Node;
    expect(flex(list)).toBe(1);
    const rows = root.findAll((n) => typeof n.type === "string" && /^Switch to /.test(String(n.props.accessibilityLabel)));
    expect(rows).toHaveLength(15);
    for (const r of rows) expect(isInside(r, list)).toBe(true);
    const create = root.findAll((n) => typeof n.type === "string" && n.props.accessibilityLabel === "Create a new brand")[0] as Node;
    expect(isInside(create, panel)).toBe(true);
    expect(isInside(create, list)).toBe(false);
  });
});
