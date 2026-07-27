#!/usr/bin/env node
/**
 * ORCH-0955 region-gate-deleted gate.
 *
 * INVARIANT: the native-paid region gate is DELETED — no checkout file contains
 * the banned region-gate tokens (NATIVE_PAID_ALLOWED_REGIONS,
 * isNativePaidAllowedForBrand, native_paid_not_allowed_in_region) and the legacy
 * `_shared/stripeTax.ts` helper is absent.
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(inputs, failures)` is exercised with a GOOD fixture and ≥2
 * DISTINCT BAD fixtures. The disk-reading main path calls the SAME `check(...)`;
 * the refactor is behavior-preserving (identical verdict on the real tree). The
 * banned tokens are assembled from fragments (matching the original gate's
 * defensive concatenation) so the gate's own source never carries a literal.
 */
import fs from "node:fs";
import path from "node:path";

const files = [
  "supabase/functions/ticket-checkout-create/index.ts",
  "app-mobile/src/payments/nativeCheckoutFlow.ts",
  "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
  "mingla-business/src/payments/nativeCheckoutFlow.ts",
];
const banned = [
  "NATIVE_PAID_ALLOWED" + "_REGIONS",
  "isNativePaidAllowed" + "ForBrand",
  "native_paid_not_allowed" + "_in_region",
];

function check(inputs, failures) {
  const { legacyExists, fileEntries } = inputs;
  if (legacyExists) {
    failures.push("legacy stripeTax helper still exists");
  }
  for (const { file, src } of fileEntries) {
    for (const token of banned) {
      if (src.includes(token)) failures.push(`${file} still contains ${token}`);
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: legacy helper absent, no banned tokens in any checkout file → silent.
  let f = [];
  check(
    {
      legacyExists: false,
      fileEntries: [
        { file: "supabase/functions/ticket-checkout-create/index.ts", src: "const lines = payload.lines;\n" },
      ],
    },
    f,
  );
  if (f.length) self.push("GOOD (no legacy helper + no region-gate tokens) wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): a banned region-gate token re-added to a checkout
  // file (token built from `banned` so no literal lives in this source) → fires.
  f = [];
  check(
    {
      legacyExists: false,
      fileEntries: [
        { file: "supabase/functions/ticket-checkout-create/index.ts", src: "const gate = " + banned[0] + " ?? [];\n" },
      ],
    },
    f,
  );
  if (f.length === 0) self.push("BAD1 (region-gate token re-added to a checkout file) not flagged");

  // BAD2 (regression, different angle): the legacy _shared/stripeTax.ts helper
  // re-created → fires.
  f = [];
  check(
    {
      legacyExists: true,
      fileEntries: [
        { file: "supabase/functions/ticket-checkout-create/index.ts", src: "const lines = payload.lines;\n" },
      ],
    },
    f,
  );
  if (f.length === 0) self.push("BAD2 (legacy _shared/stripeTax.ts re-created) not flagged");

  if (self.length) {
    console.error("ORCH-0955-REGION-GATE-DELETED self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0955-REGION-GATE-DELETED self-test PASS (3/3 cases).");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();
const legacyExists = fs.existsSync(path.join(root, "supabase/functions/_shared/stripeTax.ts"));
const fileEntries = [];
for (const file of files) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) continue;
  fileEntries.push({ file, src: fs.readFileSync(abs, "utf8") });
}
const failures = [];
check({ legacyExists, fileEntries }, failures);
if (failures.length) {
  console.error(`FAIL [ORCH-0955 region gate deleted]\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS [ORCH-0955 region gate deleted]");
