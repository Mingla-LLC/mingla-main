import {
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  classifyEntrySource,
  deriveReferrerHost,
} from "../../_shared/entrySource.ts";
import {
  handleVenueOrganicCapture,
  type VenueOrganicCaptureDeps,
} from "../index.ts";

Deno.test("#1421 shared classifier accepts only proven unpaid sources", () => {
  assertEquals(classifyEntrySource({ hasAdSignal: false, referrerHost: null }), "direct");
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: "www.google.com" }),
    "search",
  );
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: "l.instagram.com" }),
    "social",
  );
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: "usemingla.com" }),
    "organic",
  );
  assertEquals(
    classifyEntrySource({ hasAdSignal: true, referrerHost: "google.com" }),
    "ad",
  );
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: "example.com" }),
    "unknown",
  );
});

Deno.test("#1421 classifier strips path/query and rejects lookalikes", () => {
  assertEquals(
    deriveReferrerHost("https://www.google.com/search?q=private"),
    "google.com",
  );
  assertEquals(
    classifyEntrySource({
      hasAdSignal: false,
      referrerHost: deriveReferrerHost("https://google.com.attacker.net/path"),
    }),
    "unknown",
  );
});

interface FakeState {
  journeys: Array<Record<string, unknown>>;
  events: Map<string, Record<string, unknown>>;
}

function captureHarness(): {
  deps: VenueOrganicCaptureDeps;
  state: FakeState;
} {
  const state: FakeState = { journeys: [], events: new Map() };
  const venues = [
    {
      id: "22222222-2222-4222-8222-222222222222",
      brand_id: "11111111-1111-4111-8111-111111111111",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      brand_id: "11111111-1111-4111-8111-111111111111",
    },
  ];
  const client = {
    from(table: string) {
      const filters = new Map<string, unknown>();
      let insertRow: Record<string, unknown> | null = null;
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
              data: venues.find((row) =>
                [...filters].every(([key, value]) =>
                  row[key as keyof typeof row] === value
                )
              ) ?? null,
              error: null,
            };
          }
          const journey = state.journeys.find((row) =>
            [...filters].every(([key, value]) => row[key] === value)
          ) ?? null;
          return { data: journey, error: null };
        },
        insert(row: Record<string, unknown>) {
          insertRow = row;
          return builder;
        },
        async single() {
          if (insertRow === null) return { data: null, error: "missing_insert" };
          const row: Record<string, unknown> = {
            ...insertRow,
            expires_at: "2026-07-31T22:00:00.000Z",
          };
          state.journeys.push(row);
          return { data: { id: row.id }, error: null };
        },
        async upsert(
          row: Record<string, unknown>,
          _options: Record<string, unknown>,
        ) {
          const id = String(row.id);
          if (!state.events.has(id)) state.events.set(id, row);
          return { error: null };
        },
      };
      return builder;
    },
  };
  return {
    state,
    deps: {
      client: client as unknown as VenueOrganicCaptureDeps["client"],
      now: () => new Date("2026-07-30T22:00:00.000Z"),
      randomUUID: () => "44444444-4444-4444-8444-444444444444",
      randomToken: () => "opaque-token-a",
    },
  };
}

function request(
  body: Record<string, unknown>,
  ip: string,
): Request {
  return new Request("https://example.test/venue-organic-capture", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify({
      eventId: "55555555-5555-4555-8555-555555555555",
      brandId: "11111111-1111-4111-8111-111111111111",
      venueId: "22222222-2222-4222-8222-222222222222",
      eventType: "page_view",
      surface: "buyer_web",
      referrerHost: null,
      hasAdSignal: false,
      ...body,
    }),
  });
}

Deno.test("#1421 handle accepts a proven journey and dedupes event IDs", async () => {
  const { deps, state } = captureHarness();
  const first = await handleVenueOrganicCapture(request({}, "198.51.100.1"), deps);
  const firstBody = await first.json();
  assertEquals(firstBody.accepted, true);
  assertEquals(firstBody.journeyToken, "opaque-token-a");
  assertEquals(state.journeys.length, 1);
  assertEquals(state.events.size, 1);

  const duplicate = await handleVenueOrganicCapture(
    request({ journeyToken: "opaque-token-a" }, "198.51.100.1"),
    deps,
  );
  assertEquals((await duplicate.json()).accepted, true);
  assertEquals(state.journeys.length, 1);
  assertEquals(state.events.size, 1);
});

Deno.test("#1421 handle rejects paid/unknown sources and cross-venue tokens", async () => {
  const { deps, state } = captureHarness();
  const paid = await handleVenueOrganicCapture(
    request({ hasAdSignal: true }, "198.51.100.2"),
    deps,
  );
  assertEquals(await paid.json(), {
    accepted: false,
    reason: "source_ineligible",
  });
  const unknown = await handleVenueOrganicCapture(
    request({ referrerHost: "affiliate.example" }, "198.51.100.3"),
    deps,
  );
  assertEquals(await unknown.json(), {
    accepted: false,
    reason: "source_ineligible",
  });
  assertEquals(state.journeys.length, 0);

  const accepted = await handleVenueOrganicCapture(
    request({}, "198.51.100.4"),
    deps,
  );
  assertEquals((await accepted.json()).accepted, true);
  const mismatch = await handleVenueOrganicCapture(
    request({
      venueId: "33333333-3333-4333-8333-333333333333",
      eventId: "66666666-6666-4666-8666-666666666666",
      journeyToken: "opaque-token-a",
      eventType: "menu_open",
    }, "198.51.100.4"),
    deps,
  );
  assertEquals(await mismatch.json(), {
    accepted: false,
    reason: "journey_invalid",
  });
  assertEquals(state.events.size, 1);
});
