/**
 * #4273 — a tab that closed with the review open leaves sibling drafts in the
 * campaign group. The group preview must price only the methods the host
 * picked: a leftover on an unticked method is deleted and never named; a
 * leftover on a re-ticked method is reused instead of colliding with it.
 *
 * #4273 polish (follow-ups 1 and 2):
 * The refusal names what holds the method (a draft, a scheduled send, one that
 * went out), never "Open it from Drafts" for something that is not a draft.
 *
 * Fixtures: every leftover the old tests adopt or delete is now passed in
 * `seen` with its updatedAt (spec §2.11 items 2-3); the behaviour is unchanged.
 */
// MINGLA-INVARIANT: I-4273-GROUP-DRAFT-CLEANUP-SEEN-ONLY | issue #4273 | A composer adopts or deletes only group rows it saw, with the same updated_at, at load or from its own writes; one another tab wrote is left alone, and if it holds a method this composer wants the host is told.
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
  DraftChangedElsewhereError: class DraftChangedElsewhereError extends Error {
    constructor(public readonly campaignId: string) { super("changed"); }
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

const T0 = "2026-11-07T10:00:00.000+00:00";
const T1 = "2026-11-07T10:05:00.000+00:00";
type Row = { id: string; channel: string; isHead?: boolean; status?: string; updatedAt?: string };
/** What listGroupDrafts returns: every member, and the draft subset. */
const listed = (rows: Row[], groupId: string = GROUP_OF(rows)) => {
  const members = rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    isHead: row.isHead ?? false,
    status: row.status ?? "draft",
    updatedAt: row.updatedAt ?? T0,
  }));
  return { groupId, drafts: members.filter((row) => row.status === "draft"), members };
};
/** The composer saw these drafts unchanged (id -> updatedAt T0). */
const seenAll = (...ids: string[]): Map<string, string> => new Map(ids.map((id) => [id, T0]));

