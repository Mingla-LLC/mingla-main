/**
 * issue #4420 D-V2 / §2.1.7 — the venue basket bar and the order review sheet.
 *
 *   B-1 the bar's copy: an empty basket says ordering is open with no button;
 *       a basket names its count, the spot and "pay on your phone"; a total
 *       appears ONLY once the server priced the basket (#1793 money rule);
 *   B-2 the review pane hands its body and its Pay button to a host layout
 *       (buyer web pins Pay in the sheet footer), and the button is the same
 *       money-gated control either way: one Pay, same label, same gate;
 *   B-3 without a layout the pane is the single column it always was.
 *
 * Fails-on-revert: a guessed running total, a button on an empty basket, a
 * second Pay button, or a layout that loses the gate fails here.
 */
import React from "react";

import { venueOrderingBarCopy } from "../../../../../packages/brand-rendering/venueOrdering/VenueOrderingStickyBar";
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

const preview: VenueOrderPreview = {
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


const renderPane = async (
  previewStatus: "loading" | "ready",
  layout?: (body: React.ReactNode, pay: React.ReactNode) => React.ReactNode,
): Promise<RenderTree> => {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <VenueOrderReviewPane
        palette={palette}
        surface={surface as never}
        config={config}
        cart={[{
          key: "line-1",
          menuItemId: "22222222-2222-4222-8222-222222222222",
          itemName: "Negroni",
          quantity: 2,
          modifierIds: [],
          modifierNames: [],
          notes: null,
        }]}
        notesAllowedByItemId={{}}
        preview={preview}
        previewStatus={previewStatus}
        previewError={null}
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
        layout={layout}
      />,
    );
  });
  return tree!;
};

const payButtons = (tree: RenderTree): RenderNode[] =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "button" &&
      typeof node.props.accessibilityLabel === "string" &&
      String(node.props.accessibilityLabel).startsWith("Pay"),
  );

describe("issue #4420 — venue basket bar and review sheet", () => {
  test("B-1 the bar never guesses a total and says where the order is paid", () => {
    // TEST-MOD-APPROVED #4490 (fix round 2, N91): with no table the bar and the chip say the same thing.
    expect(venueOrderingBarCopy({ count: 0, totalCents: null, currency: null })).toEqual({
      title: "Order here, collect at the counter",
      subtitle: "Add something to start",
      ctaLabel: null,
      spoken: null,
    });
    const unpriced = venueOrderingBarCopy({
      count: 2,
      totalCents: null,
      currency: "GBP",
      spotLabel: "Table 12",
    });
    expect(unpriced.title).toBe("2 items");
    expect(unpriced.subtitle).toBe("Table 12 · pay on your phone");
    expect(unpriced.ctaLabel).toBe("View order");
    const priced = venueOrderingBarCopy({ count: 1, totalCents: 2570, currency: "GBP" });
    expect(priced.title).toMatch(/^1 item · £25\.70$/);
    expect(priced.subtitle).toBe("Pay on your phone");
  });

  test("B-2 a host layout gets the body and the one money-gated Pay button", async () => {
    const seen: { body: number; pay: number } = { body: 0, pay: 0 };
    const tree = await renderPane("ready", (body, pay) => {
      seen.body += body === null ? 0 : 1;
      seen.pay += pay === null ? 0 : 1;
      return (
        <>
          {React.createElement("SheetBody", null, body)}
          {React.createElement("SheetFooter", null, pay)}
        </>
      );
    });
    expect(seen).toEqual({ body: 1, pay: 1 });
    const footer = tree.root.findAll((n) => n.type === "SheetFooter")[0];
    expect(footer).toBeDefined();
    const pays = payButtons(tree);
    expect(pays).toHaveLength(1);
    expect(pays[0]?.props).toMatchObject({ accessibilityLabel: "Pay £25.70", disabled: false });
    // The one Pay button sits in the footer, not the scrolling body.
    const inFooter = footer?.findAll((n) => n === pays[0]) ?? [];
    expect(inFooter).toHaveLength(1);

    const waiting = await renderPane("loading", (body, pay) => (
      <>
        {body}
        {pay}
      </>
    ));
    expect(payButtons(waiting)[0]?.props).toMatchObject({
      accessibilityLabel: "Pay — waiting for the total",
      disabled: true,
    });
  });

  test("B-3 without a layout the pane is one column with one Pay", async () => {
    const tree = await renderPane("ready");
    expect(payButtons(tree)).toHaveLength(1);
  });
});
