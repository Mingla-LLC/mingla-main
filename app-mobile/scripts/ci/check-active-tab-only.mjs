#!/usr/bin/env node
// I-ONLY-ACTIVE-TAB-MOUNTED — ORCH-0679 Wave 2.8 Path B invariant.
//
// Detects regression to the "all 6 tabs always mounted" pattern. Path B
// requires that ONLY the active tab is mounted at any time, selected via
// switch(currentPage). Hidden tabs literally don't exist → no React.memo
// concerns, no context-propagation re-renders, no god-hook impact.
//
// Fires on the legacy `styles.tabVisible` / `styles.tabHidden` style names
// being defined or referenced in app/index.tsx.
//
// PORTED from check-active-tab-only.sh to .mjs (issue #967 D-8 dark-gate
// triage) so meta-1383 P11 sweeps it and run-batch enforces it every PR.
//
// Negative-control: re-add `tabVisible: { flex: 1 }` to app/index.tsx →
// run this gate → exit 1 with the named invariant → revert → exit 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..", ".."); // app-mobile/
const TARGET = "app/index.tsx";

// Pure checker — I/O injected so --self-test drives it with fixtures.
export function check(read) {
  const failures = [];
  const src = read(TARGET);
  if (src == null) {
    failures.push(`ERROR: ${TARGET} not found`);
    return failures;
  }
  const legacy = src
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /styles\.(tabVisible|tabHidden)|^\s+tabVisible:|^\s+tabHidden:/.test(line));
  if (legacy.length) {
    failures.push("I-ONLY-ACTIVE-TAB-MOUNTED violation: legacy tabVisible/tabHidden pattern detected");
    for (const { line, n } of legacy) failures.push(`  ${TARGET}:${n}: ${line.trim()}`);
  }
  return failures;
}

function realRun() {
  const read = (rel) => {
    try { return fs.readFileSync(path.join(APP_ROOT, rel), "utf8"); } catch { return null; }
  };
  const failures = check(read);
  if (failures.length) {
    for (const f of failures) console.error(f);
    console.error("\nPath B (Wave 2.8) replaced the all-mounted pattern with switch(currentPage).");
    process.exit(1);
  }
  console.log("I-ONLY-ACTIVE-TAB-MOUNTED: PASS");
}

function selfTest() {
  const cases = [];
  const t = (name, read, shouldFail) => {
    const f = check(read);
    cases.push({ name, ok: (f.length > 0) === shouldFail, f });
  };
  t("clean source passes", () => "const x = 1;\n<Tab />", false);
  t("styles.tabVisible reference fails", () => "if (styles.tabVisible) {}", true);
  t("tabHidden style def fails", () => "  tabHidden: { display: 'none' },", true);
  t("missing file fails", () => null, true);
  let bad = 0;
  for (const c of cases) { console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`); if (!c.ok) { bad++; console.log(JSON.stringify(c.f)); } }
  if (bad) { console.error(`\nself-test FAILED: ${bad}/${cases.length}`); process.exit(1); }
  console.log(`\ncheck-active-tab-only self-test: ${cases.length}/${cases.length} PASS`);
}

if (process.argv.includes("--self-test")) selfTest();
else realRun();
