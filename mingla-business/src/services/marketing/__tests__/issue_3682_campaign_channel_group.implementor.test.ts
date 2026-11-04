/**
 * #3682 wave 2 (B) — one campaign across push, email and SMS: each extra
 * channel is a sibling draft in the lead's campaign group with its own sealed
 * preview, confirmed after the lead through its own lane.
 */
const createDraft = jest.fn();
const updateDraft = jest.fn();
const deleteDraft = jest.fn();
const previewMarketingBook = jest.fn();
const confirmMarketingBook = jest.fn();
jest.mock("../marketingCampaignService", () => ({
  createDraft: (...a: unknown[]) => createDraft(...a),
  updateDraft: (...a: unknown[]) => updateDraft(...a),
  deleteDraft: (...a: unknown[]) => deleteDraft(...a),
  previewMarketingBook: (...a: unknown[]) => previewMarketingBook(...a),
  confirmMarketingBook: (...a: unknown[]) => confirmMarketingBook(...a),
  MarketingBookSendError: class MarketingBookSendError extends Error {
    constructor(public readonly code: string) { super(code); }
  },
}));

import {
  confirmSiblingChannels,
  discardSiblingDrafts,
  prepareSiblingChannel,
} from "../campaignChannelGroupService";

const LEAD = "36829600-0000-4000-8000-000000000001";
const base = {
  leadCampaignId: LEAD,
  accountId: "36829600-0000-4000-8000-000000000002",
  brandId: "36829600-0000-4000-8000-000000000003",
  audienceId: "36829600-0000-4000-8000-000000000004",
  audienceKind: "brand_followers" as const,
  name: "Tonight",
  existingCampaignId: null,
};

describe("#3682 campaign channel group", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates the push sibling in the lead's group and previews it through the push lane", async () => {
    createDraft.mockResolvedValue({ id: "sib-1" });
    previewMarketingBook.mockResolvedValue({ reachableCount: 3, costKind: "not_metered" });
    const state = await prepareSiblingChannel({ ...base, channel: "push", payload: { kind: "push", body: "Doors at 9." } });
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({
      campaign_group_id: LEAD,
      channel_payload: { kind: "push", body: "Doors at 9." },
    }));
    expect(previewMarketingBook).toHaveBeenCalledWith({ campaignId: "sib-1", audienceKind: "brand_followers", channel: "push" });
    expect(state.quote?.reachableCount).toBe(3);
    expect(state.error).toBeNull();
  });

  it("a failed sibling preview becomes a plain reason, not a crash", async () => {
    createDraft.mockResolvedValue({ id: "sib-2" });
    const { MarketingBookSendError } = jest.requireMock("../marketingCampaignService");
    previewMarketingBook.mockRejectedValue(new MarketingBookSendError("BOOK_BLAST_AUDIENCE_NOT_FOUND"));
    const state = await prepareSiblingChannel({ ...base, channel: "push", payload: { kind: "push", body: "x" } });
    expect(state.quote).toBeNull();
    expect(state.error).toContain("Push reaches Mingla accounts only");
  });

  it("confirms each sibling on its own lane and reports failures without stopping", async () => {
    confirmMarketingBook
      .mockResolvedValueOnce({ mode: "sent", delivered: 3, deferred: 0, skippedAfterConfirm: 0 })
      .mockRejectedValueOnce(new Error("BOOK_BLAST_MONTHLY_CAP_EXCEEDED"));
    const results = await confirmSiblingChannels({
      siblings: [
        { channel: "push", campaignId: "sib-1", quote: { reachableCount: 3 } as never, requestId: "r1", error: null },
        { channel: "sms", campaignId: "sib-3", quote: { reachableCount: 2 } as never, requestId: "r2", error: null },
      ],
      audienceKind: "brand_followers",
      scheduledFor: null,
    });
    expect(confirmMarketingBook.mock.calls[0][0]).toEqual(expect.objectContaining({ campaign_id: "sib-1", channel: "push" }));
    expect(confirmMarketingBook.mock.calls[1][0]).toEqual(expect.objectContaining({ campaign_id: "sib-3", channel: "sms" }));
    expect(results.map((row) => row.ok)).toEqual([true, false]);
    expect(results[1].message).toContain("monthly limit");
  });

  it("discards sibling drafts the host backed out of", async () => {
    deleteDraft.mockResolvedValue(undefined);
    await discardSiblingDrafts(["a", "b"]);
    expect(deleteDraft).toHaveBeenCalledTimes(2);
  });
});
