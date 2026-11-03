/**
 * #4238 — Ari's ad card loads the Host ad money format and app names on
 * intent from the Host Ads chunk (useHostAdCardWords), so they stay out of the
 * boot chunk. Mounts the real ToolProposalCard and hook; only the lazy Host Ads
 * loader is stubbed, with the REAL formatter and names behind it.
 * FAILS ON REVERT: import hostAdMoney/hostAdCopy into the card again (no
 * placeholder, no loader call) or drop the loader (the words never arrive).
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

const ARGS = {
  plan_id: "44444444-4444-4444-8444-444444444444",
  __proposal_context: {
    ad_budget_cents: 150_000_000,
    ad_daily_budget_cents: 5_000_000,
    currency: "NGN",
    ad_platforms: ["meta", "tiktok"],
    ad_result: "ticket sales",
  },
};

const mount = async () => {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <ToolProposalCard
        toolName="approve_ad_plan"
        args={ARGS}
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

describe("#4238 Ari's ad card words load on intent", () => {
  it("shows a placeholder in the same rows until the Host Ads words arrive, then the plain words", async () => {
    const renderer = await mount();
    expect(loadHostAdPlanService).toHaveBeenCalledTimes(1);
    expect(fieldValue(renderer, "Total budget")).toBe("Loading…");
    expect(fieldValue(renderer, "Apps")).toBe("Loading…");
    expect(fieldValue(renderer, "What we count")).toBe("ticket sales");

    await TestRenderer.act(async () => {
      release?.({ formatHostAdMoneyCents, platformName });
      await flush();
    });
    expect(fieldValue(renderer, "Total budget")).toBe("NGN 1,500,000.00");
    expect(fieldValue(renderer, "Daily total")).toBe("NGN 50,000.00");
    expect(fieldValue(renderer, "Apps")).toBe("Facebook & Instagram, TikTok");
    renderer.unmount();
  });

  it("a later card reuses the loaded words with no placeholder and no second load", async () => {
    const renderer = await mount();
    expect(fieldValue(renderer, "Total budget")).toBe("NGN 1,500,000.00");
    expect(loadHostAdPlanService).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });
});
