import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const rpc = jest.fn<(...args: unknown[]) => Promise<{ data: unknown; error: Error | null }>>();
const invoke = jest.fn<(...args: unknown[]) => Promise<{ data: unknown; error: Error | null }>>();

jest.mock("../supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

import { bulkApproveRsvps, setRsvpStatus } from "../rsvpApprovals";
import { requestRsvpContributionRefund } from "../sourceRefundService";

const EVENT_ID = "19770000-0000-4000-8000-000000000001";
const RSVP_ID = "19770000-0000-4000-8000-000000000002";
const CONTRIBUTION_ID = "19770000-0000-4000-8000-000000000003";

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => "19770000-0000-4000-8000-000000000099" },
  });
});

describe("#1977 Business RSVP lifecycle parity", () => {
  test("single and all-pending decisions use the same exact-once owner", async () => {
    rpc.mockResolvedValue({ data: { appliedCount: 1, pendingRemaining: 0, goingPersonCount: 2 }, error: null });
    await setRsvpStatus(EVENT_ID, RSVP_ID, "approved");
    await bulkApproveRsvps(EVENT_ID);
    expect(rpc.mock.calls[0]).toEqual(["business_set_rsvp_guest_status", expect.objectContaining({
      p_event_id: EVENT_ID,
      p_scope: "selected",
      p_roster_keys: [`rsvp:${RSVP_ID}`],
    })]);
    expect(rpc.mock.calls[1]).toEqual(["business_set_rsvp_guest_status", expect.objectContaining({
      p_event_id: EVENT_ID,
      p_scope: "all_pending",
      p_roster_keys: null,
    })]);
  });

  test("contribution refund is event-bound and never sends an order or amount", async () => {
    invoke.mockResolvedValue({ data: { refund: {
      refund_id: "refund-1", source_type: "rsvp_contribution", subject_id: CONTRIBUTION_ID,
      refund_kind: "rsvp_discretionary", buyer_state: "pending", fee_state: "not_required",
      financial_state: "pending", amount_cents: 1200, currency: "NGN",
      requested_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z",
      processed_at: null, ops_status: "pending", can_retry: false,
    } }, error: null });
    await requestRsvpContributionRefund({
      eventId: EVENT_ID,
      contributionId: CONTRIBUTION_ID,
      mode: "discretionary",
      reason: "Guest requested the contribution refund",
    });
    const body = (invoke.mock.calls[0]?.[1] as { body: Record<string, unknown> }).body;
    expect(body).toEqual(expect.objectContaining({ eventId: EVENT_ID, contributionId: CONTRIBUTION_ID }));
    expect(body).not.toHaveProperty("orderId");
    expect(body).not.toHaveProperty("amountCents");
  });
});
