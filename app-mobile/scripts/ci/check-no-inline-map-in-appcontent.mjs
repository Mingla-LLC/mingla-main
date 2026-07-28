#!/usr/bin/env node
// I-NO-INLINE-MAP-IN-APPCONTENT — ORCH-0679 Wave 2.7 invariant.
//
// Detects unmemoized inline `.map()` / `.filter()` declarations inside the
// AppContent body in app/index.tsx (lines 144-2700). These rebuild fresh
// arrays every render, busting React.memo barriers on any consumer.
//
// PORTED from check-no-inline-map-in-appcontent.sh to .mjs (issue #967 D-8
// dark-gate triage) so meta-1383 P11 sweeps it and run-batch enforces it.
//
// Whitelist: add `// inline-OK: <reason>` on the same line.
// Negative-control: insert `const x = [].map(y => y);` at line 200 →
// run this gate → exit 1 → revert → exit 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..", ".."); // app-mobile/
const TARGET = "app/index.tsx";
const LO = 144;
const HI = 2700;

export function check(read) {
  const failures = [];
  const src = read(TARGET);
  if (src == null) {
    failures.push(`ERROR: ${TARGET} not found`);
    return failures;
  }
  const lines = src.split("\n");
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    if (n < LO || n > HI) continue;
    const line = lines[i];
    if (/inline-OK:/.test(line)) continue;
    if (/useMemo/.test(line)) continue;
    if (/^  const .* = .*\.map\(/.test(line) || /^  const .* = .*\.filter\(/.test(line)) {
      violations.push(`${TARGET}:${n}: ${line}`);
    }
  }
  if (violations.length) {
    failures.push("I-NO-INLINE-MAP-IN-APPCONTENT violation(s):");
    for (const v of violations) failures.push(`  ${v}`);
    failures.push("Fix: wrap in useMemo, or annotate `// inline-OK: <reason>`.");
  }
  return failures;
}

function realRun() {
  const read = (rel) => {
    try { return fs.readFileSync(path.join(APP_ROOT, rel), "utf8"); } catch { return null; }
  };
  const failures = check(read);
  if (failures.length) { for (const f of failures) console.error(f); process.exit(1); }
  console.log("I-NO-INLINE-MAP-IN-APPCONTENT: PASS");
}

function selfTest() {
  const cases = [];
  const t = (name, read, shouldFail) => {
    const f = check(read);
    cases.push({ name, ok: (f.length > 0) === shouldFail, f });
  };
  const pad = (bodyLine) => Array.from({ length: 200 }, (_, i) => (i === 199 ? bodyLine : "// filler")).join("\n");
  t("clean body passes", () => pad("  const x = 1;"), false);
  t("inline .map() at line 200 fails", () => pad("  const rows = items.map(x => x.id);"), true);
  t("inline .filter() fails", () => pad("  const rows = items.filter(x => x);"), true);
  t("useMemo-wrapped .map() passes", () => pad("  const rows = useMemo(() => items.map(x => x), [items]);"), false);
  t("inline-OK annotated .map() passes", () => pad("  const rows = items.map(x => x); // inline-OK: static"), false);
  t("out-of-region .map() (line 1) passes", () => "  const rows = items.map(x => x);\n" + "// f", false);
  t("missing file fails", () => null, true);
  let bad = 0;
  for (const c of cases) { console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`); if (!c.ok) { bad++; console.log(JSON.stringify(c.f)); } }
  if (bad) { console.error(`\nself-test FAILED: ${bad}/${cases.length}`); process.exit(1); }
  console.log(`\ncheck-no-inline-map-in-appcontent self-test: ${cases.length}/${cases.length} PASS`);
}

if (process.argv.includes("--self-test")) selfTest();
else realRun();
