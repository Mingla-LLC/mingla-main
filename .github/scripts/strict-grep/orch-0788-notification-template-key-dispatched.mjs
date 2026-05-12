#!/usr/bin/env node
/**
 * ORCH-0788 strict-grep gate — I-PROPOSED-BA NOTIFICATION_TEMPLATE_KEY_DISPATCHED.
 *
 * Every template_key value referenced by ANY writer of
 * `ticket_order_notifications` MUST have a matching case in the dispatcher.
 * Writers must inline-dispatch after enqueue. The sweeper must exist with
 * the documented backoff + cap.
 *
 * Seven checks (all must pass; any failure exits non-zero):
 *
 *   1. `_shared/email/buyerLifecycleAdapters.ts` exports `refundIssuedToGenericBody`
 *      AND `orderCancelledToGenericBody`.
 *   2. `ticket-confirmation-dispatch/index.ts` SELECTs `payload` in the
 *      notifications query.
 *   3. `ticket-confirmation-dispatch/index.ts` references both
 *      `"buyer_refund_issued"` and `"buyer_order_cancelled"` literals,
 *      plus the `unknown_template_key:` defensive branch.
 *   4. `refund-order/index.ts` imports `dispatchTicketConfirmation` AND
 *      calls `dispatchTicketConfirmation(orderId)`.
 *   5. `cancel-order/index.ts` imports `dispatchTicketConfirmation` AND
 *      calls `dispatchTicketConfirmation(orderId)`.
 *   6. `_shared/stripeWebhookRouter.ts` refund handler fires a POST to
 *      `/functions/v1/ticket-confirmation-dispatch` inline after upsert.
 *   7. Substrate Option A: migration `*orch_0788_notification_retry_cron.sql`
 *      exists AND schedules `orch_0788_notification_retry_sweeper`.
 *      (Option B substrate substitutes this with an external workflow file;
 *       implementor chose A — see implementation report §3.)
 *
 * Codified by ORCH-0788 SPEC §9.1.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const ADAPTERS_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "_shared",
  "email",
  "buyerLifecycleAdapters.ts",
);
const DISPATCHER_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "ticket-confirmation-dispatch",
  "index.ts",
);
const REFUND_ORDER_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "refund-order",
  "index.ts",
);
const CANCEL_ORDER_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "cancel-order",
  "index.ts",
);
const STRIPE_WEBHOOK_ROUTER_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "_shared",
  "stripeWebhookRouter.ts",
);

const failures = [];

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// Check 1 — adapters exist
const adaptersSrc = readOrEmpty(ADAPTERS_PATH);
if (!adaptersSrc) {
  failures.push(`Check 1 FAIL: cannot read ${ADAPTERS_PATH}`);
} else {
  if (!/export function refundIssuedToGenericBody\b/.test(adaptersSrc)) {
    failures.push(
      "Check 1a FAIL: buyerLifecycleAdapters.ts must export 'function refundIssuedToGenericBody'",
    );
  }
  if (!/export function orderCancelledToGenericBody\b/.test(adaptersSrc)) {
    failures.push(
      "Check 1b FAIL: buyerLifecycleAdapters.ts must export 'function orderCancelledToGenericBody'",
    );
  }
}

// Check 2 — dispatcher selects payload
const dispatcherSrc = readOrEmpty(DISPATCHER_PATH);
if (!dispatcherSrc) {
  failures.push(`Check 2 FAIL: cannot read ${DISPATCHER_PATH}`);
} else if (
  !/\.select\(\s*"[^"]*\bpayload\b[^"]*"\s*\)/.test(dispatcherSrc)
) {
  failures.push(
    "Check 2 FAIL: ticket-confirmation-dispatch must SELECT payload in its notifications query",
  );
}

// Check 3 — dispatcher routes by every known template_key + defensive default
if (dispatcherSrc) {
  if (!/"buyer_refund_issued"/.test(dispatcherSrc)) {
    failures.push(
      "Check 3a FAIL: dispatcher missing 'buyer_refund_issued' case",
    );
  }
  if (!/"buyer_order_cancelled"/.test(dispatcherSrc)) {
    failures.push(
      "Check 3b FAIL: dispatcher missing 'buyer_order_cancelled' case",
    );
  }
  if (!/unknown_template_key:/.test(dispatcherSrc)) {
    failures.push(
      "Check 3c FAIL: dispatcher missing defensive 'unknown_template_key:' failed_terminal branch",
    );
  }
}

// Check 4 — refund-order inline-dispatches
const refundOrderSrc = readOrEmpty(REFUND_ORDER_PATH);
if (!refundOrderSrc) {
  failures.push(`Check 4 FAIL: cannot read ${REFUND_ORDER_PATH}`);
} else {
  if (!/import\s*\{[^}]*\bdispatchTicketConfirmation\b/.test(refundOrderSrc)) {
    failures.push(
      "Check 4a FAIL: refund-order/index.ts must import dispatchTicketConfirmation",
    );
  }
  if (!/dispatchTicketConfirmation\(\s*orderId\s*\)/.test(refundOrderSrc)) {
    failures.push(
      "Check 4b FAIL: refund-order/index.ts must call dispatchTicketConfirmation(orderId) after enqueue",
    );
  }
}

// Check 5 — cancel-order inline-dispatches
const cancelOrderSrc = readOrEmpty(CANCEL_ORDER_PATH);
if (!cancelOrderSrc) {
  failures.push(`Check 5 FAIL: cannot read ${CANCEL_ORDER_PATH}`);
} else {
  if (!/import\s*\{[^}]*\bdispatchTicketConfirmation\b/.test(cancelOrderSrc)) {
    failures.push(
      "Check 5a FAIL: cancel-order/index.ts must import dispatchTicketConfirmation",
    );
  }
  if (!/dispatchTicketConfirmation\(\s*orderId\s*\)/.test(cancelOrderSrc)) {
    failures.push(
      "Check 5b FAIL: cancel-order/index.ts must call dispatchTicketConfirmation(orderId) after enqueue",
    );
  }
}

// Check 6 — stripe webhook router refund handler inline-dispatches
const webhookRouterSrc = readOrEmpty(STRIPE_WEBHOOK_ROUTER_PATH);
if (!webhookRouterSrc) {
  failures.push(`Check 6 FAIL: cannot read ${STRIPE_WEBHOOK_ROUTER_PATH}`);
} else {
  // Must contain a fetch to the dispatcher endpoint inside the refund-handler
  // region. Use a permissive regex — implementor may format differently.
  if (
    !/fetch\([^)]*\/functions\/v1\/ticket-confirmation-dispatch/.test(
      webhookRouterSrc,
    )
  ) {
    failures.push(
      "Check 6 FAIL: stripeWebhookRouter.ts must fetch /functions/v1/ticket-confirmation-dispatch after the refund-handler upsert",
    );
  }
}

// Check 7 — Option A substrate migration exists
let migrationPath = "";
try {
  const entries = readdirSync(MIGRATIONS_DIR);
  const match = entries.find((n) =>
    /orch_0788.*notification_retry_cron\.sql$/.test(n),
  );
  if (match) {
    migrationPath = join(MIGRATIONS_DIR, match);
  } else {
    failures.push(
      "Check 7a FAIL: no migration file matching '*orch_0788*notification_retry_cron.sql' under supabase/migrations/ (Option A substrate expected per implementation report)",
    );
  }
} catch (err) {
  failures.push(`Check 7 FAIL: cannot read supabase/migrations/: ${err.message}`);
}
const migrationSrc = migrationPath ? readOrEmpty(migrationPath) : "";
if (migrationSrc) {
  if (
    !/cron\.schedule\(\s*'orch_0788_notification_retry_sweeper'/.test(
      migrationSrc,
    )
  ) {
    failures.push(
      "Check 7b FAIL: migration must register cron job 'orch_0788_notification_retry_sweeper'",
    );
  }
  if (!/'\*\/5 \* \* \* \*'/.test(migrationSrc)) {
    failures.push(
      "Check 7c FAIL: migration must schedule every 5 minutes ('*/5 * * * *') per SPEC §8.3",
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-0788 strict-grep gate FAILED:");
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}

console.log("ORCH-0788 strict-grep gate: PASS (7/7 checks)");
process.exit(0);
