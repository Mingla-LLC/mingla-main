#!/usr/bin/env node
/**
 * ORCH-1138 Leg 3 REWORK (§9) — checkout BYTE-IDENTICAL gate (I-1).
 *
 * The consumer experience Reserve (slot OR open-daily party-size) must reach the
 * SAME ticket-checkout-create request as the pre-rework path: the request adds
 * ONLY `eventDateId` (when a slot is chosen) + the line `quantity` (= party
 * size). NO new line item, NO address, NO taxCalculationId, NO paymentPlanChoice,
 * NO parallel money function. Party-size rides as cart `quantity` (initialQuantity
 * seed → setLineQuantity), never as a second line.
 *
 * This gate asserts the consumer experience screen's runNativeCheckout call:
 *   (a) threads eventDateId conditionally (selectedEventDateId !== null),
 *   (b) does NOT introduce address / taxCalculationId / paymentPlanChoice keys,
 *   (c) does NOT call any experience-specific money edge fn (only the shared
 *       runNativeCheckout → ticket-checkout-create).
 *
 * FAILS-ON-REVERT: add an address/tax/plan field or a second money fn → FAIL.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FILE = "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx";

let raw;
try {
  raw = readFileSync(resolve(ROOT, FILE), "utf8");
} catch {
  console.error(`[ORCH-1138 checkout-byte-identical] FAIL — cannot read ${FILE}`);
  process.exit(1);
}

// Strip line comments + block comments so a "NO taxCalculationId" doc line never
// trips the forbidden-field check (we gate on real CODE, not prose).
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => l.replace(/\/\/.*$/, ""))
  .join("\n");

const errors = [];

// (a) eventDateId is threaded conditionally on a chosen slot.
if (
  !/selectedEventDateId\s*!==\s*null/.test(src) ||
  !/eventDateId:\s*selectedEventDateId/.test(src)
) {
  errors.push(
    "missing the conditional `eventDateId: selectedEventDateId` thread (slot only).",
  );
}

// (b) the checkout request must NOT carry buyer-tax / address / plan fields.
const FORBIDDEN = [
  /\btaxCalculationId\b/,
  /\bbillingAddress\b/,
  /\bpaymentPlanChoice\b/,
  /\baddress:\s*\{/,
];
for (const re of FORBIDDEN) {
  if (re.test(src)) {
    errors.push(`forbidden checkout field present: ${re}`);
  }
}

// (c) only the shared runNativeCheckout money path (no parallel experience fn).
if (!/runNativeCheckout\(/.test(src)) {
  errors.push("the shared runNativeCheckout call is missing.");
}
if (/functions\.invoke\(\s*["'`]experience-/.test(src)) {
  errors.push("a parallel experience-specific money edge fn is invoked (I-1 violation).");
}

if (errors.length > 0) {
  console.error("[ORCH-1138 checkout-byte-identical] FAIL —");
  errors.forEach((e) => console.error("  " + e));
  process.exit(1);
}

console.log(
  "[ORCH-1138 checkout-byte-identical] OK — Reserve adds only eventDateId + line quantity; no address/tax/plan field; one shared money path (I-1).",
);
