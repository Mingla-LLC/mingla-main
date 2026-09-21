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
    // issue #3351 [free trip intake loop] — this route's third marker was
    // `createTicketCheckout`. DO NOT RESTORE IT. That marker encoded the
    // pre-#3351 arrangement in which the intake screen was expected to submit
    // the free reservation, and that arrangement is what produced the defect:
    // two screens each naming the other as the finisher, with nothing recording
    // that the questions had been answered, so a free trip with any question
    // bounced forever and made ZERO reservation requests. Submission now lives
    // at exactly ONE call site in buyer.tsx, where this audit still requires
    // the marker. This screen's contract is the opposite one, so it is asserted
    // in both directions: it must route through the step-order owner, and it
    // must not submit.
    mustInclude: [
      "schemasQuery.isLoading",
      "lines.length === 0",
      'nextTripCheckoutStep("intake"',
    ],
    mustExclude: ["createTicketCheckout"],
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
  // issue #3351 — some contracts are about what a route must NOT do. A
  // presence-only audit cannot catch a second submit path being reintroduced.
  for (const snippet of route.mustExclude ?? []) {
    if (text.includes(snippet)) {
      fail(`${route.label} (${route.file}) must NOT contain: ${snippet}`);
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
