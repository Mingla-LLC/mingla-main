#!/usr/bin/env node
/**
 * #1734 / #1735 — I-PROPOSED-1734-TOOL-RESULTS-NEVER-PERSISTED-CLIENT-SIDE
 * (DRAFT; flips ACTIVE at CLOSE). The P-36 gate, authored with the FIRST
 * per-tool client PR (#1735) per the platform SPEC.
 *
 * WHAT THIS ENFORCES
 * ------------------
 * Growth-tool run results (grader reports, forecasts, quotes, audits) live
 * ONLY in the React Query cache and component state of the Business app —
 * NEVER in a persisted zustand store. Server data inside a persisted store is
 * the COMMS-0136 / "Zustand persist IDs not records" violation class: it
 * outlives logout boundaries, leaks across brands, churns autosave, and
 * silently serves stale server truth as if it were fresh.
 *
 * Mechanically: NO file under `mingla-business/src/store/` may
 *   R-1  reference the growth-tools client modules (`growthToolsService`,
 *        `growthToolsKeys`, `useGrowthTools`) — value OR type import; a
 *        type-only import means a store is SHAPED to hold tool results,
 *        which is the same disease one commit earlier;
 *   R-2  reference the growth-tools report type namespace
 *        (GraderReport / GrowthToolRunResult / SubjectLatestResult /
 *        CompetitorWatchRow / GrowthToolsAppError);
 *   R-3  call a growth-tools edge function directly (a `growth-tools-`
 *        function-name literal) — the bypass that would dodge R-1 entirely.
 *
 * VACUITY GUARDS (a gate that observes nothing must FAIL, never pass):
 *   P-A  the guarded client modules exist on disk — if they move/rename, this
 *        gate must be repointed IN THE SAME PR, not left grepping for a name
 *        nothing uses;
 *   P-B  the store sweep observed a real store directory (≥ MIN_STORE_FILES
 *        files) — an empty result set proves nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const STORE_DIR = "mingla-business/src/store";
/** P-A — the guarded modules; their existence is asserted, never assumed. */
const GUARDED_MODULES = [
  "mingla-business/src/services/growthToolsService.ts",
  "mingla-business/src/hooks/growthToolsKeys.ts",
  "mingla-business/src/hooks/useGrowthTools.ts",
  "mingla-business/src/hooks/useTurnoutForecast.ts",
  "mingla-business/src/utils/turnoutInput.ts",
  "mingla-business/src/types/growthTools.ts",
];
/** P-B — src/store has 29 files at authoring time; a sweep seeing fewer than
 * this many did not walk the real directory. */
const MIN_STORE_FILES = 5;

