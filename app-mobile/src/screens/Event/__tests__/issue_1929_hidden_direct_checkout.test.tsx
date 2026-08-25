jest.mock("@mingla/offering-rendering", () => ({
  // issue #2562 — this partial factory must carry every export the hook
  // imports, or the mapper throws before any assertion below runs. These
  // suites predate the past-event rule and assert nothing about it, so the
  // stub returns `undefined`: exactly the shape they were written against.
  forwardableAcquisitionState: () => undefined,

  isThemeAnimationSlug: () => false,
  isThemeColor: () => false,
  isThemeFontSlug: () => false,
}));
jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));
jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

import {
  acceptRsvpLegacySeed,
  directEventColdReadPlan,
  mapRpcPayloadToPublicEvent,
} from "../../../hooks/usePublicEventBySlug";

const canonical = mapRpcPayloadToPublicEvent({
  id: "hidden-event",
  brandId: "brand",
  brandSlug: "brand-slug",
  eventSlug: "hidden-event",
  name: "Hidden Event",
  status: "live",
  currency: "NGN",
  tickets: [{ id: "bundle-tier", name: "General", isFree: true }],
  brand: null,
});

describe("#1929 Consumer screen cold-read composition", () => {
  test("canonical public/hidden standard event owns body and tickets with zero legacy reads", () => {
    const plan = directEventColdReadPlan(
      false,
      { isSuccess: true, data: canonical },
      true,
    );
    expect(plan.canonical?.event.id).toBe("hidden-event");
    expect(plan.canonical?.event.tickets.map((ticket) => ticket.id)).toEqual([
      "bundle-tier",
    ]);
    expect(plan.allowLegacySeedRead).toBe(false);
    expect(plan.allowLegacyTicketRead).toBe(false);
  });

  test("SQL NULL caps private/unknown standard events but admits an RSVP-only legacy seed", () => {
    const plan = directEventColdReadPlan(
      false,
      { isSuccess: true, data: null },
      true,
    );
    expect(plan.canonical).toBeNull();
    expect(plan.allowLegacySeedRead).toBe(true);
    expect(
      acceptRsvpLegacySeed({ eventType: "event", id: "private" }),
    ).toBeNull();
    expect(acceptRsvpLegacySeed({ eventType: "rsvp", id: "rsvp-1" })).toEqual({
      eventType: "rsvp",
      id: "rsvp-1",
    });
  });

  test("warm opens and incomplete identities never issue a legacy seed lookup", () => {
    expect(
      directEventColdReadPlan(true, { isSuccess: true, data: null }, true)
        .allowLegacySeedRead,
    ).toBe(false);
    expect(
      directEventColdReadPlan(false, { isSuccess: true, data: null }, false)
        .allowLegacySeedRead,
    ).toBe(false);
  });
});
