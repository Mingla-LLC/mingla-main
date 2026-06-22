#!/usr/bin/env node
/**
 * ORCH-1224 — TESTER adversarial test for the i-proposed-1224-business-route gate.
 *
 * Different angle than the implementor's own --self-test (which exercises the
 * gate's matcher functions on in-memory strings). This test drives the LIVE gate
 * binary as a subprocess against a real on-disk perturbation of the marketing
 * source, then restores it — proving:
 *
 *   T1 (CONTRACT, fails-on-revert): re-introducing a navigable `/organisers`
 *       href in a *components* file (surface-toggle.tsx) makes the live gate
 *       EXIT 1. This is the gate's core promise; if it passed here the gate
 *       would be worthless.
 *   T2 (CONTRACT, fails-on-revert): deleting the `async redirects()` block from
 *       next.config.ts makes the live gate EXIT 1.
 *   T3 (BASELINE): with the tree pristine, the live gate EXITs 0.
 *   T4 (KNOWN SCOPE GAP, documented as P2): a navigable `/organisers` href in an
 *       *app/* file is NOT caught (gate scans only components+lib). This test
 *       ASSERTS the current (gappy) behavior so a future scope-widening fix
 *       flips this assertion intentionally rather than silently.
 *
 * Self-restoring: every perturbation is reverted in a finally, and a final
 * `git diff --quiet` guards that the working tree is clean on exit.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const GATE = join(ROOT, ".github/scripts/strict-grep/i-proposed-1224-business-route.mjs");
const TOGGLE = join(ROOT, "mingla-marketing/components/marketing/surface-toggle.tsx");
const CONFIG = join(ROOT, "mingla-marketing/next.config.ts");
const APP_PAGE = join(ROOT, "mingla-marketing/app/business/page.tsx");

const runGate = () => {
  try {
    execFileSync("node", [GATE], { cwd: ROOT, stdio: "pipe" });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
};

const withPerturbation = (file, mutate, fn) => {
  const original = readFileSync(file, "utf8");
  try {
    writeFileSync(file, mutate(original));
    return fn();
  } finally {
    writeFileSync(file, original);
  }
};

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures.push(name);
};

// T3 baseline FIRST (proves clean tree => pass)
check("T3 baseline: pristine tree -> gate EXIT 0", runGate() === 0);

// T1: components-file /organisers href -> EXIT 1 (the gate's core contract)
check(
  "T1 fails-on-revert: /organisers href in surface-toggle.tsx -> gate EXIT 1",
  withPerturbation(
    TOGGLE,
    (src) => src.replace("href: '/business'", "href: '/organisers'"),
    () => runGate() === 1,
  ),
);

// T2: removing the redirects() block -> EXIT 1
check(
  "T2 fails-on-revert: delete async redirects() from next.config.ts -> gate EXIT 1",
  withPerturbation(
    CONFIG,
    (src) => src.replace(/async redirects\(\)\s*\{[\s\S]*?\n  \},/, ""),
    () => runGate() === 1,
  ),
);

// T4: KNOWN SCOPE GAP — a navigable /organisers href in an app/ file is NOT
// caught (gate scans only components+lib). Asserting the gappy status quo so a
// future widening is a deliberate, visible change. P2 in the test report.
check(
  "T4 documented scope gap: /organisers href in app/business/page.tsx -> gate STILL EXIT 0 (P2)",
  withPerturbation(
    APP_PAGE,
    (src) => src + '\nexport const STRAY = <a href="/organisers/x">x</a>\n',
    () => runGate() === 0,
  ),
);

// guard: tree must be clean after all perturbations restored
let dirty = "";
try {
  dirty = execFileSync("git", ["diff", "--name-only", "--", TOGGLE, CONFIG, APP_PAGE], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
} catch {}
check("CLEANUP: perturbed files restored (git diff empty)", dirty === "");

if (failures.length > 0) {
  console.error(`\n${failures.length} adversarial assertion(s) failed:`, failures);
  process.exit(1);
}
console.log("\nORCH-1224 adversarial gate test passed (contract caught both reverts; scope gap documented).");
