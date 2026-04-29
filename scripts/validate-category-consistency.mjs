#!/usr/bin/env node
/**
 * Category Consistency Validator — ORCH-0526 Amendment 1 §A1.2
 *
 * Checks that the three category-truth sources agree at build time:
 *   B) on-demand:  supabase/functions/_shared/categoryPlaceTypes.ts (MINGLA_CATEGORY_PLACE_TYPES)
 *   C) display:    mingla-admin/src/constants/categories.js (CATEGORY_LABELS, ALL_CATEGORIES)
 *
 * Runtime drift (A: DB-backed filter rules) is the responsibility of
 * `run_drift_check` edge fn action — that catches drift introduced by admin
 * edits. This script catches drift introduced by code changes AT PR TIME,
 * before anything ships.
 *
 * Exits 0 on clean, 1 on drift with a human-readable report.
 *
 * Usage:
 *   node scripts/validate-category-consistency.mjs
 *   OR via package.json: npm run validate:categories
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const DISPLAY_PATH = resolve(ROOT, "mingla-admin/src/constants/categories.js");
const ON_DEMAND_PATH = resolve(ROOT, "supabase/functions/_shared/categoryPlaceTypes.ts");

// Known display-name → slug aliases (used by edge fn handleRunDriftCheck too)
const DISPLAY_NAME_TO_SLUG = {
  "Nature & Views": "nature",
  "Icebreakers": "icebreakers",
  "Drinks & Music": "drinks_and_music",
  "Brunch, Lunch & Casual": "brunch_lunch_casual",
  "Upscale & Fine Dining": "upscale_fine_dining",
  "Movies & Theatre": "movies_theatre",
  "Creative & Arts": "creative_arts",
  "Play": "play",
  "Flowers": "flowers",
  "Groceries": "groceries",
};

// Parse mingla-admin/src/constants/categories.js (ES module, `export const CATEGORY_LABELS = {...}`)
function parseDisplayConstants() {
  const src = readFileSync(DISPLAY_PATH, "utf8");

  // Extract CATEGORY_LABELS object block (from `export const CATEGORY_LABELS = {` to the matching `};`)
  const labelsMatch = src.match(/export\s+const\s+CATEGORY_LABELS\s*=\s*\{([\s\S]*?)\};/);
  if (!labelsMatch) {
    throw new Error(`Could not find CATEGORY_LABELS in ${DISPLAY_PATH}`);
  }
  const labelsBlock = labelsMatch[1];

  // Extract each `slug: "label"` pair (ignore comments, trailing commas)
  const labels = {};
  const pairPattern = /^\s*([a-z_][a-z0-9_]*)\s*:\s*["'`]([^"'`]+)["'`]\s*,?/gm;
  let m;
  while ((m = pairPattern.exec(labelsBlock)) !== null) {
    labels[m[1]] = m[2];
  }

  if (Object.keys(labels).length === 0) {
    throw new Error(`Parsed 0 entries from CATEGORY_LABELS — regex mismatch?`);
  }

  return labels; // { slug: displayName }
}

// Parse supabase/functions/_shared/categoryPlaceTypes.ts for MINGLA_CATEGORY_PLACE_TYPES
function parseOnDemand() {
  const src = readFileSync(ON_DEMAND_PATH, "utf8");

  // Find the object block
  const objMatch = src.match(
    /export\s+const\s+MINGLA_CATEGORY_PLACE_TYPES\s*:\s*Record<string,\s*string\[\]>\s*=\s*\{([\s\S]*?)\n\};/,
  );
  if (!objMatch) {
    throw new Error(`Could not find MINGLA_CATEGORY_PLACE_TYPES in ${ON_DEMAND_PATH}`);
  }
  const block = objMatch[1];

  // Split into key-array sections. Each is `'Display Name': [ ... ],` (commented lines allowed inside)
  const result = {};
  // Match `'Key': [ ... ]` with multi-line array bodies
  const keyPattern = /['"]([^'"]+)['"]\s*:\s*\[([\s\S]*?)\],?\s*(?=(?:['"][^'"]+['"]\s*:\s*\[)|$)/g;
  let m;
  while ((m = keyPattern.exec(block)) !== null) {
    const key = m[1];
    const arrBody = m[2];
    // Extract string literals from arr body, skip comments
    const types = [];
    const typePattern = /['"]([a-z_][a-z0-9_]*)['"]/g;
    let tm;
    // Strip JS-style // comments first (both block and line) to avoid capturing type-names
    // inside comment syntax — simple heuristic but sufficient for this file.
    const cleaned = arrBody
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    while ((tm = typePattern.exec(cleaned)) !== null) types.push(tm[1]);
    result[key] = types;
  }

  if (Object.keys(result).length === 0) {
    throw new Error(`Parsed 0 entries from MINGLA_CATEGORY_PLACE_TYPES — regex mismatch?`);
  }

  return result; // { displayName: [types] }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const errors = [];
  const warnings = [];

  let displayLabels, onDemand;
  try {
    displayLabels = parseDisplayConstants();
  } catch (err) {
    errors.push(`PARSE ERROR (display): ${err.message}`);
  }
  try {
    onDemand = parseOnDemand();
  } catch (err) {
    errors.push(`PARSE ERROR (on-demand): ${err.message}`);
  }

  if (!displayLabels || !onDemand) {
    report(errors, warnings);
    process.exit(1);
  }

  const displaySlugs = new Set(Object.keys(displayLabels));
  const onDemandSlugs = new Set();
  const onDemandByDisplayName = {};

  for (const displayName of Object.keys(onDemand)) {
    const slug = DISPLAY_NAME_TO_SLUG[displayName];
    if (!slug) {
      warnings.push(
        `On-demand category "${displayName}" has no mapping in DISPLAY_NAME_TO_SLUG. ` +
        `Either add it to the map at the top of this script, or remove/rename the on-demand entry.`,
      );
      continue;
    }
    onDemandSlugs.add(slug);
    onDemandByDisplayName[displayName] = slug;
  }

  // Check 1: every display slug must have an on-demand entry (via display-name mapping)
  for (const slug of displaySlugs) {
    if (!onDemandSlugs.has(slug)) {
      errors.push(
        `Display category "${slug}" (${displayLabels[slug]}) has no on-demand fetch list. ` +
        `Add to ${ON_DEMAND_PATH.replace(ROOT + "/", "")} under key "${Object.entries(DISPLAY_NAME_TO_SLUG).find(([, s]) => s === slug)?.[0] || "?"}".`,
      );
    }
  }

  // Check 2: every on-demand slug must be in display
  for (const slug of onDemandSlugs) {
    if (!displaySlugs.has(slug)) {
      errors.push(
        `On-demand category slug "${slug}" is not in CATEGORY_LABELS (${DISPLAY_PATH.replace(ROOT + "/", "")}). ` +
        `Add it, or remove the on-demand entry.`,
      );
    }
  }

  // Check 3 (informational): count on-demand types per category. Zero-type lists are likely bugs.
  for (const [displayName, types] of Object.entries(onDemand)) {
    if ((types || []).length === 0) {
      warnings.push(
        `On-demand category "${displayName}" has zero Google primary_types. ` +
        `Experience generation will never return results for this category.`,
      );
    }
  }

  report(errors, warnings);
  process.exit(errors.length > 0 ? 1 : 0);
}

function report(errors, warnings) {
  console.log("\n── Category Consistency Validator ───────────────────────────────\n");
  if (errors.length === 0 && warnings.length === 0) {
    console.log("✓ All 3 category-truth sources are consistent.\n");
    return;
  }

  if (errors.length > 0) {
    console.log(`✗ ${errors.length} error${errors.length === 1 ? "" : "s"}:\n`);
    errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}\n`));
  }

  if (warnings.length > 0) {
    console.log(`! ${warnings.length} warning${warnings.length === 1 ? "" : "s"}:\n`);
    warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}\n`));
  }

  console.log("──────────────────────────────────────────────────────────────────\n");
}

main();
