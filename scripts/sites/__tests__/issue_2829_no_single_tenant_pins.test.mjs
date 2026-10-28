// MINGLA-INVARIANT: I-PROPOSED-2829-01 | issue #2829 | Sites never pins a single brand, site, operator or hostname in code or in current SQL; every site is bound by its own request host and entitlement.
/*
 * #2829 R-2 — no functional single-tenant pin survives.
 *
 * invariant: I-PROPOSED-2829-01 (DRAFT) — Sites never pins a single brand,
 * site, operator or hostname in code or current SQL. This file enforces the
 * code half; supabase/migrations/__tests__/issue_2829_sites_multi_brand.test.sql
 * enforces the current-SQL half (pg_get_functiondef over brand_site_%).
 *
 * Scanned (spec §8): mingla-sites/src, mingla-site-cms/src (not migrations/),
 * supabase/functions/brand-site-*, supabase/functions/_shared/sites*,
 * supabase/functions/_shared/agentSiteTools.ts, scripts/sites (not the gögi
 * content seed under gogi-pilot/). Comment-only lines are stripped first;
 * test files are skipped because their fixtures name these values as data.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

export const FORBIDDEN = [
  "gogi.sites.usemingla.com",
  "733bc470-45e1-4684-8896-acd7e26074ff",
  "1f3d2ddf-b741-4e2f-8884-d7222a660c7e",
  "pilotSiteId",
  "pilot_brand_id",
  "pilot_site_id",
  "activate_gogi_pilot",
  "deactivate_gogi_pilot",
];

const ROOTS = [
  "mingla-sites/src",
  "mingla-site-cms/src",
  "supabase/functions",
  "scripts/sites",
];
const SKIP_DIRS = new Set(["node_modules", "migrations", "__tests__", "gogi-pilot", ".stacks", ".state", ".next"]);
const CODE = /\.(ts|tsx|mjs|js|sql|sh)$/;

function inScope(path) {
  if (path.startsWith("supabase/functions/")) {
    return path.startsWith("supabase/functions/brand-site-") ||
      /^supabase\/functions\/_shared\/sites[^/]*$/.test(path) ||
      path === "supabase/functions/_shared/agentSiteTools.ts";
  }
  return true;
}

export function scannedFiles() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(REPO, dir))) {
      const path = `${dir}/${name}`;
      if (statSync(join(REPO, path)).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(path);
      } else if (CODE.test(name) && !/\.test\.[a-z]+$/.test(name) && inScope(path)) {
        files.push(path);
      }
    }
  };
  for (const root of ROOTS) walk(root);
  return files;
}

/** Drop block comments and whole comment lines (// * -- #); keep code lines. */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|--|#)/.test(line))
    .join("\n");
}

export function findPins(files = scannedFiles()) {
  const found = [];
  for (const path of files) {
    const code = stripComments(readFileSync(join(REPO, path), "utf8"));
    for (const token of FORBIDDEN) {
      if (code.includes(token)) found.push(`${relative(REPO, join(REPO, path))}: ${token}`);
    }
  }
  return found;
}

test("#2829 R-2 no single-tenant pin in Sites code", () => {
  const files = scannedFiles();
  assert.ok(files.length > 100, `expected to scan the Sites tree, scanned ${files.length}`);
  assert.deepEqual(findPins(files), []);
});

test("#2829 R-2 the scanner sees a pin when one is present", () => {
  assert.deepEqual(stripComments("// gogi.sites.usemingla.com\nconst a = 1;"), "const a = 1;");
  assert.ok(stripComments('const host = "gogi.sites.usemingla.com";').includes("gogi.sites.usemingla.com"));
});

test("#2829 the pilot activation script and its RPC names are gone", () => {
  const files = scannedFiles();
  assert.equal(files.includes("scripts/sites/activate-gogi-pilot.mjs"), false);
});
