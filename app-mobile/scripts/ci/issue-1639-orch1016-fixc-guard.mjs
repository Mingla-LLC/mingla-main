#!/usr/bin/env node
// Issue #1639 — backward-compatibility guard for the ORCH-1016 FIX-C contract.
//
// #1639 edits `PersonHolidayView.tsx`, which ORCH-1016 also constrains: the collapsed
// paired-friend card's chip row must WRAP (C1) and the tile must CLIP (C2), so a wide
// second GlassBadge is contained instead of bleeding past the card edge.
//
// The original suite (`src/components/__tests__/orch_1016_rework4_sheets_keyboard_pills.test.tsx`)
// asserts C1/C2 alongside a `B-ref` drift guard on `CityPickerSheet.tsx`. That B-ref
// check has been FAILING since ORCH-1361 (e3d87c40b) rewrote CityPickerSheet and removed
// BottomSheetTextInput — and nobody noticed, because that suite is wired into NO
// workflow and therefore never runs (the #1584 dark-suite class). Invoking it whole
// from the #1639 gate would turn this PR red for an unrelated, pre-existing reason.
//
// So this guard re-asserts EXACTLY the two FIX-C predicates, verbatim from the original
// suite, against the file #1639 actually touches. Fixing ORCH-1016's B-ref drift is a
// separate work item (reported as a discovery on #1639); it is not this PR's to make.
import fs from "node:fs";
import path from "node:path";

const root = fs.existsSync("src/components/PersonHolidayView.tsx") ? "." : "app-mobile";
const target = path.join(root, "src/components/PersonHolidayView.tsx");
const src = fs.readFileSync(target, "utf8");

const checks = [
  {
    id: "C1",
    re: /tileChips:\s*\{[\s\S]*?flexDirection:\s*["']row["'][\s\S]*?flexWrap:\s*["']wrap["'][\s\S]*?\}/,
    why: "the CompactCard chip row must wrap so multi-pill cards never bleed past the card width",
  },
  {
    id: "C2",
    re: /tile:\s*\{[\s\S]*?overflow:\s*["']hidden["'][\s\S]*?\}/,
    why: "the collapsed tile must clip at its rounded edge so residual overflow is contained",
  },
];

let failed = 0;
for (const c of checks) {
  if (c.re.test(src)) {
    console.log(`OK   ORCH-1016 ${c.id} — ${c.why}`);
  } else {
    console.error(`FAIL ORCH-1016 ${c.id} regressed in ${target} — ${c.why}`);
    failed += 1;
  }
}

// Negative control: the predicates must be capable of failing on this file.
if (checks.some((c) => c.re.test("const styles = {};"))) {
  console.error("FAIL negative control — a FIX-C predicate matches an empty stylesheet");
  failed += 1;
}

if (failed > 0) process.exit(1);
console.log("issue-1639 / ORCH-1016 FIX-C backward-compatibility guard: PASS (2 checks)");
