/**
 * #4273 — a tab that closed with the review open leaves sibling drafts in the
 * campaign group. The group preview must price only the methods the host
 * picked: a leftover on an unticked method is deleted and never named; a
 * leftover on a re-ticked method is reused instead of colliding with it.
 */
const createDraft = jest.fn();
const updateDraft = jest.fn();
const deleteDraft = jest.fn();
const listGroupDrafts = jest.fn();
const previewMarketingCampaignGroup = jest.fn();
jest.mock("../marketingCampaignService", () => ({
  createDraft: (...a: unknown[]) => createDraft(...a),
  updateDraft: (...a: unknown[]) => updateDraft(...a),
  deleteDraft: (...a: unknown[]) => deleteDraft(...a),
  listGroupDrafts: (...a: unknown[]) => listGroupDrafts(...a),
  MarketingBookSendError: class MarketingBookSendError extends Error {
    constructor(public readonly code: string) { super(code); }
  },
}));
jest.mock("../marketingBookSendService", () => ({
  previewMarketingBook: jest.fn(),
  confirmMarketingBook: jest.fn(),
  previewMarketingCampaignGroup: (...a: unknown[]) => previewMarketingCampaignGroup(...a),
}));

import {
  prepareCampaignGroupPreview,
  settleLeftoverGroupDrafts,
  siblingErrorMessage,
} from "../campaignChannelGroupService";

const LEAD = "42730000-0000-4000-8000-000000000001";
const SMS = "42730000-0000-4000-8000-000000000002";
const PUSH = "42730000-0000-4000-8000-000000000003";
const base = {
  leadCampaignId: LEAD,
  leadChannel: "email" as const,
  accountId: "42730000-0000-4000-8000-000000000004",
  brandId: "42730000-0000-4000-8000-000000000005",
  audienceId: "42730000-0000-4000-8000-000000000006",
  name: "Tonight",
};
const preview = (methods: Array<{ campaignId: string; channel: string }>) => ({
  group: { reachableCount: 1 },
  methods: methods.map((m) => ({ ...m, quote: { reachableCount: 1 }, error: null })),
});

describe("#4273 leftover group drafts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deleteDraft.mockResolvedValue(undefined);
  });

  it("J-5 a leftover SMS draft with Email only is deleted and never priced", async () => {
    listGroupDrafts.mockResolvedValue([{ id: SMS, channel: "sms" }]);
    previewMarketingCampaignGroup.mockResolvedValue(preview([{ campaignId: LEAD, channel: "email" }]));
    const out = await prepareCampaignGroupPreview({ ...base, extras: [] });
    expect(deleteDraft).toHaveBeenCalledWith(SMS);
    expect(previewMarketingCampaignGroup).toHaveBeenCalledWith(LEAD, [LEAD]);
    expect(out.siblings).toEqual([]);
  });

  it("J-6 a leftover SMS draft is reused when the host ticks SMS again", async () => {
    listGroupDrafts.mockResolvedValue([{ id: SMS, channel: "sms" }]);
    updateDraft.mockResolvedValue({ id: SMS });
    previewMarketingCampaignGroup.mockResolvedValue(preview([
      { campaignId: LEAD, channel: "email" },
      { campaignId: SMS, channel: "sms" },
    ]));
    const out = await prepareCampaignGroupPreview({
      ...base,
      extras: [{ channel: "sms", payload: { kind: "sms", body: "Doors at 9" } as never, existingCampaignId: null }],
    });
    expect(createDraft).not.toHaveBeenCalled();
    expect(deleteDraft).not.toHaveBeenCalled();
    expect(updateDraft).toHaveBeenCalledWith(expect.objectContaining({ campaign_id: SMS }));
    expect(previewMarketingCampaignGroup).toHaveBeenCalledWith(LEAD, [LEAD, SMS]);
    expect(out.siblings.map((row) => row.campaignId)).toEqual([SMS]);
  });

  it("a leftover on the lead's own method is deleted so the lead can take it", async () => {
    listGroupDrafts.mockResolvedValue([{ id: SMS, channel: "sms" }, { id: PUSH, channel: "push" }]);
    const adopted = await settleLeftoverGroupDrafts({
      leadCampaignId: LEAD,
      leadChannel: "sms",
      extras: [{ channel: "push", existingCampaignId: null }],
    });
    expect(deleteDraft).toHaveBeenCalledWith(SMS);
    expect(deleteDraft).not.toHaveBeenCalledWith(PUSH);
    expect(adopted.get("push")).toBe(PUSH);
  });

  it("drafts the server says were not named are discarded", async () => {
    listGroupDrafts.mockResolvedValue([]);
    previewMarketingCampaignGroup.mockResolvedValue({
      ...preview([{ campaignId: LEAD, channel: "email" }]),
      unlistedDraftIds: [PUSH],
    });
    await prepareCampaignGroupPreview({ ...base, extras: [] });
    await new Promise((resolve) => setImmediate(resolve));
    expect(deleteDraft).toHaveBeenCalledWith(PUSH);
  });

  it("J-4 a Push refusal for a buyer list says so, not 'pick Your Book'", () => {
    const { MarketingBookSendError } = jest.requireMock("../marketingCampaignService");
    expect(siblingErrorMessage("push", new MarketingBookSendError("BOOK_BLAST_AUDIENCE_NOT_FOUND"))).toBe(
      "Push reaches Mingla accounts only, so it can't go to a buyer list.",
    );
  });
});
