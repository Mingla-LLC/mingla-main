/**
 * #3355 rework 3 (tester R3-5) — the Host discount card shows when the code
 * starts and ends, in the brand's own time zone, before the host approves it
 * (the 10 Nov incident: the stated end date was invisible). A fixed amount is
 * money, never "minor units". Mounts the real ToolProposalCard.
 * FAILS ON REVERT: drop discountProposalFields from the card's create_discount
 * rows (the six-field list had no Starts / Ends).
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
  discountProposalFields,
  formatProposalInstant,
  formatProposalMinor,
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

// The FAVY10 card as agent-chat builds it (brand zone in server context).
const FAVY10 = {
  brand_id: BRAND,
  kind: "code",
  code: "FAVY10",
  name: "FAVY10",
  value_type: "percent",
  value_bps: 1000,
  ends_at: "2026-12-19T22:59:59Z",
  scope_kind: "listing_kinds",
  __proposal_context: { brand_timezone: "Africa/Lagos", brand_currency: "NGN" },
};

describe("#3355 rework 3 (R3-5): the discount card's dates in the brand's time zone", () => {
  it("says the 19 Dec end at 11:59 pm Lagos time, and a start of 'as soon as you confirm'", async () => {
    const renderer = await mount(FAVY10);
    const text = visible(renderer);
    expect(text).toContain("Ends");
    expect(text).toContain("Sat 19 Dec 2026, 11:59 pm Lagos time");
    expect(text).toContain("Starts");
    expect(text).toContain("As soon as you confirm");
    expect(text).toContain("10% off");
    renderer.unmount();
  });

  it("formats a stated start, a fixed amount as money, and says when there is no end", () => {
    const rows = discountProposalFields({
      ...FAVY10,
      value_bps: undefined,
      value_type: "amount",
      value_minor: 150000,
      starts_at: "2026-12-01T00:00:00+01:00",
      ends_at: undefined,
    });
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));
    expect(byLabel.Starts).toBe("Tue 1 Dec 2026, 12:00 am Lagos time");
    expect(byLabel.Ends).toBe("No end date");
    expect(byLabel.Value).toBe("₦1,500.00 off");
    expect(byLabel.Value).not.toMatch(/minor units/);
  });

  it("reads London and UTC zones, and never throws on a bad value", () => {
    expect(formatProposalInstant("2026-12-19T23:59:59Z", "Europe/London"))
      .toBe("Sat 19 Dec 2026, 11:59 pm London time");
    expect(formatProposalInstant("2026-12-19T22:59:59Z", null))
      .toBe("Sat 19 Dec 2026, 10:59 pm UTC");
    expect(formatProposalInstant("not a date", "Africa/Lagos")).toBeNull();
    expect(formatProposalInstant("2026-12-19T22:59:59Z", "Not/AZone")).toBeNull();
    expect(formatProposalMinor(500, "GBP")).toBe("£5.00");
    expect(formatProposalMinor(500, null)).toBeNull();
  });
});
