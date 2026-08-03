// issue #962 [pre-bank-currency-degbp] R2 — the consumer discover feed and the
// /e/ cold seed must agree on the last-resort currency for a null-currency row.
//
// THE SPLIT-BRAIN — the SAME DB event row rendered £ in the consumer discover
// deck (this edge fn) but $ via a shared /e/ link. `_business-query.ts:129` fell
// back to "GBP"; the /e/ seed (app-mobile/src/services/publicEventSeedService.ts)
// falls back to "USD". The fix byte-matches both on USD, so a pre-bank brand's
// event shows the SAME symbol everywhere (and GBP is never fabricated). A set
// currency passes through unchanged on both paths.
//
// FAILS-ON-REVERT (true line-deletion, proven in the implementation report):
//   revert `_business-query.ts` to `String(row.currency ?? "GBP")` →
//   T-962-R2-1 FAILS (card.currency becomes "GBP", not "USD").

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { mapRpcRowToCard } from "../_business-query.ts";

// A minimal-but-realistic discover RPC row (the shape pg_discover_business_events
// emits). Only `currency` matters for this suite; everything else defaults safely.
function discoverRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "d3aa8011-664f-4cb8-a85e-5e696bb34638",
    brand_id: "22a18413-bfbf-4087-9ba7-45f70deba0f3",
    brand_slug: "leggothis",
    brand_name: "Leggo This",
    slug: "the-second-test",
    title: "The Second Test",
    theme: { coverHue: 25, business_event: { format: "in_person" } },
    location_text: "The Party Venue",
    city: "Raleigh",
    timezone: "America/New_York",
    is_online: false,
    master_start_at: "2026-06-17T17:00:00+00:00",
    master_end_at: "2026-06-18T08:00:00+00:00",
    event_type: "event",
    ...overrides,
  };
}

Deno.test("issue #962 T-R2-1: a null-currency discover row falls back to USD (never GBP)", () => {
  const card = mapRpcRowToCard(discoverRow({ currency: null }));
  assertEquals(card.currency, "USD");
  assert(card.currency !== "GBP", "must not fabricate GBP for a pre-bank row");
});

Deno.test("issue #962 T-R2-2: a missing currency key also falls back to USD", () => {
  const card = mapRpcRowToCard(discoverRow()); // no `currency` key at all
  assertEquals(card.currency, "USD");
});

Deno.test("issue #962 T-R2-3: a SET currency passes through unchanged", () => {
  assertEquals(mapRpcRowToCard(discoverRow({ currency: "GBP" })).currency, "GBP");
  assertEquals(mapRpcRowToCard(discoverRow({ currency: "USD" })).currency, "USD");
  assertEquals(mapRpcRowToCard(discoverRow({ currency: "NGN" })).currency, "NGN");
});

// Consistency lock — the /e/ cold seed must use the SAME "USD" last-resort so the
// two paths never disagree. We assert the seed's source text carries the exact
// byte-matched fallback (the seed is an RN module we cannot import here).
Deno.test("issue #962 T-R2-4: the /e/ cold seed byte-matches the USD last-resort", async () => {
  const seed = await Deno.readTextFile(
    new URL(
      "../../../../app-mobile/src/services/publicEventSeedService.ts",
      import.meta.url,
    ),
  );
  assertStringIncludes(seed, 'currency: row.currency ?? "USD"');
  // And it must NOT have reverted to a GBP fallback.
  assert(
    !seed.includes('currency: row.currency ?? "GBP"'),
    "the /e/ seed must not fall back to GBP",
  );
});