/** R-1 — module references (import specifiers or bare identifiers). */
const MODULE_TOKENS = [
  ["growthToolsService", "the growth-tools service module"],
  ["growthToolsKeys", "the growth-tools query-key factory"],
  ["useGrowthTools", "the growth-tools hook family"],
  ["useTurnoutForecast", "the turnout forecast hook"],
  ["turnoutInput", "the canonical turnout input builder"],
];
/** R-2 — the report type namespace. */
const TYPE_TOKENS = [
  ["GraderReport", "the grader report type"],
  ["GrowthToolRunResult", "the run-result type"],
  ["SubjectLatestResult", "the latest-read result type"],
  ["CompetitorWatchRow", "the competitor watch row type"],
  ["GrowthToolsAppError", "the growth-tools error type"],
  ["TurnoutReport", "the turnout report type"],
  ["TurnoutCachedResult", "the turnout cached-result type"],
];
/** R-3 — direct edge-function invocation from a store. */
const FUNCTION_LITERAL = /["'`]growth-tools-/;

/** Comments stripped (`[^:]` keeps `https://` intact). */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * Pure, so the self-test can plant fixtures.
 *
 * @param {{rel:string, code:string}[]} storeFiles every file under src/store/
 * @param {Record<string, boolean>} guardedPresent module path -> exists
 * @returns {{code:number, messages:string[]}} 0 pass · 1 violation · 2 vacuous
 */
export function runGate(storeFiles, guardedPresent) {
  // ---- P-A: the guarded modules exist. ------------------------------------
  for (const mod of GUARDED_MODULES) {
    if (guardedPresent[mod] !== true) {
      return {
        code: 2,
        messages: [
          `#1734 tool-results gate FAIL — guarded module ${mod} is MISSING. ` +
            "If it legitimately moved/renamed, REPOINT this gate in the same " +
            "PR — a gate grepping for a name nothing uses enforces nothing.",
        ],
      };
    }
  }

  // ---- P-B: the sweep observed a real store directory. --------------------
  if (!Array.isArray(storeFiles) || storeFiles.length < MIN_STORE_FILES) {
    return {
      code: 2,
      messages: [
        `#1734 tool-results gate VACUOUS — the store sweep observed ` +
          `${Array.isArray(storeFiles) ? storeFiles.length : 0} files under ` +
          `${STORE_DIR} (minimum ${MIN_STORE_FILES}). An empty result set ` +
          "would report 'no store persists tool results' for a tree it never walked.",
      ],
    };
  }

  const failures = [];
  for (const file of storeFiles) {
    const code = stripComments(file.code);
    for (const [token, why] of MODULE_TOKENS) {
      if (code.includes(token)) {
        failures.push(
          `${file.rel}: references ${why} (\`${token}\`). Tool results live in ` +
            "the React Query cache ONLY — a persisted store must never import " +
            "the growth-tools client (COMMS-0136 class).",
        );
      }
    }
    for (const [token, why] of TYPE_TOKENS) {
      if (code.includes(token)) {
        failures.push(
          `${file.rel}: references ${why} (\`${token}\`). A store SHAPED to ` +
            "hold tool results is the same violation one commit earlier — " +
            "reports/forecasts/quotes/audits never enter persisted state.",
        );
      }
    }
    if (FUNCTION_LITERAL.test(code)) {
      failures.push(
        `${file.rel}: names a growth-tools edge function directly. Calling the ` +
          "engines from a store bypasses the service layer AND persists the " +
          "answer — both forbidden.",
      );
    }
  }

  if (failures.length > 0) {
    return {
      code: 1,
      messages: [
        "FAIL [I-PROPOSED-1734-TOOL-RESULTS-NEVER-PERSISTED-CLIENT-SIDE]:",
        ...failures.map((f) => `  x ${f}`),
      ],
    };
  }
  return {
    code: 0,
    messages: [
      `OK [I-PROPOSED-1734-TOOL-RESULTS-NEVER-PERSISTED-CLIENT-SIDE]: ` +
        `${storeFiles.length} store files swept; zero growth-tools module/type/` +
        "function references; guarded modules present.",
    ],
  };
}

const TURNOUT_INPUT_OWNER = "mingla-business/src/utils/turnoutInput.ts";
const TURNOUT_RUN_OWNER = "mingla-business/src/hooks/useTurnoutForecast.ts";

/** #1008 A9 — turnout payload construction and event runs stay single-owned. */
export function runTurnoutSingleSourceGate(clientFiles) {
  const failures = [];
  for (const file of clientFiles) {
    if (/\/__tests__\//.test(file.rel) || /\.test\./.test(file.rel)) continue;
    const code = stripComments(file.code);
    if (
      file.rel !== TURNOUT_INPUT_OWNER &&
      code.includes("stableStringify") &&
      code.includes("ticket_price")
    ) {
      failures.push(`${file.rel}: duplicates canonical turnout input/key construction.`);
    }
    if (
      file.rel !== TURNOUT_RUN_OWNER &&
      /runGrowthTool(?:<[^>]+>)?\s*\(\s*["']events["']/.test(code)
    ) {
      failures.push(`${file.rel}: starts an events engine run outside useTurnoutForecast.`);
    }
  }
  return {
    code: failures.length === 0 ? 0 : 1,
    messages: failures.length === 0
      ? ["OK [I-PROPOSED-1008-TURNOUT-INPUT-SINGLE-SOURCE]: one builder and one metered event-run owner."]
      : ["FAIL [I-PROPOSED-1008-TURNOUT-INPUT-SINGLE-SOURCE]:", ...failures.map((f) => `  x ${f}`)],
  };
}

// ---------------------------------------------------------------------------
// Disk I/O
// ---------------------------------------------------------------------------

function sweepStoreDir() {
  const out = [];
  const walk = (absDir, relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(absDir, entry.name), rel);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) continue;
      try {
        out.push({
          rel,
          code: fs.readFileSync(path.join(absDir, entry.name), "utf8"),
        });
      } catch {
        // Unreadable store file — surfaced via the count guard (P-B), and a
        // partial sweep below the floor hard-fails rather than passing.
      }
    }
  };
  walk(path.join(REPO_ROOT, STORE_DIR), STORE_DIR);
  return out;
}

function sweepBusinessClient() {
  const root = path.join(REPO_ROOT, "mingla-business/src");
  const out = [];
  const walk = (absDir, relDir) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, rel);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push({ rel, code: fs.readFileSync(abs, "utf8") });
      }
    }
  };
  walk(root, "mingla-business/src");
  return out;
}

