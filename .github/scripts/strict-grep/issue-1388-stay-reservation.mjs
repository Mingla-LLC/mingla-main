#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  schema:
    "supabase/migrations/20270131013810_issue_1388_stay_reservation_schema.sql",
  management:
    "supabase/migrations/20270131013811_issue_1388_stay_reservation_management.sql",
  edge: "supabase/functions/stay-reservations/index.ts",
  config: "supabase/config.toml",
  service: "mingla-business/src/services/stayReservationService.ts",
  types: "mingla-business/src/types/stayReservation.ts",
  sqlTest:
    "supabase/migrations/__tests__/issue_1388_stay_reservation.test.sql",
  adversarialSqlTest:
    "supabase/migrations/__tests__/issue_1388_stay_reservation.adversarial.test.sql",
};

const tableNames = [
  "stay_quotes",
  "stay_quote_lines",
  "stay_quote_fee_lines",
  "stay_quote_allocations",
  "stay_reservation_groups",
  "stay_reservation_lines",
  "stay_inventory_holds",
  "stay_inventory_hold_slices",
  "stay_inventory_commitments",
  "stay_reservation_events",
];

function functionBody(source, functionName) {
  const start = source.indexOf(`FUNCTION public.${functionName}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n$function$;", start);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function check(sources) {
  const failures = [];
  const combined = Object.values(sources).join("\n");
  const required = [
    ["reservation RPC", /biz_manage_stay_reservation/],
    ["authoritative quote", /issue_1388_quote_stay_cart/],
    ["atomic group creator", /issue_1388_create_stay_group/],
    ["Request management", /issue_1388_manage_request/],
    ["expiry worker", /issue_1388_expire_groups/],
    ["brand collect readiness", /pg_brand_can_collect/],
    ["brand currency authority", /brands[\s\S]*default_currency/],
    ["Room dependency for restricted Places", /stay_dependent_place_requires_room/],
    ["payload-bound idempotency", /actor_key_hash[\s\S]*idempotency_key/],
    ["integer money", /total_minor bigint/],
    ["frozen pricing", /price_snapshot/],
    ["frozen policy", /policy_snapshot/],
    ["inventory holds", /stay_inventory_holds/],
    ["future commitment seam", /stay_inventory_commitments/],
    ["server-derived mixed Request mode", /v_mode := 'request'/],
    ["deterministic row locking", /FOR UPDATE/],
    ["JWT edge declaration", /\[functions\.stay-reservations\][\s\S]*verify_jwt = true/],
    ["typed business client", /stayReservationService/],
  ];
  for (const [name, pattern] of required) {
    if (!pattern.test(combined)) failures.push(`missing ${name}`);
  }

  for (const table of tableNames) {
    if (!new RegExp(`CREATE TABLE public\\.${table}\\b`).test(sources.schema ?? "")) {
      failures.push(`missing canonical table ${table}`);
    }
  }

  if (!/ENABLE ROW LEVEL SECURITY/.test(sources.schema ?? "") ||
      !/FORCE ROW LEVEL SECURITY/.test(sources.schema ?? "")) {
    failures.push("reservation tables are not protected by enabled and forced RLS");
  }
  if (!/REVOKE ALL ON public\.%I FROM public, anon, authenticated/.test(
    sources.schema ?? "",
  )) {
    failures.push("reservation tables do not revoke direct client access");
  }

  const alias = combined.match(/\b(?:hotel|resort|staycation)_[a-z][a-z0-9_]*/i);
  if (alias) {
    failures.push(
      `non-canonical product identifier: ${alias[0]} (use stay_*)`,
    );
  }

  for (const key of ["management", "edge", "service", "types"]) {
    const legacy = sources[key]?.match(
      /\b(?:venue_tables|venue_capacity_rules|venue_reservation_settings|pg_venue_available_slots)\b/,
    );
    if (legacy) {
      failures.push(`${key} reuses restaurant reservation contract ${legacy[0]}`);
    }
  }

  const requestManager = functionBody(
    sources.management ?? "",
    "issue_1388_manage_request",
  );
  const commerce = requestManager.match(
    /\b(?:stripe|paystack|flutterwave|payment_intent|payment_method|precharge|charge_customer)\b/i,
  );
  if (commerce) {
    failures.push(
      `Request approval crosses into #1389 commerce: ${commerce[0]}`,
    );
  }

  if (!/v_offering\.confirmation_mode = 'request'[\s\S]*v_mode := 'request'/.test(
    sources.management ?? "",
  )) {
    failures.push("reservation mode is not derived from offering truth");
  }
  if (!/ORDER BY[\s\S]*FOR UPDATE/.test(sources.management ?? "")) {
    failures.push("reservation allocation lacks ordered row locking");
  }
  return failures;
}

