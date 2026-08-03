import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  handleVenueOrganicCapture,
  type VenueOrganicCaptureDeps,
} from "../index.ts";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const VENUE_ID = "22222222-2222-4222-8222-222222222222";
const JOURNEY_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN_HASH =
  "b52b3ef2233858ce1156d85f235cf2c41eddfa8ca1eedc924398b9af1db303cb";

interface FakeState {
  eventWrites: number;
  journeyLookups: number;
}

function harness(): { deps: VenueOrganicCaptureDeps; state: FakeState } {
  const state: FakeState = { eventWrites: 0, journeyLookups: 0 };
  const builderFor = (table: string) => {
    const filters = new Map<string, unknown>();
    const builder = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.set(column, value);
        return builder;
      },
      async maybeSingle() {
        if (table === "venue_public_view") {
          return {
            data:
              filters.get("id") === VENUE_ID &&
                filters.get("brand_id") === BRAND_ID
                ? { id: VENUE_ID, brand_id: BRAND_ID }
                : null,
            error: null,
          };
        }
        state.journeyLookups += 1;
        return {
          data: filters.get("token_hash") === TOKEN_HASH
            ? {
              id: JOURNEY_ID,
              brand_id: BRAND_ID,
              venue_id: VENUE_ID,
              surface: "buyer_web",
              expires_at: "2026-07-30T21:59:59.999Z",
            }
            : null,
          error: null,
        };
      },
      insert() {
        throw new Error("expired/native requests must not create journeys");
      },
      async upsert() {
        state.eventWrites += 1;
        return { error: null };
      },
    };
    return builder;
  };
  return {
    state,
    deps: {
      client: {
        from: builderFor,
      } as unknown as VenueOrganicCaptureDeps["client"],
      now: () => new Date("2026-07-30T22:00:00.000Z"),
      randomUUID: () => JOURNEY_ID,
      randomToken: () => "must-not-be-generated",
    },
  };
}

function request(body: Record<string, unknown>): Request {
  return new Request("https://example.test/venue-organic-capture", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.142",
    },
    body: JSON.stringify({
      eventId: EVENT_ID,
      brandId: BRAND_ID,
      venueId: VENUE_ID,
      eventType: "menu_open",
      surface: "buyer_web",
      journeyToken: "expired-token",
      referrerHost: null,
      hasAdSignal: false,
      ...body,
    }),
  });
}

Deno.test("#1421 tester: expired tokens and unproven native surfaces fail closed before writes", async () => {
  const expiredHarness = harness();
  const expired = await handleVenueOrganicCapture(
    request({}),
    expiredHarness.deps,
  );
  assertEquals(await expired.json(), {
    accepted: false,
    reason: "journey_invalid",
  });
  assertEquals(expiredHarness.state.journeyLookups, 1);
  assertEquals(expiredHarness.state.eventWrites, 0);

  for (
    const surface of [
      "consumer_ios",
      "consumer_android",
      "business_preview",
      "admin",
    ]
  ) {
    const nativeHarness = harness();
    const response = await handleVenueOrganicCapture(
      request({ surface, journeyToken: null }),
      nativeHarness.deps,
    );
    assertEquals((await response.json()).accepted, false);
    assertEquals(nativeHarness.state.journeyLookups, 0);
    assertEquals(nativeHarness.state.eventWrites, 0);
  }
});
