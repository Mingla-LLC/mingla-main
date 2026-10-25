#!/usr/bin/env node
/**
 * ORCH-0809 strict-grep gate #3 — I-PROPOSED-BJ DISCOVER_TM_LOCAL_TIME_WINDOWS.
 *
 * Enforces that Discover date chips resolve their Ticketmaster window in the
 * selected city's timezone and pass it via `localStartEndDateTime`. The V2
 * server owns this math; the one-page client sends filter intent only.
 *
 * Five pattern checks (all must pass):
 *
 *   1. DiscoverScreen.tsx contains neither client window math nor the
 *      `localStartEndDateTime` transport field.
 *   2. The V2 handler asks the canonical SQL window helper with the selected
 *      supply/device timezone.
 *   3. The V2 handler formats returned instants as timezone-local wall clocks
 *      without a UTC `toISOString()` shortcut.
 *   4. The V2 pool sends `localStartEndDateTime` to ticketmaster-events, whose
 *      handler and URL builder still carry it end-to-end.
 *   5. ticketmaster-events rejects the both-location ambiguity instead of
 *      silently picking city precedence.
 *
 * Codified by ORCH-0809 SPEC §9 Gate 3 + re-audit §13 recommendation.
 * [TEST-MOD-APPROVED #4073] One-page Discover moved window ownership from the
 * retired client fetch rail to the canonical V2 server rail.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const DISCOVER_PATH = join(
  REPO_ROOT,
  "app-mobile",
  "src",
  "components",
  "DiscoverScreen.tsx",
);
const V2_HANDLER_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "discover-merged-events",
  "_v2_handler.ts",
);
const V2_POOL_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "discover-merged-events",
  "_v2_tm_pool.ts",
);
const EDGE_FN_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "ticketmaster-events",
  "index.ts",
);

const failures = [];

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function stripComments(s) {
  let out = s.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/\/\/[^\n]*/g, "");
  return out;
}

const discoverCodeOnly = stripComments(readOrEmpty(DISCOVER_PATH));
const v2HandlerCodeOnly = stripComments(readOrEmpty(V2_HANDLER_PATH));
const v2PoolCodeOnly = stripComments(readOrEmpty(V2_POOL_PATH));

// Check 1 — the one-page client sends intent; it does not own time windows.
if (/\b(getDateRange|toISONoMs|toLocalISO|localStartEndDateTime)\b/.test(discoverCodeOnly)) {
  failures.push(
    "Check 1 FAIL: DiscoverScreen.tsx must send date-filter intent only; V2 server code owns localStartEndDateTime math (issue #4073).",
  );
}

// Check 2 — the V2 handler resolves the canonical SQL window in city time.
if (!/client\.rpc\(\s*["']discover_v2_window["']\s*,\s*\{[^}]*p_tz\s*:\s*timezone[^}]*\}\s*\)/s.test(v2HandlerCodeOnly)) {
  failures.push(
    "Check 2 FAIL: _v2_handler.ts must call discover_v2_window with p_tz: timezone so city-local intent owns the Ticketmaster window.",
  );
}

// Check 3 — returned UTC instants are formatted into that city's wall clock.
const localWallBody = v2HandlerCodeOnly.match(
  /function\s+localWall\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/,
)?.[1] ?? "";
if (
  !localWallBody
  || !/Intl\.DateTimeFormat\(\s*["']en-CA["']\s*,\s*\{[^}]*timeZone\s*:\s*timezone/s.test(localWallBody)
  || /\.toISOString\s*\(/.test(localWallBody)
) {
  failures.push(
    "Check 3 FAIL: _v2_handler.ts localWall must format with Intl.DateTimeFormat({ timeZone: timezone }) and must not use toISOString().",
  );
}

// Check 4 — the V2 pool and Ticketmaster edge carry the wall-clock pair.
const edgeSrc = readOrEmpty(EDGE_FN_PATH);
const edgeCodeOnly = stripComments(edgeSrc);
const inV2Pool = /localStartEndDateTime\s*:\s*request\.localStartEndDateTime/.test(v2PoolCodeOnly);
const inHandler =
  /const\s*\{[^}]*localStartEndDateTime[^}]*\}\s*=\s*body/.test(edgeCodeOnly);
const inUrlBuilder =
  /params\.set\s*\(\s*["']localStartEndDateTime["']/.test(edgeCodeOnly);
if (!inV2Pool || !inHandler || !inUrlBuilder) {
  const missing = [];
  if (!inV2Pool) missing.push("V2 pool request");
  if (!inHandler) missing.push("request body destructure");
  if (!inUrlBuilder) missing.push("params.set on the TM URL");
  failures.push(
    `Check 4 FAIL: the V2 Ticketmaster path is missing localStartEndDateTime wiring in: ${missing.join(" + ")}. The city-local pair must flow end-to-end.`,
  );
}

// Check 5 — edge function 400s on both city AND location.
if (
  edgeCodeOnly
  && !/pass either city or location, not both/.test(edgeCodeOnly)
) {
  failures.push(
    "Check 5 FAIL: ticketmaster-events/index.ts must reject both city and location with the phrase \"pass either city or location, not both\".",
  );
}

if (failures.length > 0) {
  console.error("ORCH-0809 Gate 3 (tm-local-time-window) FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0809 Gate 3 (tm-local-time-window) PASS — 5/5 checks.");
