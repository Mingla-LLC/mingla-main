#!/usr/bin/env node
/**
 * ORCH-1138 Leg 3 REWORK (§9) — checkout BYTE-IDENTICAL gate (I-1), amended
 * by issue #3281 Round 1 PR 1b.
 *
 * The Explorer experience Reserve must reach ticket-checkout-create with ONLY:
 *   - `eventDateId` (when a slot/day is chosen)
 *   - line `quantity` (= party size)
 *   - `bookedStartAt` (when open-daily chose a start; issue #3281)
 *
 * NO address, NO taxCalculationId, NO paymentPlanChoice, NO parallel money fn
 * on the Explorer experience detail screen.
 *
 * Host / shared native checkout carriers are also required to thread
 * `bookedStartAt` (type + body), but they intentionally serve trips/events too
 * so tax/plan tokens there are NOT forbidden by this gate.
 *
 * FAILS-ON-REVERT: drop bookedStartAt threading, or add address/tax/plan on the
 * Explorer experience screen → FAIL.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const EXPLORER_DETAIL =
  "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx";

const CARRIERS = [
  "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
  "mingla-business/src/payments/nativeCheckoutFlow.ts",
  "mingla-business/src/services/ticketCheckoutService.ts",
  "app-mobile/src/payments/nativeCheckoutFlow.ts",
];

const FORBIDDEN_ON_EXPLORER = [
  /\btaxCalculationId\b/,
  /\bbillingAddress\b/,
  /\bpaymentPlanChoice\b/,
  /\baddress:\s*\{/,
];

function stripComments(raw) {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

function checkExplorerDetail(src, errors) {
  if (
    !/selectedEventDateId\s*!==\s*null/.test(src) ||
    !/eventDateId:\s*selectedEventDateId/.test(src)
  ) {
    errors.push(
      "Explorer detail: missing conditional `eventDateId: selectedEventDateId`.",
    );
  }
  if (!/bookedStartAt/.test(src)) {
    errors.push(
      "Explorer detail: missing `bookedStartAt` thread (issue #3281).",
    );
  }
  for (const re of FORBIDDEN_ON_EXPLORER) {
    if (re.test(src)) {
      errors.push(`Explorer detail forbidden field: ${re}`);
    }
  }
  if (!/runNativeCheckout\(/.test(src)) {
    errors.push("Explorer detail: shared runNativeCheckout call missing.");
  }
  if (/functions\.invoke\(\s*["'`]experience-/.test(src)) {
    errors.push("Explorer detail: parallel experience money edge fn.");
  }
}

function checkCarrier(src, label, errors) {
  if (!/bookedStartAt/.test(src)) {
    errors.push(`${label}: missing bookedStartAt carrier (issue #3281).`);
  }
}

function check(rawByFile, errors) {
  const detail = rawByFile[EXPLORER_DETAIL];
  if (detail !== undefined) {
    checkExplorerDetail(stripComments(detail), errors);
  }
  for (const file of CARRIERS) {
    const raw = rawByFile[file];
    if (raw === undefined) continue;
    checkCarrier(stripComments(raw), file, errors);
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const run = (map) => {
    const e = [];
    check(map, e);
    return e;
  };

  const goodDetail =
    "if (selectedEventDateId !== null) {\n" +
    "  payload = { eventDateId: selectedEventDateId, bookedStartAt: start };\n" +
    "}\n" +
    "runNativeCheckout({ lines });";
  const goodFlow = "body.bookedStartAt = input.bookedStartAt;";
  const good = {
    [EXPLORER_DETAIL]: goodDetail,
    "mingla-business/src/payments/nativeCheckoutFlow.native.ts": goodFlow,
    "mingla-business/src/payments/nativeCheckoutFlow.ts": goodFlow,
    "mingla-business/src/services/ticketCheckoutService.ts": goodFlow,
    "app-mobile/src/payments/nativeCheckoutFlow.ts": goodFlow,
  };
  if (run(good).length) {
    self.push("GOOD (bookedStartAt + eventDateId) wrongly flagged");
  }

  const badTax = {
    ...good,
    [EXPLORER_DETAIL]: goodDetail + '\nconst taxCalculationId = "txcal_123";',
  };
  if (run(badTax).length === 0) {
    self.push("BAD (taxCalculationId on Explorer detail) not flagged");
  }

  const badMissing = {
    ...good,
    [EXPLORER_DETAIL]:
      "if (selectedEventDateId !== null) {\n  payload = { eventDateId: selectedEventDateId };\n}\nrunNativeCheckout({ lines });",
  };
  if (run(badMissing).length === 0) {
    self.push("BAD (missing bookedStartAt on Explorer detail) not flagged");
  }

  if (self.length) {
    console.error("ORCH-1138-CHECKOUT-BYTE-IDENTICAL self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1138-CHECKOUT-BYTE-IDENTICAL self-test PASS (3/3 cases).",
  );
  process.exit(0);
}

const rawByFile = {};
const errors = [];
for (const file of [EXPLORER_DETAIL, ...CARRIERS]) {
  try {
    rawByFile[file] = readFileSync(resolve(ROOT, file), "utf8");
  } catch {
    errors.push(`cannot read ${file}`);
  }
}
if (errors.length === 0) check(rawByFile, errors);

if (errors.length > 0) {
  console.error("[ORCH-1138 checkout-byte-identical] FAIL —");
  errors.forEach((e) => console.error("  " + e));
  process.exit(1);
}

console.log(
  "[ORCH-1138 checkout-byte-identical] OK — Reserve adds eventDateId + quantity + bookedStartAt; no parallel experience money path (I-1 / #3281).",
);
