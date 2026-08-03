#!/usr/bin/env node
// I-ANIMATIONS-NATIVE-DRIVER-DEFAULT — ORCH-0675 Wave 1 RC-1 + RC-3 protection.
//
// Fails if `useNativeDriver: false` appears in the SwipeableCards swipe-handler
// region (lines 1216-1380) OR the DiscoverScreen LoadingGridSkeleton block
// (lines 575-620) without an explicit `JUSTIFIED:` annotation.
//
// PORTED from check-no-native-driver-false.sh to .mjs (issue #967 D-8
// dark-gate triage) so meta-1383 P11 sweeps it and run-batch enforces it.
//
// Negative-control: inject `useNativeDriver: false` in the SwipeableCards
// PanResponder body → run this gate → exit 1 → revert → exit 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..", ".."); // app-mobile/

const REGIONS = [
  { rel: "src/components/SwipeableCards.tsx", lo: 1216, hi: 1380, label: "SwipeableCards swipe handler" },
  { rel: "src/components/DiscoverScreen.tsx", lo: 575, hi: 620, label: "DiscoverScreen LoadingGridSkeleton" },
];

export function check(read) {
  const failures = [];
  for (const { rel, lo, hi, label } of REGIONS) {
    const src = read(rel);
    if (src == null) { failures.push(`WARN: ${rel} not found — skipping`); continue; }
    const lines = src.split("\n");
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const n = i + 1;
      if (n < lo || n > hi) continue;
      const line = lines[i];
      if (/useNativeDriver: false/.test(line) && !/JUSTIFIED:/.test(line)) hits.push(`${rel}:${n}: ${line.trim()}`);
    }
    if (hits.length) {
      failures.push(`I-ANIMATIONS-NATIVE-DRIVER-DEFAULT violation in ${label}:`);
      for (const h of hits) failures.push(`  ${h}`);
    }
  }
  // Returns WARN: lines (file-not-found, non-fatal) and violation lines mixed;
  // callers split them by the "WARN:" prefix.
  return failures;
}

function realRun() {
  const read = (rel) => {
    try { return fs.readFileSync(path.join(APP_ROOT, rel), "utf8"); } catch { return null; }
  };
  const out = check(read);
  const warns = out.filter((f) => f.startsWith("WARN:"));
  const violations = out.filter((f) => !f.startsWith("WARN:"));
  for (const w of warns) console.log(w);
  if (violations.length) {
    for (const v of violations) console.error(v);
    console.error("\nAnimations on transform/opacity must use useNativeDriver: true (annotate width/height with `// useNativeDriver:false JUSTIFIED: <reason>`).");
    process.exit(1);
  }
  console.log("I-ANIMATIONS-NATIVE-DRIVER-DEFAULT: PASS");
}

function selfTest() {
  const cases = [];
  const t = (name, read, shouldFail) => {
    const out = check(read);
    const violations = out.filter((f) => !f.startsWith("WARN:"));
    cases.push({ name, ok: (violations.length > 0) === shouldFail, out });
  };
  const swipePad = (bodyLine) => Array.from({ length: 1300 }, (_, i) => (i === 1249 ? bodyLine : "// f")).join("\n");
  const readFor = (swipeSrc, discoverSrc) => (rel) =>
    rel.includes("SwipeableCards") ? swipeSrc : rel.includes("DiscoverScreen") ? discoverSrc : null;
  t("clean regions pass", readFor(swipePad("  useNativeDriver: true,"), ""), false);
  t("bare useNativeDriver:false in swipe region fails", readFor(swipePad("  useNativeDriver: false,"), ""), true);
  t("JUSTIFIED useNativeDriver:false passes", readFor(swipePad("  useNativeDriver: false, // JUSTIFIED: width"), ""), false);
  let bad = 0;
  for (const c of cases) { console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`); if (!c.ok) { bad++; console.log(JSON.stringify(c.out)); } }
  if (bad) { console.error(`\nself-test FAILED: ${bad}/${cases.length}`); process.exit(1); }
  console.log(`\ncheck-no-native-driver-false self-test: ${cases.length}/${cases.length} PASS`);
}

if (process.argv.includes("--self-test")) selfTest();
else realRun();
