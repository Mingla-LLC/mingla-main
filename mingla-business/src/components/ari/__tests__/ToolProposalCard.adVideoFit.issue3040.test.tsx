/**
 * #3040 design AD-04 on Ari — the ad proposal card shows the SAME per-platform
 * fit sentence as Host Ads, from the same server-computed `fit` (ad-plan setup).
 * Mounts the real ToolProposalCard and the real useAdVideoFitSummary hook; only
 * the network boundary (the lazy Host Ads service) is stubbed.
 * FAILS ON REVERT: drop the hook from the card, or stop passing the sentence
 * to the ad video sheet.
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

const BRAND = "11111111-1111-4111-8111-111111111111";
const CREATIVE = "22222222-2222-4222-8222-222222222222";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const mount = async (args: Record<string, unknown>) => {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <ToolProposalCard
        toolName="propose_ad_plan"
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

describe("#3040 AD-04 on Ari's ad proposal card", () => {
  beforeEach(() => loadHostAdSetup.mockReset());

  it("shows the server fit sentence for the proposal's video, and hands it to the ad video sheet", async () => {
    loadHostAdSetup.mockResolvedValue({
      creatives: [{
        id: CREATIVE,
        fit: [
          { platform: "meta", fits: true, needs: [] },
          { platform: "tiktok", fits: true, needs: [] },
          { platform: "snapchat", fits: false, needs: ["1080×1920"] },
        ],
      }],
    });
    const renderer = await mount({ brand_id: BRAND, creative_library_id: CREATIVE });
    expect(loadHostAdSetup).toHaveBeenCalledWith(BRAND);
    const [line] = renderer.root.findAll((node) => node.props.testID === "ari-ad-video-fit" && node.type === "Text");
    expect(line.props.children).toBe("Fits Meta and TikTok. Snapchat needs 1080×1920.");
    const [sheet] = renderer.root.findAll((node) => node.type === "CoverPickerSheet");
    expect(sheet.props.adFitSummary).toBe("Fits Meta and TikTok. Snapchat needs 1080×1920.");
    renderer.unmount();
  });

  it("says nothing when there is no video yet, or the server has no fit", async () => {
    let renderer = await mount({ brand_id: BRAND });
    expect(loadHostAdSetup).not.toHaveBeenCalled();
    expect(renderer.root.findAll((node) => node.props.testID === "ari-ad-video-fit")).toHaveLength(0);
    renderer.unmount();
    loadHostAdSetup.mockResolvedValue({ creatives: [{ id: CREATIVE }] });
    renderer = await mount({ brand_id: BRAND, creative_library_id: CREATIVE });
    expect(renderer.root.findAll((node) => node.props.testID === "ari-ad-video-fit")).toHaveLength(0);
    renderer.unmount();
  });
});
