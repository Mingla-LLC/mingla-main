#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1232 (PUBLIC-SAFETY, CLOSE-BLOCKING)
 * I-PROPOSED-1232-F — `isAuthReady` MUST NOT appear in any public-path file, the
 * single-by-id `useBrand` MUST stay ungated, and the public route-prefix lists MUST
 * be unchanged.
 *
 * WHY: the META-ORCH-1232 fix gates ONLY the authed brand MUTATION hooks (and the
 * C1/H2/H3 chokepoints). It must NEVER over-gate a public/anon surface. The public
 * buyer routes, self-authenticating Stripe-Connect seller routes, the slug-keyed
 * `usePublicBrandBySlug`/`getPublicBrandBySlug`, and the anon-readable single-by-id
 * `useBrand` are on a cleanly separated code path (anon RLS policies). A gate on any
 * of them would blank-screen logged-out buyers/sellers.
 *
 * THE GATE (revert = a public path gets gated = fail):
 *  F1. `isAuthReady` is ABSENT from usePublicEvents.ts and publicEventsService.ts.
 *  F2. the single-by-id `useBrand` (useBrands.ts) does NOT reference isAuthReady.
 *  F3. PUBLIC_BUYER_ROUTE_PREFIXES + SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES
 *      membership in coldLoadAuthGates.ts is UNCHANGED (exact snapshot).
 *
 * NOTE: coldLoadAuthGates.ts legitimately uses `isAuthReady` as a PARAMETER NAME in
 * shouldGateColdLoad — so F does NOT ban the token there; it pins the route lists.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. Self-test (--self-test).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BIZ = "mingla-business/src";

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

const ISAUTHREADY_RE = /isAuthReady/;

// Extract a string[] literal array body for a named const. Comments are stripped
// FIRST so a `]` inside an inline comment (e.g. `// /e/[brandSlug]`) cannot
// truncate the non-greedy array capture.
function extractPrefixList(rawSrc, name) {
  const src = stripComments(rawSrc);
  const re = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m");
  const m = src.match(re);
  if (!m) return null;
  const items = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  return items;
}

// Expected snapshots (SPEC §3 — frozen). Sorted for order-independent compare.
const EXPECTED_BUYER = [
  "/e/",
  "/t/",
  "/b/",
  "/exp/",
  "/checkout/",
  "/checkout-trip/",
  "/checkout-experience/",
  "/reserve/",
  "/refund/",
  "/o/",
  "/booking/",
].sort();
const EXPECTED_CONNECT = [
  "/connect-onboarding",
  "/connect-account-management",
  "/connect-partner-onboarding",
  "/connect-partner-account-management",
  "/connect-tax-registrations",
  "/stripe-onboarding-return",
].sort();

const eqSet = (a, b) =>
  a !== null &&
  a.length === b.length &&
  a.slice().sort().join("|") === b.slice().sort().join("|");

// useBrand single-by-id body extractor. Ends at the FIRST top-level boundary that
// follows the hook — whichever comes first of: the next `export interface`, the
// next `export const`, or the next `\nconst ` (e.g. a private helper like
// useIsAuthReadyGetter). This keeps the captured body to ONLY the useBrand hook so
// a gate added to a LATER hook does not leak into this check.
function useBrandBody(src) {
  const start = src.indexOf("export const useBrand = ");
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const boundaries = [
    rest.indexOf("\nexport interface "),
    rest.indexOf("\nexport const "),
    rest.indexOf("\nconst "),
  ].filter((n) => n >= 0);
  if (boundaries.length === 0) return src.slice(start);
  const cut = Math.min(...boundaries);
  return src.slice(start, start + 1 + cut);
}