import {
  discardSiblingDrafts,
  draftSaveErrorMessage,
  GroupDraftInUseElsewhereError,
  GroupHeadMethodTakenError,
  groupMethodTakenMessage,
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
    listGroupDrafts.mockResolvedValue(listed([{ id: SMS, channel: "sms" }]));
    previewMarketingCampaignGroup.mockResolvedValue(preview([{ campaignId: LEAD, channel: "email" }]));
    const out = await prepareCampaignGroupPreview({ ...base, extras: [], seen: seenAll(SMS) });
    expect(deleteDraft).toHaveBeenCalledWith(SMS, { expectedUpdatedAt: T0 });
    expect(previewMarketingCampaignGroup).toHaveBeenCalledWith(LEAD, [LEAD]);
    expect(out.siblings).toEqual([]);
  });

  it("J-6 a leftover SMS draft is reused when the host ticks SMS again", async () => {
    listGroupDrafts.mockResolvedValue(listed([{ id: SMS, channel: "sms" }]));
    updateDraft.mockResolvedValue({ id: SMS, updated_at: T1 });
    previewMarketingCampaignGroup.mockResolvedValue(preview([
      { campaignId: LEAD, channel: "email" },
      { campaignId: SMS, channel: "sms" },
    ]));
    const out = await prepareCampaignGroupPreview({
      ...base,
      extras: [{ channel: "sms", payload: { kind: "sms", body: "Doors at 9" } as never, existingCampaignId: null }],
      seen: seenAll(SMS),
    });
    expect(createDraft).not.toHaveBeenCalled();
    expect(deleteDraft).not.toHaveBeenCalled();
    expect(updateDraft).toHaveBeenCalledWith(expect.objectContaining({ campaign_id: SMS, expectedUpdatedAt: T0 }));
    expect(previewMarketingCampaignGroup).toHaveBeenCalledWith(LEAD, [LEAD, SMS]);
    expect(out.siblings.map((row) => row.campaignId)).toEqual([SMS]);
  });

  it("a leftover on the lead's own method is deleted so the lead can take it", async () => {
    listGroupDrafts.mockResolvedValue(listed([{ id: SMS, channel: "sms" }, { id: PUSH, channel: "push" }]));
    const adopted = await settleLeftoverGroupDrafts({
      leadCampaignId: LEAD,
      leadChannel: "sms",
      extras: [{ channel: "push", existingCampaignId: null }],
      seen: seenAll(SMS, PUSH),
    });
    expect(deleteDraft).toHaveBeenCalledWith(SMS, { expectedUpdatedAt: T0 });
    expect(deleteDraft).not.toHaveBeenCalledWith(PUSH);
    expect(adopted.get("push")).toBe(PUSH);
  });

  it("drafts the server says were not named are discarded", async () => {
    listGroupDrafts.mockResolvedValue(listed([]));
    previewMarketingCampaignGroup.mockResolvedValue({
      ...preview([{ campaignId: LEAD, channel: "email" }]),
      unlistedDraftIds: [PUSH],
    });
    await prepareCampaignGroupPreview({ ...base, extras: [], seen: seenAll(PUSH) });
    await new Promise((resolve) => setImmediate(resolve));
    expect(deleteDraft).toHaveBeenCalledWith(PUSH, { expectedUpdatedAt: T0 });
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
    listGroupDrafts.mockResolvedValue(listed([{ id: HEAD, channel: "email", isHead: true }]));
    previewMarketingCampaignGroup.mockResolvedValue({
      ...preview([{ campaignId: SIB, channel: "sms" }]),
      // An old server still reports the head as unlisted.
      unlistedDraftIds: [HEAD],
    });
    await prepareCampaignGroupPreview({ ...base, leadCampaignId: SIB, leadChannel: "sms", extras: [], seen: seenAll(HEAD) });
    await new Promise((resolve) => setImmediate(resolve));
    expect(deleteDraft).not.toHaveBeenCalledWith(HEAD, expect.anything());
    expect(deleteDraft).not.toHaveBeenCalledWith(HEAD);
    expect(previewMarketingCampaignGroup).toHaveBeenCalledWith(SIB, [SIB]);
  });

  it("the head on the lead's own method is kept, not deleted, and the host is told", async () => {
    listGroupDrafts.mockResolvedValue(listed([{ id: HEAD, channel: "sms", isHead: true }], HEAD));
    await expect(settleLeftoverGroupDrafts({ leadCampaignId: SIB, leadChannel: "sms", extras: [], seen: seenAll(HEAD) }))
      .rejects.toBeInstanceOf(GroupHeadMethodTakenError);
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it("ticking the head's method again never reuses or overwrites the original", async () => {
    listGroupDrafts.mockResolvedValue(listed([{ id: HEAD, channel: "email", isHead: true }], HEAD));
    const run = prepareCampaignGroupPreview({
      ...base,
      leadCampaignId: SIB,
      leadChannel: "sms",
      extras: [{ channel: "email", payload: { kind: "email", subject: "New", body_html: "x", body_text: "x" } as never, existingCampaignId: null }],
      seen: seenAll(HEAD),
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
    listGroupDrafts.mockResolvedValue(listed([], HEAD));
    createDraft.mockResolvedValue({ id: PUSH, updated_at: T0 });
    previewMarketingCampaignGroup.mockResolvedValue(preview([
      { campaignId: SIB, channel: "sms" },
      { campaignId: PUSH, channel: "push" },
    ]));
    await prepareCampaignGroupPreview({
      ...base,
      leadCampaignId: SIB,
      leadChannel: "sms",
      extras: [{ channel: "push", payload: { kind: "push", body: "Doors at 9" } as never, existingCampaignId: null }],
      seen: new Map(),
    });
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ campaign_group_id: HEAD }));
  });
});

