#!/usr/bin/env node
/**
 * ORCH-0756A active-brand recovery guard.
 *
 * INVARIANT: the business app keeps the active brand DURABLE across the two entry
 * points a user reaches it from — PICKING an existing brand and CREATING a new one
 * — plus the supporting resolver / recovery / store wiring that keeps the selection
 * from silently vanishing (the false-empty / null-splash regressions this gate was
 * born to catch).
 *
 * WHY brand-create is asserted in BrandCreationFlow.tsx and brand-pick in
 * BrandSwitcherSheet.tsx (META-ORCH-0972, Sub-B, commit 2e018bdea):
 *   Before the move, BrandSwitcherSheet.tsx owned BOTH flows — it picked an existing
 *   brand AND inlined the create form, so both default-persistence writes lived there.
 *   Sub-B split the create form out into its own BrandCreationFlow.tsx; the switcher
 *   now merely renders <BrandCreationFlow/> in create-mode. So today:
 *     - brand PICK  → default_brand_id: brand.id + onDefaultBrandSaveError toast
 *                     STILL live in BrandSwitcherSheet.tsx  → asserted THERE.
 *     - brand CREATE → the persistence moved to BrandCreationFlow.tsx and is asserted
 *                      THERE via its three legs:
 *                        1. setCurrentBrand(newBrand)          — store write
 *                        2. default_brand_id: newBrand.id      — creator-account DB write
 *                        3. commitDefaultBrand(newBrand)       — the create flow invokes
 *                                                                the commit helper
 *   Issue #961 (discovery D-2): this gate had stayed pinned to the PRE-move location
 *   (create asserted in BrandSwitcherSheet.tsx) and so exited 1 even though the behavior
 *   was fully intact — a blessed-refactor drift, not a regression. Re-pinning create to
 *   BrandCreationFlow.tsx restores a genuinely protective gate at the behavior's new home.
 *
 * `--self-test` proves fail-on-revert (mirrors orch-0955-region-gate-deleted.mjs):
 * the pure `check(sources, violations, checks)` is exercised with a GOOD fixture that
 * satisfies every leg, and with BAD fixtures that DELETE each BrandCreationFlow
 * create-persistence leg — each BAD fixture MUST make the gate fire. The disk-reading
 * main path calls the SAME `check(...)`, so the real run and the self-test share logic.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

// ---- guarded file paths ------------------------------------------------------
const homePath = "mingla-business/app/(tabs)/home.tsx";
const todosHookPath = "mingla-business/src/hooks/useBusinessTodos.ts";
const todosUtilPath = "mingla-business/src/utils/businessTodos.ts";
const creatorAccountHookPath = "mingla-business/src/hooks/useCreatorAccount.ts";
const creatorAccountServicePath = "mingla-business/src/services/creatorAccount.ts";
const recoveryHookPath = "mingla-business/src/hooks/useCurrentBrandRecovery.ts";
const layoutPath = "mingla-business/app/_layout.tsx";
const switcherPath = "mingla-business/src/components/brand/BrandSwitcherSheet.tsx";
const creationFlowPath = "mingla-business/src/components/brand/BrandCreationFlow.tsx";
const storePath = "mingla-business/src/store/currentBrandStore.ts";

const GUARDED_PATHS = [
  homePath,
  todosHookPath,
  todosUtilPath,
  creatorAccountHookPath,
  creatorAccountServicePath,
  recoveryHookPath,
  layoutPath,
  switcherPath,
  creationFlowPath,
  storePath,
];

/**
 * Pure verifier. `sources` maps each guarded relPath to its source text. Failures
 * are pushed into `violations`, every check label into `checks`. No disk I/O — the
 * real run and `--self-test` both call this, so they can never diverge.
 */
