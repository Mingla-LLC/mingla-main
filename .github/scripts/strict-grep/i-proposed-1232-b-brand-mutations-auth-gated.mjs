#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1232 (C2)
 * I-PROPOSED-1232-B — brand mutations are auth-ready-gated (await-until-ready;
 * never silently drop).
 *
 * WHY: `useBrands` (read) gates on `isAuthReady`, but the brand MUTATION hooks
 * (`useCreateBrand` / `useUpdateBrand` / `useCreateVenueBrand`) did not — they fire
 * whenever `mutateAsync` is called. On web the JWT can attach late; a pre-JWT insert
 * runs as `anon`, `auth.uid()` is NULL, and the `brands` INSERT RLS
 * `WITH CHECK (account_id = auth.uid())` rejects it (presented as a no-op).
 *
 * THE FIX: each of the 3 mutation `mutationFn`s `await awaitAuthReady(...)` (≤5s cap,
 * throws AuthNotReadyError on cap-elapse) before the service write; AND the create CTA
 * + address CTA in BrandCreationFlow.tsx are `disabled` on `!isAuthReady`.
 *
 * This gate asserts each of the 3 hooks calls awaitAuthReady, and both CTAs gate on
 * `!isAuthReady`. A revert (dropping the gate) fails CI.
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

// Return the body of a hook from its `export const NAME = (` to the next
// top-level `export const ` (rough but sufficient for the mutation hooks).
function hookBody(src, name) {
  const start = src.indexOf(`export const ${name} = `);
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const nextExport = rest.indexOf("\nexport const ");
  return nextExport < 0 ? src.slice(start) : src.slice(start, start + 1 + nextExport);
}

const AWAIT_AUTH_READY_RE = /await\s+awaitAuthReady\s*\(/;

function runSelfTest() {
  let f = 0;
  const good = stripComments(`
    export const useCreateBrand = () => {
      const isAuthReadyGetter = useIsAuthReadyGetter();
      const mutation = useMutation({ mutationFn: async (i) => {
        await awaitAuthReady({ isReady: isAuthReadyGetter });
        return createBrand(i, "owner");
      }});
    };
  `);
  const bad = stripComments(`
    export const useCreateBrand = () => {
      const mutation = useMutation({ mutationFn: async (i) => createBrand(i, "owner") });
    };
  `);
  if (!AWAIT_AUTH_READY_RE.test(hookBody(good, "useCreateBrand") ?? "")) {
    console.error("SELF-TEST FAIL: good hook awaitAuthReady not detected");
    f++;
  }
  if (AWAIT_AUTH_READY_RE.test(hookBody(bad, "useCreateBrand") ?? "")) {
    console.error("SELF-TEST FAIL: reverted hook falsely matched awaitAuthReady");
    f++;
  }
  // CTA gate detector
  const goodCta = stripComments(`disabled={trimmedName.length === 0 || createBrandMutation.isPending || !isAuthReady}`);
  const badCta = stripComments(`disabled={trimmedName.length === 0 || createBrandMutation.isPending}`);
  const CTA_RE = /createBrandMutation\.isPending[\s\S]{0,60}!isAuthReady/;
  if (!CTA_RE.test(goodCta)) {
    console.error("SELF-TEST FAIL: good create CTA gate not detected");
    f++;
  }
  if (CTA_RE.test(badCta)) {
    console.error("SELF-TEST FAIL: ungated create CTA falsely matched");
    f++;
  }
  if (f > 0) {
    console.error(`SELF-TEST: ${f} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1232-B detectors behave");
  process.exit(0);
}
if (process.argv.includes("--self-test")) runSelfTest();

// 1 — the 3 mutation hooks await auth readiness in mutationFn.
const useBrandsSrc = stripComments(read(`${BIZ}/hooks/useBrands.ts`));
for (const hook of ["useCreateBrand", "useUpdateBrand", "useCreateVenueBrand"]) {
  const body = hookBody(useBrandsSrc, hook);
  if (body === null) {
    fail("hook-present", `${hook} not found in useBrands.ts`);
    continue;
  }
  if (AWAIT_AUTH_READY_RE.test(body)) {
    ok("hook-auth-gated", `${hook} awaits auth readiness before the service write`);
  } else {
    fail(
      "hook-auth-gated",
      `${hook} does NOT await awaitAuthReady() — a brand mutation can fire during the ` +
        `auth-warm window (anon RLS rejection presented as a no-op). Restore the C2 gate.`,
    );
  }
}

// 2 — both CTAs in BrandCreationFlow.tsx gate on !isAuthReady.
const flowSrc = stripComments(read(`${BIZ}/components/brand/BrandCreationFlow.tsx`));
const CREATE_CTA_RE = /createBrandMutation\.isPending[\s\S]{0,80}!isAuthReady/;
const ADDRESS_CTA_RE = /updateBrandMutation\.isPending[\s\S]{0,80}!isAuthReady/;
if (CREATE_CTA_RE.test(flowSrc)) {
  ok("create-cta-gated", "create CTA is disabled while !isAuthReady");
} else {
  fail(
    "create-cta-gated",
    "BrandCreationFlow create CTA is not gated on !isAuthReady (SPEC §2 C2).",
  );
}
if (ADDRESS_CTA_RE.test(flowSrc)) {
  ok("address-cta-gated", "address CTA is disabled while !isAuthReady");
} else {
  fail(
    "address-cta-gated",
    "BrandCreationFlow address CTA is not gated on !isAuthReady (SPEC §2 C2).",
  );
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1232-B: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1232-B: PASS · violations=0");
process.exit(0);
