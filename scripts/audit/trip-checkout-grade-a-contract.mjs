#!/usr/bin/env node
/**
 * #426 PR7 bundle — Grade A contract for trip buyer checkout funnel.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const TRIP_CHECKOUT = join(ROOT, "mingla-business/app/checkout-trip/[tripEventId]");

const ROUTES = [
  {
    file: "index.tsx",
    mustInclude: ["usePublicTripById", "isLoading", "EmptyState", "Loading trip"],
    label: "spots",
  },
  {
    file: "intake.tsx",
    mustInclude: ["schemasQuery.isLoading", "lines.length === 0", "createTicketCheckout"],
    label: "intake",
  },
  {
    file: "buyer.tsx",
    mustInclude: ["createTicketCheckout", "lines.length === 0", "errorText"],
    label: "buyer",
  },
  {
    file: "payment.tsx",
    mustInclude: ["paymentError", "confirmTicketCheckout", "thrown_error"],
    label: "payment",
  },
  {
    file: "confirm.tsx",
    mustInclude: ["checkoutSessionId", "buyerStatusToken"],
    label: "confirm",
  },
];

const REQUIRED_EXTERNAL = [
  "docs/evidence/grade-a-trip-checkout.md",
  "scripts/load/ticket-checkout-create.js",
  "scripts/load/ticket-checkout-status.js",
  "mingla-business/app/checkout-trip/[tripEventId]/__tests__/orch_0911_trip_confirm_loading_state.test.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/__tests__/orch_0928_url_fragment_recovery.test.tsx",
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

for (const rel of REQUIRED_EXTERNAL) {
  if (!existsSync(join(ROOT, rel))) fail(`missing ${rel}`);
}

for (const route of ROUTES) {
  const path = join(TRIP_CHECKOUT, route.file);
  if (!existsSync(path)) fail(`missing trip checkout route ${route.file}`);
  const text = readFileSync(path, "utf8");
  for (const snippet of route.mustInclude) {
    if (!text.includes(snippet)) {
      fail(`${route.label} (${route.file}) missing required marker: ${snippet}`);
    }
  }
}

const evidence = readFileSync(
  join(ROOT, "docs/evidence/grade-a-trip-checkout.md"),
  "utf8",
);
if (!evidence.includes("ticket-checkout-create") || !evidence.includes("test:orch-433")) {
  fail("grade-a-trip-checkout.md must reference load scripts and test:orch-433");
}

console.log("PASS: trip checkout Grade A contract (5 routes + evidence)");
process.exit(0);