function guardedModulesPresent() {
  const present = {};
  for (const mod of GUARDED_MODULES) {
    present[mod] = fs.existsSync(path.join(REPO_ROOT, mod));
  }
  return present;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

if (process.argv.includes("--self-test")) {
  const allPresent = Object.fromEntries(GUARDED_MODULES.map((m) => [m, true]));
  const cleanStores = () => [
    { rel: `${STORE_DIR}/draftEventStore.ts`, code: "export const a = 1;" },
    { rel: `${STORE_DIR}/draftVenueStore.ts`, code: "export const b = 2;" },
    { rel: `${STORE_DIR}/currentBrandStore.ts`, code: "export const c = 3;" },
    { rel: `${STORE_DIR}/venueSuiteStore.ts`, code: "export const d = 4;" },
    { rel: `${STORE_DIR}/orderStore.ts`, code: "export const e = 5;" },
  ];

  const problems = [];
  const expect = (label, got, want) => {
    if (got !== want) problems.push(`${label}: expected exit ${want}, got ${got}`);
  };

  // 1 — a clean store tree passes.
  expect("clean stores", runGate(cleanStores(), allPresent).code, 0);

  // 2 — a VALUE import of the service from a store FAILS (the headline case).
  {
    const stores = cleanStores();
    stores[0].code +=
      '\nimport { runGrowthTool } from "../services/growthToolsService";\n';
    const result = runGate(stores, allPresent);
    expect("service value import", result.code, 1);
    if (!result.messages.join("\n").includes("draftEventStore")) {
      problems.push("service-import failure did not name the offending store");
    }
  }

  // 3 — a TYPE-ONLY import fails too (a store shaped for results is the same
  //     violation one commit earlier).
  {
    const stores = cleanStores();
    stores[1].code +=
      '\nimport type { GraderReport } from "../services/growthToolsService";\n';
    expect("type-only import", runGate(stores, allPresent).code, 1);
  }

  // 4 — the key factory import fails.
  {
    const stores = cleanStores();
    stores[2].code +=
      '\nimport { growthToolsKeys } from "../hooks/growthToolsKeys";\n';
    expect("keys import", runGate(stores, allPresent).code, 1);
  }

  // 5 — a report-shaped field declaration fails (the type-namespace rule).
  {
    const stores = cleanStores();
    stores[3].code += "\ninterface S { lastReport: GrowthToolRunResult | null }\n";
    expect("report-shaped field", runGate(stores, allPresent).code, 1);
  }

  // 6 — a direct edge-function call from a store fails (the service bypass).
  {
    const stores = cleanStores();
    stores[4].code +=
      '\nconst r = await supabase.functions.invoke("growth-tools-run", {});\n';
    expect("direct function literal", runGate(stores, allPresent).code, 1);
  }

  // 7 — a commented-out reference does NOT fail (comment-stripped scan; a
  //     comment persists nothing).
  {
    const stores = cleanStores();
    stores[0].code += "\n// import { growthToolsKeys } from '../hooks/growthToolsKeys';\n";
    expect("comment-only reference", runGate(stores, allPresent).code, 0);
  }

  // 8 — turnout-specific report imports fail too.
  {
    const stores = cleanStores();
    stores[0].code +=
      '\nimport type { TurnoutCachedResult } from "../hooks/useTurnoutForecast";\n';
    expect("turnout result store import", runGate(stores, allPresent).code, 1);
  }

  // 9 — VACUITY: an empty/short sweep is a FAILURE, never a pass.
  expect("empty sweep", runGate([], allPresent).code, 2);
  expect(
    "short sweep",
    runGate(cleanStores().slice(0, 2), allPresent).code,
    2,
  );

  // 9 — VACUITY: a guarded module going missing (rename/move) hard-fails so
  //     the gate gets repointed instead of going dark.
  {
    const present = { ...allPresent };
    present["mingla-business/src/services/growthToolsService.ts"] = false;
    const result = runGate(cleanStores(), present);
    expect("guarded module missing", result.code, 2);
    if (!result.messages.join("\n").includes("REPOINT")) {
      problems.push("missing-module failure did not demand a repoint");
    }
  }

  const cleanClient = [
    { rel: TURNOUT_INPUT_OWNER, code: "const stableStringify = 1; const ticket_price = 0;" },
    { rel: TURNOUT_RUN_OWNER, code: 'runGrowthTool("events", brandId, input);' },
  ];
  expect("turnout single owners", runTurnoutSingleSourceGate(cleanClient).code, 0);
  expect(
    "duplicate turnout builder",
    runTurnoutSingleSourceGate([
      ...cleanClient,
      { rel: "mingla-business/src/utils/other.ts", code: "stableStringify({ ticket_price: 2 });" },
    ]).code,
    1,
  );
  expect(
    "duplicate turnout run",
    runTurnoutSingleSourceGate([
      ...cleanClient,
      { rel: "mingla-business/src/hooks/other.ts", code: 'runGrowthTool("events", id, input);' },
    ]).code,
    1,
  );

  if (problems.length > 0) {
    console.error("SELF-TEST FAIL:");
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }
  console.log(
    "#1734 tool-results-not-persisted gate self-test passed " +
      "(value/type/keys/field/function-literal all RED; comment-only clean; " +
      "empty sweep + missing guarded module both HARD FAIL).",
  );
  process.exit(0);
}

const storeResult = runGate(sweepStoreDir(), guardedModulesPresent());
const turnoutResult = runTurnoutSingleSourceGate(sweepBusinessClient());
const code = storeResult.code !== 0 ? storeResult.code : turnoutResult.code;
for (const message of [...storeResult.messages, ...turnoutResult.messages]) {
  if (code === 0) console.log(message);
  else console.error(message);
}
process.exit(code);
