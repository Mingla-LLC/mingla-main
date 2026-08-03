#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  schema:
    "supabase/migrations/20270131013807_issue_1387_stay_inventory_schema.sql",
  management:
    "supabase/migrations/20270131013808_issue_1387_stay_inventory_management.sql",
  currency:
    "supabase/migrations/20270131013809_issue_1387_stay_currency_registration.sql",
  edge: "supabase/functions/manage-stay-inventory/index.ts",
  service: "mingla-business/src/services/stayInventoryService.ts",
  types: "mingla-business/src/types/stayInventory.ts",
};

function check(sources) {
  const failures = [];
  const combined = Object.values(sources).join("\n");
  const required = [
    ["canonical category", /venue_category[^\n]*|'stay'/],
    ["Room and Place kinds", /kind IN \('room', 'place'\)/],
    ["forced RLS", /FORCE ROW LEVEL SECURITY/],
    ["management RPC", /biz_manage_stay_inventory/],
    ["brand currency authority", /issue_1387_assert_authoring_currency/],
    ["#1384 registration", /issue_1384_reconcile_bank_currency/],
    ["Stay-aware reconciliation", /issue_1387_resolve_currency_reconciliation/],
    ["immutable monetary history", /stay_money_history_immutable/],
    ["bulk idempotency", /idempotency_key/],
    ["JWT edge declaration", /manage-stay-inventory/],
  ];
  for (const [name, pattern] of required) {
    if (!pattern.test(combined)) failures.push(`missing ${name}`);
  }

  const identifierViolation = combined.match(
    /\b(?:hotel|resort|staycation)_[a-z][a-z0-9_]*/i,
  );
  if (identifierViolation) {
    failures.push(
      `non-canonical product identifier: ${identifierViolation[0]} (use stay_*)`,
    );
  }

  for (const key of ["management", "currency", "edge", "service", "types"]) {
    const legacy = sources[key]?.match(
      /\b(?:venue_tables|venue_capacity_rules|venue_reservation_settings|pg_venue_available_slots)\b/,
    );
    if (legacy) {
      failures.push(
        `${key} reuses restaurant inventory contract ${legacy[0]}`,
      );
    }
  }

  if (!/venue_category IN \([\s\S]*'stay'[\s\S]*\)/.test(sources.schema ?? "")) {
    failures.push("venue category constraint does not explicitly include stay");
  }
  if (/'hotel'\s*,?\s*\)/.test(
    (sources.schema ?? "").match(
      /venue_category IN \([\s\S]*?\)\s*\n\s*\)/,
    )?.[0] ?? "",
  )) {
    failures.push("hotel was added as a venue product category");
  }
  return failures;
}

function selfTest() {
  const clean = {
    schema: `
      CHECK (venue_category IN ('restaurant','stay'));
      kind text CHECK (kind IN ('room', 'place'));
      ALTER TABLE public.stay_offerings FORCE ROW LEVEL SECURITY;
      stay_money_history_immutable;
      idempotency_key text;
    `,
    management:
      "biz_manage_stay_inventory issue_1387_assert_authoring_currency",
    currency:
      "issue_1384_reconcile_bank_currency issue_1387_resolve_currency_reconciliation",
    edge: "manage-stay-inventory",
    service: "manage-stay-inventory",
    types: "StayOfferingKind",
  };
  const cleanFailures = check(clean);
  if (cleanFailures.length > 0) {
    throw new Error(`clean fixture failed: ${cleanFailures.join("; ")}`);
  }

  const aliasFailures = check({
    ...clean,
    management: clean.management + "\nCREATE TABLE hotel_rooms(id uuid);",
  });
  if (!aliasFailures.some((failure) => failure.includes("hotel_rooms"))) {
    throw new Error("hotel_* product alias was not detected");
  }

  const restaurantReuse = check({
    ...clean,
    service: "manage-stay-inventory pg_venue_available_slots",
  });
  if (!restaurantReuse.some((failure) => failure.includes("restaurant inventory"))) {
    throw new Error("restaurant inventory reuse was not detected");
  }

  const missingCurrency = check({ ...clean, currency: "" });
  if (!missingCurrency.some((failure) => failure.includes("#1384 registration"))) {
    throw new Error("missing #1384 registration was not detected");
  }
  console.log("issue-1387-stay-inventory self-test: PASS (4/4)");
}

if (process.argv.includes("--self-test")) {
  try {
    selfTest();
    process.exit(0);
  } catch (error) {
    console.error(`issue-1387-stay-inventory self-test: FAIL: ${error.message}`);
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
    console.error("I-1387-STAY-CANONICAL-INVENTORY violated:");
    for (const failure of failures) console.error(`- ${failure}`);
    console.error("Fix: keep the product namespace stay_* and extend #1384 atomically.");
    process.exit(1);
  }
  console.log("I-1387-STAY-CANONICAL-INVENTORY: PASS");
} catch (error) {
  console.error(`I-1387-STAY-CANONICAL-INVENTORY inconclusive: ${error.message}`);
  process.exit(2);
}