function selfTest() {
  const cleanSchema = tableNames
    .map((table) => `CREATE TABLE public.${table} (total_minor bigint);`)
    .join("\n");
  const clean = {
    schema: `${cleanSchema}
      ALTER TABLE public.stay_quotes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.stay_quotes FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.%I FROM public, anon, authenticated;
      actor_key_hash text; idempotency_key text; price_snapshot jsonb;
      policy_snapshot jsonb; stay_inventory_holds; stay_inventory_commitments;`,
    management: `
      issue_1388_quote_stay_cart issue_1388_create_stay_group
      issue_1388_expire_groups biz_manage_stay_reservation
      pg_brand_can_collect brands default_currency
      stay_dependent_place_requires_room
      IF v_offering.confirmation_mode = 'request' THEN v_mode := 'request'; END IF;
      ORDER BY offering_id FOR UPDATE;
      FUNCTION public.issue_1388_manage_request(
      approve_request decline_request
      $function$;`,
    edge: "biz_manage_stay_reservation",
    config: "[functions.stay-reservations]\nverify_jwt = true",
    service: "stayReservationService",
    types: "StayReservationGroup",
    sqlTest: "multi-room atomic hold",
    adversarialSqlTest: "oversell prevention",
  };
  const cleanFailures = check(clean);
  if (cleanFailures.length > 0) {
    throw new Error(`clean fixture failed: ${cleanFailures.join("; ")}`);
  }

  const aliasFailures = check({
    ...clean,
    management: `${clean.management}\nCREATE TABLE hotel_rooms(id uuid);`,
  });
  if (!aliasFailures.some((failure) => failure.includes("hotel_rooms"))) {
    throw new Error("hotel_* product alias was not detected");
  }

  const restaurantFailures = check({
    ...clean,
    service: `${clean.service} pg_venue_available_slots`,
  });
  if (!restaurantFailures.some((failure) => failure.includes("restaurant"))) {
    throw new Error("restaurant reservation reuse was not detected");
  }

  const lockFailures = check({
    ...clean,
    management: clean.management.replace("ORDER BY offering_id FOR UPDATE;", ""),
  });
  if (!lockFailures.some((failure) => failure.includes("ordered row locking"))) {
    throw new Error("missing deterministic lock was not detected");
  }

  const commerceFailures = check({
    ...clean,
    management: clean.management.replace(
      "approve_request decline_request",
      "approve_request charge_customer decline_request",
    ),
  });
  if (!commerceFailures.some((failure) => failure.includes("#1389 commerce"))) {
    throw new Error("premature commerce action was not detected");
  }
  console.log("issue-1388-stay-reservation self-test: PASS (5/5)");
}

if (process.argv.includes("--self-test")) {
  try {
    selfTest();
    process.exit(0);
  } catch (error) {
    console.error(`issue-1388-stay-reservation self-test: FAIL: ${error.message}`);
    process.exit(1);
  }
}

try {
  const sources = Object.fromEntries(
    Object.entries(files).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
  );
  const failures = check(sources);
  if (failures.length > 0) {
    console.error("I-1388-STAY-AUTHORITATIVE-GROUP-RESERVATION violated:");
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(
      "Fix: keep one same-Stay, one-currency atomic group under server authority.",
    );
    process.exit(1);
  }
  console.log("I-1388-STAY-AUTHORITATIVE-GROUP-RESERVATION: PASS");
} catch (error) {
  console.error(
    `I-1388-STAY-AUTHORITATIVE-GROUP-RESERVATION inconclusive: ${error.message}`,
  );
  process.exit(2);
}
