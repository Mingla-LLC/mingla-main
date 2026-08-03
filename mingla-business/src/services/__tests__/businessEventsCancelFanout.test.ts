import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// #1179 [cancel-refund-fanout] — coverage that the buyer auto-refund fan-out
// kickoff added to `cancelBusinessEvent` is a STRICTLY TRANSPARENT, best-effort
// side effect: it fires after the lifecycle RPC succeeds, but a rejecting (or
// absent) fan-out endpoint can NEVER reject into the cancel adapter's promise
// nor alter the mapped event. Correctness of the refund itself is owned by the
// backstop pg_cron + the #1179 Deno/PG17 DB suite — this file only guards the
// client-side kickoff contract. New file so the existing publish-adapter test
// stays byte-for-byte unmodified (append-only gate stays trivially green).

const rpcMock = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: null }>
>();
const invokeMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: rpcMock,
    functions: {
      invoke: invokeMock,
    },
  },
}));

import { cancelBusinessEvent } from "../businessEvents";

const EVENT_ID = "00000000-0000-4000-8000-000000000001";

const cancelledResponse = () => ({
  event: {
    id: EVENT_ID,
    brand_id: "00000000-0000-4000-8000-000000000002",
    created_by: "00000000-0000-4000-8000-000000000003",
    title: "Visa",
    description: "Free launch event.",
    slug: "visa",
    location_text: "Main Hall · 1 High Street",
    online_url: null,
    is_online: false,
    is_recurring: false,
    is_multi_date: false,
    recurrence_rules: null,
    cover_media_url: null,
    cover_media_type: null,
    cover_media_provider: null,
    cover_media_source_url: null,
    cover_media_credit: null,
    cover_media_credit_url: null,
    cover_media_alt: null,
    currency: "USD",
    visibility: "public",
    status: "cancelled",
    published_at: "2026-05-08T18:30:00.000Z",
    timezone: "Europe/London",
    created_at: "2026-05-08T18:00:00.000Z",
    updated_at: "2026-05-08T19:00:00.000Z",
    theme: {
      coverHue: 25,
      business_event: {
        format: "in_person",
        requestedVisibility: "public",
        coverHue: 25,
        whenMode: "single",
        when: {
          date: "2026-06-01",
          doorsOpen: "18:00",
          endsAt: "22:00",
          timezone: "Europe/London",
        },
        location: {
          venueName: "Main Hall",
          address: "1 High Street",
        },
        settings: {},
      },
    },
  },
  brand: {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "leggothis",
    name: "Leggo This",
  },
  tickets: [],
  client_revision: null,
});

describe("cancel adapter refund fan-out kickoff (#1179)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    invokeMock.mockReset();
  });

  test("fires the buyer refund fan-out edge function after a successful cancel", async () => {
    rpcMock.mockResolvedValueOnce({ data: cancelledResponse(), error: null });
    invokeMock.mockResolvedValueOnce({ data: { ok: true }, error: null });

    const cancelled = await cancelBusinessEvent(EVENT_ID);

    // The lifecycle RPC contract is unchanged.
    expect(rpcMock).toHaveBeenCalledWith("business_cancel_event", {
      p_event_id: EVENT_ID,
    });
    // The best-effort kickoff fired with the documented payload.
    expect(invokeMock).toHaveBeenCalledWith("event-cancel-refund-fanout", {
      body: { event_id: EVENT_ID },
    });
    // The mapped event is returned exactly as the RPC produced it.
    expect(cancelled.event.status).toBe("cancelled");
    expect(cancelled.event.cancelledAt).toBe("2026-05-08T19:00:00.000Z");
  });

  test("still resolves the cancel with the mapped event when the fan-out kickoff rejects", async () => {
    rpcMock.mockResolvedValueOnce({ data: cancelledResponse(), error: null });
    invokeMock.mockRejectedValueOnce(new Error("edge function unreachable"));

    // A rejecting fan-out endpoint must have ZERO effect on the cancel adapter.
    const cancelled = await cancelBusinessEvent(EVENT_ID);

    expect(invokeMock).toHaveBeenCalledWith("event-cancel-refund-fanout", {
      body: { event_id: EVENT_ID },
    });
    expect(cancelled.event.status).toBe("cancelled");
    expect(cancelled.event.cancelledAt).toBe("2026-05-08T19:00:00.000Z");
  });
});
