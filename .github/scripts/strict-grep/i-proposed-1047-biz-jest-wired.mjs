#!/usr/bin/env node
/**
 * I-PROPOSED-1047-BIZ-JEST-WIRED  (issue #1047 [business-jest-suite-audit])
 *
 * DRAFT invariant (flips ACTIVE at CLOSE): the mingla-business default jest suite
 * is executed by a CI workflow — it is never again dark. This was the whole point
 * of #1047 (and #1038 before it): a safety mechanism that LOOKS present in the repo
 * but that no workflow runs is worse than none, because it manufactures false
 * confidence. The regression-test CLOSE gate had been depositing tests into a suite
 * that CI never invoked.
 *
 * THE RULE: `.github/workflows/mingla-business-jest-suite.yml` exists and actually
 * invokes the suite (bare `jest` / `npm test` / `npm run test` in mingla-business —
 * NOT a per-file `jest <path>` list, which is the workaround #1047 exists to end).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WF = ".github/workflows/mingla-business-jest-suite.yml";

let src;
try {
  src = fs.readFileSync(path.join(REPO, WF), "utf8");
} catch {
  console.error(
    `\nFAIL [I-PROPOSED-1047-BIZ-JEST-WIRED]: ${WF} is MISSING — the mingla-business jest suite has ` +
      "no workflow that runs it and is therefore dark (the exact #1038/#1047 failure).\n",
  );
  process.exit(1);
}

// Must invoke the whole suite, not an explicit per-file list. Accept `npm test`,
// `npm run test`, `jest --ci`, or a bare `jest` with no test-path argument.
const invokesSuite =
  /\bnpm\s+(?:run\s+)?test\b/.test(src) ||
  /\bnpx?\s+jest(?:\s+--[^\n]*)*\s*(?:\n|$|#)/.test(src) ||
  /\bjest\s+--ci\b/.test(src);

if (!invokesSuite) {
  console.error(
    `\nFAIL [I-PROPOSED-1047-BIZ-JEST-WIRED]: ${WF} exists but does not invoke the WHOLE jest suite ` +
      "(expected `npm test` / `npm run test` / `jest --ci`). A per-file `jest <path>` list is the dark-suite " +
      "workaround #1047 exists to end.\n",
  );
  process.exit(1);
}

console.log("OK [I-PROPOSED-1047-BIZ-JEST-WIRED]: mingla-business-jest-suite.yml runs the whole jest suite.");
