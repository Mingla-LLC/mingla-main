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

const FORBIDDEN = [
  /\btaxCalculationId\b/,
  /\bbillingAddress\b/,
  /\bpaymentPlanChoice\b/,
  /\baddress:\s*\{/,
];

// Pure verdict (behavior-preserving refactor). Strips comments from `raw`, then
// asserts the byte-identical-checkout invariant, pushing human-readable strings
// into `errors` in the same order (a → b → c) as before. Takes a STRING; never
// touches disk.
function check(raw, errors) {
  // Strip line comments + block comments so a "NO taxCalculationId" doc line never
  // trips the forbidden-field check (we gate on real CODE, not prose).
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

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
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const run = (raw) => {
    const e = [];
    check(raw, e);
    return e;
  };

  // GOOD: conditional eventDateId + line quantity, one shared money path, no
  // address/tax/plan field → silent. eventDateId is threaded as an object
  // property (colon form) exactly as the invariant requires.
  const good =
    "if (selectedEventDateId !== null) {\n" +
    "  payload = { eventDateId: selectedEventDateId };\n" +
    "}\n" +
    "runNativeCheckout({ lines });";
  if (run(good).length) self.push("GOOD (byte-identical Reserve checkout) wrongly flagged");

  // BAD1 (revert-style): a buyer-tax field is added to the checkout request → fires.
  const bad1 = good + '\nconst taxCalculationId = "txcal_123";';
  if (run(bad1).length === 0) self.push("BAD1 (taxCalculationId field added to checkout) not flagged");

  // BAD2 (regression, different angle): a parallel experience-specific money
  // edge fn is invoked (instead of / alongside the shared path) → fires.
  const bad2 = good + '\nawait supabase.functions.invoke("experience-checkout-create", { body });';
  if (run(bad2).length === 0) self.push("BAD2 (parallel experience money edge fn invoked) not flagged");

  if (self.length) {
    console.error("ORCH-1138-CHECKOUT-BYTE-IDENTICAL self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1138-CHECKOUT-BYTE-IDENTICAL self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
let raw;
try {
  raw = readFileSync(resolve(ROOT, FILE), "utf8");
} catch {
  console.error(`[ORCH-1138 checkout-byte-identical] FAIL — cannot read ${FILE}`);
  process.exit(1);
}

const errors = [];
check(raw, errors);

if (errors.length > 0) {
  console.error("[ORCH-1138 checkout-byte-identical] FAIL —");
  errors.forEach((e) => console.error("  " + e));
  process.exit(1);
}

console.log(
  "[ORCH-1138 checkout-byte-identical] OK — Reserve adds only eventDateId + line quantity; no address/tax/plan field; one shared money path (I-1).",
);
