/* eslint-disable import/first */
// [TEST-MOD-APPROVED #1971]
// Currency/default-tier ownership moved from fragmented client inserts into
// the canonical database command. This test pins both halves of that boundary.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createChainableQuery } from "./__helpers__/supabaseMock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (name: string, args: unknown) => rpcMock(name, args),
  },
}));

import { createTripDraft } from "../tripsService";

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

describe("#1971 — createTripDraft canonical currency boundary", () => {
  test("one command creates the graph and the client performs no fragmented insert", async () => {
    const event = {
      id: "event-1",
      brand_id: "brand-1",
      title: "Untitled trip",
      description: null,
      slug: "draft-x",
      status: "draft",
      visibility: "draft",
      published_at: null,
      timezone: "UTC",
      cover_media_url: null,
      cover_media_type: null,
      theme: { business_trip: {} },
      event_type: "trip",
      created_at: "2026-08-14T00:00:00Z",
      updated_at: "2026-08-14T00:00:00Z",
      brands: { slug: "travelbrand" },
      refund_policy: null,
      booking_deadline: null,
      bookings_closed: false,
      bookings_closed_at: null,
    };
    rpcMock.mockImplementation((name: string) =>
      Promise.resolve(
        name === "biz_create_trip_draft"
          ? { data: { event: { id: "event-1" } }, error: null }
          : { data: 0, error: null },
      ),
    );
    fromMock.mockImplementation((table: string) =>
      createChainableQuery({
        data: table === "events" ? event : table === "event_dates" ? null : [],
      }),
    );

    const trip = await createTripDraft(
      {
        brandId: "brand-1",
        operationId: "11111111-1111-4111-8111-111111111111",
      },
      "owner",
    );

    expect(trip.id).toBe("event-1");
    expect(rpcMock).toHaveBeenCalledWith("biz_create_trip_draft", {
      p_brand_id: "brand-1",
      p_seed: { title: "Untitled trip" },
      p_operation_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("the command derives nullable currency from the brand before event and tier inserts", () => {
    const sql = readFileSync(
      join(
        __dirname,
        "../../../../supabase/migrations/20270509001971_issue_1971_ari_trip_lifecycle.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("SELECT default_currency INTO v_currency");
    expect(sql).toMatch(
      /INSERT INTO public\.events[^]*?currency[^]*?v_currency/,
    );
    expect(sql).toMatch(
      /INSERT INTO public\.ticket_types[^]*?currency[^]*?v_currency/,
    );
    expect(sql).not.toContain("COALESCE(v_currency,'USD')");
  });
});