function check(sources, violations, checks) {
  const src = (relPath) => sources[relPath] ?? "";
  const expectIncludes = (relPath, signature, message) => {
    checks.push(message);
    if (!src(relPath).includes(signature)) {
      violations.push(`${relPath}: missing ${message}`);
    }
  };
  const expectNotIncludes = (relPath, signature, message) => {
    checks.push(message);
    if (src(relPath).includes(signature)) {
      violations.push(`${relPath}: forbidden ${message}`);
    }
  };

  // home.tsx — the false-empty condition is gone; the to-do toggle still renders.
  expectNotIncludes(
    homePath,
    "brands.length === 0 || currentBrand === null",
    "old false-empty condition",
  );
  // ORCH-1038: the four active-brand states moved out of home.tsx into the shared
  // useBusinessTodos hook (derivations) + buildBusinessTodos (the create/select-brand
  // to-do rows). The recovery invariant is preserved — now shared by Home AND Hub —
  // just relocated. home.tsx must still RENDER the toggle that surfaces those rows.
  expectIncludes(
    homePath,
    "<BusinessTodoToggle",
    "home renders the to-do toggle (surfaces the brand-recovery rows)",
  );
  expectIncludes(todosHookPath, "const hasNoBrands =", "true no-brands state");
  expectIncludes(
    todosHookPath,
    "const hasBrandsButNoSelection =",
    "brands-exist/no-selection state",
  );
  expectIncludes(
    todosHookPath,
    "brandResolving: isBrandResolving",
    "resolving/loading state",
  );
  expectIncludes(todosUtilPath, '"Select a brand"', "brand-selection state");
  expectIncludes(
    homePath,
    "onDefaultBrandSaveError={handleDefaultBrandSaveError}",
    "default-brand write failure toast wiring",
  );

  expectIncludes(
    creatorAccountHookPath,
    "default_brand_id: string | null",
    "creator account default_brand_id type",
  );
  expectIncludes(
    creatorAccountHookPath,
    "default_brand_id, deleted_at",
    "creator account default_brand_id select",
  );
  expectIncludes(
    creatorAccountHookPath,
    "updateCreatorAccount(user.id, patch)",
    "creator account mutation delegates to verified service",
  );

  expectIncludes(
    creatorAccountServicePath,
    "default_brand_id?: string | null",
    "creator account update patch accepts default_brand_id",
  );
  expectIncludes(
    creatorAccountServicePath,
    ".select(\"id\")",
    "creator account update verifies returned row",
  );
  expectIncludes(
    creatorAccountServicePath,
    "no creator account row updated",
    "creator account update throws on zero-row update",
  );

  expectIncludes(
    recoveryHookPath,
    "resolveCurrentBrandId",
    "current brand resolver hook wiring",
  );
  expectIncludes(
    recoveryHookPath,
    "Brand selected for now. Couldn't save it as your default.",
    "visible fallback persistence error",
  );
  expectIncludes(recoveryHookPath, "appliedKeyRef", "loop prevention key");
  expectIncludes(
    recoveryHookPath,
    "setCreatorDefaultBrand",
    "fallback default persistence",
  );

  expectIncludes(
    layoutPath,
    "useCurrentBrandRecovery()",
    "app-wide current brand recovery wiring",
  );
  expectNotIncludes(
    layoutPath,
    "currentBrandId === null ||",
    "old null-brand splash ready shortcut",
  );

  // --- brand PICK persistence — STILL owned by BrandSwitcherSheet.tsx (META-ORCH-0972) ---
  expectIncludes(
    switcherPath,
    "default_brand_id: brand.id",
    "brand pick persists default brand",
  );
  expectIncludes(
    switcherPath,
    "onDefaultBrandSaveError",
    "brand switcher surfaces default persistence failure",
  );

  // --- brand CREATE persistence — MOVED to BrandCreationFlow.tsx (META-ORCH-0972) ---
  // All three legs are asserted at the new home so the gate genuinely catches removal
  // of create-persists-default (the issue #961 / D-2 re-pin).
  expectIncludes(
    creationFlowPath,
    "setCurrentBrand(newBrand)",
    "brand create sets current brand in store",
  );
  expectIncludes(
    creationFlowPath,
    "default_brand_id: newBrand.id",
    "brand create persists default brand (DB write)",
  );
  expectIncludes(
    creationFlowPath,
    "commitDefaultBrand(newBrand)",
    "brand create invokes default-brand commit",
  );

  // --- store partialize remains ID-only ---
  const store = src(storePath);
  const partializeMatch = store.match(/partialize:\s*\(state\)\s*=>\s*\(\{([\s\S]*?)\}\),/);
  checks.push("currentBrandStore persisted shape remains ID-only");
  if (partializeMatch === null) {
    violations.push(`${storePath}: could not inspect partialize block`);
  } else {
    const partializeBody = partializeMatch[1];
    if (!partializeBody.includes("currentBrandId: state.currentBrandId")) {
      violations.push(`${storePath}: partialize does not persist currentBrandId`);
    }
    if (/\bcurrentBrand\s*:|\bbrands\s*:/.test(partializeBody)) {
      violations.push(
        `${storePath}: partialize must not persist currentBrand or brands`,
      );
    }
  }
}

