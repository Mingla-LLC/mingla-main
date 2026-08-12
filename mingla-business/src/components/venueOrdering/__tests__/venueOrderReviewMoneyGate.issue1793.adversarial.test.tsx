// Issue #1793 — tester-owned mounted proof for the last money boundary.
//
// The service suites prove what crosses the wire. This suite mounts the real
// shared review pane and proves that a stale preview cannot become a visible,
// tappable price while a replacement server preview is loading or has failed.
// It also pins the accessible state of the payment control: a screen-reader
// user gets the same gate as a pointer user.

import React from "react";

interface RenderNode {
  type?: unknown;
  props: {
    children?: unknown;
    accessibilityLabel?: unknown;
    accessibilityRole?: unknown;
    accessibilityState?: { disabled?: boolean };
    disabled?: unknown;
  };
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { VenueOrderReviewPane } from "../../../../../packages/brand-rendering/venueOrdering/VenueOrderReviewPane";
import type {
  VenueOrderPreview,
  VenueOrderingConfig,
} from "../../../../../packages/brand-rendering/venueOrdering/venueOrderingTypes";

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
  subtotalCents: 2000,
  serviceChargeCents: 250,
  serviceChargeLabel: "House service",
  feesAndTaxCents: 120,
  tipCents: 200,
  totalCents: 2570,
  lines: [{
    lineNo: 1,
    menuItemId: "22222222-2222-4222-8222-222222222222",
    itemNameAtOrder: "Negroni",
    unitPriceCents: 1000,
    currency: "GBP",
    quantity: 2,
    modifiersTotalCents: 0,
    lineTotalCents: 2000,
    notes: null,
  }],
  tipsEnabled: true,
  counterPickupEnabled: true,
};

const renderPane = async (
  previewStatus: "loading" | "ready" | "error",
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
        previewError={previewStatus === "error" ? "The menu changed. Try again." : null}
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

const allText = (tree: RenderTree): string =>
  tree.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => String(node.props.children))
    .join(" ");

const payButton = (tree: RenderTree): RenderNode => {
  const matches = tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "button" &&
      typeof node.props.accessibilityLabel === "string" &&
      String(node.props.accessibilityLabel).startsWith("Pay"),
  );
  expect(matches).toHaveLength(1);
  return matches[0];
};

describe("issue #1793 mounted review money gate", () => {
  test.each(["loading", "error"] as const)(
    "a stale preview is neither shown nor payable while status is %s",
    async (status) => {
      const tree = await renderPane(status);
      const text = allText(tree);
      expect(text).not.toContain("£25.70");
      expect(text).not.toContain("House service £2.50");
      expect(payButton(tree).props).toMatchObject({
        disabled: true,
        accessibilityLabel: "Pay — waiting for the total",
        accessibilityState: { disabled: true },
      });
    },
  );

  test("only a ready server preview exposes every charge and enables payment", async () => {
    const tree = await renderPane("ready");
    const text = allText(tree);
    expect(text).toContain("Items £20.00");
    expect(text).toContain("House service £2.50");
    expect(text).toContain("Fees & tax £1.20");
    expect(text).toContain("Tip £2.00");
    expect(text).toContain("Total £25.70");
    expect(payButton(tree).props).toMatchObject({
      disabled: false,
      accessibilityLabel: "Pay £25.70",
      accessibilityState: { disabled: false },
    });
  });
});
