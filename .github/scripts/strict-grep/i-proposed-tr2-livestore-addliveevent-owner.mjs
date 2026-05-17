#!/usr/bin/env node
/**
 * I-PROPOSED-TR2-LIVESTORE-ADDLIVEEVENT-OWNER strict-grep gate.
 *
 * Pins the existing `[I-16 GUARD]` comment in
 * `mingla-business/src/utils/liveEventConverter.ts:137` as a CI-enforced
 * invariant: `addLiveEvent` may ONLY be called from `liveEventConverter.ts`
 * (and from the store itself + its test files where the method is
 * defined). Any other caller would risk leaking a non-event row into the
 * persisted Zustand store and from there into the home/hub Upcoming list
 * tap-handlers.
 *
 * The Zustand `liveEventStore` is correctly gated today — partialize
 * returns empty, migrate drops persisted server data — but those
 * protections only catch DATA that's already in the store. They do NOT
 * prevent a future code path from `useLiveEventStore.getState().addLiveEvent(...)`
 * with a trip row. This gate prevents that regression class.
 *
 * Allowed callers:
 *   - `mingla-business/src/utils/liveEventConverter.ts` (the documented
 *     single writer per [I-16 GUARD]).
 *   - `mingla-business/src/store/liveEventStore.ts` (the store defines
 *     the method; the implementation IS the method).
 *   - Test files (`__tests__/*.test.ts` and `*.test.ts`).
 *   - Any file with allowlist comment within 5 lines above the call:
 *     `// orch-strict-grep-allow livestore-addliveevent-owner — <reason>`
 *
 * Why this exists: ORCH-0865 [trips-leak systemic + routeForEventRow
 *   helper] Hidden Flaw H-1 — the Zustand store is operationally safe
 *   today but structurally fragile because the `[I-16 GUARD]` rule lives
 *   as a code comment, not a CI gate. ORCH-0859 REWORK 5 formalizes it.
 *
 * Established by: ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  join(REPO_ROOT, "mingla-business", "app"),
  join(REPO_ROOT, "mingla-business", "src"),
];

const CONVERTER_FILE = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "utils",
  "liveEventConverter.ts",
);
const STORE_FILE = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "store",
  "liveEventStore.ts",
);

const ALLOWLIST_TAG = "orch-strict-grep-allow livestore-addliveevent-owner";
const ADD_LIVE_EVENT_CALL_RE = /\.addLiveEvent\s*\(/;

let violations = 0;
let filesScanned = 0;

function* walkTsTsx(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkTsTsx(full);
    } else if (/\.(tsx|ts)$/.test(entry)) {
      yield full;
    }
  }
}

function isOwnerExempt(file) {
  if (file === CONVERTER_FILE) return true;
  if (file === STORE_FILE) return true;
  if (/\.test\.(tsx|ts)$/.test(file)) return true;
  if (file.includes("__tests__")) return true;
  return false;
}

function checkFile(file) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    if (!ADD_LIVE_EVENT_CALL_RE.test(line)) continue;
    let allowlisted = false;
    for (let k = i - 1; k >= Math.max(0, i - 5); k -= 1) {
      if (lines[k].includes(ALLOWLIST_TAG)) {
        allowlisted = true;
        break;
      }
    }
    if (allowlisted) continue;
    violations += 1;
    const rel = relative(REPO_ROOT, file);
    console.error(
      `✗ ${rel}:${i + 1} — addLiveEvent called outside liveEventConverter.ts / liveEventStore.ts`,
    );
    console.error(`    > ${line.trim()}`);
    console.error(
      `    fix: route writes through liveEventConverter.ts (the documented single owner per [I-16 GUARD])`,
    );
    console.error(
      `    OR add allowlist comment: // ${ALLOWLIST_TAG} — <reason>`,
    );
  }
}

for (const dir of SCAN_DIRS) {
  for (const file of walkTsTsx(dir)) {
    if (isOwnerExempt(file)) continue;
    filesScanned += 1;
    checkFile(file);
  }
}

console.log(
  `I-PROPOSED-TR2-LIVESTORE-ADDLIVEEVENT-OWNER: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
