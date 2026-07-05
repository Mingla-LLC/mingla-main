#!/usr/bin/env node
/**
 * ORCH-1309 [brand-deeplink-cold-load-guard] — strict-grep gate.
 *
 * WHY: `/brand/[id]/edit` and `/brand/[id]/team` resolved the brand by
 * `useBrandList().find(id)` — an in-memory store list that is EMPTY on a cold
 * deep-link / refresh / bookmark (it is only populated after the app warms
 * through home). So `.find()` returned null and the routes flashed "Brand not
 * found" for every direct load (reproduced repeatedly on Seth's Samsung). The
 * /brand/[id] HUB already did it right: fetch by id (`useBrand`) + the cold-load
 * resolving guard (`isBrandRouteResolving`, ORCH-1100 Wave 3 + ORCH-1292) that
 * shows a spinner while the session warms + the query settles.
 *
 * FIX (ORCH-1309): the edit + team routes now FETCH the brand via `useBrand(id)`
 * and gate the null window with `isBrandRouteResolving` (spinner, not
 * not-found). BrandEditView takes an `isResolving` prop and renders a spinner
 * when `brand === null && isResolving`, before its not-found branch.
 *
 * RULE — all must hold (comment-stripped), else exit non-zero:
 *   A. edit.tsx + team.tsx each call `useBrand(` and `isBrandRouteResolving(`,
 *      and NO LONGER reference `useBrandList` (the empty-on-cold-load source).
 *   B. BrandEditView.tsx has the `isResolving` prop and a
 *      `brand === null && isResolving` spinner branch.
 *
 * Self-test (`--self-test`): the GOOD (post-fix) shapes pass; the BAD reverts
 * (list-find back / no guard / no resolving branch) fail. Invariant
 * I-PROPOSED-1309-BRAND-DEEPLINK-COLD-LOAD-GUARD.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const EDIT_REL = "mingla-business/app/brand/[id]/edit.tsx";
const TEAM_REL = "mingla-business/app/brand/[id]/team.tsx";
const VIEW_REL = "mingla-business/src/components/brand/BrandEditView.tsx";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

/** Rule A — a brand sub-route fetches by id + guards the resolving window. */
function scanRoute(src, label) {
  const failures = [];
  const stripped = stripComments(src);
  const s = normalize(src);
  if (!/useBrand\s*\(/.test(s)) {
    failures.push(
      `A: ${label} no longer FETCHES the brand via useBrand(...) — a cold ` +
        `deep-link can't resolve it (ORCH-1309).`,
    );
  }
  if (!/isBrandRouteResolving\s*\(/.test(s)) {
    failures.push(
      `A: ${label} no longer guards the cold-load window with ` +
        `isBrandRouteResolving(...) — a null brand flashes not-found on a direct ` +
        `load (ORCH-1309).`,
    );
  }
  if (/useBrandList/.test(stripped)) {
    failures.push(
      `A: ${label} references useBrandList again — that in-memory list is EMPTY ` +
        `on a cold deep-link; resolve via useBrand(id) instead (ORCH-1309).`,
    );
  }
  return failures;
}

/** Rule B — BrandEditView renders a spinner while resolving. */
function scanView(src) {
  const failures = [];
  const s = normalize(src);
  if (!/isResolving/.test(s)) {
    failures.push(
      "B: BrandEditView.tsx no longer accepts an isResolving prop — the route " +
        "can't tell it to show a spinner during cold-load (ORCH-1309).",
    );
  }
  if (!/brand === null && isResolving/.test(s)) {
    failures.push(
      "B: BrandEditView.tsx no longer renders a spinner branch " +
        "(`brand === null && isResolving`) before not-found — a cold load flashes " +
        "not-found (ORCH-1309).",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const ROUTE_OK = `
    import { useBrand } from "../../../src/hooks/useBrands";
    import { isBrandRouteResolving } from "../../../src/utils/coldLoadAuthGates";
    const brandQuery = useBrand(brandId);
    const brand = brandQuery.data ?? null;
    const isBrandResolving = isBrandRouteResolving({ hasBrandId: true });`;
  const ROUTE_BAD_LISTFIND = `
    import { useBrandList } from "../../../src/store/currentBrandStore";
    const brands = useBrandList();
    const brand = brands.find((b) => b.id === idParam) ?? null;`;
  const ROUTE_BAD_NOGUARD = `
    import { useBrand } from "../../../src/hooks/useBrands";
    const brand = useBrand(brandId).data ?? null;`;
  const VIEW_OK = `
    export interface BrandEditViewProps { brand: Brand | null; isResolving?: boolean; }
    if (brand === null && isResolving) { return <ActivityIndicator />; }
    if (brand === null || draft === null) { return <NotFound />; }`;
  const VIEW_BAD = `
    export interface BrandEditViewProps { brand: Brand | null; }
    if (brand === null || draft === null) { return <NotFound />; }`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) {
      console.error(`ORCH-1309 self-test FAIL: ${label} should have failed but passed.`);
      process.exit(1);
    }
    if (!expectFail && failures.length !== 0) {
      console.error(
        `ORCH-1309 self-test FAIL: ${label} should have passed but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  check("route GOOD", scanRoute(ROUTE_OK, "route"), false);
  check("route BAD (list-find back)", scanRoute(ROUTE_BAD_LISTFIND, "route"), true);
  check("route BAD (no resolving guard)", scanRoute(ROUTE_BAD_NOGUARD, "route"), true);
  check("view GOOD", scanView(VIEW_OK), false);
  check("view BAD (no resolving branch)", scanView(VIEW_BAD), true);

  console.log("ORCH-1309 gate self-test PASS (5/5: fixed shapes pass; reverts fail).");
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1309 gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = [
  ...scanRoute(read(EDIT_REL), "app/brand/[id]/edit.tsx"),
  ...scanRoute(read(TEAM_REL), "app/brand/[id]/team.tsx"),
  ...scanView(read(VIEW_REL)),
];

if (failures.length > 0) {
  console.error(
    "ORCH-1309 gate FAIL — a brand sub-route can flash 'Brand not found' on a " +
      "cold deep-link:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nBrand sub-routes MUST fetch by id (useBrand) + guard the cold-load " +
      "window (isBrandRouteResolving), never resolve from the empty-on-cold-load " +
      "useBrandList(). See ORCH-1309.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1309 gate PASS — edit + team routes fetch via useBrand + guard with " +
    "isBrandRouteResolving; BrandEditView shows a spinner while resolving.",
);