describe("#4273 a refused draft save reads in plain words", () => {
  it("the one-method-per-campaign index", () => {
    const raw = { code: "23505", message: 'duplicate key value violates unique constraint "issue_3682_one_channel_per_campaign_group"' };
    const text = draftSaveErrorMessage(raw);
    // #4273 polish (§2.11 item 1): the index spans every status, so the copy
    // names all three and never sends the host to Drafts.
    expect(text).toBe("This campaign already has a message by this method — as a draft, a scheduled send, or one that went out. Pick a different method here, or start a new campaign.");
    expect(text).not.toContain("Drafts");
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

// ── #4273 polish follow-up 1: two tabs on one campaign ─────────────────────
describe("#4273 a composer touches only group drafts it saw", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deleteDraft.mockResolvedValue(undefined);
  });

  it("T-20 a sibling another tab created after this one loaded is never deleted", async () => {
    // Tab A created SMS after tab B loaded; B sends Email only.
    listGroupDrafts.mockResolvedValue(listed([{ id: SMS, channel: "sms", updatedAt: T1 }]));
    previewMarketingCampaignGroup.mockResolvedValue(preview([{ campaignId: LEAD, channel: "email" }]));
    await prepareCampaignGroupPreview({ ...base, extras: [], seen: new Map() });
    await new Promise((resolve) => setImmediate(resolve));
    expect(deleteDraft).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("T-21 ticking the method another tab's draft holds is refused before any write", async () => {
    listGroupDrafts.mockResolvedValue(listed([{ id: SMS, channel: "sms", updatedAt: T1 }]));
    const run = prepareCampaignGroupPreview({
      ...base,
      extras: [{ channel: "sms", payload: { kind: "sms", body: "Doors at 9" } as never, existingCampaignId: null }],
      seen: new Map(),
    });
    await expect(run).rejects.toBeInstanceOf(GroupDraftInUseElsewhereError);
    await expect(
      settleLeftoverGroupDrafts({ leadCampaignId: LEAD, leadChannel: "email", extras: [{ channel: "sms", existingCampaignId: null }], seen: new Map() }),
    ).rejects.toThrow(
      "This campaign is open in another tab or device, and that tab is using SMS. Close it there, or reload here and try again.",
    );
    expect(updateDraft).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
    expect(deleteDraft).not.toHaveBeenCalled();
    expect(previewMarketingCampaignGroup).not.toHaveBeenCalled();
  });

  it("T-22 a draft seen at load but changed since is skipped like an unseen one", async () => {
    listGroupDrafts.mockResolvedValue(listed([{ id: PUSH, channel: "push", updatedAt: T1 }]));
    const adopted = await settleLeftoverGroupDrafts({
      leadCampaignId: LEAD,
      leadChannel: "email",
      extras: [],
      seen: seenAll(PUSH), // saw it at T0; another tab wrote it at T1
    });
    expect(adopted.size).toBe(0);
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it("T-22b a server delete that finds the draft changed is left to its owner", async () => {
    const { DraftChangedElsewhereError } = jest.requireMock("../marketingCampaignService");
    deleteDraft.mockRejectedValueOnce(new DraftChangedElsewhereError(SMS));
    await expect(discardSiblingDrafts([SMS], seenAll(SMS))).resolves.toBeUndefined();
    expect(deleteDraft).toHaveBeenCalledWith(SMS, { expectedUpdatedAt: T0 });
  });

  it("T-22c an adopted draft that changed between read and write is reported, not overwritten blind", async () => {
    const { DraftChangedElsewhereError } = jest.requireMock("../marketingCampaignService");
    listGroupDrafts.mockResolvedValue(listed([{ id: SMS, channel: "sms" }]));
    updateDraft.mockRejectedValueOnce(new DraftChangedElsewhereError(SMS));
    const run = prepareCampaignGroupPreview({
      ...base,
      extras: [{ channel: "sms", payload: { kind: "sms", body: "Doors at 9" } as never, existingCampaignId: null }],
      seen: seenAll(SMS),
    });
    await expect(run).rejects.toBeInstanceOf(GroupDraftInUseElsewhereError);
    expect(previewMarketingCampaignGroup).not.toHaveBeenCalled();
  });

  it("the composer records its own writes so its own siblings stay its to drop", async () => {
    listGroupDrafts.mockResolvedValue(listed([]));
    createDraft.mockResolvedValue({ id: PUSH, updated_at: T1 });
    previewMarketingCampaignGroup.mockResolvedValue(preview([
      { campaignId: LEAD, channel: "email" },
      { campaignId: PUSH, channel: "push" },
    ]));
    const seen = new Map<string, string>();
    await prepareCampaignGroupPreview({
      ...base,
      extras: [{ channel: "push", payload: { kind: "push", body: "Doors at 9" } as never, existingCampaignId: null }],
      seen,
    });
    expect(seen.get(PUSH)).toBe(T1);
  });
});

// ── #4273 polish follow-up 2: the refusal says what holds the method ───────
describe("#4273 a method the campaign already used is named for what it is", () => {
  const HEAD = "42730000-0000-4000-8000-0000000000b1";
  const SIB = "42730000-0000-4000-8000-0000000000b2";

  beforeEach(() => {
    jest.clearAllMocks();
    deleteDraft.mockResolvedValue(undefined);
  });

  it("T-24 a sent head: 'already went out', no Drafts, nothing written", async () => {
    listGroupDrafts.mockResolvedValue(listed([{ id: HEAD, channel: "email", isHead: true, status: "sent" }], HEAD));
    const run = prepareCampaignGroupPreview({
      ...base,
      leadCampaignId: SIB,
      leadChannel: "sms",
      extras: [{ channel: "email", payload: { kind: "email", subject: "New", body_html: "x", body_text: "x" } as never, existingCampaignId: null }],
      seen: new Map(),
    });
    await expect(run).rejects.toThrow(
      "Your original campaign already went out by Email. Untick Email here. To send by Email again, start a new campaign.",
    );
    await expect(run).rejects.toBeInstanceOf(GroupHeadMethodTakenError);
    expect(createDraft).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it("T-25 a scheduled head: 'already scheduled'", async () => {
    listGroupDrafts.mockResolvedValue(listed([{ id: HEAD, channel: "sms", isHead: true, status: "scheduled" }], HEAD));
    const run = settleLeftoverGroupDrafts({ leadCampaignId: SIB, leadChannel: "sms", extras: [], seen: new Map() });
    await expect(run).rejects.toThrow(
      "Your original campaign is already scheduled to send by SMS. Untick SMS here, or cancel that send in Campaigns first.",
    );
  });

  it("a sent sibling (not the head) reads 'This campaign'", async () => {
    listGroupDrafts.mockResolvedValue(listed([
      { id: HEAD, channel: "email", isHead: true, status: "sent" },
      { id: PUSH, channel: "push", status: "sent" },
    ], HEAD));
    const run = settleLeftoverGroupDrafts({
      leadCampaignId: SIB,
      leadChannel: "sms",
      extras: [{ channel: "push", existingCampaignId: null }],
      seen: new Map(),
    });
    await expect(run).rejects.toThrow("This campaign already went out by Push.");
  });

  it("#4273 extra (b): a failed or cancelled method no longer holds its slot", async () => {
    listGroupDrafts.mockResolvedValue(listed([
      { id: HEAD, channel: "email", isHead: true, status: "failed" },
      { id: PUSH, channel: "push", status: "cancelled" },
    ], HEAD));
    const adopted = await settleLeftoverGroupDrafts({
      leadCampaignId: SIB,
      leadChannel: "email",
      extras: [{ channel: "push", existingCampaignId: null }],
      seen: new Map(),
    });
    expect(adopted.size).toBe(0);
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it("every status has its own words and none of the non-draft ones says Drafts", () => {
    for (const status of ["scheduled", "sending", "sent", "failed", "cancelled"] as const) {
      expect(groupMethodTakenMessage("sms", status, true)).not.toContain("Drafts");
    }
    expect(groupMethodTakenMessage("sms", "draft", true)).toBe(
      "Your original campaign already sends by SMS. Open it from Drafts to send by SMS, or untick SMS here.",
    );
  });
});

describe("#4273 T-27 the composer keeps its seen map", () => {
  it("fills it at load and from its own saves, and hands it to every cleanup", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");
    const compose: string = readFileSync(
      path.join(__dirname, "../../../../app/(tabs)/marketing/campaigns/compose.tsx"),
      "utf8",
    );
    expect(compose).toContain("const seenGroupDraftsRef = useRef(new Map<string, string>());");
    expect(compose).toContain("seenGroupDraftsRef.current.set(draft.id, draft.updatedAt);");
    expect(compose.match(/seenGroupDraftsRef\.current\.set\(row\.id, row\.updated_at\);/g)).toHaveLength(2);
    expect(compose.match(/seen: seenGroupDraftsRef\.current,/g)).toHaveLength(2);
    expect(compose.match(/discardSiblingDrafts\([^;]*seenGroupDraftsRef\.current\)/g)).toHaveLength(2);
    expect(compose).toContain("error instanceof GroupHeadMethodTakenError || error instanceof GroupDraftInUseElsewhereError");
  });
});
