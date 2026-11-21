#!/usr/bin/env node
/* eslint-disable no-console */
// MINGLA-INVARIANT: I-4514-ONE-QUESTION-MODEL | issue #4514 | form question renderers (shell, text, choice, date, number, the form orchestrator) are defined only in packages/form-rendering; apps inject their primitives and render file upload themselves (C11).
/**
 * Strict-grep gate — #4514 · I-4514-ONE-QUESTION-MODEL
 *
 * BUILD CONTRACT v2 §5.2 / SC-24: `IntakeQuestionRenderers.tsx` moved (not
 * copied) to the props-only package `packages/form-rendering`; trip checkout and
 * every brand form view mount from there. This gate fails when a tracked source
 * file outside the package:
 *   - is named IntakeQuestionRenderers.tsx / QuestionRenderers.tsx, or
 *   - defines a question renderer: IntakeQuestion{Shell,ShortText,LongText,
 *     SingleChoice,MultiChoice,Date,Number}, IntakeFormRenderer, or a
 *     BrandForm…Renderer / BrandFormQuestion… component.
 * The business file upload question (IntakeQuestionFileUpload) is not matched:
 * C11 keeps the file picker in the business app until brand-form file upload ships.
 *
 *   [TRANSITIONAL] ALLOWED UNTIL THE EXPLORER WAVE OF #4514:
 *     - app-mobile/src/components/expandedCard/ConsumerIntakeForm.tsx, the
 *       Explorer cart's own trip intake renderer (ORCH-1016). Exit condition:
 *       Explorer mounts @mingla/form-rendering (#4514 Explorer wave / trip
 *       slice) and this entry is deleted.
 *
 * Exit codes: 0 pass · 1 fail · 2 git/fs error. --self-test checks the detector.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const PACKAGE_DIR = /^packages\/form-rendering\//;
export const SCOPES = /^(app-mobile|mingla-business|mingla-admin|mingla-marketing|mingla-sites|packages)\//;
export const SOURCE = /\.(ts|tsx|js|jsx)$/;
export const TEST_PATH = /(^|\/)__tests__\/|\.test\.[jt]sx?$/;
export const ALLOWED_FILES = new Set([
  // [TRANSITIONAL] see header.
  "app-mobile/src/components/expandedCard/ConsumerIntakeForm.tsx",
]);
const BANNED_NAME = /(^|\/)(IntakeQuestionRenderers|QuestionRenderers)\.(ts|tsx)$/;
const DEFINITION =
  /\b(?:const|let|function|class)\s+(IntakeQuestion(?:Shell|ShortText|LongText|SingleChoice|MultiChoice|Date|Number)|IntakeFormRenderer|BrandForm\w*Renderer|BrandFormQuestion\w*)\b/g;

/** The renderer definitions in `text` (names). */
export function definitions(text) {
  const out = [];
  for (const m of text.matchAll(DEFINITION)) out.push(m[1]);
  return out;
}

/** Violations for one tracked path and its text. */
export function violations(rel, text) {
  if (PACKAGE_DIR.test(rel) || !SCOPES.test(rel) || !SOURCE.test(rel) || TEST_PATH.test(rel)) return [];
  if (ALLOWED_FILES.has(rel)) return [];
  const out = [];
  if (BANNED_NAME.test(rel)) out.push(`file name ${path.basename(rel)} belongs in packages/form-rendering`);
  for (const name of definitions(text)) out.push(`defines ${name}`);
  return out;
}

if (process.argv.includes("--self-test")) {
  const cases = [
    [violations("mingla-business/src/x/IntakeQuestionRenderers.tsx", "").length, 1],
    [violations("mingla-business/src/x/Foo.tsx", "export const IntakeQuestionShortText = () => null;").length, 1],
    [violations("app-mobile/src/x/Foo.tsx", "function IntakeFormRenderer() {}").length, 1],
    [violations("mingla-business/src/x/Foo.tsx", "export const BrandFormQuestionList = () => null;").length, 1],
    [violations("packages/form-rendering/QuestionRenderers.tsx", "export const IntakeQuestionShell = 1;").length, 0],
    [violations("mingla-business/src/x/IntakeQuestionFileUpload.tsx", "export const IntakeQuestionFileUpload = 1;").length, 0],
    [violations("mingla-business/app/intake.tsx", 'import { IntakeFormRenderer } from "@mingla/form-rendering";').length, 0],
    [violations("mingla-business/src/x/__tests__/a.test.ts", "const IntakeQuestionShell = 1;").length, 0],
    [violations("app-mobile/src/components/expandedCard/ConsumerIntakeForm.tsx", "const IntakeQuestionShell = 1;").length, 0],
  ];
  const bad = cases.filter(([got, want]) => got !== want);
  if (bad.length === 0) {
    console.log("SELF-TEST OK: I-4514-ONE-QUESTION-MODEL detector behaves");
    process.exit(0);
  }
  console.error(`SELF-TEST FAIL: ${JSON.stringify(bad)}`);
  process.exit(1);
}

let files;
try {
  files = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 })
    .toString("utf8").split("\0").filter(Boolean);
} catch (e) {
  console.error(`git error: ${e.message}`);
  process.exit(2);
}

let failures = 0;
let packageHasRenderers = false;
for (const rel of files) {
  if (!SOURCE.test(rel)) continue;
  let text;
  try {
    text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  if (PACKAGE_DIR.test(rel) && definitions(text).includes("IntakeFormRenderer")) packageHasRenderers = true;
  for (const v of violations(rel, text)) {
    failures += 1;
    console.error(`FAIL [I-4514-ONE-QUESTION-MODEL] ${rel}: ${v}`);
  }
}
if (!packageHasRenderers) {
  failures += 1;
  console.error("FAIL [I-4514-ONE-QUESTION-MODEL] packages/form-rendering no longer defines IntakeFormRenderer");
}
if (failures === 0) console.log("OK   [I-4514-ONE-QUESTION-MODEL] question renderers live only in packages/form-rendering");
process.exit(failures > 0 ? 1 : 0);
