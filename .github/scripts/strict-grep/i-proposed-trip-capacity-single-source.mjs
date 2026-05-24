#!/usr/bin/env node
/**
 * I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE strict-grep gate.
 *
 * ORCH-0950: trip capacity is canonical in ticket_types.quantity_total.
 * New code must not reintroduce events.theme.business_trip.capacity as a
 * source of truth. Historical pre-cutover migrations are preserved as audit
 * trail; the ORCH-0950 cutover migration is allowed because it strips and
 * rewrites the old key.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT = resolve(__dirname, "..", "..", "..");

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : process.argv[idx + 1] ?? null;
}

const requestedRoot = argValue("--root");
const REPO_ROOT = requestedRoot
  ? (isAbsolute(requestedRoot) ? requestedRoot : resolve(process.cwd(), requestedRoot))
  : DEFAULT_ROOT;

const CUTOVER_PREFIX = "20260725000000";
const CUTOVER_MIGRATION =
  "supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql";
const ALLOWLIST_TAG = "orch-strict-grep-allow trip-capacity-defensive-throw";
const ALLOWLIST_CONTEXT_LINES = 5;

const SCAN_ROOTS = [
  "mingla-business/src",
  "app-mobile/src",
  "supabase/functions",
  "supabase/migrations",
  "mingla-admin/src",
];

const EXT_RE = /\.(ts|tsx|js|jsx|sql)$/;
const FORBIDDEN = [
  {
    label: "business_trip.capacity",
    re: /business_trip\.capacity/g,
  },
  {
    label: "business_trip'.capacity",
    re: /business_trip'\.capacity/g,
  },
  {
    label: "business_trip\"->>'capacity'",
    re: /business_trip"->>'capacity'/g,
  },
  {
    label: "theme.business_trip.capacity",
    re: /theme\.business_trip\.capacity/g,
  },
];

let filesScanned = 0;
let violations = 0;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if (err?.code === "ENOENT") return;
    console.error(`[trip-capacity-single-source] cannot read ${dir}: ${err.message}`);
    process.exit(2);
  }

  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === "build") {
      continue;
    }
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch (err) {
      console.error(`[trip-capacity-single-source] cannot stat ${full}: ${err.message}`);
      process.exit(2);
    }

    if (st.isDirectory()) {
      yield* walk(full);
    } else if (EXT_RE.test(entry)) {
      yield full;
    }
  }
}

function relPath(file) {
  return relative(REPO_ROOT, file).replaceAll("\\", "/");
}

function isMigrationBeforeCutover(rel) {
  if (!rel.startsWith("supabase/migrations/")) return false;
  const filename = rel.split("/").at(-1) ?? "";
  const prefix = filename.slice(0, 14);
  return /^\d{14}$/.test(prefix) && prefix < CUTOVER_PREFIX;
}

function hasAllowlistTag(lines, lineIndex) {
  const start = Math.max(0, lineIndex - ALLOWLIST_CONTEXT_LINES);
  const end = Math.min(lines.length, lineIndex + ALLOWLIST_CONTEXT_LINES + 1);
  return lines.slice(start, end).some((line) => line.includes(ALLOWLIST_TAG));
}

for (const scanRoot of SCAN_ROOTS) {
  const absoluteRoot = join(REPO_ROOT, scanRoot);
  for (const file of walk(absoluteRoot)) {
    const rel = relPath(file);
    if (rel === CUTOVER_MIGRATION) continue;
    if (isMigrationBeforeCutover(rel)) continue;

    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch (err) {
      console.error(`[trip-capacity-single-source] cannot read ${rel}: ${err.message}`);
      process.exit(2);
    }

    filesScanned += 1;
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (hasAllowlistTag(lines, i)) continue;
      for (const forbidden of FORBIDDEN) {
        forbidden.re.lastIndex = 0;
        if (forbidden.re.test(line)) {
          violations += 1;
          console.error(
            `x ${rel}:${i + 1} - forbidden trip-capacity JSONB reference (${forbidden.label}); use ticket_types.quantity_total`,
          );
        }
      }
    }
  }
}

if (violations > 0) {
  console.error(
    `I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE: FAIL files=${filesScanned} violations=${violations}`,
  );
  process.exit(1);
}

console.log(
  `I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE: PASS files=${filesScanned} violations=0`,
);
