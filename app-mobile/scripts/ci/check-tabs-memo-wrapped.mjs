#!/usr/bin/env node
// I-TAB-SCREENS-MEMOIZED — ORCH-0679 Wave 2A invariant.
//
// Fails if any of the 6 tab screen files is missing `React.memo(...)` on its
// default export. Without memo, hidden tabs re-render on every parent state
// change even when props are unchanged.
//
// PORTED from check-tabs-memo-wrapped.sh to .mjs (issue #967 D-8 dark-gate
// triage). The .sh used bash-4 `declare -A`; on bash 3.2 (macOS default) it
// fails and the loop iterates ZERO tabs, so the gate PASSED WITHOUT CHECKING.
// This port genuinely asserts all 6/6.
//
// Negative-control: change `export default React.memo(HomePage);` to
// `export default HomePage;` → run this gate → exit 1 → revert → exit 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..", ".."); // app-mobile/

// file -> exported component name (note ConnectionsPage exports ConnectionsPageRefactored).
const TABS = [
  ["src/components/HomePage.tsx", "HomePage"],
  ["src/components/DiscoverScreen.tsx", "DiscoverScreen"],
  ["src/components/ConnectionsPage.tsx", "ConnectionsPageRefactored"],
  ["src/components/SavedExperiencesPage.tsx", "SavedExperiencesPage"],
  ["src/components/LikesPage.tsx", "LikesPage"],
  ["src/components/ProfilePage.tsx", "ProfilePage"],
];

export function check(read, tabs = TABS) {
  const failures = [];
  let memoized = 0;
  for (const [rel, comp] of tabs) {
    const src = read(rel);
    if (src == null) { failures.push(`ERROR: ${rel} not found`); continue; }
    if (!src.includes(`export default React.memo(${comp})`)) {
      failures.push(`I-TAB-SCREENS-MEMOIZED violation: ${rel} missing 'export default React.memo(${comp})'`);
    } else {
      memoized++;
    }
  }
  return { failures, memoized, total: tabs.length };
}

function realRun() {
  const read = (rel) => {
    try { return fs.readFileSync(path.join(APP_ROOT, rel), "utf8"); } catch { return null; }
  };
  const { failures, memoized, total } = check(read);
  if (failures.length) {
    for (const f of failures) console.error(f);
    console.error("\nAll 6 tab screens MUST default-export React.memo(...). Do NOT add custom arePropsEqual fns.");
    process.exit(1);
  }
  console.log(`I-TAB-SCREENS-MEMOIZED: PASS (${memoized}/${total} tabs memoized)`);
}

function selfTest() {
  const cases = [];
  const t = (name, read, tabs, shouldFail) => {
    const { failures } = check(read, tabs);
    cases.push({ name, ok: (failures.length > 0) === shouldFail, failures });
  };
  const tabs2 = [["a.tsx", "Foo"], ["b.tsx", "Bar"]];
  t("both memoized passes", (rel) => (rel === "a.tsx" ? "export default React.memo(Foo)" : "export default React.memo(Bar)"), tabs2, false);
  t("one un-memoized fails", (rel) => (rel === "a.tsx" ? "export default React.memo(Foo)" : "export default Bar"), tabs2, true);
  t("wrong component name fails", (rel) => (rel === "a.tsx" ? "export default React.memo(Foo)" : "export default React.memo(Baz)"), tabs2, true);
  t("missing file fails", () => null, tabs2, true);
  let bad = 0;
  for (const c of cases) { console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`); if (!c.ok) { bad++; console.log(JSON.stringify(c.failures)); } }
  if (bad) { console.error(`\nself-test FAILED: ${bad}/${cases.length}`); process.exit(1); }
  console.log(`\ncheck-tabs-memo-wrapped self-test: ${cases.length}/${cases.length} PASS`);
}

if (process.argv.includes("--self-test")) selfTest();
else realRun();
