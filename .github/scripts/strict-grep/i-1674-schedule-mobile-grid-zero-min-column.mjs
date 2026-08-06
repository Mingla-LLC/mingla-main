#!/usr/bin/env node

/**
 * #1674 marketing-web regression (fails-on-revert contract).
 *
 * The /schedule two-pane picker sets its columns ONLY at `md:`
 * (`md:grid-cols-[minmax(0,240px)_1fr]`). Below that breakpoint a bare `grid`
 * leaves the single implicit column at `auto`, which resolves to MAX-CONTENT —
 * the 28 `shrink-0` day buttons and the 2-up time grid sized it to ~1769px
 * inside a 358px card. The card wrapper is `overflow-hidden`, so the time pills
 * were CLIPPED rather than scrollable and rendered as empty capsules: mobile
 * web could not book a call at all, while desktop looked perfect.
 *
 * INVARIANT: in ScheduleClient.tsx, any className that sets grid columns at a
 * breakpoint (`sm:`/`md:`/`lg:`/`xl:`/`2xl:grid-cols-*`) MUST also set a BASE
 * (unprefixed) `grid-cols-*`, so the mobile track keeps a zero minimum.
 * Tailwind emits `repeat(N,minmax(0,1fr))` for `grid-cols-N`.
 *
 * `--self-test` proves the gate fires on the reverted shape and passes on the
 * fixed shape, so a green run is evidence and not vacuity.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET = "mingla-marketing/app/schedule/ScheduleClient.tsx";
const BREAKPOINT_COLS = /^(?:sm|md|lg|xl|2xl):grid-cols-/;
const BASE_COLS = /^grid-cols-/;

// JSX/JS comments must go first — this file documents the invariant in prose
// that itself contains the literal `grid-cols-1`, which would otherwise satisfy
// the check and make the gate vacuous.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Collect every `className="..."` literal in the source. */
function classNameLiterals(src) {
  const out = [];
  const re = /className\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

export function checkSource(rawSrc, relPath, failures) {
  const src = stripComments(rawSrc);
  for (const literal of classNameLiterals(src)) {
    const tokens = literal.split(/\s+/).filter(Boolean);
    const breakpointCols = tokens.filter((t) => BREAKPOINT_COLS.test(t));
    if (breakpointCols.length === 0) continue;
    const hasBase = tokens.some((t) => BASE_COLS.test(t));
    if (!hasBase) {
      failures.push(
        `${relPath}: className "${literal}" sets grid columns at a breakpoint ` +
          `(${breakpointCols.join(", ")}) but has no BASE grid-cols-* — the mobile ` +
          `implicit column falls back to auto/max-content and blows the layout out ` +
          `of the overflow-hidden card (#1674: /schedule time pills rendered empty ` +
          `on mobile web). Add an unprefixed grid-cols-N.`,
      );
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (src) => {
    const f = [];
    checkSource(src, "fixture.tsx", f);
    return f;
  };

  // (a) The SHIPPED shape → MUST pass.
  const fixed = `<div className="grid grid-cols-1 md:grid-cols-[minmax(0,240px)_1fr]">`;
  if (run(fixed).length !== 0) selfFailures.push("fixed two-pane grid wrongly flagged");

  // (b) The REVERTED shape (the actual #1674 bug) → MUST fire.
  const reverted = `<div className="grid md:grid-cols-[minmax(0,240px)_1fr]">`;
  if (run(reverted).length === 0) {
    selfFailures.push("reverted two-pane grid (no base grid-cols) not flagged");
  }

  // (c) Other breakpoint-column reverts must fire too.
  for (const planted of [
    `<div className="mt-3 grid max-h-72 gap-2 sm:grid-cols-3">`,
    `<div className="grid lg:grid-cols-4">`,
    `<div className="grid gap-2 xl:grid-cols-[200px_1fr]">`,
  ]) {
    if (run(planted).length === 0) selfFailures.push(`planted line not flagged: ${planted}`);
  }

  // (d) The real sibling times grid (base + sm:) → MUST pass.
  const timesGrid = `<div className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">`;
  if (run(timesGrid).length !== 0) selfFailures.push("times grid with base grid-cols-2 wrongly flagged");

  // (e) A className with no grid columns at all is out of scope → MUST pass.
  if (run(`<div className="flex gap-2 overflow-x-auto md:flex-col">`).length !== 0) {
    selfFailures.push("non-grid className wrongly flagged");
  }

  // (f) VACUITY GUARD: prose mentioning grid-cols-1 must NOT rescue a reverted
  //     className — comments are stripped before the check.
  const prosePlusRevert =
    `{/* grid-cols-1 keeps the zero minimum */}\n` +
    `<div className="grid md:grid-cols-[minmax(0,240px)_1fr]">`;
  if (run(prosePlusRevert).length === 0) {
    selfFailures.push("comment prose satisfied the check — gate is vacuous");
  }

  if (selfFailures.length) {
    console.error("#1674 I-1674-SCHEDULE-MOBILE-GRID-ZERO-MIN-COLUMN self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "#1674 I-1674-SCHEDULE-MOBILE-GRID-ZERO-MIN-COLUMN self-test PASS (8/8 cases).",
  );
  process.exit(0);
}

// ---- Plain mode
const full = path.join(repoRoot, TARGET);
if (!fs.existsSync(full)) {
  console.error(`FAIL: #1674 gate — missing required file: ${TARGET}`);
  process.exit(1);
}

const failures = [];
checkSource(fs.readFileSync(full, "utf8"), TARGET, failures);

// Vacuity guard: the target MUST actually contain the two-pane grid this gate
// exists to protect. A rename that silently emptied the scan would otherwise
// pass forever.
const shipped = stripComments(fs.readFileSync(full, "utf8"));
if (!/className\s*=\s*"[^"]*\bmd:grid-cols-\[minmax\(0,240px\)_1fr\]/.test(shipped)) {
  failures.push(
    `${TARGET}: the /schedule two-pane grid (md:grid-cols-[minmax(0,240px)_1fr]) was not ` +
      `found — this gate would be scanning nothing. Re-point it at the renamed element.`,
  );
}

if (failures.length > 0) {
  console.error("FAIL: #1674 schedule-mobile-grid-zero-min-column");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  "OK: #1674 schedule-mobile-grid-zero-min-column — every breakpoint grid-cols in " +
    "ScheduleClient.tsx is backed by a base grid-cols (mobile keeps a zero minimum).",
);
