// MINGLA-INVARIANT: I-4624-26 | issue #4624 | A venue order line a ticket-capped code cannot cover (fewer left on the code than the line holds) shows the server's code-limit notice on that line, in the shared item copy, instead of silently keeping full price; buyer web and the Explorer app render the same pane.
/**
 * #4624 follow-up 3 — the venue order review pane (buyer web and the Explorer
 * app render the same shared pane) shows the code-limit notice on the line a
 * ticket-capped code could not cover. Before this the pane read only the
 * free-order tip notice, so the line kept full price with no word why.
 *
 * FAILS-ON-REVERT: drop the codeLimitedByLineNo block from
 * VenueOrderReviewPane.tsx and the notice assertions fail.
 */
import React from "react";

import { VenueOrderReviewPane } from "../../../../../packages/brand-rendering/venueOrdering/VenueOrderReviewPane";
import type {
  VenueOrderPreview,
  VenueOrderingConfig,
} from "../../../../../packages/brand-rendering/venueOrdering/venueOrderingTypes";

interface RenderNode {
  type?: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const palette = {
  page: "#fff",
  accent: "#123456",
  accentText: "#fff",
  primaryText: "#111",
  secondaryText: "#222",
  tertiaryText: "#666",
  panel: "#fff",
  panelStrong: "#fff",
  panelBorder: "#ddd",
  card: "#fff",
  cutoutBorder: "#ddd",
  glass: "#fff",
  glassTint: "light" as const,
  accentWash: "#eee",
};

const surface = {
  page: {},
  pageContent: {},
  hero: {},
  heroMedia: {},
  heroOverlay: {},
  glassPanel: {},
  card: {},
  chip: {},
  primaryButton: {},
  primaryButtonText: {},
  secondaryButton: {},
  secondaryButtonText: {},
  input: {},
  divider: {},
};

const config: VenueOrderingConfig = {
  state: "on",
  venueId: "11111111-1111-4111-8111-111111111111",
  venueName: "The Brasserie",
  spotState: "ok",
  spot: { label: "Table 12", kind: "table", servingMenuId: null },
  serviceChargeBps: 1250,
  serviceChargeLabel: "House service",
  tipsEnabled: true,
  tipPresetsBps: [1000],
  counterPickupEnabled: true,
  prepTimeMinutes: 20,
};

const basePreview: VenueOrderPreview = {
  currency: "GBP",
  listSubtotalCents: 2000,
  discountCents: 0,
  subtotalCents: 2000,
  serviceChargeCents: 250,
  serviceChargeLabel: "House service",
  feesAndTaxCents: 120,
  tipCents: 200,
  totalCents: 2570,
  discounts: [],
  codeOutcome: {
    supplied: false,
    applied: false,
    reason: null,
    discountId: null,
  },
  notices: [],
  quoteDigest: null,
  lines: [{
    lineNo: 1,
    menuItemId: "22222222-2222-4222-8222-222222222222",
    itemNameAtOrder: "Negroni",
    unitPriceCents: 1000,
    currency: "GBP",
    quantity: 2,
    modifiersTotalCents: 0,
    lineTotalCents: 2000,
    discountCents: 0,
    netLineTotalCents: 2000,
    discounts: [],
    notes: null,
  }],
  tipsEnabled: true,
  counterPickupEnabled: true,
};



const codeNotice = (lineRef: string, remaining: number) => ({
  type: "sale_limited",
  discountId: "33333333-3333-4333-8333-333333333333",
  lineRef,
  remaining,
  discountKind: "code",
});

const twoLines: VenueOrderPreview["lines"] = [
  { ...basePreview.lines[0]!, lineNo: 1, itemNameAtOrder: "Negroni", quantity: 4 },
  {
    ...basePreview.lines[0]!,
    lineNo: 2,
    menuItemId: "44444444-4444-4444-8444-444444444444",
    itemNameAtOrder: "Jollof rice",
    quantity: 1,
  },
];

const cartFor = (lines: VenueOrderPreview["lines"]) =>
  lines.map((line) => ({
    key: `line-${line.lineNo}`,
    menuItemId: line.menuItemId,
    itemName: line.itemNameAtOrder,
    quantity: line.quantity,
    modifierIds: [],
    modifierNames: [],
    notes: null,
  }));

const renderPane = async (
  preview: VenueOrderPreview,
  previewStatus: "loading" | "ready" = "ready",
): Promise<RenderTree> => {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <VenueOrderReviewPane
        palette={palette}
        surface={surface as never}
        config={config}
        cart={cartFor(preview.lines)}
        notesAllowedByItemId={{}}
        preview={preview}
        previewStatus={previewStatus}
        previewError={null}
        discountCode="TOPZY"
        tip={{ bps: 1000, flatCents: null }}
        tipRemembered
        onTipChange={jest.fn()}
        partySize={2}
        askPartySize={false}
        onPartySizeChange={jest.fn()}
        buyer={{ name: "Ada", email: "ada@example.com", phone: "+447700900000" }}
        onBuyerChange={jest.fn()}
        onSetQuantity={jest.fn()}
        onSetNotes={jest.fn()}
        submitting={false}
        submitError={null}
        onSubmit={jest.fn()}
        onBack={jest.fn()}
      />,
    );
  });
  return tree!;
};

const notices = (tree: RenderTree): Array<{ testID: string; text: string }> =>
  tree.root
    .findAll(
      (node) =>
        typeof node.props.testID === "string" &&
        String(node.props.testID).startsWith("venue-order-code-limited-") &&
        node.props.accessibilityRole === "alert",
    )
    .filter((node, index, all) => all.findIndex((other) => other.props.testID === node.props.testID) === index)
    .map((node) => ({
      testID: String(node.props.testID),
      text: [node.props.children].flat().join(""),
    }));

describe("#4624 follow-up 3 — venue order code-limit notice", () => {
  test("a single line with more items than the code has left says so", async () => {
    const tree = await renderPane({
      ...basePreview,
      lines: [{ ...basePreview.lines[0]!, quantity: 4 }],
      notices: [codeNotice("001", 3)],
    });
    expect(notices(tree)).toEqual([
      {
        testID: "venue-order-code-limited-001",
        text: "Only 3 left on this code. Lower the number to use it.",
      },
    ]);
  });

  test("two lines name the item to lower; singular and none-left forms", async () => {
    const tree = await renderPane({
      ...basePreview,
      lines: twoLines,
      notices: [codeNotice("001", 1), codeNotice("002", 0)],
    });
    expect(notices(tree)).toEqual([
      {
        testID: "venue-order-code-limited-001",
        text: "Only 1 left on this code. Lower Negroni to 1 to use it.",
      },
      {
        testID: "venue-order-code-limited-002",
        text: "Nothing left on this code for the rest of your order.",
      },
    ]);
  });

  test("sale notices, the tip notice and an unpriced order show no code notice", async () => {
    const saleOnly = await renderPane({
      ...basePreview,
      notices: [
        { type: "sale_limited", discountId: "x", lineRef: "001", remaining: 1 },
        { type: "tip_dropped_free_order" },
      ],
    });
    expect(notices(saleOnly)).toEqual([]);
    const loading = await renderPane(
      { ...basePreview, notices: [codeNotice("001", 1)] },
      "loading",
    );
    expect(notices(loading)).toEqual([]);
  });
});
