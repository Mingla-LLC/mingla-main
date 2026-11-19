// MINGLA-INVARIANT: I-4238-ADS-LIST-REVIEW-DRAFTS | issue #4238 | the Host Ads list shows a launched ad as In review until an app shows it (and which app is still checking when only one is), has In review and Drafts tabs, and lets you delete your own saved draft after a confirmation.
/**
 * #4238 — Tinoe's Yard launch (19 Nov 2026). Seth: the list said "Running"
 * while both apps were still checking the ad, and drafts could not be
 * deleted. Design approved: https://claude.ai/artifact/A1qeEi123LtD48oLcTdhdf
 *
 * The list logic (hostAdLifecycle) runs for real; only data hooks and heavy
 * UI shells are stubbed.
 *
 * FAILS ON REVERT:
 *  - drop the In review / part-review status -> the chip tests fail;
 *  - drop the review and drafts tabs -> the tab tests fail;
 *  - drop the bin button or its confirm -> the delete tests fail.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

type Campaign = Record<string, unknown>;
let mockCampaigns: Campaign[] = [];
const mockRefetchPlans = jest.fn(async () => undefined);
const mockDiscard = jest.fn(async (_input: { draftId: string; expectedRevision: number }) => undefined);

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ id: "brand-1" }) }));
jest.mock("../../../hooks/useHostAdPermissions", () => ({
  useHostAdPermissions: () => ({
    isLoading: false,
    isError: false,
    canRead: true,
    canPlan: true,
    canTopUp: true,
    canWithdraw: true,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../hooks/useStickyFooterOffset", () => ({ useStickyFooterOffset: () => 0 }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../lib/netinfoSafe", () => ({ useNetInfoSafe: () => ({ isConnected: true }) }));
jest.mock("../../../hooks/marketing/useAdCreditWallet", () => ({
  useAdCreditWallet: () => ({
    canView: false,
    hasResolved: true,
    viewLoading: false,
    isError: false,
    viewError: false,
    isRefetching: false,
    refetch: jest.fn(),
    data: null,
  }),
}));
jest.mock("../../../hooks/marketing/useHostAdCampaigns", () => ({
  useHostAdCampaigns: () => ({ campaigns: mockCampaigns, summary: null, isRefetching: false, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/marketing/useHostAdPlans", () => ({
  useHostAdPlans: () => ({
    drafts: [
      {
        id: "draft-1",
        client_kind: "host",
        owner_kind: "host",
        brand_id: "brand-1",
        plan_id: null,
        revision: 7,
        current_step: "pick",
        draft_state: {},
        updated_at: "2026-11-18T10:00:00.000Z",
      },
    ],
    plans: [],
    launchedPlanIds: [],
    planIdByVersionId: {},
    isRefetching: false,
    refetch: mockRefetchPlans,
  }),
}));
jest.mock("../../../services/adCreditService", () => ({ applyAdCreditTopUp: jest.fn() }));
jest.mock("../../../services/hostAdPlanService", () => ({
  discardHostAdDraft: (input: { draftId: string; expectedRevision: number }) => mockDiscard(input),
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { View } = jest.requireActual("react-native") as { View: unknown };
  return { ScrollView: View };
});
jest.mock("../../../components/marketing/ads/HostAdManageSheets", () => ({
  HostAdCompareSheet: () => null,
  HostAdMoneyExplainer: () => null,
  HostAdReceiptsSheet: () => null,
  HostAdWithdrawSheet: () => null,
}));
jest.mock("../../../components/marketing/ads/HostAdBuilderBits", () => {
  const R = jest.requireActual("react") as typeof React;
  const pass = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return {
    builderStyles: new Proxy({}, { get: () => ({}) }),
    Blocker: () => null,
    BuilderCard: pass,
    BuilderLabel: pass,
    BuilderList: pass,
    Note: (props: Record<string, unknown>) => R.createElement("FakeNote", props),
    Segmented: (props: Record<string, unknown>) => R.createElement("FakeSegmented", props),
    ValueRow: () => null,
  };
});
jest.mock("../../../components/marketing/ads/HostAdTopUpSheet", () => ({ HostAdTopUpSheet: () => null }));
jest.mock("../../../components/marketing/ads/results/AdListSummaryCard", () => ({ AdListSummaryCard: () => null }));
jest.mock("../../../components/ui/ConfirmDialog", () => {
  const R = jest.requireActual("react") as typeof React;
  return { ConfirmDialog: (props: Record<string, unknown>) => R.createElement("FakeConfirm", props) };
});
jest.mock("../../../components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../components/ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("../../../components/ui/Button", () => ({ Button: () => null }));

import MarketingAdsRoute from "../HostAdListScreen";

type Node = { type: unknown; props: Record<string, unknown>; children: (Node | string)[] };
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] } };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const campaign = (appReviews: { platform: string; state: string }[], lifecycle: string): Campaign => ({
  id: "camp-1",
  name: "Tinoe's Yard: 2nd Edition",
  status: "ACTIVE",
  platform: "meta",
  currency: "NGN",
  cap_cents: 3_300_000,
  starts_at: "2026-11-19T00:00:00.000Z",
  created_at: "2026-11-19T03:10:00.000Z",
  updated_at: "2026-11-19T03:11:00.000Z",
  plan_version_id: "v1",
  plan_state: "live",
  lifecycle,
  next_action: lifecycle === "in_review" ? "Track review" : "View results",
  campaign_ids: ["camp-1", "camp-2"],
  platforms: ["meta", "snapchat"],
  app_reviews: appReviews,
  destination: { page_type: "event", url: null },
  host_spend_equivalent_cents: 0,
  spend_by_currency: [],
  primary_result_label: "ticket_purchase",
  primary_result_count: 0,
  cost_per_result_cents: null,
  impressions: 0,
  clicks: 0,
  creative: null,
});

const mount = async (): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<MarketingAdsRoute />);
  });
  return tree;
};
const texts = (tree: Tree): string[] =>
  tree.root.findAll(() => true).flatMap((n) => n.children.filter((c): c is string => typeof c === "string"));
const byTestId = (tree: Tree, id: string): Node[] =>
  tree.root.findAll((n) => n.props.testID === id && typeof n.type !== "string");
const rowIds = (tree: Tree): string[] =>
  tree.root
    .findAll((n) => typeof n.props.testID === "string" && /^ads-(campaign|draft)-row-/.test(n.props.testID as string))
    .map((n) => n.props.testID as string)
    .filter((id, i, all) => all.indexOf(id) === i);

describe("#4238 Ads list: In review and drafts", () => {
  beforeEach(() => {
    mockDiscard.mockClear();
    mockRefetchPlans.mockClear();
  });

  test("just launched, both apps checking: In review, not Running, and each app's state", async () => {
    mockCampaigns = [campaign([{ platform: "meta", state: "in_review" }, { platform: "snapchat", state: "in_review" }], "in_review")];
    const tree = await mount();
    const all = texts(tree);
    expect(all).toContain("In review");
    expect(all).not.toContain("Running");
    expect(all).toContain("Each app checks your ad first. Nothing is spent until it shows.");
    expect(all).toContain("Facebook & Instagram: checking · Snapchat: checking");
  });

  test("one app showing, one checking: Running, naming the app still checking", async () => {
    mockCampaigns = [campaign([{ platform: "meta", state: "showing" }, { platform: "snapchat", state: "in_review" }], "live")];
    const tree = await mount();
    expect(texts(tree)).toContain("Running · Snapchat in review");
    expect(texts(tree)).toContain("Facebook & Instagram: showing · Snapchat: checking");
  });

  test("every app showing: plain Running, no per-app line", async () => {
    mockCampaigns = [campaign([{ platform: "meta", state: "showing" }, { platform: "snapchat", state: "showing" }], "live")];
    const tree = await mount();
    expect(texts(tree)).toContain("Running");
    expect(byTestId(tree, "ads-row-apps-camp-1")).toHaveLength(0);
  });

  test("the tabs are All, Running, In review, Drafts, Ended and each one filters", async () => {
    mockCampaigns = [campaign([{ platform: "meta", state: "in_review" }], "in_review")];
    const tree = await mount();
    const seg = tree.root.findAll((n) => n.type === "FakeSegmented")[0]!;
    expect((seg.props.options as { id: string; label: string }[]).map((o) => o.label)).toEqual([
      "All",
      "Running",
      "In review",
      "Drafts",
      "Ended",
    ]);
    expect(rowIds(tree).sort()).toEqual(["ads-campaign-row-camp-1", "ads-draft-row-draft-1"]);
    const pick = async (id: string) => {
      await TestRenderer.act(async () => {
        (tree.root.findAll((n) => n.type === "FakeSegmented")[0]!.props.onChange as (v: string) => void)(id);
      });
    };
    await pick("review");
    expect(rowIds(tree)).toEqual(["ads-campaign-row-camp-1"]);
    await pick("drafts");
    expect(rowIds(tree)).toEqual(["ads-draft-row-draft-1"]);
    await pick("running");
    expect(rowIds(tree)).toEqual([]);
  });

  test("a draft has a bin; it asks first, then deletes at the listed revision", async () => {
    mockCampaigns = [];
    const tree = await mount();
    expect(byTestId(tree, "ads-draft-delete-camp-1")).toHaveLength(0);
    const bin = byTestId(tree, "ads-draft-delete-draft-1")[0]!;
    expect(bin.props.accessibilityLabel).toBe("Delete draft Untitled ad draft");
    const dialog = () => tree.root.findAll((n) => n.type === "FakeConfirm")[0]!;
    expect(dialog().props.visible).toBe(false);
    await TestRenderer.act(async () => {
      (bin.props.onPress as () => void)();
    });
    expect(dialog().props.visible).toBe(true);
    expect(dialog().props.title).toBe("Delete this draft?");
    expect(dialog().props.destructive).toBe(true);
    expect(mockDiscard).not.toHaveBeenCalled();
    await TestRenderer.act(async () => {
      await (dialog().props.onConfirm as () => Promise<void>)();
    });
    expect(mockDiscard).toHaveBeenCalledWith({ draftId: "draft-1", expectedRevision: 7 });
    expect(mockRefetchPlans).toHaveBeenCalled();
    expect(dialog().props.visible).toBe(false);
  });

  test("a failed delete keeps the dialog open and says so", async () => {
    mockCampaigns = [];
    mockDiscard.mockRejectedValueOnce(new Error("draft_conflict"));
    const tree = await mount();
    await TestRenderer.act(async () => {
      (byTestId(tree, "ads-draft-delete-draft-1")[0]!.props.onPress as () => void)();
    });
    const dialog = () => tree.root.findAll((n) => n.type === "FakeConfirm")[0]!;
    await TestRenderer.act(async () => {
      await (dialog().props.onConfirm as () => Promise<void>)();
    });
    expect(dialog().props.visible).toBe(true);
    expect(dialog().props.errorMessage).toBe("Couldn't delete this draft. Pull down to refresh and try again.");
  });
});
