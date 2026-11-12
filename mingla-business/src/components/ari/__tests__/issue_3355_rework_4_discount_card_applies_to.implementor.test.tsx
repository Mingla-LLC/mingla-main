/**
 * #3355 rework 4 (tester R4-8) — the Host discount card says what the code
 * applies to in words ("All event tickets", "Lagos Food Fest tickets") and
 * shows the minimum order, never the raw "Scope: brand". Mounts the real
 * ToolProposalCard.
 * FAILS ON REVERT: restore the raw `Scope` row / drop the Minimum order row
 * in discountProposalFields.
 */
import React from "react";

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    unmount: () => void;
  };
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loadHostAdSetup = jest.fn();
jest.mock("../../../services/lazyHostAdPlanService", () => ({
  loadHostAdPlanService: async () => ({ loadHostAdSetup: (id: string) => loadHostAdSetup(id) }),
}));
jest.mock("../../ui/CoverPickerSheet", () => ({ CoverPickerSheet: "CoverPickerSheet" }));
jest.mock("../../ui/GlassChrome", () => ({
  GlassChrome: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../AriOrb", () => ({ AriOrb: "AriOrb" }));
jest.mock("../ToolEditForm", () => ({ ToolEditForm: "ToolEditForm", isToolProposalEditable: () => false }));
jest.mock("../../../hooks/useBrands", () => ({ useBrandCascadePreview: () => ({ data: null, isLoading: false }) }));
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));
jest.mock("lucide-react-native", () => ({
  AlertTriangle: "AlertTriangle", Pencil: "Pencil", Play: "Play", Plus: "Plus", X: "X",
}));

// eslint-disable-next-line import/first
import { ToolProposalCard } from "../ToolProposalCard";

import {
  discountAppliesTo,
  discountProposalFields,
} from "../eventProposalDisplay";

const BRAND = "11111111-1111-4111-8111-111111111111";

const mount = async (args: Record<string, unknown>) => {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <ToolProposalCard
        toolName="create_discount"
        args={args}
        isExecuting={false}
        onConfirm={async () => ({ ok: true })}
        onCancel={() => undefined}
        proposalId="33333333-3333-4333-8333-333333333333"
      />,
    );
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  return renderer;
};

const visible = (renderer: Awaited<ReturnType<typeof mount>>): string =>
  renderer.root.findAll((node) => node.type === "Text")
    .map((node) => node.props.children)
    .flat(Infinity)
    .filter((value): value is string => typeof value === "string")
    .join(" | ");

const EVENT_ID = "22222222-2222-4222-8222-222222222222";

// GIRLS20 as agent-chat builds it after the rework 4 fill-in: "20% off all
// orders over 10,000 naira" on an events brand.
const GIRLS20 = {
  brand_id: BRAND,
  kind: "code",
  code: "GIRLS20",
  name: "GIRLS20",
  value_type: "percent",
  value_bps: 2000,
  min_subtotal_minor: 1000000,
  scope_kind: "listing_kinds",
  targets: [{ target_kind: "listing_kind", listing_kind: "event" }],
  __proposal_context: { brand_timezone: "Africa/Lagos", brand_currency: "NGN" },
};

describe("#3355 rework 4 (R4-8): the discount card says what it applies to and the minimum order", () => {
  it("shows 'Applies to: All event tickets' and 'Minimum order ₦10,000.00', never 'Scope'", async () => {
    const renderer = await mount(GIRLS20);
    const text = visible(renderer);
    expect(text).toContain("Applies to");
    expect(text).toContain("All event tickets");
    expect(text).toContain("Minimum order");
    expect(text).toContain("₦10,000.00");
    expect(text).not.toContain("Scope");
    expect(text).not.toMatch(/listing kinds/i);
    renderer.unmount();
  });

  it("names a specific event from the server's titles, and a brand-wide code in words", () => {
    const rows = discountProposalFields({
      ...GIRLS20,
      min_subtotal_minor: undefined,
      scope_kind: "listings",
      targets: [{ target_kind: "event", target_id: EVENT_ID }],
      __proposal_context: {
        brand_timezone: "Africa/Lagos",
        brand_currency: "NGN",
        discount_target_titles: { [EVENT_ID]: "Lagos Food Fest" },
      },
    });
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));
    expect(byLabel["Applies to"]).toBe("Lagos Food Fest tickets");
    expect(byLabel["Minimum order"]).toBeUndefined();
    expect(byLabel.Scope).toBeUndefined();
    expect(discountAppliesTo({ scope_kind: "brand" })).toBe("Everything you sell");
    expect(
      discountAppliesTo({
        targets: [
          { target_kind: "listing_kind", listing_kind: "trip" },
          { target_kind: "listing_kind", listing_kind: "venue_order" },
        ],
      }),
    ).toBe("All trips, All venue orders");
    expect(discountAppliesTo({ targets: [{ target_kind: "event", target_id: EVENT_ID }] }))
      .toBe("One event's tickets");
  });
});
