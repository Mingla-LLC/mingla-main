/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4624 follow-up 3 — the Explorer venue order review (ConsumerVenueOrderingSlots
 * raises the shared VenueOrderReviewPane with the preview parsed by
 * parseVenueOrderPreview). A server preview whose code notice says the code
 * has fewer items left than a line holds now shows that notice on the line
 * instead of silently keeping full price. Runs under
 * app-mobile/jest.issue2774.render.cjs (react-native-web).
 *
 * FAILS-ON-REVERT: drop the codeLimitedByLineNo block from
 * packages/brand-rendering/venueOrdering/VenueOrderReviewPane.tsx and the
 * notice is missing.
 */
import React from "react";
import { VenueOrderReviewPane } from "../../../../../packages/brand-rendering/venueOrdering/VenueOrderReviewPane";
import { parseVenueOrderPreview } from "../../../../../packages/brand-rendering/venueOrdering/venueOrderingWire";
import type { VenueOrderingConfig } from "../../../../../packages/brand-rendering/venueOrdering/venueOrderingTypes";
import {
  itemCodeLimitedCopy,
  venueCodeLimitedNotices,
} from "@mingla/offering-rendering/venueCodeLimitedCopy";

interface RenderNode {
  type?: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
}
const TestRenderer =
  require("react-test-renderer") as {
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


// The Explorer raises the pane in a bottom sheet and passes the sheet's own
// input; a plain host element stands in for it here (no DOM in this lane).
const SheetInput = (props: Record<string, unknown>): React.ReactElement =>
  React.createElement("SheetTextInput", props);

// The venue-order-create preview as the server sends it (one line of 4, a
// code with 3 left).
const wire = {
  currency: "GBP",
  listSubtotalCents: 4000,
  discountCents: 0,
  subtotalCents: 4000,
  serviceChargeCents: 0,
  serviceChargeLabel: "Service",
  feesAndTaxCents: 200,
  tipCents: 0,
  totalCents: 4200,
  discounts: [],
  codeOutcome: { supplied: true, applied: true, reason: null, discountId: null },
  notices: [{
    type: "sale_limited",
    discountId: "33333333-3333-4333-8333-333333333333",
    lineRef: "001",
    remaining: 3,
    discountKind: "code",
  }],
  quoteDigest: "digest",
  tipsEnabled: false,
  counterPickupEnabled: false,
  lines: [{
    lineNo: 1,
    menuItemId: "22222222-2222-4222-8222-222222222222",
    itemNameAtOrder: "Suya plate",
    unitPriceCents: 1000,
    currency: "GBP",
    quantity: 4,
    modifiersTotalCents: 0,
    lineTotalCents: 4000,
    discountCents: 0,
    netLineTotalCents: 4000,
    discounts: [],
    notes: null,
  }],
};

describe("#4624 follow-up 3 — Explorer venue order code-limit notice", () => {
  test("the parsed server preview shows the notice on the line", async () => {
    const preview = parseVenueOrderPreview(wire);
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <VenueOrderReviewPane
          palette={palette}
          surface={surface as never}
          config={{ ...config, tipsEnabled: false }}
          cart={[{
            key: "line-1",
            menuItemId: "22222222-2222-4222-8222-222222222222",
            itemName: "Suya plate",
            quantity: 4,
            modifierIds: [],
            modifierNames: [],
            notes: null,
          }]}
          notesAllowedByItemId={{}}
          preview={preview}
          previewStatus="ready"
          previewError={null}
          discountCode="TOPZY"
          tip={{ bps: 0, flatCents: null }}
          tipRemembered={false}
          onTipChange={jest.fn()}
          partySize={null}
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
          TextInputComponent={SheetInput as never}
        />,
      );
    });
    const found = (tree as unknown as RenderTree).root.findAll(
      (node) =>
        node.props.testID === "venue-order-code-limited-001" &&
        node.props.accessibilityRole === "alert",
    );
    expect(found.length).toBeGreaterThan(0);
    expect([found[0]?.props.children].flat().join("")).toBe(
      "Only 3 left on this code. Lower the number to use it.",
    );
  });

  test("the shared item copy covers every case", () => {
    expect(itemCodeLimitedCopy({ remaining: 0 })).toBe(
      "Nothing left on this code for the rest of your order.",
    );
    expect(itemCodeLimitedCopy({ remaining: 1 })).toBe(
      "Only 1 left on this code. Lower the number to use it.",
    );
    expect(itemCodeLimitedCopy({ remaining: 2, itemName: "Jollof", lowerTo: 2, multiLine: true }))
      .toBe("Only 2 left on this code. Lower Jollof to 2 to use it.");
    expect(itemCodeLimitedCopy({ remaining: 2, itemName: "Jollof", lowerTo: 2, multiLine: false }))
      .toBe("Only 2 left on this code. Lower the number to use it.");
  });

  test("the notice model reads only code notices and never names an item twice in the order", () => {
    const models = venueCodeLimitedNotices({
      lines: [
        { lineNo: 1, itemNameAtOrder: "Jollof", quantity: 3 },
        { lineNo: 2, itemNameAtOrder: "Jollof", quantity: 2 },
        { lineNo: 3, itemNameAtOrder: "Chapman", quantity: 2 },
      ],
      notices: [
        { type: "sale_limited", discountId: "d", lineRef: "003", remaining: 1, discountKind: "code" },
        { type: "sale_limited", discountId: "d", lineRef: "001", remaining: 2, discountKind: "code" },
        { type: "sale_limited", discountId: "s", lineRef: "002", remaining: 1 },
        { type: "tip_dropped_free_order" },
        null,
      ],
    });
    expect(models.map((model) => [model.lineNo, model.text])).toEqual([
      [1, "Only 2 left on this code. Lower the number to use it."],
      [3, "Only 1 left on this code. Lower Chapman to 1 to use it."],
    ]);
  });
});
