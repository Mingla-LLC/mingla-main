/**
 * #3682 wave 3 — push-only campaigns and partial sends.
 *  (a) every preview (open, schedule, retry) goes through the channel's own
 *      lane, so a push-only campaign never previews as email; push to Friends
 *      of followers needs the same three switches the server checks.
 *  (c) when some recipients fail at the provider and others are delivered,
 *      Host reports "sent N, failed M", not a blanket dispatch error.
 * FAILS-ON-REVERT: restoring `recipient_failed !== 0` as a hard failure, or a
 * preview call without the channel, fails these.
 */
import { readFileSync } from "fs";
import path from "path";

jest.mock("../../supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import { supabase } from "../../supabase";
import { MarketingBookSendError } from "../marketingCampaignService";
import { confirmMarketingBook } from "../marketingBookSendService";
import {
  campaignPreviewInput,
  extendedPushReady,
  partialSendLine,
} from "../campaignChannelGroupService";

const invoke = supabase.functions.invoke as jest.Mock;
const quote = { reachableCount: 3, quoteHash: "h", quotedAt: "now", estimatedCostMinor: null, currency: null } as never;
const dispatch = (over: Record<string, unknown>) => ({
  data: {
    resultState: "complete",
    dispatch: {
      processed: 1, succeeded: 1, failed: 0, delivered: 3, deferred: 0,
      recipient_failed: 0, skipped_after_confirm: 0, preview_skipped: 0, errors: [],
      ...over,
    },
  },
  error: null,
});
const confirm = () =>
  confirmMarketingBook({
    campaign_id: "c1",
    client_request_id: "r1",
    quote,
    scheduled_for: null,
    audience_kind: "brand_followers",
    channel: "push",
  });

describe("#3682 wave 3 — partial send-now", () => {
  beforeEach(() => invoke.mockReset());

  it("reports sent N, failed M when some pushes fail at the provider", async () => {
    invoke.mockResolvedValueOnce(dispatch({ delivered: 2, recipient_failed: 1 }));
    await expect(confirm()).resolves.toEqual({
      mode: "partial", delivered: 2, deferred: 0, failed: 1, skippedAfterConfirm: 0,
    });
    expect(invoke.mock.calls[0][1].body.action).toBe("confirm_push_v1");
    expect(partialSendLine(2, 1)).toBe("Sent to 2 people. 1 person couldn't be reached by the provider.");
  });

  it("a full send is still a plain send with zero failed", async () => {
    invoke.mockResolvedValueOnce(dispatch({}));
    await expect(confirm()).resolves.toEqual({
      mode: "sent", delivered: 3, deferred: 0, failed: 0, skippedAfterConfirm: 0,
    });
  });

  it("nobody reached is its own honest error; counts that don't add up still fail", async () => {
    invoke.mockResolvedValueOnce(dispatch({ delivered: 0, recipient_failed: 3 }));
    await expect(confirm()).rejects.toEqual(new MarketingBookSendError("BOOK_BLAST_ALL_RECIPIENTS_FAILED", null));
    invoke.mockResolvedValueOnce(dispatch({ delivered: 2, recipient_failed: 2 }));
    await expect(confirm()).rejects.toEqual(new MarketingBookSendError("BOOK_BLAST_DISPATCH_FAILED", null));
    invoke.mockResolvedValueOnce(dispatch({ delivered: 2, recipient_failed: 1, errors: [{}] }));
    await expect(confirm()).rejects.toEqual(new MarketingBookSendError("BOOK_BLAST_DISPATCH_FAILED", null));
  });
});

describe("#3682 wave 3 — push-only campaigns", () => {
  it("every preview carries the channel", () => {
    expect(campaignPreviewInput("c1", null, "push")).toEqual({
      campaignId: "c1", audienceKind: "all_brand_people", channel: "push",
    });
    const compose = readFileSync(
      path.join(__dirname, "../../../../app/(tabs)/marketing/campaigns/compose.tsx"),
      "utf8",
    );
    // #4273: every path into the review shares one preview call.
    expect(compose.match(/campaignPreviewInput\(/g)?.length).toBe(1);
    expect(compose).toContain("void openReviewWithServerPreview()");
    expect(compose).not.toMatch(/bookPreviewMutation\.mutate(Async)?\(\{ campaignId/);
    expect(compose).toContain("setBookFailedConfirmationCount(result.failed)");
  });

  it("Friends of followers push needs roster and both guest-control switches", () => {
    expect(extendedPushReady(true, true, true)).toBe(true);
    expect(extendedPushReady(true, true, false)).toBe(false);
    expect(extendedPushReady(true, undefined, true)).toBe(false);
    expect(extendedPushReady(false, true, true)).toBe(false);
  });
});
