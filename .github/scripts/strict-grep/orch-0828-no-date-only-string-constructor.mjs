#!/usr/bin/env node
// ORCH-0828 — I-PROPOSED-LIVE-STATUS-UTC-INPUT
//
// Forbids `new Date("YYYY-MM-DD")` literals — the date-only string is parsed
// as UTC midnight by JavaScript, which silently corrupts time-window math
// for any non-UTC event. (Bug C: Big Party at 4pm EDT classified "live"
// 14 hours before its actual start.)
//
// Callers must use either:
//   1. A full ISO timestamp with offset (e.g. "2026-05-14T20:00:00.000Z"), or
//   2. The `computeMasterStartAtUtc(event)` helper from
//      `mingla-business/src/utils/eventDateMath.ts`, which does a proper
//      IANA-timezone-aware parse via `Intl.DateTimeFormat`.
//
// Exits 0 (PASS) when no offending pattern found, 1 (FAIL) otherwise.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const SCAN_DIRS = [
  "mingla-business/src",
  "mingla-business/app",
  "app-mobile/src",
  "app-mobile/app",
];

// Match `new Date("YYYY-MM-DD")` or `new Date('YYYY-MM-DD')`. The trailing
// quote anchors on the date-only form — a full ISO with a "T" or "Z" inside
// would not match because the inner content would have more chars before
// the closing quote.
const FORBIDDEN_RE = /new Date\(\s*['"]\d{4}-\d{2}-\d{2}['"]\s*\)/g;

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".expo",
  ".next",
  "dist",
  "build",
  "ios",
  "android",
  "__tests__",
  "__mocks__",
]);

const TARGET_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile() && TARGET_EXT.test(name)) {
      out.push(full);
    }
  }
}

const offenders = [];
for (const rel of SCAN_DIRS) {
  const abs = join(REPO_ROOT, rel);
  const files = [];
  walk(abs, files);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    FORBIDDEN_RE.lastIndex = 0;
    let m;
    while ((m = FORBIDDEN_RE.exec(text)) !== null) {
      const lineNo = text.slice(0, m.index).split("\n").length;
      const lineText = text.split("\n")[lineNo - 1] ?? "";
      offenders.push({
        file: relative(REPO_ROOT, file),
        line: lineNo,
        match: m[0],
        snippet: lineText.trim(),
      });
    }
  }
}

if (offenders.length > 0) {
  console.error(
    "::error::ORCH-0828 (I-PROPOSED-LIVE-STATUS-UTC-INPUT) — forbidden `new Date(\"YYYY-MM-DD\")` literal detected.",
  );
  console.error(
    "Date-only strings are parsed as UTC midnight, corrupting time-window math.",
  );
  console.error(
    "Use a full ISO timestamp (with `T` and offset/Z) OR `computeMasterStartAtUtc(event)`.\n",
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  ${o.snippet}`);
  }
  console.error(`\n${offenders.length} violation(s) blocking merge.`);
  process.exit(1);
}

console.log(
  "ORCH-0828 gate PASS — no `new Date(\"YYYY-MM-DD\")` literals in scanned source.",
);
