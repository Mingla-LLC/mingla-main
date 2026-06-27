#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1232 (C1)
 * I-PROPOSED-1232-A — no `_temp_`/non-UUID id may reach a uuid column or the
 * current-brand pointer.
 *
 * WHY: `useCreateBrand.onMutate` mints an optimistic `_temp_${Date.now()...}`
 * brand id into the React Query list cache. For a zero-brand account,
 * `resolveCurrentBrandId` would pick that temp row as `brands[0]` ("newest-brand")
 * and `runBrandRecoveryWrite` would write it to the global `currentBrandId` AND to
 * `creator_accounts.default_brand_id` (uuid) AND it flows into `getBrand(.eq("id"))`
 * against uuid `brands.id` — both throw Postgres `22P02` (observed live).
 *
 * THE FIX (defense-in-depth): one shared `isPersistedBrandId` validator
 * (`src/utils/brandId.ts`) applied at FOUR sinks so a non-uuid id is rejected
 * BEFORE it can reach a uuid column / the pointer:
 *   1. resolver        — src/utils/currentBrandResolver.ts
 *   2. write boundary  — src/hooks/useCurrentBrandRecovery.ts (runBrandRecoveryWrite)
 *   3. default-brand   — src/services/creatorAccount.ts (setCreatorDefaultBrand)
 *   4. by-id read      — src/services/brandsService.ts (getBrand)
 *
 * This gate asserts the validator EXISTS and is imported+applied at each sink, so a
 * revert (dropping any guard) fails CI.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. Self-test (--self-test) validates the
 * detectors against fixtures.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BIZ = "mingla-business/src";

const VALIDATOR_FILE = `${BIZ}/utils/brandId.ts`;

let failures = 0;
const fail = (check, msg) => {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
};
const ok = (check, msg) => console.log(`OK   [${check}] ${msg}`);

function read(rel) {
  const abs = path.join(REPO_ROOT, rel);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (e) {
    console.error(`fs error reading ${rel}: ${e.message}`);
    process.exit(2);
  }
}
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// Detectors.
const VALIDATOR_DEF_RE = /export\s+const\s+isPersistedBrandId\s*=/;
const IMPORTS_VALIDATOR_RE = /isPersistedBrandId/;
const IMPORTS_INVALID_ERR_RE = /InvalidBrandIdError/;

function runSelfTest() {
  let f = 0;
  const goodValidator = stripComments(`
    export const isPersistedBrandId = (id) => UUID_RE.test(id);
    export class InvalidBrandIdError extends Error {}
  `);
  const goodResolver = stripComments(`
    import { isPersistedBrandId } from "./brandId";
    const newest = brands.find((b) => isPersistedBrandId(b.id));
  `);
  const badResolver = stripComments(`
    const newest = brands[0];
  `);
  if (!VALIDATOR_DEF_RE.test(goodValidator)) {
    console.error("SELF-TEST FAIL: validator def not detected");
    f++;
  }
  if (!IMPORTS_VALIDATOR_RE.test(goodResolver)) {
    console.error("SELF-TEST FAIL: validator usage not detected in good resolver");
    f++;
  }
  if (IMPORTS_VALIDATOR_RE.test(badResolver)) {
    console.error("SELF-TEST FAIL: reverted resolver falsely matched validator usage");
    f++;
  }
  if (f > 0) {
    console.error(`SELF-TEST: ${f} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1232-A detectors behave");
  process.exit(0);
}
if (process.argv.includes("--self-test")) runSelfTest();

// 1. Validator exists.
const validatorSrc = stripComments(read(VALIDATOR_FILE));
if (VALIDATOR_DEF_RE.test(validatorSrc)) {
  ok("validator-exists", `${VALIDATOR_FILE} exports isPersistedBrandId`);
} else {
  fail(
    "validator-exists",
    `${VALIDATOR_FILE} must export the shared isPersistedBrandId validator (Constitution #4 — one source of truth).`,
  );
}
if (IMPORTS_INVALID_ERR_RE.test(validatorSrc)) {
  ok("invalid-err-exists", `${VALIDATOR_FILE} exports InvalidBrandIdError`);
} else {
  fail("invalid-err-exists", `${VALIDATOR_FILE} must export InvalidBrandIdError.`);
}

// 2..5 — each sink imports + applies the validator.
const SINKS = [
  {
    rel: `${BIZ}/utils/currentBrandResolver.ts`,
    label: "resolver",
  },
  {
    rel: `${BIZ}/hooks/useCurrentBrandRecovery.ts`,
    label: "write-boundary (runBrandRecoveryWrite)",
  },
  {
    rel: `${BIZ}/services/creatorAccount.ts`,
    label: "setCreatorDefaultBrand",
    extra: IMPORTS_INVALID_ERR_RE,
    extraLabel: "throws InvalidBrandIdError",
  },
  {
    rel: `${BIZ}/services/brandsService.ts`,
    label: "getBrand",
  },
];

for (const { rel, label, extra, extraLabel } of SINKS) {
  const code = stripComments(read(rel));
  if (IMPORTS_VALIDATOR_RE.test(code)) {
    ok("guarded-sink", `${rel} (${label}) imports+applies isPersistedBrandId`);
  } else {
    fail(
      "guarded-sink",
      `${rel} (${label}) does NOT reference isPersistedBrandId — a non-uuid/_temp_ id ` +
        `could reach a uuid column / the current-brand pointer (Postgres 22P02). Restore the C1 guard.`,
    );
  }
  if (extra && !extra.test(code)) {
    fail(
      "guarded-sink-extra",
      `${rel} (${label}) must ${extraLabel}.`,
    );
  }
}

// 6 — getBrand guard must precede the .eq("id") query (the temp-id-miss short
// circuit). Assert isPersistedBrandId appears before `.eq("id"` in getBrand.
const brandsSvc = stripComments(read(`${BIZ}/services/brandsService.ts`));
const getBrandIdx = brandsSvc.indexOf("export async function getBrand(");
if (getBrandIdx >= 0) {
  const body = brandsSvc.slice(getBrandIdx, getBrandIdx + 600);
  const guardIdx = body.indexOf("isPersistedBrandId");
  const eqIdx = body.search(/\.eq\(\s*["']id["']/);
  if (guardIdx >= 0 && (eqIdx < 0 || guardIdx < eqIdx)) {
    ok("getBrand-guard-precedes-query", "getBrand guards before .eq(\"id\")");
  } else {
    fail(
      "getBrand-guard-precedes-query",
      "getBrand must reject a non-persisted id BEFORE issuing .eq(\"id\", …).",
    );
  }
} else {
  fail("getBrand-present", "getBrand not found in brandsService.ts");
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1232-A: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1232-A: PASS · violations=0");
process.exit(0);
