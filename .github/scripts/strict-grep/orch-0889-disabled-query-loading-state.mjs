#!/usr/bin/env node

/**
 * I-DISABLED-QUERY-IS-LOADING (ORCH-0889 invariant)
 *
 * Rejects the brittle loading-state guard
 *   if (someQuery.isLoading && someQuery.data === undefined) { … }
 * inside marketing routes. React Query reports `isLoading: false` when
 * the query is `enabled: false` (auth bootstrap), so the brittle guard
 * falls through to the error/empty branch and surfaces a false-error
 * state ("Couldn't load metrics", "No buyers yet.", "Your first
 * campaign starts here.") for the entire 4-8s web auth-bootstrap
 * window.
 *
 * Correct shape: `if (!someQuery.hasResolved && !someQuery.isError)`
 * — hooks expose `hasResolved` via `query.isFetched`, which is
 * `true` once the query has resolved at least one fetch.
 *
 * Scope: mingla-business/app/(tabs)/marketing/**\/*.tsx
 *   PLUS app/(tabs)/marketing/**\/*.tsx (relative to repo root, since
 *   Expo Router routes live OUTSIDE the `src/` folder).
 *
 * Allow-list: templates/index.tsx is exempt because `useStarterTemplates`
 *   is unconditionally enabled (no `enabled` gate), so the brittle pattern
 *   degrades gracefully there. OB-2 of the investigation documents this.
 *
 * Cross-references:
 *   - SPEC_ORCH-0889 §3.5.7 + §5 (invariants)
 *   - feedback_strict_grep_registry_pattern.md (one script + one job)
 *   - INVESTIGATION_ORCH-0889_*.md RC-1 + OB-2
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET_ROOT = "mingla-business/app/(tabs)/marketing";

const ALLOW_LIST = new Set([
  // Always-enabled starter query — see OB-2 of investigation.
  "mingla-business/app/(tabs)/marketing/templates/index.tsx",
]);

/**
 * Match `<expr>.isLoading && <expr>.data === undefined` (and minor
 * whitespace variants). The leading `<expr>` is any identifier chain
 * (e.g., `query`, `someQuery`, `audienceQuery`). The trailing
 * `=== undefined` is the canonical "no data yet" check.
 */
const BRITTLE = /\b\w[\w.?]*\.isLoading\s*&&\s*\w[\w.?]*\.data\s*===\s*undefined/;

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      yield full;
    }
  }
}

const violations = [];
let filesScanned = 0;

const targetAbs = path.join(repoRoot, TARGET_ROOT);
for (const file of walk(targetAbs)) {
  const rel = path.relative(repoRoot, file);
  if (ALLOW_LIST.has(rel)) continue;
  filesScanned++;
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (BRITTLE.test(line)) {
      violations.push({
        file: rel,
        line: index + 1,
        text: line.trim(),
      });
    }
  });
}

if (violations.length > 0) {
  console.error(
    "I-DISABLED-QUERY-IS-LOADING violation (ORCH-0889):",
  );
  console.error(
    "  brittle loading-state guard `isLoading && data === undefined` " +
      "found in marketing route.",
  );
  console.error(
    "  React Query reports isLoading: false when enabled: false " +
      "(auth bootstrap), so the brittle guard falls through to the " +
      "error/empty branch and surfaces a false-error state during the " +
      "4-8s web auth-bootstrap window.",
  );
  console.error(
    "  Fix: replace with `!query.hasResolved && !query.isError` and " +
      "ensure the hook exposes `hasResolved` from `query.isFetched`.",
  );
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error("");
  console.error(
    `Scanned ${filesScanned} file(s) under ${TARGET_ROOT}; found ${violations.length} violation(s).`,
  );
  process.exit(1);
}

console.log(
  `ORCH-0889 disabled-query-loading-state OK: scanned ${filesScanned} file(s) under ${TARGET_ROOT}; no brittle loading-state guards found.`,
);
process.exit(0);
