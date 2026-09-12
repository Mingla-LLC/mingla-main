const invoke = jest.fn();
const rpc = jest.fn();

jest.mock("../../supabase", () => ({
  supabase: { functions: { invoke }, rpc },
}));

import {
  confirmMarketingBook,
  getOrCreateMarketingCircleAudience,
  previewMarketingBook,
} from "../marketingCampaignService";

const QUOTE = {
  quoteVersion: 1 as const,
  quoteHash: "a".repeat(64),
  quotedAt: "2026-08-30T12:00:00.000Z",
  expiresAt: "2026-08-30T12:05:00.000Z",
  selectedCount: 42,
  reachableCount: 37,
  suppressedCount: 3,
  unavailableCount: 2,
  smsSegments: 0,
  costKind: "not_metered" as const,
  estimatedCostMinor: null,
  currency: null,
  audienceId: "17780000-1000-4000-8000-000000000010",
  audienceKind: "brand_followers" as const,
  audienceVersion: 17,
};

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  invoke.mockResolvedValue({ data: QUOTE, error: null });
});

test("#1778 service maps both Circle kinds to dedicated preview action", async () => {
  await previewMarketingBook({
    campaignId: "campaign-followers",
    audienceKind: "brand_followers",
  });
  await previewMarketingBook({
    campaignId: "campaign-extended",
    audienceKind: "brand_circle_extended",
  });
  expect(invoke).toHaveBeenNthCalledWith(1, "marketing-send", {
    body: {
      action: "preview_circle_v1",
      campaign_id: "campaign-followers",
    },
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "marketing-send", {
    body: {
      action: "preview_circle_v1",
      campaign_id: "campaign-extended",
    },
  });
});

test("#1778 service maps both Circle kinds to dedicated confirm action", async () => {
  invoke.mockResolvedValue({ data: { resultState: "scheduled" }, error: null });
  for (const audience_kind of [
    "brand_followers",
    "brand_circle_extended",
  ] as const) {
    await confirmMarketingBook({
      campaign_id: `campaign-${audience_kind}`,
      client_request_id: `request-${audience_kind}`,
      quote: { ...QUOTE, audienceKind: audience_kind },
      audience_kind,
      scheduled_for: null,
    });
  }
  expect(invoke.mock.calls.map((call) => call[1].body.action)).toEqual([
    "confirm_circle_v1",
    "confirm_circle_v1",
  ]);
});

test("#1778 audience creation is an authenticated brand-scoped RPC", async () => {
  rpc.mockResolvedValue({
    data: { audienceId: "17780000-1000-4000-8000-000000000010" },
    error: null,
  });
  await getOrCreateMarketingCircleAudience({
    actor_id: "17780000-0000-4000-8000-000000000001",
    brand_id: "17780000-0000-4000-8000-000000000010",
    audience_kind: "brand_followers",
  });
  expect(rpc).toHaveBeenCalledWith(
    "biz_get_or_create_marketing_circle_audience_v1",
    {
      p_actor_id: "17780000-0000-4000-8000-000000000001",
      p_brand_id: "17780000-0000-4000-8000-000000000010",
      p_audience_kind: "brand_followers",
    },
  );
});
