#!/usr/bin/env node
// I-SENTRY-SINGLE-INIT — ORCH-0679 Wave 2B-2 invariant.
//
// Fails unless EXACTLY ONE `Sentry.init(` call exists across app-mobile's app/
// and src/ (*.ts, *.tsx). Double-init has undefined merge semantics; zero-init
// means Sentry never starts. The single source of truth is app/_layout.tsx.
//
// PORTED from check-single-sentry-init.sh to .mjs (issue #967 D-8 dark-gate
// triage). Previously the .sh ran ONLY inside the path-gated issue-1044
// workflow (dark on most PRs); registering the .mjs in run-batch broadens it
// to every PR. meta-1383 P11 also sweeps it.
//
// Negative-control: re-add `Sentry.init({...})` to app/index.tsx →
// run this gate → exit 1 → revert → exit 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..", ".."); // app-mobile/
const ROOTS = ["app", "src"];
const INIT_RE = /^\s*Sentry\.init\(/;

// Pure checker over the collected list of matching occurrences.
export function check(occurrences) {
  const failures = [];
  const count = occurrences.length;
  if (count > 1) {
    failures.push(`I-SENTRY-SINGLE-INIT violation: found ${count} Sentry.init() calls (expected exactly 1):`);
    for (const o of occurrences) failures.push(`  ${o}`);
    failures.push("Sentry.init() must be called EXACTLY ONCE in app-mobile/, in app/_layout.tsx.");
  } else if (count === 0) {
    failures.push("I-SENTRY-SINGLE-INIT violation: NO Sentry.init() found in app-mobile/. Initialize in app/_layout.tsx.");
  }
  return failures;
}

function collect() {
  const occurrences = [];
  const walk = (abs, rel) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(childAbs, childRel); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const src = fs.readFileSync(childAbs, "utf8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (INIT_RE.test(lines[i])) occurrences.push(`${childRel}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  };
  for (const root of ROOTS) walk(path.join(APP_ROOT, root), root);
  return occurrences;
}

function realRun() {
  const occurrences = collect();
  const failures = check(occurrences);
  if (failures.length) { for (const f of failures) console.error(f); process.exit(1); }
  console.log(`I-SENTRY-SINGLE-INIT: PASS (1 Sentry.init found: ${occurrences[0]})`);
}

function selfTest() {
  const cases = [];
  const t = (name, occ, shouldFail) => {
    const f = check(occ);
    cases.push({ name, ok: (f.length > 0) === shouldFail, f });
  };
  t("exactly one init passes", ["app/_layout.tsx:10: Sentry.init({"], false);
  t("zero init fails", [], true);
  t("two inits fail", ["app/_layout.tsx:10: Sentry.init({", "app/index.tsx:5: Sentry.init({"], true);
  let bad = 0;
  for (const c of cases) { console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`); if (!c.ok) { bad++; console.log(JSON.stringify(c.f)); } }
  if (bad) { console.error(`\nself-test FAILED: ${bad}/${cases.length}`); process.exit(1); }
  console.log(`\ncheck-single-sentry-init self-test: ${cases.length}/${cases.length} PASS`);
}

if (process.argv.includes("--self-test")) selfTest();
else realRun();
