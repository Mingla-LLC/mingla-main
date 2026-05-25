// ORCH-0954 migration regression tests.
//
// Pins the DB contract that allows Stripe Accounts v2 dashboard:none rows to
// persist after brand-stripe-onboard writes controller_dashboard_type: "none".

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../20260727000002_orch_0954_controller_dashboard_type_check.sql",
    import.meta.url,
  ),
);

const onboardSource = await Deno.readTextFile(
  new URL("../../functions/brand-stripe-onboard/index.ts", import.meta.url),
);

function finalCheckValues(sql: string): string[] {
  const match = sql.match(
    /ADD CONSTRAINT stripe_connect_accounts_type_check\s+CHECK\s*\(\s*controller_dashboard_type\s*=\s*ANY\s*\(ARRAY\[([^\]]+)\]\)\s*\)/i,
  );
  assert(match !== null, "migration adds the replacement dashboard CHECK");
  return Array.from(
    match[1].matchAll(/'([^']+)'::text/g),
    (valueMatch) => valueMatch[1],
  );
}

Deno.test("ORCH-0954 allows dashboard:none connected-account persistence", () => {
  const values = finalCheckValues(migration);

  assertEquals(values, ["full", "express", "none"]);
  assert(values.includes("none"), "dashboard:none must satisfy the DB CHECK");
  assert(!values.includes("standard"), "legacy standard must not remain valid");
  assert(!values.includes("custom"), "legacy custom must not remain valid");
  assertStringIncludes(onboardSource, 'controller_dashboard_type: "none"');
});

Deno.test("ORCH-0954 migrates legacy values before tightening the CHECK", () => {
  assertMatch(
    migration,
    /DROP CONSTRAINT IF EXISTS stripe_connect_accounts_type_check/i,
  );
  assertMatch(migration, /WHEN 'standard' THEN 'full'/);
  assertMatch(migration, /WHEN 'custom' THEN 'none'/);
  assertMatch(
    migration,
    /WHERE controller_dashboard_type IN \('standard', 'custom'\)/,
  );
});
