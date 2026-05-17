#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate for I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER.
 *
 * Enforces ORCH-0850 [End-not-start parity systemic]:
 *   Every past/upcoming/live decision in mingla-business/ MUST route through
 *   the canonical helpers in `mingla-business/src/utils/eventLifecycle.ts`
 *   (deriveLiveStatus, isEventPast) + `mingla-business/src/utils/eventDateMath.ts`
 *   (computeMasterStartAtUtc, computeMasterEndAtUtc).
 *
 *   Forbidden patterns OUTSIDE the canonical helper files:
 *     A. `new Date(<var>.date)` — variable date-only-string parse that produces
 *        UTC midnight regardless of the event's actual timezone. This is the
 *        bug pattern that ORCH-0828's literal-only gate missed.
 *     B. Local function declarations named `deriveLiveStatus`, `computeIsPast`,
 *        or `isEventPast` — these duplicate the canonical helper. Local
 *        helpers like `deriveCardStatus` (thin wrappers that route through
 *        the canonical) are allowed.
 *
 *   Whitelist: a `// SPEC ORCH-0850 OK:` comment on the same line exempts it
 *   (escape hatch for legitimate non-bug uses, e.g. tests).
 *
 *   Self-test mode (`--self-test`) re-runs the regex against an inlined
 *   fixture and exits 1 if the regex does NOT match — proves the gate
 *   isn't a no-op.
 *
 * Exit codes:
 *   0 — all targets pass
 *   1 — at least one forbidden pattern matched OR self-test failed
 *   2 — file system error
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BUSINESS_ROOT = path.join(REPO_ROOT, "mingla-business");

const CANONICAL_FILES = new Set([
  path.join(BUSINESS_ROOT, "src", "utils", "eventLifecycle.ts"),
  path.join(BUSINESS_ROOT, "src", "utils", "eventDateMath.ts"),
]);

// Forbidden patterns ----------------------------------------------------------
const FORBIDDEN_DATE_PARSE =
  /\bnew\s+Date\(\s*[a-zA-Z_$][\w$]*\.date\s*\)/;
const FORBIDDEN_LOCAL_HELPERS = [
  /\b(?:const|function)\s+deriveLiveStatus\b/,
  /\b(?:const|function)\s+computeIsPast\b/,
  /\b(?:const|function)\s+isEventPast\b/,
];

const WHITELIST = /\/\/\s*SPEC\s+ORCH-0850\s+OK\s*:/;

// Self-test -------------------------------------------------------------------
const SELF_TEST_FIXTURE_A = `const x = new Date(event.date);`;
const SELF_TEST_FIXTURE_B = `const computeIsPast = (e) => true;`;

if (process.argv.includes("--self-test")) {
  let ok = true;
  if (!FORBIDDEN_DATE_PARSE.test(SELF_TEST_FIXTURE_A)) {
    console.error("SELF-TEST FAIL: date-parse regex did not match fixture A");
    ok = false;
  }
  if (!FORBIDDEN_LOCAL_HELPERS[1].test(SELF_TEST_FIXTURE_B)) {
    console.error("SELF-TEST FAIL: local-helper regex did not match fixture B");
    ok = false;
  }
  if (ok) {
    console.log("i-event-lifecycle-single-helper self-test PASSED");
    process.exit(0);
  }
  process.exit(1);
}

// Walk ------------------------------------------------------------------------
function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      yield* walk(full);
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) {
      yield full;
    }
  }
}

const TARGETS = [
  path.join(BUSINESS_ROOT, "src"),
  path.join(BUSINESS_ROOT, "app"),
];

let failures = 0;

for (const root of TARGETS) {
  for (const file of walk(root)) {
    if (CANONICAL_FILES.has(file)) continue;
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch (err) {
      console.error(`READ ERROR ${file}: ${err.message}`);
      process.exit(2);
    }
    // Strip block comments (line-by-line comment stripping happens per-line).
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "");
    const lines = stripped.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      if (WHITELIST.test(raw)) continue;
      const noLineComment = raw.replace(/\/\/.*$/, "");
      if (FORBIDDEN_DATE_PARSE.test(noLineComment)) {
        console.error(
          `${path.relative(REPO_ROOT, file)}:${i + 1}: forbidden \`new Date(<var>.date)\` — route through eventDateMath.computeMasterStartAtUtc / computeMasterEndAtUtc.`,
        );
        console.error(`  Line: ${raw.trim()}`);
        failures += 1;
      }
      for (const pat of FORBIDDEN_LOCAL_HELPERS) {
        if (pat.test(noLineComment)) {
          console.error(
            `${path.relative(REPO_ROOT, file)}:${i + 1}: forbidden local declaration of canonical-helper name — import from src/utils/eventLifecycle instead.`,
          );
          console.error(`  Line: ${raw.trim()}`);
          failures += 1;
          break;
        }
      }
    }
  }
}

if (failures > 0) {
  console.error("");
  console.error(
    `i-event-lifecycle-single-helper: ${failures} violation(s). See I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER in INVARIANT_REGISTRY.md.`,
  );
  process.exit(1);
}
console.log("i-event-lifecycle-single-helper PASSED");
process.exit(0);
