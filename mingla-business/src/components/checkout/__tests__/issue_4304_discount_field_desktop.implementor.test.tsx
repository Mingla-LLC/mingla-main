/**
 * #4304 — buyer-web checkout discount field: typing on desktop, the dark
 * collapsed / expanded / applied / error states, and the desktop two-column
 * order summary.
 *
 * Desktop typing root cause (reproduced 2026-11-07 in a 1440x900 browser on
 * the local business web build, /checkout/<eventId>): with nothing selected,
 * the field was rendered `editable={!disabled}` with `disabled = cart empty`,
 * so the live-looking input was `readOnly` and swallowed every keystroke.
 * `document.elementsFromPoint` at the input's centre returned the INPUT
 * itself (no overlay), and after one ticket was added the same input accepted
 * "save20" -> "SAVE20". Desktop buyers reach the cart from "Get tickets" with
 * an empty selection; the fix keeps the field typeable and gates only Apply.
 */
import React from "react";
import { Pressable, Text, TextInput } from "react-native";
import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";

import { DiscountCodeField } from "../DiscountCodeField";

interface RenderNode {
  props: Record<string, unknown> & {
    accessibilityLabel?: string;
    testID?: string;
    editable?: boolean;
    disabled?: boolean;
    style?: unknown;
    onChangeText?: (value: string) => void;
    onPress?: () => void;
  };
  children?: unknown[];
}
interface RenderTree {
  root: {
    findByType: (type: unknown) => RenderNode;
    findAllByType: (type: unknown) => RenderNode[];
    findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
  };
  toJSON: () => unknown;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
const act = TestRenderer.act;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("../../../analytics/discountAnalytics", () => ({
  captureDiscountEvent: jest.fn(),
}));

let mockWide = false;
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({
    isWideDesktop: mockWide,
    isWeb: true,
    width: mockWide ? 1440 : 390,
  }),
}));

const quote: TicketQuote = {
  kind: "quote",
  currency: "USD",
  lines: [
    {
      ticketTypeId: "tt-1",
      ticketName: "General",
      quantity: 2,
      listUnitCents: 2500,
      netUnitCents: 2000,
      lineListCents: 5000,
      lineNetCents: 4000,
      discountCents: 1000,
      discounts: [],
    },
  ],
  listSubtotalCents: 5000,
  discountCents: 1000,
  netSubtotalCents: 4000,
  dueTodayNetCents: 4000,
  dueTodayListCents: 5000,
  installmentSchedule: null,
  discounts: [
    {
      discountId: "discount-1",
      kind: "code",
      name: "Save ten",
      code: "SAVE10",
      amountMinor: 1000,
      units: 1,
    },
  ],
  codeOutcome: {
    status: "applied",
    reason: null,
    required: null,
    with: null,
    replaced: [],
  },
  notices: [],
  quoteDigest: "discounted-digest",
  quoteListDigest: "list-digest",
  feesCents: 0,
  taxCents: 0,
  buyerTotalCents: 4000,
  calculationId: "calc-1",
  subtotalCents: 4000,
  totalCents: 4000,
};

let mockCart: {
  lines: Array<{ ticketTypeId: string; ticketName: string; quantity: number; currency: string }>;
  quote: TicketQuote | null;
} = { lines: [], quote: null };
jest.mock("../CartContext", () => ({
  useCart: () => mockCart,
}));

const byLabel = (tree: RenderTree, label: string): RenderNode | undefined =>
  tree.root
    .findAllByType(Pressable)
    .find((node) => node.props.accessibilityLabel === label);

const flatStyle = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.filter(Boolean).map(flatStyle))
    : ((style as Record<string, unknown>) ?? {});

const textOf = (tree: RenderTree): string => JSON.stringify(tree.toJSON());

