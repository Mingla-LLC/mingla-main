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
  MarketingBookSendError: class MarketingBookSendError extends Error {
    constructor(public readonly code: string) { super(code); }
  },
}));
jest.mock("../marketingBookSendService", () => ({
  previewMarketingBook: jest.fn(),
  confirmMarketingBook: jest.fn(),
  previewMarketingCampaignGroup: (...a: unknown[]) => previewMarketingCampaignGroup(...a),
  listGroupDrafts: (...a: unknown[]) => listGroupDrafts(...a),
}));

/** The head's id when one is listed, else the lead's own group (LEAD). */
const GROUP_OF = (drafts: Array<{ id: string; channel: string; isHead?: boolean }>): string =>
  drafts.find((draft) => draft.isHead)?.id ?? "42730000-0000-4000-8000-000000000001";

import {
  draftSaveErrorMessage,
  GroupHeadMethodTakenError,
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
    listGroupDrafts.mockResolvedValue({ groupId: GROUP_OF([{ id: SMS, channel: "sms" }]), drafts: [{ id: SMS, channel: "sms" }] });
    previewMarketingCampaignGroup.mockResolvedValue(preview([{ campaignId: LEAD, channel: "email" }]));
    const out = await prepareCampaignGroupPreview({ ...base, extras: [] });
    expect(deleteDraft).toHaveBeenCalledWith(SMS);
    expect(previewMarketingCampaignGroup).toHaveBeenCalledWith(LEAD, [LEAD]);
    expect(out.siblings).toEqual([]);
  });

  it("J-6 a leftover SMS draft is reused when the host ticks SMS again", async () => {
    listGroupDrafts.mockResolvedValue({ groupId: GROUP_OF([{ id: SMS, channel: "sms" }]), drafts: [{ id: SMS, channel: "sms" }] });
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
    listGroupDrafts.mockResolvedValue({ groupId: GROUP_OF([{ id: SMS, channel: "sms" }, { id: PUSH, channel: "push" }]), drafts: [{ id: SMS, channel: "sms" }, { id: PUSH, channel: "push" }] });
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
    listGroupDrafts.mockResolvedValue({ groupId: GROUP_OF([]), drafts: [] });
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

// ── P2-1: the composer's lead can be a sibling reopened from Drafts ─────────
describe("#4273 the group head is never discarded", () => {
  const HEAD = "42730000-0000-4000-8000-0000000000a1";
  const SIB = "42730000-0000-4000-8000-0000000000a2";

  beforeEach(() => {
    jest.clearAllMocks();
    deleteDraft.mockResolvedValue(undefined);
  });

  it("a sibling lead sending alone leaves the head draft in place", async () => {
    listGroupDrafts.mockResolvedValue({ groupId: GROUP_OF([{ id: HEAD, channel: "email", isHead: true }]), drafts: [{ id: HEAD, channel: "email", isHead: true }] });
    previewMarketingCampaignGroup.mockResolvedValue({
      ...preview([{ campaignId: SIB, channel: "sms" }]),
      // An old server still reports the head as unlisted.
      unlistedDraftIds: [HEAD],
    });
    await prepareCampaignGroupPreview({ ...base, leadCampaignId: SIB, leadChannel: "sms", extras: [] });
    await new Promise((resolve) => setImmediate(resolve));
    expect(deleteDraft).not.toHaveBeenCalledWith(HEAD);
    expect(previewMarketingCampaignGroup).toHaveBeenCalledWith(SIB, [SIB]);
  });

  it("the head on the lead's own method is kept, not deleted, and the host is told", async () => {
    listGroupDrafts.mockResolvedValue({ groupId: HEAD, drafts: [{ id: HEAD, channel: "sms", isHead: true }] });
    await expect(settleLeftoverGroupDrafts({ leadCampaignId: SIB, leadChannel: "sms", extras: [] }))
      .rejects.toBeInstanceOf(GroupHeadMethodTakenError);
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it("ticking the head's method again never reuses or overwrites the original", async () => {
    listGroupDrafts.mockResolvedValue({ groupId: HEAD, drafts: [{ id: HEAD, channel: "email", isHead: true }] });
    const run = prepareCampaignGroupPreview({
      ...base,
      leadCampaignId: SIB,
      leadChannel: "sms",
      extras: [{ channel: "email", payload: { kind: "email", subject: "New", body_html: "x", body_text: "x" } as never, existingCampaignId: null }],
    });
    await expect(run).rejects.toThrow(
      "Your original campaign already sends by Email. Open it from Drafts to send by Email, or untick Email here.",
    );
    expect(updateDraft).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
    expect(deleteDraft).not.toHaveBeenCalled();
    expect(previewMarketingCampaignGroup).not.toHaveBeenCalled();
  });

  it("a brand-new method under a sibling lead joins the real group, not the sibling", async () => {
    listGroupDrafts.mockResolvedValue({ groupId: HEAD, drafts: [] });
    createDraft.mockResolvedValue({ id: PUSH });
    previewMarketingCampaignGroup.mockResolvedValue(preview([
      { campaignId: SIB, channel: "sms" },
      { campaignId: PUSH, channel: "push" },
    ]));
    await prepareCampaignGroupPreview({
      ...base,
      leadCampaignId: SIB,
      leadChannel: "sms",
      extras: [{ channel: "push", payload: { kind: "push", body: "Doors at 9" } as never, existingCampaignId: null }],
    });
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ campaign_group_id: HEAD }));
  });
});

describe("#4273 a refused draft save reads in plain words", () => {
  it("the one-method-per-campaign index", () => {
    const raw = { code: "23505", message: 'duplicate key value violates unique constraint "issue_3682_one_channel_per_campaign_group"' };
    const text = draftSaveErrorMessage(raw);
    expect(text).toBe("Another draft of this campaign already sends by this method. Open it from Drafts, or pick a different method here.");
    expect(text).not.toContain("duplicate key");
    expect(draftSaveErrorMessage(new Error(raw.message))).toBe(text);
  });

  it("campaign_group_invalid", () => {
    const text = draftSaveErrorMessage({ code: "23514", message: "campaign_group_invalid" });
    expect(text).toBe("This draft can't join that campaign. Start a new campaign from Blast and try again.");
  });

  it("an already-plain message keeps its words", () => {
    expect(draftSaveErrorMessage(new Error("That audience belongs to another brand. Pick one for this brand.")))
      .toBe("That audience belongs to another brand. Pick one for this brand.");
  });

  it("the review never says 'save the draft' after a refused save", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");
    const compose: string = readFileSync(
      path.join(__dirname, "../../../../app/(tabs)/marketing/campaigns/compose.tsx"),
      "utf8",
    );
    expect(compose).toContain("setErrorBanner(draftSaveErrorMessage(err));");
    expect(compose).toContain('if (!saveRefusedRef.current) setErrorBanner("Save the draft, then preview again.");');
  });
});
