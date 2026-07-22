#!/usr/bin/env node
/**
 * ORCH-1047-QUARANTINE-LIST-IS-SOURCE-PINS-ONLY  (issue #1047 [business-jest-suite-audit])
 *
 * Tester-authored anti-quarantine guard (the mingla-tester Step-0.5 regression proof
 * for #1047, a DIFFERENT angle than the implementor's 7 rule-gates). It turns the
 * one-time manual audit finding — "every file quarantined by the #1047 block executes
 * NO real behavior; no real test was hidden" — into a PERMANENT, per-PR (class A) gate.
 *
 * THE RULE: every test file matched by the #1047 QUARANTINE block of
 * `mingla-business/jest.config.cjs` `testPathIgnorePatterns` must be classified
 * `source-pin` (a brittle source-text pin, §4.1.1) or `render` (a render-proof that
 * runs under its own dedicated jest.<orch>.render.cjs config) by the COMMITTED selector
 * `mingla-business/scripts/ci/select-source-text-pins.mjs`. A file that executes real
 * behavior — `behavioral` (`await fn()` / a `jest.mock(factory)`) or `unknown`
 * (neither a source read nor a render) — can NEVER be added to the ignore list without
 * this gate going red and naming it. That is the "no real behavioral test hidden by
 * quarantine" invariant, enforced continuously instead of by a one-time human review.
 *
 * SOURCE OF TRUTH: the selector's own `classifyFile` is imported (not re-derived), so
 * this guard and the selector cannot drift.
 *
 * DEFENSE-IN-DEPTH (audit finding P3-b — classifyFile's behavioral heuristic keys on
 * `await`/`jest.mock` and would miss a SYNCHRONOUS logic call): a quarantined
 * `source-pin` is ADDITIONALLY rejected here if it imports a sibling module as a VALUE
 * (a relative, non-`type` import) — the signal that it executes code rather than only
 * reading source text. This makes the guard STRICTLY STRICTER than classifyFile alone
 * (it can only catch more bad quarantines, never fewer), so a weak selector cannot make
 * the guard hollow. classifyFile itself is left unchanged to avoid rippling the criterion
 * to its other two consumers (verifyPartition + --assert-no-new).
 *
 * Runs on EVERY PR via run-batch.mjs --class A (a bad quarantine is caught at PR time,
 * not only in the nightly).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyFile } from "../../../mingla-business/scripts/ci/select-source-text-pins.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const BIZ = path.join(REPO, "mingla-business");
const JEST_CONFIG = path.join(BIZ, "jest.config.cjs");

const toPosix = (p) => p.split(path.sep).join("/");
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function fail(lines) {
  const arr = Array.isArray(lines) ? lines : [lines];
  console.error("\nFAIL [ORCH-1047-QUARANTINE-LIST-IS-SOURCE-PINS-ONLY]:");
  for (const l of arr) console.error(`  x ${l}`);
  console.error("");
  process.exit(1);
}

// --- 1. Extract the #1047 QUARANTINE block of testPathIgnorePatterns. -----------
const cfg = fs.readFileSync(JEST_CONFIG, "utf8");
const START = "#1047 [business-jest-suite-audit] — Part 1 quarantine";
const startIdx = cfg.indexOf(START);
if (startIdx === -1) {
  fail(
    "could not find the '#1047 [business-jest-suite-audit] — Part 1 quarantine' marker in " +
      "mingla-business/jest.config.cjs — the quarantine block was renamed or removed. " +
      "This guard pins that block; keep the marker or update the guard in the same PR.",
  );
}
const afterStart = cfg.slice(startIdx);
const closeRel = afterStart.search(/\n\s*\],/); // end of the testPathIgnorePatterns array
if (closeRel === -1) fail("could not locate the end of testPathIgnorePatterns after the #1047 marker.");
const blockText = afterStart.slice(0, closeRel);

// Each quarantine entry is a quoted JS regex-source string literal (may carry a // note).
// The literal is JS-source-escaped (`\\.` in the file for a regex literal dot), so
// JSON.parse the quoted token to recover the true regex source before `new RegExp`.
const patternStrings = [];
for (const line of blockText.split("\n")) {
  const codeOnly = line.replace(/\/\/.*$/, ""); // drop trailing line comment
  const m = codeOnly.match(/^\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/);
  if (!m) continue;
  try {
    patternStrings.push(JSON.parse(m[1]));
  } catch (e) {
    fail(`could not decode quarantine pattern token ${m[1]}: ${e.message}`);
  }
}
if (patternStrings.length === 0) {
  fail("parsed ZERO patterns from the #1047 quarantine block — the parser or the block shape changed; refusing to pass vacuously.");
}

const regexes = patternStrings.map((s) => {
  try {
    return new RegExp(s);
  } catch (e) {
    fail(`invalid quarantine pattern /${s}/: ${e.message}`);
    return null;
  }
});

// --- 2. Enumerate mingla-business test files (jest testMatch). -------------------
const testFiles = [];
(function walk(dir) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (/(^|\/)__tests__\/.*\.test\.tsx?$/.test(toPosix(path.relative(BIZ, full)))) {
      testFiles.push(full);
    }
  }
})(BIZ);

// --- 3. Classify every file the #1047 block quarantines. ------------------------
// jest applies testPathIgnorePatterns against the absolute path; a suffix/segment
// regex matches the relative path identically. Test both, faithfully.
const RELATIVE_VALUE_IMPORT = /^\s*import\s+(?!type[\s{])[^;]*?\bfrom\s+["']\.\.?\//m;
const ALLOWED = new Set(["source-pin", "render"]);
const violations = [];
let matched = 0;

for (const full of testFiles) {
  const rel = toPosix(path.relative(BIZ, full));
  const absPosix = toPosix(full);
  if (!regexes.some((re) => re.test(rel) || re.test(absPosix))) continue;
  matched++;

  let kind;
  try {
    kind = classifyFile(rel);
  } catch (e) {
    violations.push(`${rel}: selector classifyFile() threw (${e.message}).`);
    continue;
  }
  if (!ALLOWED.has(kind)) {
    violations.push(
      `${rel} is quarantined by the #1047 block but classifyFile() says "${kind}". A quarantined ` +
        "test MUST be a source-text pin or a render-proof — never one that executes real behavior. " +
        "Do NOT add a behavioral/logic test to testPathIgnorePatterns; fix it or gate it instead.",
    );
    continue;
  }
  if (kind === "source-pin") {
    const code = stripComments(fs.readFileSync(full, "utf8"));
    if (RELATIVE_VALUE_IMPORT.test(code)) {
      violations.push(
        `${rel} is quarantined as a source-text pin but imports a sibling module as a VALUE ` +
          "(a relative, non-`type` import) — that executes behavior, which classifyFile's " +
          "await/mock-only heuristic (audit P3-b) would miss. A quarantined pin must read source as TEXT only.",
      );
    }
  }
}

if (matched === 0) {
  fail(
    "the #1047 quarantine block matched ZERO of the mingla-business test files on disk — the block " +
      "patterns or the test tree changed such that this guard now checks nothing; refusing to pass vacuously.",
  );
}

if (violations.length) fail(violations);

console.log(
  `OK [ORCH-1047-QUARANTINE-LIST-IS-SOURCE-PINS-ONLY]: all ${matched} #1047-quarantined test file(s) ` +
    "classify as source-pin or render (no behavioral test hidden by quarantine).",
);
