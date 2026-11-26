// MINGLA-INVARIANT: INV-4624-1 | issue #4624 | The "Specific offerings" picker writes only whole-offering event targets; tickets are never expanded into ticket_type targets.
/* eslint-disable import/first */
/**
 * #4624 — the REAL DiscountScopePicker, mounted with react-test-renderer under
 * the default node config (react-native → __manual_mocks__/react-native.js).
 * Boundaries mocked: expo-haptics and ui/Button (a probe that keeps its props).
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
interface Rendered {
  root: TestInstance;
  update: (node: React.ReactElement) => void;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Rendered;
  act: (fn: () => void) => void;
};

jest.mock("expo-haptics", () => ({ selectionAsync: () => Promise.resolve() }));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    require("react").createElement("ButtonProbe", props),
}));

import { DiscountScopePicker } from "../DiscountScopePicker";
import type {
  DiscountKind,
  DiscountOfferingRow,
  DiscountScopeKind,
  DiscountTarget,
} from "../../../services/discountService";
import type { DiscountOfferingsStatus } from "../DiscountScopePicker";

const offering = (
  id: string,
  offeringKind: DiscountOfferingRow["offeringKind"],
  title: string,
  extra: Partial<DiscountOfferingRow> = {},
): DiscountOfferingRow => ({
  id,
  offeringKind,
  title,
  status: "scheduled",
  discountsAllowed: true,
  paidTicketCount: 2,
  nextStartAt: "2026-12-12T19:00:00.000Z",
  lastEndAt: "2026-12-12T23:00:00.000Z",
  ...extra,
});

const OFFERINGS: DiscountOfferingRow[] = [
  offering("e1", "event", "Rooftop Night"),
  offering("e4", "event", "Jazz Brunch", { discountsAllowed: false }),
  offering("e0", "event", "Harvest Supper", { status: "ended" }),
  offering("x1", "experience", "Pottery Workshop", { paidTicketCount: 1 }),
  offering("t1", "trip", "Coastal Weekend", { paidTicketCount: 0 }),
];

interface Harness {
  tree: Rendered;
  onTargetsChange: jest.Mock<(value: DiscountTarget[]) => void>;
  onScopeKindChange: jest.Mock<(value: DiscountScopeKind) => void>;
  onRetry: jest.Mock<() => void>;
  rerender: (targets: DiscountTarget[]) => void;
}

const mount = (opts: {
  targets?: DiscountTarget[];
  offerings?: DiscountOfferingRow[];
  status?: DiscountOfferingsStatus;
  kind?: DiscountKind;
  scope?: DiscountScopeKind;
}): Harness => {
  const onTargetsChange = jest.fn<(value: DiscountTarget[]) => void>();
  const onScopeKindChange = jest.fn<(value: DiscountScopeKind) => void>();
  const onRetry = jest.fn<() => void>();
  const element = (targets: DiscountTarget[]): React.ReactElement => (
    <DiscountScopePicker
      scopeKind={opts.scope ?? "listings"}
      targets={targets}
      prices={[]}
      currencyCode="USD"
      discountKind={opts.kind ?? "code"}
      offerings={opts.offerings ?? OFFERINGS}
      offeringsStatus={opts.status ?? "ready"}
      onRetryOfferings={onRetry}
      onScopeKindChange={onScopeKindChange}
      onTargetsChange={onTargetsChange}
    />
  );
  let tree!: Rendered;
  TestRenderer.act(() => {
    tree = TestRenderer.create(element(opts.targets ?? []));
  });
  return {
    tree,
    onTargetsChange,
    onScopeKindChange,
    onRetry,
    rerender: (targets) =>
      TestRenderer.act(() => {
        tree.update(element(targets));
      }),
  };
};

const byTestId = (tree: Rendered, id: string): TestInstance[] =>
  tree.root.findAll((node) => node.props.testID === id && typeof node.type === "string");
const one = (tree: Rendered, id: string): TestInstance => {
  const found = byTestId(tree, id);
  expect(found).toHaveLength(1);
  return found[0] as TestInstance;
};
const textOf = (node: TestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const allText = (tree: Rendered): string[] =>
  tree.root
    .findAll((node) => node.type === "Text" || node.type === "Animated.Text")
    .map(textOf);
const press = (node: TestInstance): void =>
  TestRenderer.act(() => {
    (node.props.onPress as () => void)();
  });
const eventTarget = (id: string, orphanedAt: string | null = null): DiscountTarget => ({
  targetKind: "event",
  targetId: id,
  listingKind: null,
  orphanedAt,
});

describe("#4624 Specific offerings picker", () => {
  test("offers Specific offerings as the third of four scope cards", () => {
    const { tree, onScopeKindChange } = mount({ scope: "brand" });
    const cards = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.testID === "string" &&
        (node.props.testID as string).startsWith("discount-scope-"),
    );
    expect(cards.map((card) => card.props.testID)).toEqual([
      "discount-scope-brand",
      "discount-scope-listing_kinds",
      "discount-scope-listings",
      "discount-scope-items",
    ]);
    const listings = one(tree, "discount-scope-listings");
    expect(listings.props.accessibilityLabel).toBe("Specific offerings");
    expect(listings.props.accessibilityHint).toBe("Whole events, experiences or trips");
    press(listings);
    expect(onScopeKindChange).toHaveBeenCalledWith("listings");
  });

  test("groups rows under Events, Experiences, Trips and hides ended offerings nobody picked", () => {
    const { tree } = mount({});
    const text = allText(tree);
    const groups = text.filter((t) => ["Events", "Experiences", "Trips"].includes(t));
    expect(groups).toEqual(["Events", "Experiences", "Trips"]);
    expect(text).toContain("Rooftop Night");
    expect(text).not.toContain("Harvest Supper");
    expect(text).toContain("Sat 12 Dec · 2 paid tickets");
    expect(text).toContain("Sat 12 Dec · 1 paid ticket");
    expect(text).toContain("Sat 12 Dec · No paid tickets yet");
    expect(text).toContain(
      "New tickets added to these offerings are included. Items with Allow discounts turned off are still excluded.",
    );
    expect(textOf(one(tree, "discount-offerings-count"))).toBe("None selected");
    const row = one(tree, "discount-offering-x1");
    expect(row.props.accessibilityRole).toBe("checkbox");
    expect(row.props.accessibilityLabel).toBe("Pottery Workshop, experience");
  });

  test("ticking a row writes one whole-offering event target, never ticket targets", () => {
    const { tree, onTargetsChange, rerender } = mount({});
    press(one(tree, "discount-offering-e1"));
    expect(onTargetsChange).toHaveBeenLastCalledWith([
      { targetKind: "event", targetId: "e1", listingKind: null },
    ]);
    rerender([eventTarget("e1")]);
    expect(textOf(one(tree, "discount-offerings-count"))).toBe("1 selected");
    expect(one(tree, "discount-offering-e1").props.accessibilityState).toEqual({
      checked: true,
      disabled: false,
    });
    press(one(tree, "discount-offering-e1"));
    expect(onTargetsChange).toHaveBeenLastCalledWith([]);
  });

  test("an offering with discounts off cannot be ticked, but an already-ticked one can be unticked", () => {
    const { tree, onTargetsChange, rerender } = mount({});
    const off = one(tree, "discount-offering-e4");
    expect(off.props.disabled).toBe(true);
    expect(off.props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(allText(tree)).toContain("Discounts are off for this offering");
    press(off);
    expect(onTargetsChange).not.toHaveBeenCalled();

    rerender([eventTarget("e4")]);
    const ticked = one(tree, "discount-offering-e4");
    expect(ticked.props.disabled).toBe(false);
    press(ticked);
    expect(onTargetsChange).toHaveBeenLastCalledWith([]);
  });

  test("an ended offering that is a target leads its group and stays visible after an untick", () => {
    const { tree, onTargetsChange, rerender } = mount({ targets: [eventTarget("e0")] });
    const text = allText(tree);
    expect(text.indexOf("Harvest Supper")).toBeLessThan(text.indexOf("Rooftop Night"));
    expect(text).toContain("Ended · Sat 12 Dec");
    press(one(tree, "discount-offering-e0"));
    expect(onTargetsChange).toHaveBeenLastCalledWith([]);
    rerender([]);
    expect(allText(tree)).toContain("Harvest Supper");
  });

  test("a cancelled offering reads Cancelled · {date} (D6)", () => {
    const { tree } = mount({
      offerings: [offering("c1", "event", "Called Off", { status: "cancelled" })],
      targets: [eventTarget("c1")],
    });
    expect(allText(tree)).toContain("Cancelled · Sat 12 Dec");
  });

  test("a deleted offering shows Remove, and Remove drops only that target", () => {
    const { tree, onTargetsChange } = mount({
      targets: [eventTarget("gone", "2026-11-20T00:00:00.000Z"), eventTarget("x1")],
    });
    const text = allText(tree);
    expect(text).toContain("Deleted offering");
    expect(text).toContain("This offering was deleted. Remove it to save.");
    expect(text).toContain("Deleted item — remove it before saving.");
    const remove = one(tree, "discount-offering-remove-gone");
    expect(remove.props.label).toBe("Remove");
    expect(remove.props.accessibilityLabel).toBe("Remove deleted offering");
    press(remove);
    expect(onTargetsChange).toHaveBeenLastCalledWith([eventTarget("x1")]);
  });

  test("empty, loading and error states", () => {
    const empty = mount({ offerings: [] });
    expect(allText(empty.tree)).toContain("No events, experiences or trips yet.");

    const loading = mount({ status: "loading" });
    const skeleton = one(loading.tree, "discount-offerings-loading");
    expect(skeleton.props.accessibilityRole).toBe("progressbar");
    expect(skeleton.props.accessibilityLabel).toBe("Loading offerings");

    const failed = mount({ status: "error" });
    expect(allText(failed.tree)).toContain("Couldn’t load your offerings.");
    const retry = one(failed.tree, "discount-offerings-retry");
    expect(retry.props.label).toBe("Retry");
    press(retry);
    expect(failed.onRetry).toHaveBeenCalledTimes(1);
  });

  test("a sale price disables every scope card but Specific items (D5)", () => {
    const { tree, onScopeKindChange } = mount({ kind: "sale_price", scope: "items" });
    for (const scope of ["brand", "listing_kinds", "listings"]) {
      const card = one(tree, `discount-scope-${scope}`);
      expect(card.props.disabled).toBe(true);
      expect(card.props.accessibilityState).toEqual({ checked: false, disabled: true });
      expect(card.props.accessibilityHint).toBe("Sale prices apply to specific items only.");
    }
    expect(one(tree, "discount-scope-items").props.disabled).toBe(false);
    expect(allText(tree)).toContain("Sale prices apply to specific items only.");
    expect(onScopeKindChange).not.toHaveBeenCalled();
  });
  test("web: scope cards and offering rows expose aria-checked (P2-2)", () => {
    const { tree } = mount({ targets: [eventTarget("e1")] });
    expect(one(tree, "discount-scope-listings").props["aria-checked"]).toBe(true);
    expect(one(tree, "discount-scope-brand").props["aria-checked"]).toBe(false);
    expect(one(tree, "discount-offering-e1").props["aria-checked"]).toBe(true);
    expect(one(tree, "discount-offering-x1").props["aria-checked"]).toBe(false);
  });

  test("web: item cards and offering-type chips expose aria-checked (P2-2)", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "DiscountScopePicker.tsx"),
      "utf8",
    ) as string;
    expect(src.match(/aria-checked=\{isSelected\}/g)?.length).toBe(4);
  });

  test("the Remove button gets a 44 pt target without changing its size (P3-1)", () => {
    const { tree } = mount({ targets: [eventTarget("gone", "2026-12-01T00:00:00Z")] });
    const remove = one(tree, "discount-offering-remove-gone");
    expect(remove.props.size).toBe("sm");
    const slop = remove.props.hitSlop as Record<string, number>;
    expect(36 + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
    expect(36 + slop.left + slop.right).toBeGreaterThanOrEqual(44);
  });
});
