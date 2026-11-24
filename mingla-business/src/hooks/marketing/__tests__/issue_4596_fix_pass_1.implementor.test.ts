/**
 * #4596 fix pass 1 — every event count a host sees comes from the server's one
 * owner, for every rank that can open it.
 *  - An event manager's Blasts count uses only the discovery RPC (marketing
 *    manager and up, so event_manager 40 >= 20) and the event reach RPC
 *    (event_manager): never the summary, never the orders roster.
 *  - The Audiences tab reach for an event row is the server's (RSVP guests
 *    included), not the orders-only roster that showed 0.
 *  - A failed method's reason (push included) is read for the detail screen.
 */
const rpc = jest.fn();
const maybeSingle = jest.fn();
const from = jest.fn(() => ({
  select: () => ({ eq: () => ({ maybeSingle }) }),
}));
jest.mock("../../../services/supabase", () => ({ supabase: { rpc, from } }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true, user: null }) }));

import { loadEventAudienceCount } from "../useEventAudienceCount";
import { getCampaignFailureReason } from "../useCampaignFailureReason";
import { resolveEventAudienceReach } from "../../../services/marketing/marketingAudienceService";

const ACTOR = "45960000-0000-4000-8000-000000000007";
const BRAND = "45960000-0000-4000-8000-0000000000b1";
const EVENT = "45960000-0000-4000-8000-0000000000e1";

beforeEach(() => {
  rpc.mockReset();
  maybeSingle.mockReset();
});

describe("#4596 FP1 an event manager's Blasts count", () => {
  it("reads discovery and the event reach only, and shows the guests", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: EVENT, brand_id: BRAND, event_type: "rsvp" }, error: null });
    rpc.mockImplementation(async (name: string) => name === "biz_marketing_event_audiences_v1"
      ? { data: [{ eventId: EVENT, title: "Rooftop", eventType: "rsvp", startsAt: null,
          buyerCount: 0, guestCount: 3, peopleCount: 3, pendingReviewCount: 1 }], error: null }
      : name === "biz_marketing_event_roster_v1"
        ? { data: { eventTitle: "Rooftop", rows: [] }, error: null }
        : { data: 2, error: null });
    const count = await loadEventAudienceCount(ACTOR, EVENT);
    expect(count).toMatchObject({ shape: "guests", peopleCount: 3, reachableEmail: 2, pendingReviewCount: 1 });
    // Fix pass 3: the roster (event_manager and up) joins the two count reads.
    // The reach reader asks email and SMS (the Audiences tab's own reader).
    expect(rpc.mock.calls.map((call) => call[0]).sort()).toEqual([
      "biz_marketing_combined_audience_reach_v1",
      "biz_marketing_combined_audience_reach_v1",
      "biz_marketing_event_audiences_v1",
      "biz_marketing_event_roster_v1",
    ]);
    expect(rpc).toHaveBeenCalledWith("biz_marketing_combined_audience_reach_v1", expect.objectContaining({
      p_actor_id: ACTOR, p_brand_id: BRAND, p_sources: [`event:${EVENT}`], p_channel: "email",
    }));
  });
});

describe("#4596 FP2 the Audiences tab reads the server's event reach", () => {
  it("counts RSVP guests through the event source, email and SMS", async () => {
    rpc.mockImplementation(async (_name: string, args: { p_channel: string }) =>
      ({ data: args.p_channel === "email" ? 2 : 1, error: null }));
    const reach = await resolveEventAudienceReach({
      actor_id: ACTOR, brand_id: BRAND, event_id: EVENT, people_count: 3,
    });
    expect(reach).toEqual({ total: 3, reachable_email: 2, reachable_sms: 1 });
    expect(rpc).toHaveBeenCalledTimes(2);
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe("biz_marketing_combined_audience_reach_v1");
      expect(call[1]).toMatchObject({ p_sources: [`event:${EVENT}`] });
    }
  });
  it("a failed reach is an error, never a quiet 0", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("forbidden") });
    await expect(resolveEventAudienceReach({
      actor_id: ACTOR, brand_id: BRAND, event_id: EVENT, people_count: 3,
    })).rejects.toThrow("forbidden");
  });
});

describe("#4596 FP5 a failed method's reason, push included", () => {
  it("reads failure_reason; none is null", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { failure_reason: "no_recipients" }, error: null });
    await expect(getCampaignFailureReason("c1")).resolves.toBe("no_recipients");
    maybeSingle.mockResolvedValueOnce({ data: { failure_reason: null }, error: null });
    await expect(getCampaignFailureReason("c1")).resolves.toBeNull();
  });
});
