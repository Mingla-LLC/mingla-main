#!/usr/bin/env node
/**
 * ORCH-1055 strict-grep gate — every (tabs) nav entry MUST declare a
 * minimum-rank threshold in `navTabGate.ts`.
 *
 * Gate logic:
 *   1. Parse the `TABS` literal in `mingla-business/app/(tabs)/_layout.tsx`,
 *      collecting every `id: "..."` string.
 *   2. Parse `MIN_RANK_FOR_TAB` in `mingla-business/src/utils/navTabGate.ts`,
 *      collecting every declared key.
 *   3. Every TABS id MUST appear as a key in MIN_RANK_FOR_TAB. Adding a
 *      new tab without a rank threshold would silently fall through the
 *      `visibleTabsForRank` filter (which drops unknown ids) — visible
 *      bug, but worth catching at PR time.
 *
 * Why: ORCH-1055 closes META-ORCH-1048 sub-F (Mingla Partner Program). A
 * rank-10 scanner MUST NOT see the full brand-management nav surface.
 * Without this gate, a future PR can add a tab to `_layout.tsx` and
 * forget to update `MIN_RANK_FOR_TAB`, re-opening the leak.
 *
 * Exit codes:
 *   0 — parity holds (clean)
 *   1 — at least one TABS id missing from MIN_RANK_FOR_TAB
 *   2 — script error
 *
 * Established by: ORCH-1055 SPEC §5 / Step 0.5 regression.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const LAYOUT_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "(tabs)",
  "_layout.tsx",
);
const GATE_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "utils",
  "navTabGate.ts",
);

// Extracts every `id: "<value>"` (or single-quote) from the TABS literal
// region. We bound the parse to the TABS const declaration to avoid false
// positives from elsewhere in the file (e.g., comments).
const extractTabIds = (src) => {
  const start = src.indexOf("const TABS");
  if (start === -1) return [];
  // The literal ends at the first `];` we see after `const TABS`.
  const end = src.indexOf("];", start);
  if (end === -1) return [];
  const region = src.slice(start, end);
  const re = /id:\s*["']([a-zA-Z0-9_-]+)["']/g;
  const ids = [];
  let m;
  while ((m = re.exec(region)) !== null) ids.push(m[1]);
  return ids;
};

// Extracts every key in `MIN_RANK_FOR_TAB = { ... }`.
const extractGateKeys = (src) => {
  const start = src.indexOf("MIN_RANK_FOR_TAB");
  if (start === -1) return [];
  const end = src.indexOf("} as const", start);
  if (end === -1) return [];
  const region = src.slice(start, end);
  // Keys are bare identifiers followed by `:` at the start of a line
  // (allow leading whitespace). Skip TS object-property declarations
  // that aren't keys (none expected in this small literal).
  const re = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm;
  const keys = [];
  let m;
  while ((m = re.exec(region)) !== null) {
    // Skip the wrapper key itself.
    if (m[1] === "MIN_RANK_FOR_TAB") continue;
    keys.push(m[1]);
  }
  return keys;
};

if (process.argv.includes("--self-test")) {
  const fixtureTabs = `
    const TABS: BottomNavTab[] = [
      { id: "home", icon: "home", label: "Home" },
      { id: "hub", icon: "calendar", label: "Hub" },
    ];
  `;
  const fixtureGate = `
    export const MIN_RANK_FOR_TAB = {
      home: 0,
      hub: 30,
    } as const;
  `;
  const ids = extractTabIds(fixtureTabs);
  const keys = extractGateKeys(fixtureGate);
  if (
    ids.length !== 2 ||
    !ids.includes("home") ||
    !ids.includes("hub") ||
    keys.length !== 2 ||
    !keys.includes("home") ||
    !keys.includes("hub")
  ) {
    console.error(
      "ORCH-1055 nav-tab-rank-gate self-test FAILED — parser drift",
      { ids, keys },
    );
    process.exit(1);
  }
  console.log("ORCH-1055 nav-tab-rank-gate self-test: PASS");
  process.exit(0);
}

let layoutSrc;
let gateSrc;
try {
  layoutSrc = await readFile(LAYOUT_PATH, "utf8");
  gateSrc = await readFile(GATE_PATH, "utf8");
} catch (err) {
  console.error(
    `ORCH-1055 nav-tab-rank-gate ERROR: could not read source files (${err.message}).`,
  );
  process.exit(2);
}

const tabIds = extractTabIds(layoutSrc);
const gateKeys = new Set(extractGateKeys(gateSrc));

if (tabIds.length === 0) {
  console.error(
    "ORCH-1055 nav-tab-rank-gate FAIL: parsed zero ids from TABS — parser drift or TABS deleted.",
  );
  process.exit(1);
}
if (gateKeys.size === 0) {
  console.error(
    "ORCH-1055 nav-tab-rank-gate FAIL: parsed zero keys from MIN_RANK_FOR_TAB — parser drift or gate deleted.",
  );
  process.exit(1);
}

const missing = tabIds.filter((id) => !gateKeys.has(id));
if (missing.length > 0) {
  console.error(
    `ORCH-1055 nav-tab-rank-gate FAIL: ${missing.length} tab id(s) in (tabs)/_layout.tsx TABS have no MIN_RANK_FOR_TAB threshold — a scanner could see them by default-drop, or the new tab could silently disappear. Missing: ${missing.join(", ")}. Fix: declare a threshold in mingla-business/src/utils/navTabGate.ts.`,
  );
  process.exit(1);
}

console.log(
  `ORCH-1055 nav-tab-rank-gate: PASS (${tabIds.length} tab id(s), all declare a rank threshold)`,
);
