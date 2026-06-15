#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1130 [public trip page payment-structure + installments UX redesign] —
 * consumer (Path B) regression check + the DISC-1130-A consent fix.
 *
 * Goal: a consumer reserving a PLAN trip must send an EXPLICIT
 * `payment_plan_choice` ("full" | "installments") to ticket-checkout-create —
 * NEVER omit the key on a plan trip (which the server resolves to 'auto',
 * silently charging only the 25% deposit with no consent). The choice
 * originates from the "HOW YOU PAY" module on ConsumerTripDetailScreen
 * (default "full"), flows through ExpandedBusinessEventSheet → runNativeCheckout
 * → nativeCheckoutFlow's body.
 *
 * This repo uses structural + behavioral `.mjs` checks for app-mobile ORCH
 * gates (no jest in app-mobile). Set ORCH1130_SIMULATE_REVERT=1 to strip the
 * three load-bearing wirings (the screen module + the EBES forward + the body
 * key); the script must then FAIL, proving the checks bite (fails-on-revert).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const simulateRevert = process.env.ORCH1130_SIMULATE_REVERT === "1";

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};

const FLOW = "app-mobile/src/payments/nativeCheckoutFlow.ts";
const SHEET =
  "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx";
const SCREEN = "app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx";
const HOOK = "app-mobile/src/hooks/useConsumerTripDetail.ts";

// Simulated revert = restore the pre-1130 silent-'auto' state.
const maybeRevert = (src, kind) => {
  if (!simulateRevert) return src;
  if (kind === "flow") {
    // Strip the body key forward → the server defaults to 'auto'.
    return src.replace(
      /\.\.\.\(input\.paymentPlanChoice[\s\S]*?: \{\}\),/,
      "/* reverted: no payment_plan_choice */",
    );
  }
  if (kind === "sheet") {
    return src.replace(
      /\.\.\.\(paymentPlanChoice \? \{ paymentPlanChoice \} : \{\}\),/,
      "/* reverted: EBES drops the choice */",
    );
  }
  if (kind === "screen") {
    // ORCH-1138 [trip-page-redesign] — Reserve now opens TicketCartSheet
    // DIRECTLY; the consent choice is threaded through the screen's own
    // handleBuy → runNativeCheckout (NOT the old EBES prop). Revert = strip
    // that forward → the server would default to silent 'auto'.
    return src.replace(
      /paymentPlanChoice:\s*detail\.hasPlan \? paymentPlanChoice : undefined,/,
      "/* reverted: screen never threads the choice */",
    );
  }
  return src;
};

const flow = maybeRevert(read(FLOW), "flow");
const sheet = maybeRevert(read(SHEET), "sheet");
const screen = maybeRevert(read(SCREEN), "screen");
const hook = read(HOOK);

const fail = (msg) => {
  console.error(`x ${msg}`);
  process.exitCode = 1;
};

// 1. nativeCheckoutFlow forwards an explicit payment_plan_choice (the consent
//    teeth). Without this, a plan trip silently resolves to 'auto' deposit-only.
try {
  assert.match(
    flow,
    /payment_plan_choice:\s*input\.paymentPlanChoice/,
    "nativeCheckoutFlow must forward payment_plan_choice from input",
  );
  assert.match(
    flow,
    /paymentPlanChoice\?:\s*"full"\s*\|\s*"installments"/,
    "NativeCheckoutInput must type paymentPlanChoice",
  );
} catch (e) {
  fail(e.message);
}

// 2. ExpandedBusinessEventSheet (events/experiences path) STILL accepts +
//    forwards the prop into runNativeCheckout. ORCH-1138 [trip-page-redesign]
//    removed EBES from the TRIP path only — EBES is unchanged and remains the
//    events/experiences checkout sheet, so its consent forwarding must persist.
try {
  assert.match(
    sheet,
    /paymentPlanChoice\?:\s*"full"\s*\|\s*"installments"/,
    "EBES must declare the paymentPlanChoice prop",
  );
  assert.match(
    sheet,
    /\.\.\.\(paymentPlanChoice \? \{ paymentPlanChoice \} : \{\}\)/,
    "EBES must forward paymentPlanChoice into runNativeCheckout",
  );
} catch (e) {
  fail(e.message);
}

// 3. ConsumerTripDetailScreen renders the choice module + threads the value,
//    gated on hasPlan so non-plan trips send nothing (byte-identical request).
//    ORCH-1138 [trip-page-redesign] — Reserve now opens TicketCartSheet DIRECTLY,
//    so the consent choice is threaded through the screen's OWN handleBuy →
//    runNativeCheckout (NOT the old EBES prop). The "Choose how you pay" control
//    is the tabbed Pay-in-full / Pay-over-time toggle (accessibilityRole
//    "tablist"; the legacy radio-dot pills + the separate "Reserve charges"
//    disclosure were superseded by ORCH-1138's PaymentMockupCard parity legs).
try {
  assert.match(
    screen,
    /orch-1130-consumer-payment-choice/,
    "screen must render the HOW YOU PAY module",
  );
  assert.match(
    screen,
    /accessibilityRole="tablist"/,
    "screen module must be an accessible pay-choice toggle (tablist)",
  );
  assert.match(
    screen,
    /paymentPlanChoice:\s*detail\.hasPlan \? paymentPlanChoice : undefined,/,
    "screen must thread the explicit choice (hasPlan-gated) into its own runNativeCheckout (direct-cart path)",
  );
} catch (e) {
  fail(e.message);
}

// 4. The hook surfaces the plan template + hasPlan flag (always — not reverted,
//    so a SIMULATE_REVERT run still has the data layer; the consent teeth are
//    the three wirings above).
try {
  assert.match(
    hook,
    /installmentSchedule:\s*TripInstallmentScheduleData \| null/,
    "hook TripDetailTier must carry installmentSchedule",
  );
  assert.match(hook, /hasPlan:\s*boolean/, "hook must derive hasPlan");
  assert.match(
    hook,
    /tier_metadata/,
    "hook tiers query must select tier_metadata",
  );
} catch (e) {
  fail(e.message);
}

if (process.exitCode === 1) {
  console.error(
    simulateRevert
      ? "\nORCH-1130 consumer consent check FAILED under SIMULATE_REVERT — expected (fails-on-revert proven)."
      : "\nORCH-1130 consumer consent check FAILED — the consent wiring is broken.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1130 consumer payment-choice consent check: PASS (explicit payment_plan_choice threaded end-to-end; no silent 'auto').",
);
process.exit(0);
