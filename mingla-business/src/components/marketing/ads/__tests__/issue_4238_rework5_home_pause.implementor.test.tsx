// MINGLA-INVARIANT: I-4238-ONE-PAUSE-CONFIRM | issue #4238 | rework 5: Every Host ad Pause (the ad detail page and the Home ad tile) asks first with the same money-stating confirm (hostAdPauseConfirmWords: what stays held, in what the Host pays); the confirm pauses only the ad it was opened for.
/**
 * #4238 rework 5 (native P2-1): the Home ad tile's Pause paused at once with
 * no confirm (iOS ios-04). It now opens the same "Pause this ad?" confirm as
 * the detail page, with the same held amount; only "Pause" pauses, and only
 * the ad the confirm was opened for.
 *
 * FAILS ON REVERT: wire the tile's Pause straight to pauseHostAdCampaign again
 * -> "tapping Pause does not pause" fails.
 */
import React from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = { props: Record<string, unknown>; type: unknown; children: (RenderNode | string)[] };
type Renderer = { root: { findAll: (p: (node: RenderNode) => boolean) => RenderNode[] } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => Renderer;
};

const mockPause = jest.fn(async (_input: unknown) => undefined);
let mockCanPause = true;
const mockSummary = {
  currency: "USD",
  spent_cents: 202_500,
  budget_cents: 586_000,
  results: 7,
  daily_spend: [{ day: "2026-11-01", cents: 100 }],
};
const ad = (id: string, lifecycle: string) => ({
  id,
  plan_version_id: `v-${id}`,
  name: `Ad ${id}`,
  lifecycle,
  currency: "USD",
  cap_cents: 50_000,
  lifetime_budget_cents: null,
  host_spend_equivalent_cents: 10_000,
  spend_by_currency: [],
  platforms: ["meta"],
  next_action: "View results",
  plan_state: "live",
  creative: null,
  starts_at: null,
  ends_at: null,
  updated_at: "2026-11-10T10:00:00Z",
  created_at: "2026-11-01T10:00:00Z",
});

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: true }) }));
jest.mock("../../../../hooks/useHostAdPermissions", () => ({
  useHostAdPermissions: () => ({ isLoading: false, isError: false, canRead: true, canPause: mockCanPause }),
}));
jest.mock("../../../../hooks/useTrafficAnalytics", () => ({
  useBrandTrafficRollup: () => ({ data: { sources: [] } }),
}));
jest.mock("../../../../hooks/marketing/useHostAdCampaigns", () => ({
  useHostAdCampaigns: () => ({
    campaigns: [ad("a", "live"), ad("b", "live"), ad("c", "ended")],
    summary: mockSummary,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../../services/hostAdCampaignService", () => ({
  pauseHostAdCampaign: (input: unknown) => mockPause(input),
}));
jest.mock("../../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require("react") as typeof React;
    return R.createElement("FakeConfirmDialog", props);
  },
}));
jest.mock("../../../ui/GlassCard", () => ({
  GlassCard: (props: { children: React.ReactNode }) => props.children,
}));
jest.mock("../../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require("react") as typeof React;
  const make = (name: string) => (props: Record<string, unknown>) =>
    ReactLib.createElement(name, props, props.children as React.ReactNode);
  return { __esModule: true, default: make("Svg"), Path: make("Path") };
});

// eslint-disable-next-line import/first
import { HomeAdsSection } from "../../../home/HomeAdsSection";
// eslint-disable-next-line import/first
import { hostAdPauseConfirmWords } from "../hostAdManageCopy";

const mount = async (): Promise<Renderer> => {
  let home!: Renderer;
  await act(async () => {
    home = create(<HomeAdsSection brandId="b1" />);
  });
  return home;
};
const byId = (r: Renderer, type: string, testID: string): RenderNode | undefined =>
  r.root.findAll((n) => n.type === type && n.props.testID === testID)[0];
const pauseButton = (r: Renderer, id: string): RenderNode | undefined =>
  r.root.findAll((n) => n.props.testID === `home-ad-pause-${id}` && typeof n.props.onPress === "function")[0];

describe("#4238 rework 5: the Home tile's Pause asks first", () => {
  beforeEach(() => {
    mockPause.mockClear();
    mockCanPause = true;
  });

  test("tapping Pause does not pause: it opens the detail page's money-stating confirm", async () => {
    const home = await mount();
    expect(byId(home, "FakeConfirmDialog", "home-ad-pause-dialog")).toBeUndefined();
    await act(async () => {
      (pauseButton(home, "b")?.props.onPress as () => void)();
    });
    expect(mockPause).not.toHaveBeenCalled();
    const dialog = byId(home, "FakeConfirmDialog", "home-ad-pause-dialog");
    const words = hostAdPauseConfirmWords({ capCredit: 50_000, spentCredit: 10_000, currency: "USD" });
    expect(dialog?.props.title).toBe("Pause this ad?");
    expect(dialog?.props.description).toBe(words.description);
    expect(words.description).toBe("It stops spending now. USD 470.59 stays held until you resume or end it.");
    expect(dialog?.props.cancelLabel).toBe("Keep running");
  });

  test("Pause pauses only the ad the confirm was opened for; Keep running pauses nothing", async () => {
    const home = await mount();
    await act(async () => {
      (pauseButton(home, "b")?.props.onPress as () => void)();
    });
    await act(async () => {
      (byId(home, "FakeConfirmDialog", "home-ad-pause-dialog")?.props.onClose as () => void)();
    });
    expect(mockPause).not.toHaveBeenCalled();
    expect(byId(home, "FakeConfirmDialog", "home-ad-pause-dialog")).toBeUndefined();

    await act(async () => {
      (pauseButton(home, "b")?.props.onPress as () => void)();
    });
    await act(async () => {
      await (byId(home, "FakeConfirmDialog", "home-ad-pause-dialog")?.props.onConfirm as () => Promise<void>)();
    });
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockPause).toHaveBeenCalledWith({ brandId: "b1", campaignId: "b" });
    expect(byId(home, "FakeConfirmDialog", "home-ad-pause-dialog")).toBeUndefined();
  });

  test("a teammate who cannot pause gets no Pause and no confirm", async () => {
    mockCanPause = false;
    const home = await mount();
    expect(pauseButton(home, "b")).toBeUndefined();
    expect(byId(home, "FakeConfirmDialog", "home-ad-pause-dialog")).toBeUndefined();
  });
});
