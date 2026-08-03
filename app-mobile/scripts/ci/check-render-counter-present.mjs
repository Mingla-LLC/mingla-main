#!/usr/bin/env node
// ORCH-0679 Wave 2A — dev-only render-counter instrument.
//
// Fails if any of the 6 tab files is missing the `[render-count] X:` log or
// the `if (__DEV__)` gate. Gated by __DEV__ so it's dead-stripped in release.
//
// PORTED from check-render-counter-present.sh to .mjs (issue #967 D-8
// dark-gate triage). The .sh used bash-4 `declare -A`; on bash 3.2 (macOS
// default) that fails and the loop iterates ZERO tabs, so the gate PASSED
// WITHOUT CHECKING. This port genuinely asserts all 6/6.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..", ".."); // app-mobile/

// file -> render-counter component label (matches the [render-count] log).
const TABS = [
  ["src/components/HomePage.tsx", "HomePage"],
  ["src/components/DiscoverScreen.tsx", "DiscoverScreen"],
  ["src/components/ConnectionsPage.tsx", "ConnectionsPage"],
  ["src/components/SavedExperiencesPage.tsx", "SavedExperiencesPage"],
  ["src/components/LikesPage.tsx", "LikesPage"],
  ["src/components/ProfilePage.tsx", "ProfilePage"],
];

export function check(read, tabs = TABS) {
  const failures = [];
  let instrumented = 0;
  for (const [rel, comp] of tabs) {
    const src = read(rel);
    if (src == null) { failures.push(`ERROR: ${rel} not found`); continue; }
    let ok = true;
    if (!src.includes(`[render-count] ${comp}`)) { failures.push(`Render-counter missing: ${rel} expected '[render-count] ${comp}' log`); ok = false; }
    if (!src.includes("if (__DEV__)")) { failures.push(`__DEV__ gate missing: ${rel} — render counter must be dev-only`); ok = false; }
    if (ok) instrumented++;
  }
  return { failures, instrumented, total: tabs.length };
}

function realRun() {
  const read = (rel) => {
    try { return fs.readFileSync(path.join(APP_ROOT, rel), "utf8"); } catch { return null; }
  };
  const { failures, instrumented, total } = check(read);
  if (failures.length) { for (const f of failures) console.error(f); console.error(`\nRender-counter instrument: ${failures.length} violation(s).`); process.exit(1); }
  console.log(`Render-counter instrument: PASS (${instrumented}/${total} tabs instrumented)`);
}

function selfTest() {
  const cases = [];
  const t = (name, read, tabs, shouldFail) => {
    const { failures } = check(read, tabs);
    cases.push({ name, ok: (failures.length > 0) === shouldFail, failures });
  };
  const good = "if (__DEV__) { console.log('[render-count] Foo:', n); }";
  const tabs2 = [["a.tsx", "Foo"], ["b.tsx", "Bar"]];
  t("all instrumented passes", (rel) => good.replace("Foo", rel === "a.tsx" ? "Foo" : "Bar"), tabs2, false);
  t("missing [render-count] fails", (rel) => (rel === "a.tsx" ? good.replace("Foo", "Foo") : "if (__DEV__) {}"), tabs2, true);
  t("missing __DEV__ gate fails", (rel) => (rel === "a.tsx" ? good.replace("Foo", "Foo") : "console.log('[render-count] Bar:')"), tabs2, true);
  t("missing file fails", () => null, tabs2, true);
  let bad = 0;
  for (const c of cases) { console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`); if (!c.ok) { bad++; console.log(JSON.stringify(c.failures)); } }
  if (bad) { console.error(`\nself-test FAILED: ${bad}/${cases.length}`); process.exit(1); }
  console.log(`\ncheck-render-counter-present self-test: ${cases.length}/${cases.length} PASS`);
}

if (process.argv.includes("--self-test")) selfTest();
else realRun();