// -------------------------------------------------------------- self-test
if (process.argv.includes("--self-test")) {
  const problems = [];

  // A fixture set that satisfies EVERY assertion (the create-persistence legs live
  // in BrandCreationFlow.tsx, matching the real tree post-META-ORCH-0972).
  const goodSources = () => ({
    [homePath]:
      "return (<BusinessTodoToggle onDefaultBrandSaveError={handleDefaultBrandSaveError} />);",
    [todosHookPath]:
      "const hasNoBrands = brands.length === 0;\n" +
      "const hasBrandsButNoSelection = brands.length > 0 && current == null;\n" +
      "return { brandResolving: isBrandResolving };",
    [todosUtilPath]: 'const label = "Select a brand";',
    [creatorAccountHookPath]:
      "type Row = { default_brand_id: string | null };\n" +
      'const q = supabase.select("id, default_brand_id, deleted_at");\n' +
      "return updateCreatorAccount(user.id, patch);",
    [creatorAccountServicePath]:
      "type Patch = { default_brand_id?: string | null };\n" +
      'const { data } = await supabase.update(patch).select("id");\n' +
      'if (!data) throw new Error("no creator account row updated");',
    [recoveryHookPath]:
      "const id = resolveCurrentBrandId(state);\n" +
      "const appliedKeyRef = useRef(null);\n" +
      "await setCreatorDefaultBrand(id);\n" +
      "onError(\"Brand selected for now. Couldn't save it as your default.\");",
    [layoutPath]: "useCurrentBrandRecovery();\nif (ready) render();",
    [switcherPath]:
      "await mutateAsync({ default_brand_id: brand.id }).catch(() => onDefaultBrandSaveError?.(msg));",
    [creationFlowPath]:
      "setCurrentBrand(newBrand);\n" +
      "await mutateAsync({ default_brand_id: newBrand.id });\n" +
      "commitDefaultBrand(newBrand);",
    [storePath]: "partialize: (state) => ({ currentBrandId: state.currentBrandId }),",
  });

  const run = (sources) => {
    const v = [];
    check(sources, v, []);
    return v;
  };

  // control — the GOOD fixture must PASS (else every BAD case below is meaningless).
  {
    const v = run(goodSources());
    if (v.length) problems.push("GOOD fixture wrongly flagged: " + v.join("; "));
  }
  // BAD1 (the D-2 revert scenario) — all three create-persistence legs removed → fires.
  {
    const s = goodSources();
    s[creationFlowPath] = "setBrand(newBrand); // all create-persistence legs removed";
    const v = run(s);
    if (v.length === 0) {
      problems.push("BAD1 (all BrandCreationFlow create-persistence legs removed) not flagged");
    }
  }
  // BAD2 — only the DB-write leg (default_brand_id: newBrand.id) removed → fires.
  {
    const s = goodSources();
    s[creationFlowPath] = "setCurrentBrand(newBrand);\ncommitDefaultBrand(newBrand);";
    const v = run(s);
    if (!v.some((m) => m.includes(creationFlowPath) && m.includes("DB write"))) {
      problems.push("BAD2 (create DB-write leg removed) not flagged");
    }
  }
  // BAD3 — only the commit-invocation leg (commitDefaultBrand(newBrand)) removed → fires.
  {
    const s = goodSources();
    s[creationFlowPath] =
      "setCurrentBrand(newBrand);\nawait mutateAsync({ default_brand_id: newBrand.id });";
    const v = run(s);
    if (!v.some((m) => m.includes(creationFlowPath) && m.includes("commit"))) {
      problems.push("BAD3 (create commit-invocation leg removed) not flagged");
    }
  }
  // BAD4 — only the store-write leg (setCurrentBrand(newBrand)) removed → fires.
  {
    const s = goodSources();
    s[creationFlowPath] =
      "await mutateAsync({ default_brand_id: newBrand.id });\ncommitDefaultBrand(newBrand);";
    const v = run(s);
    if (!v.some((m) => m.includes(creationFlowPath) && m.includes("store"))) {
      problems.push("BAD4 (create store-write leg removed) not flagged");
    }
  }
  // BAD5 (tester #961, Step-0.5 adversarial — angle ≠ implementor's per-leg deletion):
  // create legs RELOCATED out of BrandCreationFlow.tsx back into the switcher (helper
  // moved, not deleted). The gate MUST still fire because create-persistence is pinned
  // to creationFlowPath, not checked globally — this catches an incomplete refactor-revert.
  {
    const s = goodSources();
    s[creationFlowPath] = "// create-persistence relocated away";
    s[switcherPath] =
      "await mutateAsync({ default_brand_id: brand.id }).catch(() => onDefaultBrandSaveError?.(msg));\n" +
      "setCurrentBrand(newBrand);\nawait mutateAsync({ default_brand_id: newBrand.id });\ncommitDefaultBrand(newBrand);";
    const v = run(s);
    if (v.length === 0) problems.push("BAD5 (create legs relocated to switcher) not flagged");
  }

  if (problems.length) {
    console.error("ORCH-0756A active-brand recovery guard self-test FAIL:");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log(
    "ORCH-0756A self-test PASS (GOOD + 4 revert fixtures + 1 tester adversarial BAD5 — brand-create persists-default guarded at BrandCreationFlow.tsx).",
  );
  process.exit(0);
}

// -------------------------------------------------------------- real run
const read = (relPath) => {
  const absPath = path.join(repoRoot, relPath);
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch (error) {
    console.error(`ORCH-0756A ERROR: could not read ${relPath}: ${error.message}`);
    process.exit(2);
  }
};

const sources = {};
for (const relPath of GUARDED_PATHS) sources[relPath] = read(relPath);

const violations = [];
const checks = [];
check(sources, violations, checks);

if (violations.length > 0) {
  console.error("ORCH-0756A active-brand recovery guard failed.");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(
  `ORCH-0756A PASS: active-brand recovery guard passed (${checks.length} checks).`,
);
