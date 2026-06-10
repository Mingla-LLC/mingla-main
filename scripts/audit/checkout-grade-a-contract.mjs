#!/usr/bin/env node
/**
 * #426 PR5 — Grade A contract for buyer checkout funnel.
 * Fails if critical routes lose loading / empty / error state handling.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CHECKOUT = join(ROOT, "mingla-business/app/checkout/[eventId]");

const ROUTES = [
  {
    file: "index.tsx",
    mustInclude: ["isLoading", "EmptyState", "Loading tickets"],
    label: "tickets",
  },
  {
    file: "buyer.tsx",
    mustInclude: ["errorText", "lines.length === 0", "createTicketCheckout"],
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
  "docs/evidence/grade-a-checkout.md",
  "scripts/load/ticket-checkout-create.js",
  "scripts/load/ticket-checkout-status.js",
  "mingla-business/src/services/ticketCheckoutService.ts",
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

for (const rel of REQUIRED_EXTERNAL) {
  if (!existsSync(join(ROOT, rel))) fail(`missing ${rel}`);
}

for (const route of ROUTES) {
  const path = join(CHECKOUT, route.file);
  if (!existsSync(path)) fail(`missing checkout route ${route.file}`);
  const text = readFileSync(path, "utf8");
  for (const snippet of route.mustInclude) {
    if (!text.includes(snippet)) {
      fail(`${route.label} (${route.file}) missing required marker: ${snippet}`);
    }
  }
}

const evidence = readFileSync(
  join(ROOT, "docs/evidence/grade-a-checkout.md"),
  "utf8",
);
if (!evidence.includes("ticket-checkout-create") || !evidence.includes("test:orch-430")) {
  fail("grade-a-checkout.md must reference load scripts and test:orch-430");
}

console.log("PASS: checkout Grade A contract (4 routes + evidence)");
process.exit(0);