async function mount(element: React.ReactElement): Promise<RenderTree> {
  let tree!: RenderTree;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

describe("#4304 desktop typing regression", () => {
  test("an empty cart leaves the field typeable and only gates Apply", async () => {
    const onApply = jest.fn();
    const tree = await mount(
      <DiscountCodeField
        value={null}
        quote={null}
        quoteStatus="idle"
        disabled
        onApply={onApply}
        onRemove={jest.fn()}
      />,
    );
    const input = tree.root.findByType(TextInput);
    // The shipped bug: editable was false here, so a desktop click typed nothing.
    expect(input.props.editable).toBe(true);
    await act(async () => {
      input.props.onChangeText!("wythe-20");
    });
    expect(tree.root.findByType(TextInput).props.value).toBe("WYTHE-20");
    const apply = byLabel(tree, "Apply discount code")!;
    expect(apply.props.disabled).toBe(true);
    expect(textOf(tree)).toContain("then apply your code");
    expect(onApply).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test("the field is only read-only while a code is being applied", async () => {
    const tree = await mount(
      <DiscountCodeField
        value="SAVE10"
        quote={null}
        quoteStatus="loading"
        onApply={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    expect(tree.root.findByType(TextInput).props.editable).toBe(false);
    expect(textOf(tree)).toContain('"Applying ","SAVE10"');
    await act(async () => tree.unmount());
  });

  test("Apply works while the price for a just-added ticket is still loading", async () => {
    // Smoke test 2026-11-07: code typed before choosing a ticket, then the
    // first Apply after adding the ticket was swallowed by the price refresh.
    const onApply = jest.fn();
    const tree = await mount(
      <DiscountCodeField
        value={null}
        quote={null}
        quoteStatus="loading"
        onApply={onApply}
        onRemove={jest.fn()}
      />,
    );
    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText!("wythe20");
    });
    const apply = byLabel(tree, "Apply discount code")!;
    expect(apply.props.disabled).toBe(false);
    await act(async () => {
      apply.props.onPress!();
    });
    expect(onApply).toHaveBeenCalledWith("WYTHE20");
    await act(async () => tree.unmount());
  });
});

describe("#4304 dark discount field states", () => {
  test("collapsed: one quiet 'Have a code?' row that expands into the field", async () => {
    const tree = await mount(
      <DiscountCodeField
        value={null}
        quote={null}
        quoteStatus="idle"
        collapsible
        onApply={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
    expect(textOf(tree)).toContain("Have a code?");
    const toggle = byLabel(tree, "Add discount code")!;
    expect(toggle.props.testID).toBe("discount-code-toggle");
    await act(async () => {
      toggle.props.onPress!();
    });
    // Expanded: the field, dark (no hard-coded white anywhere).
    const input = tree.root.findByType(TextInput);
    expect(input.props.accessibilityLabel).toBe("Discount code");
    expect(flatStyle(input.props.style).backgroundColor).toBe("#1a1e24");
    // No white surface anywhere in the field (white text on orange is fine).
    expect(textOf(tree).toLowerCase()).not.toMatch(
      /"backgroundcolor":"(#fff(fff)?|white)"/,
    );
    await act(async () => tree.unmount());
  });

  test("a code already in the cart opens the field even when collapsible", async () => {
    const tree = await mount(
      <DiscountCodeField
        value="NOPE"
        quote={{
          ...quote,
          discounts: [],
          codeOutcome: {
            status: "rejected",
            reason: "not_found",
            required: null,
            with: null,
            replaced: [],
          },
        }}
        quoteStatus="ready"
        collapsible
        onApply={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
    expect(textOf(tree)).not.toContain("Have a code?");
    await act(async () => tree.unmount());
  });

  test("applied: a green chip with the saving and Remove, replacing the input", async () => {
    const onRemove = jest.fn();
    const tree = await mount(
      <DiscountCodeField
        value="SAVE10"
        quote={quote}
        quoteStatus="ready"
        collapsible
        onApply={jest.fn()}
        onRemove={onRemove}
      />,
    );
    const chip = tree.root.findAll(
      (node) => node.props.testID === "discount-code-applied",
    )[0];
    expect(chip).toBeDefined();
    expect(textOf(tree)).toContain("Saving");
    expect(textOf(tree)).toContain("$10.00");
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
    await act(async () => {
      byLabel(tree, "Remove SAVE10")!.props.onPress!();
    });
    expect(onRemove).toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test("error: the retry copy stays", async () => {
    const tree = await mount(
      <DiscountCodeField
        value="SAVE10"
        quote={null}
        quoteStatus="error"
        quoteErrorCode="quote_failed"
        onApply={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    expect(textOf(tree)).toContain("Couldn't get your price");
    await act(async () => tree.unmount());
  });
});

describe("#4304 desktop order summary", () => {
  // Imported lazily so the CartContext / layout mocks above apply.
  const load = () =>
    require("../CheckoutOrderSummary") as typeof import("../CheckoutOrderSummary");

  test("wide: a static right-hand summary with lines and the struck old subtotal", async () => {
    mockWide = true;
    mockCart = {
      lines: [{ ticketTypeId: "tt-1", ticketName: "General", quantity: 2, currency: "USD" }],
      quote,
    };
    const { CheckoutColumns, CheckoutOrderSummary } = load();
    const tree = await mount(
      <CheckoutColumns wide>
        <CheckoutOrderSummary wide bottomInset={34}>
          <Text>Continue</Text>
        </CheckoutOrderSummary>
      </CheckoutColumns>,
    );
    const summary = tree.root.findAll(
      (node) => node.props.testID === "checkout-order-summary",
    )[0];
    expect(summary).toBeDefined();
    // Not a floating overlay.
    expect(flatStyle(summary.props.style).position).toBeUndefined();
    const json = textOf(tree);
    expect(json).toContain("Order summary");
    expect(json).toContain("General");
    expect(json).toContain("$50.00");
    expect(json).toContain("$40.00");
    const old = tree.root.findAll(
      (node) => node.props.testID === "checkout-summary-old-subtotal",
    )[0];
    expect(flatStyle(old.props.style).textDecorationLine).toBe("line-through");
    expect(
      tree.root.findAll((node) => node.props.testID === "checkout-columns-wide"),
    ).not.toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test("narrow: the sticky bottom bar, unchanged in position", async () => {
    mockWide = false;
    mockCart = { lines: [], quote: null };
    const { CheckoutOrderSummary } = load();
    const tree = await mount(
      <CheckoutOrderSummary wide={false} bottomInset={34}>
        <Text>Continue</Text>
      </CheckoutOrderSummary>,
    );
    const bar = tree.root.findAll(
      (node) => node.props.testID === "checkout-bottom-bar",
    )[0];
    const style = flatStyle(bar.props.style);
    expect(style.position).toBe("absolute");
    expect(style.paddingBottom).toBe(50);
    expect(textOf(tree)).not.toContain("Order summary");
    await act(async () => tree.unmount());
  });

  test("every buyer-web funnel uses the summary and the collapsible field", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    for (const route of [
      "checkout/[eventId]/index.tsx",
      "checkout-experience/[experienceEventId]/index.tsx",
      "checkout-trip/[tripEventId]/index.tsx",
    ]) {
      const source = fs.readFileSync(
        path.join(__dirname, "../../../../app", route),
        "utf8",
      );
      expect(source).toContain("<CheckoutOrderSummary wide={wide}");
      expect(source).toContain("collapsible={!wide}");
      expect(source).not.toMatch(/styles\.bottomBar/);
    }
  });
});
