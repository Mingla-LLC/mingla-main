/**
 * #4238 — Ari's ad card says one ad covers every date of a series, until the
 * last day people can book. The server writes the sentence into the card's
 * display-only context (`ad_dates`); the card shows it as a "Dates" row right
 * after "Page", and shows nothing for a page without dates.
 * FAILS ON REVERT: drop the ad_dates row in ToolProposalCard.
 */
import React from "react";

import { formatHostAdMoneyCents } from "../../marketing/ads/hostAdMoney";
import { platformName } from "../../marketing/ads/hostAdCopy";

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

type Kit = { formatHostAdMoneyCents: typeof formatHostAdMoneyCents; platformName: typeof platformName };
let release: ((kit: Kit) => void) | null = null;
const loadHostAdPlanService = jest.fn(
  () => new Promise<Kit>((resolve) => {
    release = resolve;
  }),
);
jest.mock("../../../services/lazyHostAdPlanService", () => ({
  loadHostAdPlanService: () => loadHostAdPlanService(),
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

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const ARGS: Record<string, unknown> = {
  plan_id: "44444444-4444-4444-8444-444444444444",
  __proposal_context: {
    ad_budget_cents: 150_000_000,
    ad_daily_budget_cents: 5_000_000,
    currency: "NGN",
    ad_platforms: ["meta"],
    ad_destination: "Sunday Rooftop Sessions",
    ad_dates: "Covers all 5 dates until Sun 6 Dec",
  },
};

const mount = async (args: Record<string, unknown> = ARGS) => {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <ToolProposalCard
        toolName="approve_ad_plan"
        args={args}
        isExecuting={false}
        onConfirm={async () => ({ ok: true })}
        onCancel={() => undefined}
        proposalId="33333333-3333-4333-8333-333333333333"
      />,
    );
    await flush();
  });
  return renderer;
};

const fieldValue = (renderer: ReturnType<typeof TestRenderer.create>, label: string): unknown => {
  const texts = renderer.root.findAll((node) => node.type === "Text").map((node) => node.props.children);
  const at = texts.findIndex((value) => value === label);
  return at === -1 ? undefined : texts[at + 1];
};

describe("#4238 Ari's ad card dates", () => {
  it("shows which dates the ad covers, right after the page", async () => {
    const renderer = await mount();
    expect(fieldValue(renderer, "Dates")).toBe("Covers all 5 dates until Sun 6 Dec");
    const texts = renderer.root.findAll((node) => node.type === "Text").map((node) => node.props.children);
    expect(texts.indexOf("Dates")).toBe(texts.indexOf("Page") + 2);
    renderer.unmount();
  });

  it("shows no Dates row for a page without dates", async () => {
    const renderer = await mount({
      ...ARGS,
      __proposal_context: {
        ...(ARGS.__proposal_context as Record<string, unknown>),
        ad_dates: undefined,
      },
    });
    expect(fieldValue(renderer, "Dates")).toBeUndefined();
    renderer.unmount();
  });
});
