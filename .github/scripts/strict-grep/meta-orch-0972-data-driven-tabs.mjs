#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-0972 — public/business tab visibility must be data-driven.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..", "..");

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx === -1 ? null : process.argv[idx + 1] ?? null;
}

const REPO_ROOT = path.resolve(argValue("--root") ?? DEFAULT_ROOT);
const publicBrandPage = path.join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "brand",
  "PublicBrandPage.tsx",
);
const sharedPublicBrandPage = path.join(
  REPO_ROOT,
  "packages",
  "brand-rendering",
  "PublicBrandPage.tsx",
);
const hubLayout = path.join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "(tabs)",
  "hub",
  "_layout.tsx",
);

const failures = [];

function readRequired(file, label) {
  if (!fs.existsSync(file)) {
    failures.push(`${label}: missing ${path.relative(REPO_ROOT, file)}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function requireContains(source, needle, label, file) {
  if (!source.includes(needle)) {
    failures.push(`${label}: ${path.relative(REPO_ROOT, file)} missing ${JSON.stringify(needle)}`);
  }
}

function forbidContains(source, needle, label, file) {
  if (source.includes(needle)) {
    failures.push(`${label}: ${path.relative(REPO_ROOT, file)} contains forbidden ${JSON.stringify(needle)}`);
  }
}

const publicBrandPageSource = fs.existsSync(sharedPublicBrandPage)
  ? readRequired(sharedPublicBrandPage, "D1")
  : readRequired(publicBrandPage, "D1");
const publicBrandPageFile = fs.existsSync(sharedPublicBrandPage)
  ? sharedPublicBrandPage
  : publicBrandPage;
const hubLayoutSource = readRequired(hubLayout, "D2");

requireContains(publicBrandPageSource, "visibleTabs", "D1", publicBrandPageFile);
forbidContains(publicBrandPageSource, "isTripBrand", "D1", publicBrandPageFile);
forbidContains(publicBrandPageSource, "brand.kind ===", "D1", publicBrandPageFile);

requireContains(hubLayoutSource, "useHubVisibleTabs(", "D2", hubLayout);
forbidContains(hubLayoutSource, "brand.kind ===", "D2", hubLayout);
forbidContains(hubLayoutSource, "currentBrand.kind", "D2", hubLayout);

requireContains(hubLayoutSource, "useHubInitialTab(", "D3", hubLayout);

forbidContains(publicBrandPageSource, "if (isTripBrand)", "D4", publicBrandPageFile);
forbidContains(publicBrandPageSource, "if (!isTripBrand)", "D4", publicBrandPageFile);

if (failures.length > 0) {
  console.error("META-ORCH-0972 data-driven tabs strict-grep failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("META-ORCH-0972 data-driven tabs strict-grep passed (D1-D4).");
