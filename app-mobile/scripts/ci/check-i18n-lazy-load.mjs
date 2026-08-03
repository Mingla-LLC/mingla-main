#!/usr/bin/env node
// I-LOCALES-LAZY-LOAD — ORCH-0675 Wave 1 RC-2 protection.
//
// Only the 'en' locale (23 namespaces) may be statically imported in
// src/i18n/index.ts. All other 28 languages MUST be loaded via dynamic
// import() in the localeLoaders map.
//
// PORTED from check-i18n-lazy-load.sh to .mjs (issue #967 D-8 dark-gate
// triage) so meta-1383 P11 sweeps it and run-batch enforces it every PR.
//
// Negative-control: add `import fr from './locales/fr/common.json';` →
// run this gate → exit 1 → revert → exit 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..", ".."); // app-mobile/
const TARGET = "src/i18n/index.ts";

export function check(read) {
  const failures = [];
  const src = read(TARGET);
  if (src == null) {
    failures.push(`I-LOCALES-LAZY-LOAD: ERROR — ${TARGET} not found`);
    return failures;
  }
  const lines = src.split("\n");
  const staticImports = lines.filter((l) => /^import .* from '\.\/locales\//.test(l));
  const enImports = staticImports.filter((l) => /^import .* from '\.\/locales\/en\//.test(l));
  if (staticImports.length !== enImports.length) {
    const nonEn = staticImports.length - enImports.length;
    failures.push(`I-LOCALES-LAZY-LOAD violation: ${nonEn} non-en static locale import(s) in ${TARGET}.`);
    for (const l of staticImports.filter((x) => !/\/en\//.test(x)).slice(0, 10)) failures.push(`  ${l.trim()}`);
  }
  if (enImports.length !== 23) {
    failures.push(`I-LOCALES-LAZY-LOAD violation: en has ${enImports.length} static imports (expected exactly 23 namespaces).`);
  }
  const loaderCount = lines.filter((l) => /^[ \t]+[a-z]{2,3}: async \(\) =>/.test(l)).length;
  if (loaderCount < 28) {
    failures.push(`I-LOCALES-LAZY-LOAD violation: only ${loaderCount} lazy loaders found (expected >= 28).`);
  }
  return failures;
}

function realRun() {
  const read = (rel) => {
    try { return fs.readFileSync(path.join(APP_ROOT, rel), "utf8"); } catch { return null; }
  };
  const failures = check(read);
  if (failures.length) { for (const f of failures) console.error(f); process.exit(1); }
  console.log("I-LOCALES-LAZY-LOAD: PASS");
}

function selfTest() {
  const cases = [];
  const t = (name, read, shouldFail) => {
    const f = check(read);
    cases.push({ name, ok: (f.length > 0) === shouldFail, f });
  };
  const en23 = Array.from({ length: 23 }, (_, i) => `import ns${i} from './locales/en/ns${i}.json';`).join("\n");
  const loaders28 = Array.from({ length: 28 }, (_, i) => {
    const code = String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + ((i + 1) % 26));
    return `  ${code}: async () => import('./locales/x'),`;
  }).join("\n");
  t("23 en + 28 loaders passes", () => `${en23}\n${loaders28}`, false);
  t("a non-en static import fails", () => `${en23}\nimport fr from './locales/fr/common.json';\n${loaders28}`, true);
  t("22 en imports fails", () => `${en23.split("\n").slice(0, 22).join("\n")}\n${loaders28}`, true);
  t("only 27 loaders fails", () => `${en23}\n${loaders28.split("\n").slice(0, 27).join("\n")}`, true);
  t("missing file fails", () => null, true);
  let bad = 0;
  for (const c of cases) { console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`); if (!c.ok) { bad++; console.log(JSON.stringify(c.f)); } }
  if (bad) { console.error(`\nself-test FAILED: ${bad}/${cases.length}`); process.exit(1); }
  console.log(`\ncheck-i18n-lazy-load self-test: ${cases.length}/${cases.length} PASS`);
}

if (process.argv.includes("--self-test")) selfTest();
else realRun();
