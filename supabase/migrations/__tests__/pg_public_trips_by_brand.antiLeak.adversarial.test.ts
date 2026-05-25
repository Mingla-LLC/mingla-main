// ORCH-0963 [Public brand page business-case optimization]
// T-07 ADVERSARIAL anti-leak contract test.
//
// Attacks a DIFFERENT angle than T-01: T-01 verifies field presence + canonical
// formulas. T-07 verifies that NO bypass path exists for the brand-kind +
// event-type + visibility + status filters. Specifically pins that the
// brand-kind guard cannot be silently removed in a future refactor.
//
// Run locally:
//   deno test --allow-read supabase/migrations/__tests__/pg_public_trips_by_brand.antiLeak.adversarial.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql",
);

Deno.test("T-07a brand-kind guard present exactly once in function body", () => {
  // Scope to function body (strip leading comment header) so prose comments
  // about the guard don't inflate the count.
  const bodyMatch = migration.match(
    /CREATE OR REPLACE FUNCTION public\.pg_public_trips_by_brand[\s\S]*?\$\$;/,
  );
  assert(bodyMatch !== null, "function body found");
  const fnBody = bodyMatch[0];
  const kindGuards = fnBody.match(/b\.kind\s*=\s*'trip_planner'/g) ?? [];
  assertEquals(
    kindGuards.length,
    1,
    "exactly one b.kind = 'trip_planner' guard in function body — no bypass",
  );
});

Deno.test("T-07b no OR-branch around brand-kind guard could weaken it", () => {
  // Reject any pattern like: b.kind = 'trip_planner' OR ...
  assert(
    !/b\.kind\s*=\s*'trip_planner'\s+OR\b/i.test(migration),
    "no OR-branch weakening the brand-kind guard",
  );
  // Reject: b.kind IN ('trip_planner', ...) — the IN-list could be widened
  assert(
    !/b\.kind\s+IN\s*\([^)]*'trip_planner'[^)]*,/i.test(migration),
    "no IN-list around brand-kind that could be widened",
  );
});

Deno.test("T-07c trip CTE depends on brand CTE (no orphan WHERE-only path)", () => {
  // The trip_rows CTE MUST inner-join the brand CTE, not just reference
  // brand_slug elsewhere. If a future refactor breaks this join, event-brand
  // trips could leak.
  const tripRowsBlock = migration.match(/trip_rows AS \(([\s\S]*?)\)\s*,/);
  assert(tripRowsBlock !== null, "trip_rows CTE present");
  assert(
    /JOIN\s+brand\s+ON\s+brand\.id\s*=\s*e\.brand_id/i.test(tripRowsBlock[1]),
    "trip_rows CTE inner-joins brand CTE on brand_id — orphan trips cannot leak",
  );
});

Deno.test("T-07d event_type='trip' pin lives inside trip_rows CTE (defense in depth)", () => {
  const tripRowsBlock = migration.match(/trip_rows AS \(([\s\S]*?)\)\s*,/);
  assert(tripRowsBlock !== null);
  // First condition uses WHERE; subsequent use AND. Match both.
  assert(
    /(?:WHERE|AND)\s+e\.event_type\s*=\s*'trip'/i.test(tripRowsBlock[1]),
    "trip_rows pins event_type='trip' independently of the brand CTE — two-layer guard",
  );
});

Deno.test("T-07e function returns ZERO rows for popup-brand input by construction", () => {
  // The brand CTE filters by kind='trip_planner'. If brand row fails this,
  // the CTE returns empty. The trip_rows CTE inner-joins the brand CTE, so
  // trip_rows is also empty. Final SELECT is FROM trip_rows. Therefore:
  // input slug for a popup or physical brand → empty result, NEVER event rows.
  // This is a structural assertion: pin the inner-join shape.
  const finalSelect = migration.match(/SELECT[\s\S]*?FROM trip_rows tr/i);
  assert(finalSelect !== null, "final SELECT pulls FROM trip_rows tr");
  // Also pin that we did NOT add a fallback like UNION ALL pulling from events directly
  assert(!/UNION\s+ALL/i.test(migration), "no UNION ALL bypass");
});

Deno.test("T-07f no anon-callable wrapper without the brand-kind guard", () => {
  // Pin: there is exactly ONE CREATE OR REPLACE FUNCTION in this migration,
  // and it carries the brand-kind guard. A future patch that adds a wrapper
  // function without the guard would fail this assertion.
  const fnCreates = migration.match(/CREATE OR REPLACE FUNCTION\s+\S+/g) ?? [];
  assertEquals(fnCreates.length, 1, "exactly one function definition in this migration");
});

Deno.test("T-07g SECURITY DEFINER posture matched with REVOKE FROM PUBLIC", () => {
  // SECURITY DEFINER without REVOKE FROM PUBLIC could leak — pin both.
  assert(/SECURITY DEFINER/.test(migration));
  assert(
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.pg_public_trips_by_brand\(text\)\s+FROM\s+PUBLIC/i.test(
      migration,
    ),
    "REVOKE FROM PUBLIC pairs with SECURITY DEFINER",
  );
});
