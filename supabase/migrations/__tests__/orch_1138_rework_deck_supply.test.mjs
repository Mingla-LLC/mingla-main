// ORCH-1138 Leg 3 REWORK (§9) — supply-widening migration structural test.
// The migration is NOT applied in CI; this asserts the authored SQL satisfies
// the §4.A.2/§4.A.3 contract: the deck RPC adds brand_theme + city + per-stop
// start_time; the venue RPC adds experience_intents + stops + occurrences; both
// DROP before the widened RETURNS TABLE; theme is anon-safe (view, not brands).
//
// fails-on-revert: removing a new column, the DROP, or the view-sourced theme
// flips a case red. Owner: mingla-implementor.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG = join(__dirname, "..", "20261007000000_orch_1138_rework_deck_supply.sql");

let passed = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
};

ok("the supply-widening migration exists", existsSync(MIG));
const sql = readFileSync(MIG, "utf8");

// --- deck RPC widening (§4.A.2) ---
ok(
  "deck RPC RETURNS adds brand_theme jsonb + city text",
  /RETURNS TABLE\([^)]*brand_theme jsonb, city text[^)]*\)/s.test(sql),
);
ok(
  "deck RPC DROPs before the widened RETURNS (DROP-before-widen rule)",
  /DROP FUNCTION IF EXISTS public\.pg_eligible_experiences_for_deck\(/.test(sql),
);
ok(
  "deck RPC sources brand_theme from the anon-safe view (COMMS-0009, NOT brands)",
  /business_public_events_view[\s\S]*brand_theme_color[\s\S]*AS brand_theme/.test(sql),
);
ok(
  "deck RPC carries per-stop start_time in the stops jsonb",
  /'start_time',\s*s\.start_time/.test(sql),
);
ok(
  "deck RPC final SELECT projects brand_theme + city",
  /el\.brand_theme\s+AS brand_theme/.test(sql) && /el\.city\s+AS city/.test(sql),
);
ok(
  "deck RPC theme read does NOT hit the brands table directly (COMMS-0009)",
  !/FROM public\.brands\b[\s\S]*theme_color/.test(sql),
);

// --- venue RPC widening (§4.A.3) ---
ok(
  "venue RPC DROPs before the widened RETURNS",
  /DROP FUNCTION IF EXISTS public\.pg_brand_experiences_for_place\(uuid\)/.test(sql),
);
ok(
  "venue RPC RETURNS adds experience_intents + stops + upcoming_occurrences",
  /experience_intents text\[\]/.test(sql) &&
    /stops jsonb/.test(sql) &&
    /upcoming_occurrences jsonb/.test(sql),
);
ok(
  "venue RPC stops jsonb carries image_urls + lat/lng + start_time",
  /'image_urls',\s*to_jsonb\(s\.image_urls\)/.test(sql) &&
    /'lat',\s*s\.lat/.test(sql) &&
    /'start_time',\s*s\.start_time/.test(sql),
);
ok(
  "venue RPC occurrences carry event-level remaining/capacity of the ONE ticket",
  /'remaining',\s*occ\.remaining/.test(sql) &&
    /available_online = true/.test(sql),
);

// --- transaction + grants ---
ok("one BEGIN/COMMIT transaction", /^BEGIN;/m.test(sql) && /^COMMIT;/m.test(sql));
ok(
  "deck RPC grant re-asserted to service_role only (no anon)",
  /GRANT EXECUTE ON FUNCTION public\.pg_eligible_experiences_for_deck[\s\S]*TO service_role/.test(sql),
);
ok(
  "venue RPC grant re-asserted to anon, authenticated, service_role",
  /GRANT EXECUTE ON FUNCTION public\.pg_brand_experiences_for_place\(uuid\) TO anon, authenticated, service_role/.test(sql),
);
ok("no GBP introduced (I-7)", !/\bGBP\b/.test(sql));

// --- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED preservation ---------
// This rework migration re-emits the ORCH-1072 venue-RPC body, which PREDATED
// the ORCH-1076 readiness gate. Both buyer-facing supply RPCs in this file MUST
// carry the `pg_brand_can_charge(` paid-supply gate or the serve-time mirror of
// the checkout 409 silently regresses (paid offerings from charge-disabled
// brands would leak back into the deck + venue supply). Slice each RPC body so a
// marker present in ONE function can't falsely satisfy the other.
function sliceFn(src, fn) {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`);
  if (start === -1) return "";
  const rest = src.slice(start + 1);
  const next = rest.indexOf("CREATE OR REPLACE FUNCTION public.");
  return next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
}
ok(
  "deck RPC body gates paid supply on pg_brand_can_charge (ORCH-1076)",
  sliceFn(sql, "pg_eligible_experiences_for_deck").includes("pg_brand_can_charge("),
);
ok(
  "venue RPC body gates paid supply on pg_brand_can_charge (ORCH-1076 — re-emitted ORCH-1072 body must NOT drop it)",
  sliceFn(sql, "pg_brand_experiences_for_place").includes("pg_brand_can_charge("),
);

console.log(`\n${passed} assertions passed.`);
