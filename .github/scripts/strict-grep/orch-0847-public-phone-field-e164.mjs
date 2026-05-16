#!/usr/bin/env node
/**
 * ORCH-0847 [Consumer ticket purchase parity with public business page]
 * strict-grep gate #2 — Public buyer form's phone field emits proper
 * E.164 client-side via the shared `@mingla/phone-input` PhoneInput.
 *
 * Codifies new invariant
 * `I-PROPOSED-PUBLIC-PHONE-FIELD-E164-CLIENT-SIDE` from SPEC §6:
 *
 *   "The public buyer form's phone input MUST emit a properly-formed
 *   E.164 string client-side; the server's US-fallback branch in
 *   `_shared/ticketCheckout.ts:83-84` MUST NOT be relied on by new code."
 *
 * What this gate enforces:
 *
 *   1. `mingla-business/app/checkout/[eventId]/buyer.tsx` MUST import
 *      `PhoneInput` from `@mingla/phone-input`.
 *
 *   2. `buyer.tsx` MUST use `isValidE164` (the strict E.164 validator),
 *      NOT the legacy `isRequiredPhoneValid` alias.
 *
 *   3. `buyer.tsx` MUST NOT contain a plain `<Input ... placeholder="Mobile number"`
 *      pattern — catches regression to the pre-ORCH-0847 single-text
 *      phone field.
 *
 *   4. `mingla-business/src/utils/phone.ts` MUST export both `isValidE164`
 *      and `composeE164`.
 *
 * Exit codes:
 *   0 — clean
 *   1 — violation
 *
 * Per ORCH-0847 SPEC §9 Gate 2.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const readMaybe = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
};

const violations = [];
const note = (file, msg) => violations.push({ file, msg });

const buyerPath = "mingla-business/app/checkout/[eventId]/buyer.tsx";
const buyer = readMaybe(buyerPath);
if (buyer === null) {
  console.error(`[ORCH-0847 gate #2] Cannot read ${buyerPath} — file missing.`);
  process.exit(1);
}

// Check 1 — imports PhoneInput from @mingla/phone-input
if (
  !/import\s*\{[^}]*\bPhoneInput\b[^}]*\}\s*from\s*["']@mingla\/phone-input["']/.test(
    buyer,
  )
) {
  note(
    buyerPath,
    "MUST import `PhoneInput` from `@mingla/phone-input` (the shared country-picker phone field).",
  );
}

// Check 2 — uses isValidE164 in validate()
if (!/\bisValidE164\s*\(/.test(buyer)) {
  note(
    buyerPath,
    "MUST call `isValidE164(...)` for phone validation — NOT the deprecated `isRequiredPhoneValid` alias.",
  );
}

// Check 3 — no plain <Input placeholder="Mobile number"> regression
const PLAIN_MOBILE_INPUT =
  /<Input\b[\s\S]{0,300}?placeholder\s*=\s*["']Mobile number["']/;
if (PLAIN_MOBILE_INPUT.test(buyer)) {
  note(
    buyerPath,
    "MUST NOT contain a plain `<Input ... placeholder=\"Mobile number\">` — that was the pre-ORCH-0847 single-text phone field. Use `<PhoneInput>` from `@mingla/phone-input` instead.",
  );
}

// Check 4 — phone.ts exports isValidE164 + composeE164
const phoneUtilPath = "mingla-business/src/utils/phone.ts";
const phoneUtil = readMaybe(phoneUtilPath);
if (phoneUtil === null) {
  note(phoneUtilPath, "File missing — Phase B should have rewritten this util.");
} else {
  if (!/export\s+const\s+isValidE164\s*=/.test(phoneUtil)) {
    note(phoneUtilPath, "MUST export `isValidE164`.");
  }
  if (!/export\s+const\s+composeE164\s*=/.test(phoneUtil)) {
    note(phoneUtilPath, "MUST export `composeE164`.");
  }
}

if (violations.length > 0) {
  console.error(
    "\n[ORCH-0847 gate #2 — public-phone-field-e164] VIOLATIONS:\n",
  );
  for (const v of violations) {
    console.error(`  • ${v.file}\n    ${v.msg}\n`);
  }
  console.error(
    "Codifies I-PROPOSED-PUBLIC-PHONE-FIELD-E164-CLIENT-SIDE (ORCH-0847 SPEC §6).",
  );
  process.exit(1);
}

console.log(
  "[ORCH-0847 gate #2 — public-phone-field-e164] PASS — buyer.tsx uses shared <PhoneInput>, isValidE164 is the validator, composeE164 + isValidE164 are exported from phone.ts.",
);
process.exit(0);
