/**
 * #4273 retest, tester adversarial — the server hides a contact-match skip from
 * skipped_after_confirm so the Host cannot see the match. The client must then
 * accept delivered + skipped below the quote's reach: "the reachable count can
 * run slightly above what sends" is the product decision. If it throws instead,
 * a Blast that went out reads as failed, its other methods never send, and the
 * failure itself tells the Host a typed contact matched someone.
 *
 * FAILS-ON-REVERT: the arithmetic in confirmMarketingBook requiring the counts to
 * equal the quote's reach exactly.
 */
jest.mock("../../supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import { supabase } from "../../supabase";
import { confirmMarketingBook } from "../marketingBookSendService";

const invoke = supabase.functions.invoke as jest.Mock;
const quote = {
  reachableCount: 3, quoteHash: "h", quotedAt: "now", estimatedCostMinor: null, currency: null,
} as never;
const answer = (over: Record<string, unknown>) => ({
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
    audience_kind: "combined_sources",
    channel: "email",
  });

describe("#4273 retest: a hidden skip is not a failed send", () => {
  it("delivered below the quote's reach, with nothing visible skipped, reads as sent", async () => {
    // What marketing-send answers: reach 3, one address sent once for two rows.
    invoke.mockResolvedValueOnce(answer({ delivered: 2, skipped_after_confirm: 0 }));
    await expect(confirm()).resolves.toMatchObject({ delivered: 2, failed: 0 });
  });

  it("the same when a contact match stopped one person", async () => {
    invoke.mockResolvedValueOnce(answer({ delivered: 1, recipient_failed: 1, skipped_after_confirm: 0 }));
    await expect(confirm()).resolves.toMatchObject({ delivered: 1, failed: 1 });
  });

  it("more accounted than the quote's reach is still refused", async () => {
    invoke.mockResolvedValueOnce(answer({ delivered: 4 }));
    await expect(confirm()).rejects.toMatchObject({ code: "BOOK_BLAST_DISPATCH_FAILED" });
  });
});
