#!/usr/bin/env node
/**
 * ORCH-1212 [today-curated-hours] — the curated 'today' open-hours policy is
 * FROM-NOW-ONWARD, not the point-in-time exact-arrival 'instant' cascade.
 *
 * Invariant I-CURATED-TODAY-FROM-NOW-ONWARD (DRAFT until ORCH-1212 CLOSE): the
 * curated multi-stop open-hours evaluation for date_option today/now/empty/unknown
 * MUST use the from-now-onward policy (`mode:'instantFromNowOnward'`) — an itinerary
 * qualifies if it can be completed starting at SOME hour from floor(localNowHour)
 * through end of the place-local day. It MUST mirror the single-venue
 * isOpenFromHourOnwards (discover-cards:688-694), NOT the harsh exact-arrival instant
 * cascade. this_weekend / pick_dates remain anyHourOnDays; the bare-Date back-compat
 * stays the strict 'instant'.
 *
 * This gate scans supabase/functions/_shared/curatedStopHours.ts (comments stripped)
 * and FAILS if any of these structural facts is missing:
 *   1. The CuratedHoursPolicy type union contains `instantFromNowOnward`.
 *   2. resolveCuratedHoursPolicy's today/now/empty branch returns
 *      `mode:'instantFromNowOnward'` (NOT a bare `mode:'instant'`).
 *   3. filterCuratedByStopHours has an `instantFromNowOnward` branch that loops a
 *      start hour from `Math.floor(` of the local now-hour up to `< 24`.
 *
 * Comments are stripped so the explanatory ORCH-1212 prose never trips the gate.
 * Mirrors the modular gate pattern (sibling: orch-1147-cart-total-is-allin.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TARGET = "supabase/functions/_shared/curatedStopHours.ts";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

// Strip line + block comments so prose like "// ...mode:'instant'..." never trips.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const evaluate = (rawCode) => {
  const code = stripComments(rawCode);
  const fileFailures = [];

  // (1) The policy type union must include the new mode.
  if (!/['"]?instantFromNowOnward['"]?/.test(code)) {
    fileFailures.push(
      "CuratedHoursPolicy must include the 'instantFromNowOnward' mode (ORCH-1212 from-now-onward). I-CURATED-TODAY-FROM-NOW-ONWARD.",
    );
  }

  // (2) The today/now/empty branch must return instantFromNowOnward, NOT a bare
  // 'instant'. Find the today branch body and assert it carries the new mode.
  const todayBranch = code.match(
    /dOpt\s*===\s*['"]today['"][\s\S]*?\{[\s\S]*?return\s*\{[^}]*\}/,
  );
  if (!todayBranch) {
    fileFailures.push(
      "Could not locate the resolveCuratedHoursPolicy 'today' branch — the from-now-onward routing cannot be verified. I-CURATED-TODAY-FROM-NOW-ONWARD.",
    );
  } else {
    const branch = todayBranch[0];
    if (!/mode:\s*['"]instantFromNowOnward['"]/.test(branch)) {
      fileFailures.push(
        "the 'today'/'now'/empty branch of resolveCuratedHoursPolicy must return mode:'instantFromNowOnward', not the harsh exact-arrival 'instant'. I-CURATED-TODAY-FROM-NOW-ONWARD.",
      );
    }
  }

  // (3) filterCuratedByStopHours must have an instantFromNowOnward branch that
  // probes start hours from Math.floor(<nowHour>) up to < 24.
  const hasModeGuard = /mode\s*===\s*['"]instantFromNowOnward['"]/.test(code);
  const hasFloorLoop = /for\s*\([^)]*=\s*Math\.floor\([^)]*\)[^)]*<\s*24[^)]*\)/.test(code);
  if (!hasModeGuard || !hasFloorLoop) {
    fileFailures.push(
      "filterCuratedByStopHours must implement the from-now-onward branch: a `mode === 'instantFromNowOnward'` guard AND a `for (... = Math.floor(...) ... < 24 ...)` start-hour probe loop. I-CURATED-TODAY-FROM-NOW-ONWARD.",
    );
  }

  return fileFailures;
};

// --- self-test fixtures (run with --self-test) ----------------------------
const SELF_TEST = process.argv.includes("--self-test");

if (SELF_TEST) {
  const GOOD = `
    export type CuratedHoursPolicy =
      | { mode: 'instant'; utcNow: Date }
      | { mode: 'instantFromNowOnward'; utcNow: Date }
      | { mode: 'anyHourOnDays'; days: number[] };

    export function resolveCuratedHoursPolicy(opts) {
      const now = opts.now ?? new Date();
      const dOpt = (opts.dateOption || '').toLowerCase();
      if (dOpt === 'today' || dOpt === 'now' || !opts.dateOption) {
        return { mode: 'instantFromNowOnward', utcNow: now };
      }
      return { mode: 'instantFromNowOnward', utcNow: now };
    }

    export function filterCuratedByStopHours(cards, policy) {
      if (resolved.mode === 'instantFromNowOnward') {
        const nowHour = localDate.getUTCHours();
        for (let s = Math.floor(nowHour); s < 24; s++) {
          if (cascade(card, s, localDay)) return true;
        }
        return false;
      }
    }
  `;
  // BAD_A: today branch still returns the harsh exact-arrival 'instant'.
  const BAD_A = `
    export type CuratedHoursPolicy =
      | { mode: 'instant'; utcNow: Date }
      | { mode: 'instantFromNowOnward'; utcNow: Date };
    export function resolveCuratedHoursPolicy(opts) {
      if (dOpt === 'today' || dOpt === 'now' || !opts.dateOption) {
        return { mode: 'instant', utcNow: now };
      }
    }
    export function filterCuratedByStopHours(cards, policy) {
      if (resolved.mode === 'instantFromNowOnward') {
        for (let s = Math.floor(nowHour); s < 24; s++) { if (x) return true; }
      }
    }
  `;
  // BAD_B: no instantFromNowOnward branch / loop at all (reverted to instant-only).
  const BAD_B = `
    export type CuratedHoursPolicy =
      | { mode: 'instant'; utcNow: Date }
      | { mode: 'anyHourOnDays'; days: number[] };
    export function resolveCuratedHoursPolicy(opts) {
      if (dOpt === 'today' || dOpt === 'now' || !opts.dateOption) {
        return { mode: 'instant', utcNow: now };
      }
    }
    export function filterCuratedByStopHours(cards, policy) {
      const utcNow = resolved.utcNow;
      let currentHour = localDate.getUTCHours();
    }
  `;
  const goodFails = evaluate(GOOD);
  const badAFails = evaluate(BAD_A);
  const badBFails = evaluate(BAD_B);
  const ok =
    goodFails.length === 0 &&
    badAFails.length >= 1 &&
    badBFails.length >= 1;
  if (!ok) {
    console.error("ORCH-1212 curated-today-from-now-onward SELF-TEST failed:", {
      goodFails,
      badAFails,
      badBFails,
    });
    process.exit(1);
  }
  console.log("ORCH-1212 curated-today-from-now-onward gate self-test passed.");
  process.exit(0);
}

const abs = join(root, TARGET);
const failures = [];
if (!existsSync(abs)) {
  failures.push(`${TARGET}: expected shared curated-hours module not found.`);
} else {
  failures.push(...evaluate(readFileSync(abs, "utf8")));
}

if (failures.length > 0) {
  console.error("ORCH-1212 curated-today-from-now-onward gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1212 curated-today-from-now-onward gate passed.");
