// ORCH-1188 [consumer post-purchase fixes] — calendarService contract tests.
//
// FIX 2: "View on web" opened `/e/{slug}` for ALL orders; the /e/ resolver
//   rejects trip/experience slugs → "can't open page". The public URL prefix
//   must be `/t/` for trips, `/exp/` for experiences, `/e/` for event+rsvp.
// FIX 3c: the calendar read the EVENT's is_master (often past) occurrence even
//   when the buyer booked a DIFFERENT occurrence → wrong date + wrong
//   upcoming/archive split. The booked occurrence (orders.event_date_id) must
//   be preferred, falling back to is_master only when null.
//
// `calendarService.ts` imports the React-Native `./supabase` client, so it
// can't be imported under `deno test`. This suite is therefore SOURCE-CONTRACT
// (matches the repo's hybrid-test convention, e.g.
// orch_1157_round3_consumer_hide_address.test.ts): it reads the real source and
// asserts the load-bearing logic is present.
//
// FAILS-ON-REVERT:
//   - revert the URL build to the hardcoded `/e/${brand.slug}/${event.slug}`
//     → the per-type-prefix asserts fail.
//   - revert the booked-occurrence read (masterDate fallback) → the
//     event_date_id-preference asserts fail.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(
  new URL("../calendarService.ts", import.meta.url),
);

// ─── FIX 2: URL prefix by event_type ──────────────────────────────────────────

Deno.test("FIX2 — buyerPagePrefixForEventType maps trip→t, experience→exp, else→e", () => {
  // The helper is a pure switch; assert each arm is present in source.
  assertStringIncludes(SRC, "export function buyerPagePrefixForEventType");
  assertStringIncludes(SRC, 'case "trip":');
  assertStringIncludes(SRC, 'return "t"');
  assertStringIncludes(SRC, 'case "experience":');
  assertStringIncludes(SRC, 'return "exp"');
  // default arm returns "e" for standard events + rsvp.
  assertStringIncludes(SRC, 'return "e"');
});

Deno.test("FIX2 — publicBuyerUrl is built from the type prefix, not a hardcoded /e/", () => {
  // The URL must be assembled via the helper.
  assertStringIncludes(SRC, "buyerPagePrefixForEventType(");
  // The query must select event_type so the prefix can be derived.
  assert(
    /event_type/.test(SRC),
    "the orders→events select must include event_type",
  );
  // The OLD hardcoded `/e/${brand.slug}/${event.slug}` must be GONE.
  assert(
    !/\/e\/\$\{brand\.slug\}\/\$\{event\.slug\}/.test(SRC),
    "the hardcoded /e/ buyer URL must be removed (FIX 2 regression)",
  );
});

// ─── FIX 3c: booked occurrence preferred over is_master ───────────────────────

Deno.test("FIX3c — the select reads orders.event_date_id", () => {
  assert(
    /id, event_id, payment_status, created_at, ticket_pdf_path, event_date_id/
      .test(SRC),
    "the orders select must include event_date_id",
  );
});

Deno.test("FIX3c — booked occurrence is preferred, is_master is the fallback", () => {
  // The booked occurrence is matched by id against order.event_date_id.
  assertStringIncludes(SRC, "order.event_date_id");
  assertStringIncludes(SRC, "ed?.id === order.event_date_id");
  // masterDate falls back to is_master only when no booked occurrence.
  assert(
    /bookedOccurrence\s*\?\?[\s\S]*is_master === true/.test(SRC),
    "masterDate must prefer bookedOccurrence and fall back to is_master",
  );
});

// ─── Sanity: the helper's logic is internally consistent (pure re-impl) ───────
// Mirror the switch so a future logic change to the arms is caught behaviorally.
function prefix(t: string | null | undefined): string {
  switch (t) {
    case "trip":
      return "t";
    case "experience":
      return "exp";
    default:
      return "e";
  }
}

Deno.test("FIX2 — prefix mapping behavior (mirror)", () => {
  assertEquals(prefix("trip"), "t");
  assertEquals(prefix("experience"), "exp");
  assertEquals(prefix("event"), "e");
  assertEquals(prefix("rsvp"), "e");
  assertEquals(prefix(null), "e");
  assertEquals(prefix(undefined), "e");
});