function runSelfTest() {
  let f = 0;
  // F1 — public hook token detector
  if (ISAUTHREADY_RE.test(stripComments(`const x = isAuthReady;`)) === false) {
    console.error("SELF-TEST FAIL: isAuthReady token not detected");
    f++;
  }
  if (ISAUTHREADY_RE.test(stripComments(`const enabled = brandSlug !== null;`))) {
    console.error("SELF-TEST FAIL: clean public hook falsely flagged");
    f++;
  }
  // F2 — useBrand body extractor + gate detection
  const goodUseBrand = stripComments(`
    export const useBrand = (brandId) => { const enabled = brandId !== null; };
    export const useCreateBrand = () => {};
  `);
  const badUseBrand = stripComments(`
    export const useBrand = (brandId) => { const { isAuthReady } = useAuth(); const enabled = isAuthReady && brandId !== null; };
    export const useCreateBrand = () => {};
  `);
  if (ISAUTHREADY_RE.test(useBrandBody(goodUseBrand))) {
    console.error("SELF-TEST FAIL: clean useBrand falsely flagged as gated");
    f++;
  }
  if (!ISAUTHREADY_RE.test(useBrandBody(badUseBrand))) {
    console.error("SELF-TEST FAIL: gated useBrand not detected");
    f++;
  }
  // F3 — prefix snapshot compare
  const goodCold = `export const PUBLIC_BUYER_ROUTE_PREFIXES = ["/e/","/t/","/b/","/exp/","/checkout/","/checkout-trip/","/checkout-experience/","/reserve/","/refund/","/o/","/booking/"];`;
  const badCold = `export const PUBLIC_BUYER_ROUTE_PREFIXES = ["/e/","/t/"];`;
  const badMissingRefund = `export const PUBLIC_BUYER_ROUTE_PREFIXES = ["/e/","/t/","/b/","/exp/","/checkout/","/checkout-trip/","/checkout-experience/","/reserve/","/o/","/booking/"];`;
  const badRefundsLookalike = `export const PUBLIC_BUYER_ROUTE_PREFIXES = ["/e/","/t/","/b/","/exp/","/checkout/","/checkout-trip/","/checkout-experience/","/reserve/","/refunds/","/o/","/booking/"];`;
  if (!eqSet(extractPrefixList(goodCold, "PUBLIC_BUYER_ROUTE_PREFIXES"), EXPECTED_BUYER)) {
    console.error("SELF-TEST FAIL: good buyer-prefix snapshot mismatch");
    f++;
  }
  if (eqSet(extractPrefixList(badCold, "PUBLIC_BUYER_ROUTE_PREFIXES"), EXPECTED_BUYER)) {
    console.error("SELF-TEST FAIL: shrunk buyer-prefix list falsely matched snapshot");
    f++;
  }
  if (eqSet(extractPrefixList(badMissingRefund, "PUBLIC_BUYER_ROUTE_PREFIXES"), EXPECTED_BUYER)) {
    console.error("SELF-TEST FAIL: snapshot missing exact /refund/ member falsely matched");
    f++;
  }
  if (eqSet(extractPrefixList(badRefundsLookalike, "PUBLIC_BUYER_ROUTE_PREFIXES"), EXPECTED_BUYER)) {
    console.error("SELF-TEST FAIL: /refunds/ lookalike falsely matched exact /refund/ member");
    f++;
  }
  if (f > 0) {
    console.error(`SELF-TEST: ${f} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1232-F detectors behave");
  process.exit(0);
}
if (process.argv.includes("--self-test")) runSelfTest();

// F1 — isAuthReady absent from the public data hooks/services.
const PUBLIC_FILES = [
  `${BIZ}/hooks/usePublicEvents.ts`,
  `${BIZ}/services/publicEventsService.ts`,
];
for (const rel of PUBLIC_FILES) {
  const code = stripComments(read(rel));
  if (ISAUTHREADY_RE.test(code)) {
    fail(
      "F1: public-hook-ungated",
      `${rel} references isAuthReady — a public/anon (slug-keyed) data path MUST NOT be gated (SPEC §3). ` +
        `This would blank-screen logged-out public pages.`,
    );
  } else {
    ok("F1: public-hook-ungated", `${rel} carries NO isAuthReady gate`);
  }
}

// F2 — single-by-id useBrand stays ungated.
const useBrandSrc = stripComments(read(`${BIZ}/hooks/useBrands.ts`));
const ub = useBrandBody(useBrandSrc);
if (ub === null) {
  fail("F2: useBrand-present", "useBrand (single-by-id) not found in useBrands.ts");
} else if (ISAUTHREADY_RE.test(ub)) {
  fail(
    "F2: useBrand-ungated",
    "useBrand (single-by-id) references isAuthReady — it MUST stay UNGATED (public pages depend on the " +
      "anon by-id read). C1 instead prevents a _temp_ id reaching it (SPEC §3).",
  );
} else {
  ok("F2: useBrand-ungated", "useBrand (single-by-id) stays ungated");
}

// F3 — route prefix lists unchanged (exact snapshot).
const coldSrc = read(`${BIZ}/utils/coldLoadAuthGates.ts`);
const buyer = extractPrefixList(coldSrc, "PUBLIC_BUYER_ROUTE_PREFIXES");
const connect = extractPrefixList(coldSrc, "SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES");
if (eqSet(buyer, EXPECTED_BUYER)) {
  ok("F3: buyer-prefixes-frozen", "PUBLIC_BUYER_ROUTE_PREFIXES membership unchanged");
} else {
  fail(
    "F3: buyer-prefixes-frozen",
    `PUBLIC_BUYER_ROUTE_PREFIXES membership changed (got ${JSON.stringify(buyer)}; expected ${JSON.stringify(EXPECTED_BUYER)}). ` +
      `META-ORCH-1232 must NOT alter the public buyer allowlist (SPEC §3).`,
  );
}
if (eqSet(connect, EXPECTED_CONNECT)) {
  ok("F3: connect-prefixes-frozen", "SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES membership unchanged");
} else {
  fail(
    "F3: connect-prefixes-frozen",
    `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES membership changed (got ${JSON.stringify(connect)}; expected ${JSON.stringify(EXPECTED_CONNECT)}). ` +
      `META-ORCH-1232 must NOT alter the self-authenticating seller route list (SPEC §3).`,
  );
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1232-F (PUBLIC-SAFETY): ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1232-F (PUBLIC-SAFETY): PASS · violations=0");
process.exit(0);
