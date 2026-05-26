#!/usr/bin/env node
/**
 * ORCH-0855 [Tr1 Trip Planner Brand Onboarding] — tester-authored adversarial
 * structural-grep regression check.
 *
 * Attacks the implementation from DIFFERENT angles than the 3 implementor
 * jest tests (per Step 0.5 regression gate / ORCH-0840 protocol). Implementor
 * tests cover the happy paths and locked literals; this check attacks:
 *   - Migration file presence + correct timestamp prefix + DDL + self-verify
 *     probe + transactional wrap
 *   - Cross-file type-union widening (4 separate locations)
 *   - BrandSwitcherSheet Mode union completeness via exact set membership
 *     (different angle from implementor's whole-line regex)
 *   - popup-create backward-compat literal
 *   - TripBrandWizard kind literal + final-route literal
 *   - Home Stripe-status gating presence
 *   - Scope-leak guardrail — 'trip_planner' literal appears ONLY in expected
 *     files (Tr2 scope-leak detection)
 *
 * Runs as a standalone node script. Exit code 0 = PASS, 1 = FAIL.
 * Wire into .github/workflows/strict-grep-mingla-business.yml at CLOSE
 * per `feedback_strict_grep_registry_pattern`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..", ".."); // repo root
const BUSINESS = join(ROOT, "mingla-business");
const MIG_DIR = join(ROOT, "supabase", "migrations");

const ORCH_ID = "ORCH-0855";
const results = [];
let exitCode = 0;

function pass(id, msg) {
  results.push({ id, status: "PASS", msg });
}
function fail(id, msg) {
  results.push({ id, status: "FAIL", msg });
  exitCode = 1;
}
function read(path) {
  return readFileSync(path, "utf-8");
}

// ---------- A-01: Migration filename exists with correct prefix ----------
{
  const migs = readdirSync(MIG_DIR).filter((f) =>
    f.includes("orch_0855_brands_kind_trip_planner") && f.endsWith(".sql"),
  );
  if (migs.length !== 1) {
    fail("A-01", `Expected exactly 1 ORCH-0855 migration; found ${migs.length}`);
  } else {
    const filename = migs[0];
    // Prefix must be strictly greater than 20260606000200 (latest pre-Tr1).
    const prefix = filename.split("_")[0];
    if (prefix.length !== 14 || !/^\d{14}$/.test(prefix)) {
      fail("A-01", `Migration prefix malformed: ${prefix}`);
    } else if (prefix <= "20260606000200") {
      fail(
        "A-01",
        `Migration prefix ${prefix} not strictly greater than latest pre-Tr1 head 20260606000200 — violates monotonicity (parity rule #10)`,
      );
    } else {
      pass("A-01", `Migration ${filename} (prefix ${prefix} > 20260606000200)`);
    }
  }
}

// ---------- A-02: Migration contains DDL + RAISE EXCEPTION self-verify ----------
{
  const migs = readdirSync(MIG_DIR).filter((f) =>
    f.includes("orch_0855_brands_kind_trip_planner"),
  );
  if (migs.length === 1) {
    const sql = read(join(MIG_DIR, migs[0]));
    const hasDrop = /DROP CONSTRAINT[^;]*brands_kind_check/i.test(sql);
    const hasAdd = /ADD CONSTRAINT[\s\S]*brands_kind_check[\s\S]*trip_planner/i.test(sql);
    const hasRaise = /RAISE EXCEPTION/i.test(sql);
    const hasDoBlock = /DO \$\$/i.test(sql);
    if (!hasDrop) fail("A-02", "Migration missing DROP CONSTRAINT brands_kind_check");
    else if (!hasAdd) fail("A-02", "Migration missing ADD CONSTRAINT with 'trip_planner'");
    else if (!hasRaise) fail("A-02", "Migration missing RAISE EXCEPTION self-verify probe");
    else if (!hasDoBlock) fail("A-02", "Migration missing DO $$ self-verify block");
    else pass("A-02", "Migration has DROP + ADD + DO$$ + RAISE EXCEPTION");
  }
}

// ---------- A-03: Migration uses BEGIN/COMMIT transactional wrap ----------
{
  const migs = readdirSync(MIG_DIR).filter((f) =>
    f.includes("orch_0855_brands_kind_trip_planner"),
  );
  if (migs.length === 1) {
    const sql = read(join(MIG_DIR, migs[0]));
    if (!/^BEGIN;/m.test(sql) || !/^COMMIT;/m.test(sql)) {
      fail("A-03", "Migration missing BEGIN; ... COMMIT; transactional wrap");
    } else {
      pass("A-03", "Migration is transactionally wrapped");
    }
  }
}

// ---------- A-04: types/brand.ts Brand.kind union widened ----------
{
  const path = join(BUSINESS, "src", "types", "brand.ts");
  const src = read(path);
  // Find Brand.kind line (not BrandRow / others — Brand interface specifically).
  // Look for `kind: "physical" | "popup" | "trip_planner"` somewhere.
  if (!/kind:\s*"physical"\s*\|\s*"popup"\s*\|\s*"trip_planner"/.test(src)) {
    fail("A-04", "types/brand.ts Brand.kind union not widened to include 'trip_planner'");
  } else {
    pass("A-04", "types/brand.ts kind union widened");
  }
}

// ---------- A-05: brandMapping.ts BOTH BrandRow + BrandUiInput widened ----------
{
  const path = join(BUSINESS, "src", "services", "brandMapping.ts");
  const src = read(path);
  // Should have at least 2 matches of the widened union (one non-optional + one optional).
  const widenedRequired = (src.match(/kind:\s*"physical"\s*\|\s*"popup"\s*\|\s*"trip_planner"/g) || []).length;
  const widenedOptional = (src.match(/kind\?:\s*"physical"\s*\|\s*"popup"\s*\|\s*"trip_planner"/g) || []).length;
  // Also confirm neither narrow union survives.
  const narrowReq = (src.match(/kind:\s*"physical"\s*\|\s*"popup"\s*;/g) || []).length;
  const narrowOpt = (src.match(/kind\?:\s*"physical"\s*\|\s*"popup"\s*;/g) || []).length;
  if (widenedRequired < 1) {
    fail("A-05", "brandMapping.ts BrandRow.kind not widened");
  } else if (widenedOptional < 1) {
    fail("A-05", "brandMapping.ts BrandUiInput.kind? not widened");
  } else if (narrowReq > 0 || narrowOpt > 0) {
    fail("A-05", `brandMapping.ts still has narrow union (required=${narrowReq}, optional=${narrowOpt})`);
  } else {
    pass("A-05", "brandMapping.ts both BrandRow and BrandUiInput widened");
  }
}

// ---------- A-06: brandsService.ts CreateBrandInput.kind widened ----------
{
  const path = join(BUSINESS, "src", "services", "brandsService.ts");
  const src = read(path);
  if (!/kind:\s*"physical"\s*\|\s*"popup"\s*\|\s*"trip_planner"/.test(src)) {
    fail("A-06", "brandsService.ts CreateBrandInput.kind union not widened");
  } else {
    pass("A-06", "brandsService.ts CreateBrandInput.kind widened");
  }
}

// ---------- A-08: BrandSwitcherSheet Mode union has all 4 modes (set membership) ----------
{
  const path = join(BUSINESS, "src", "components", "brand", "BrandSwitcherSheet.tsx");
  const src = read(path);
  const modeDeclMatch = src.match(/type Mode = ([^;]+);/);
  if (modeDeclMatch === null) {
    fail("A-08", "BrandSwitcherSheet.tsx missing `type Mode = ...;`");
  } else {
    const decl = modeDeclMatch[1];
    const requiredModes = ["switch", "persona", "popup-create", "trip-create"];
    const missing = requiredModes.filter((m) => !decl.includes(`"${m}"`));
    if (missing.length > 0) {
      fail("A-08", `Mode union missing required modes: ${missing.join(", ")}`);
    } else {
      // Defensive: also assert the deprecated "create" sole-mode is gone (not "popup-create" / "trip-create").
      // Look for `| "create"` or `"create" |` (sole), excluding popup-create / trip-create.
      if (/\|\s*"create"(?!-)/.test(decl) || /"create"\s*\|(?!\s*"popup-create")/.test(decl)) {
        fail("A-08", `Mode union still contains deprecated sole-"create" mode: ${decl}`);
      } else {
        pass("A-08", `Mode union has all 4 modes: ${decl.trim()}`);
      }
    }
  }
}

// ---------- A-09: BrandSwitcherSheet popup-create preserves kind:"popup" ----------
{
  const path = join(BUSINESS, "src", "components", "brand", "BrandSwitcherSheet.tsx");
  const src = read(path);
  // The popup-create submit MUST still pass kind: "popup" (backward-compat).
  if (!/kind:\s*"popup"/.test(src)) {
    fail("A-09", "BrandSwitcherSheet.tsx popup-create no longer passes kind: 'popup' — backward-compat broken");
  } else if (/kind:\s*"trip_planner"/.test(src)) {
    fail("A-09", "BrandSwitcherSheet.tsx contains kind: 'trip_planner' — trip-planner creation must live in TripBrandWizard, NOT the sheet itself");
  } else {
    pass("A-09", "BrandSwitcherSheet.tsx preserves kind:'popup' and does NOT carry kind:'trip_planner'");
  }
}

// ---------- A-10: TripBrandWizard calls createBrand with kind:"trip_planner" ----------
{
  const path = join(BUSINESS, "src", "components", "brand", "TripBrandWizard.tsx");
  if (!existsSync(path)) {
    fail("A-10", "TripBrandWizard.tsx missing");
  } else {
    const src = read(path);
    // createBrandMutation.mutateAsync({...kind: "trip_planner"...})
    if (!/createBrandMutation\.mutateAsync\([\s\S]{0,500}?kind:\s*"trip_planner"/.test(src)) {
      fail("A-10", "TripBrandWizard.tsx does not call createBrand mutation with kind:'trip_planner'");
    } else {
      pass("A-10", "TripBrandWizard calls createBrand with kind:'trip_planner' literal");
    }
  }
}

// ---------- A-11: TripBrandWizard final route = /brand/{id}/payments ----------
{
  const path = join(BUSINESS, "src", "components", "brand", "TripBrandWizard.tsx");
  if (existsSync(path)) {
    const src = read(path);
    // router.push(`/brand/${...}/payments`) — final navigation to existing BrandOnboardView.
    if (!/router\.push\(\s*`\/brand\/\$\{[^}]+\}\/payments`/.test(src)) {
      fail(
        "A-11",
        "TripBrandWizard.tsx does not route to `/brand/${id}/payments` — Stripe Connect delegation broken",
      );
    } else {
      pass("A-11", "TripBrandWizard routes to /brand/{id}/payments for Stripe Connect (delegates to existing BrandOnboardView)");
    }
  }
}

// ---------- A-12: home.tsx kind + stripeStatus gating ----------
{
  const path = join(BUSINESS, "app", "(tabs)", "home.tsx");
  const src = read(path);
  const hasKindBranch = /currentBrand\.kind\s*===\s*"trip_planner"/.test(src);
  const hasStripeBranch = /stripeStatus\s*===\s*"active"/.test(src);
  if (!hasKindBranch) {
    fail("A-12", "home.tsx missing currentBrand.kind === 'trip_planner' branch");
  } else if (!hasStripeBranch) {
    fail("A-12", "home.tsx missing stripeStatus === 'active' gating branch");
  } else {
    pass("A-12", "home.tsx has kind + stripeStatus gating");
  }
}

// ---------- A-14: Scope-leak guardrail — 'trip_planner' literal in expected files only ----------
{
  // Allowed files: anything in mingla-business/src/types/, src/services/brand*.ts,
  // src/components/brand/PersonaPickerCards.tsx, src/components/brand/TripBrandWizard.tsx,
  // src/components/brand/BrandSwitcherSheet.tsx, src/components/brand/BrandEditView.tsx,
  // app/(tabs)/home.tsx, src/services/__tests__/brandsService.tripPlannerKind.test.ts,
  // src/components/brand/__tests__/BrandSwitcherSheet.personaFork.test.ts,
  // src/components/brand/__tests__/TripBrandWizard.test.ts,
  // scripts/ci/orch-0855-adversarial-check.mjs (this file).
  const allowedSubstrings = [
    "src/types/brand.ts",
    "src/services/brandMapping.ts",
    "src/services/brandsService.ts",
    "src/services/__tests__/brandsService.tripPlannerKind.test.ts",
    "src/components/brand/PersonaPickerCards.tsx",
    "src/components/brand/TripBrandWizard.tsx",
    "src/components/brand/BrandSwitcherSheet.tsx",
    "src/components/brand/BrandEditView.tsx",
    "src/components/brand/__tests__/BrandSwitcherSheet.personaFork.test.ts",
    "src/components/brand/__tests__/TripBrandWizard.test.ts",
    "scripts/ci/orch-0855-adversarial-check.mjs",
    "app/(tabs)/home.tsx",
  ];
  const SCAN_ROOTS = [
    join(BUSINESS, "src"),
    join(BUSINESS, "app"),
    join(BUSINESS, "scripts"),
  ];
  const leaks = [];
  function walk(dir) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|mjs|js|jsx)$/.test(entry)) {
        const rel = full.substring(BUSINESS.length + 1);
        if (allowedSubstrings.some((s) => rel === s || rel.endsWith(s))) continue;
        const txt = read(full);
        if (/['"]trip_planner['"]/.test(txt) || /\btrip_planner\b/.test(txt)) {
          leaks.push(rel);
        }
      }
    }
  }
  for (const root of SCAN_ROOTS) {
    if (existsSync(root)) walk(root);
  }
  if (leaks.length > 0) {
    fail(
      "A-14",
      `'trip_planner' literal found in unexpected files (Tr2 scope leak?): ${leaks.join(", ")}`,
    );
  } else {
    pass("A-14", "'trip_planner' literal confined to expected Tr1 files; no scope leak");
  }
}

// ---------- Output ----------
const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;

console.log(`\n${ORCH_ID} adversarial structural-grep check — ${results.length} checks`);
console.log("─".repeat(72));
for (const r of results) {
  const marker = r.status === "PASS" ? "✓" : "✗";
  console.log(`${marker} ${r.id}  ${r.msg}`);
}
console.log("─".repeat(72));
console.log(`Result: ${passCount} PASS, ${failCount} FAIL`);
process.exit(exitCode);
