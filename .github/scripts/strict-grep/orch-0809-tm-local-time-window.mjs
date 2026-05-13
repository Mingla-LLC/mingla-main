#!/usr/bin/env node
/**
 * ORCH-0809 strict-grep gate #3 — I-PROPOSED-BJ DISCOVER_TM_LOCAL_TIME_WINDOWS.
 *
 * Enforces that Discover date chips (Tonight, This Weekend, Next Week,
 * This Month) compute their Ticketmaster query window in the user's
 * device-local timezone and pass it via the `localStartEndDateTime`
 * parameter. UTC `startDateTime` / `endDateTime` paths are REMOVED
 * from the Discover query path.
 *
 * Five pattern checks (all must pass):
 *
 *   1. DiscoverScreen.tsx `getDateRange` function does not use the
 *      `toISOString()` UTC formatter (callers within the function body).
 *   2. DiscoverScreen.tsx does not contain the old `toISONoMs` UTC
 *      helper (renamed `toLocalISO` in M2).
 *   3. DiscoverScreen.tsx contains the `toLocalISO` helper inside
 *      `getDateRange` (the local-time formatter).
 *   4. ticketmaster-events/index.ts references `localStartEndDateTime`
 *      in the request handler AND in the TM URL builder (proves the
 *      param is wired end-to-end).
 *   5. ORCH-0809 M2.1 post-audit reinforcement: ticketmaster-events/index.ts
 *      contains the literal `"pass either city or location, not both"`
 *      rejection — the edge function must 400 on the both-location
 *      ambiguity instead of silently picking city-precedence (re-audit
 *      §13 recommendation).
 *
 * Codified by ORCH-0809 SPEC §9 Gate 3 + re-audit §13 recommendation.
 */

import { existsSync, readFileSync } from "node:fs";
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

const discoverSrc = readOrEmpty(DISCOVER_PATH);
const discoverCodeOnly = stripComments(discoverSrc);

// Extract the body of getDateRange so we only inspect callers inside it.
// Cannot use a naive `[^{]*\{` regex for the opening brace because the
// function's return type may itself contain `{` and `}` (e.g.
// `: { localStartEndDateTime: string | null }`). Instead: locate the
// `function getDateRange(` keyword, then walk forward skipping balanced
// brace pairs in the signature until we find the FIRST top-level `{`
// whose match goes through the entire function body.
function extractGetDateRangeBody(src) {
  const sigMatch = src.match(/function\s+getDateRange\s*\(/);
  if (!sigMatch) return "";
  // Walk from after the opening `(` to find the matching `)`.
  let i = sigMatch.index + sigMatch[0].length;
  let parenDepth = 1;
  while (i < src.length && parenDepth > 0) {
    if (src[i] === "(") parenDepth++;
    else if (src[i] === ")") parenDepth--;
    i++;
  }
  if (parenDepth !== 0) return "";
  // Now walk forward through the return type annotation (possibly containing
  // balanced `{}` pairs in object-literal types), stopping when we reach a
  // `{` whose balance returns the depth to zero — that's the function body's
  // opening brace. Strategy: skip balanced brace groups until we find an
  // UNBALANCED `{` (i.e. the function body brace).
  let braceDepth = 0;
  let bodyStart = -1;
  while (i < src.length) {
    const c = src[i];
    if (c === "{") {
      if (braceDepth === 0) {
        // Lookahead — is this a return-type object literal or the body?
        // We treat the LAST `{` before a non-whitespace, non-symbol token as
        // the body start. Simpler heuristic: walk through balanced braces
        // until we land on a `{` followed (after whitespace) by an
        // identifier or keyword that looks like a statement (const, let,
        // var, return, if, switch, for, while, throw, try, etc.).
        const peek = src.slice(i + 1).match(/^\s*(const|let|var|return|if|switch|for|while|throw|try|\/\/|\/\*|}\s*$)/);
        if (peek) {
          bodyStart = i + 1;
          break;
        }
        // Otherwise this is a return-type object literal — skip past it.
        braceDepth++;
      } else {
        braceDepth++;
      }
    } else if (c === "}") {
      if (braceDepth > 0) braceDepth--;
    }
    i++;
  }
  if (bodyStart < 0) return "";
  // From bodyStart, walk to find the matching closing brace.
  let depth = 1;
  let j = bodyStart;
  while (j < src.length && depth > 0) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") depth--;
    j++;
  }
  return src.slice(bodyStart, j - 1);
}

const getDateRangeBody = extractGetDateRangeBody(discoverCodeOnly);

// Check 1 — no toISOString() inside getDateRange body.
if (!getDateRangeBody) {
  failures.push(
    "Check 1 FAIL: getDateRange function body could not be located in DiscoverScreen.tsx. The function must exist and return { localStartEndDateTime } in local time (SPEC §5.7).",
  );
} else if (/\.toISOString\s*\(/.test(getDateRangeBody)) {
  failures.push(
    "Check 1 FAIL: DiscoverScreen.tsx getDateRange uses toISOString() — UTC date math is forbidden in the Discover query path. Switch to a local-time helper (SPEC §5.7 + I-PROPOSED-BJ).",
  );
}

// Check 2 — no toISONoMs helper.
if (discoverCodeOnly && /\btoISONoMs\b/.test(discoverCodeOnly)) {
  failures.push(
    "Check 2 FAIL: DiscoverScreen.tsx contains the toISONoMs helper. This UTC-format helper was replaced by toLocalISO in M2 (SPEC §5.7).",
  );
}

// Check 3 — toLocalISO helper present inside getDateRange.
if (getDateRangeBody && !/\btoLocalISO\b/.test(getDateRangeBody)) {
  failures.push(
    "Check 3 FAIL: DiscoverScreen.tsx getDateRange must define and use toLocalISO (the local-time YYYY-MM-DDTHH:mm:ss formatter without trailing Z) (SPEC §5.7).",
  );
}

// Check 4 — edge function wires localStartEndDateTime in handler + URL builder.
const edgeSrc = readOrEmpty(EDGE_FN_PATH);
const edgeCodeOnly = stripComments(edgeSrc);
// Count distinct semantic usages: at least one in handler destructure AND
// at least one in URL builder (params.set call).
const inHandler =
  /const\s*\{[^}]*localStartEndDateTime[^}]*\}\s*=\s*body/.test(edgeCodeOnly);
const inUrlBuilder =
  /params\.set\s*\(\s*["']localStartEndDateTime["']/.test(edgeCodeOnly);
if (!inHandler || !inUrlBuilder) {
  const missing = [];
  if (!inHandler) missing.push("request body destructure");
  if (!inUrlBuilder) missing.push("params.set on the TM URL");
  failures.push(
    `Check 4 FAIL: ticketmaster-events/index.ts is missing localStartEndDateTime wiring in: ${missing.join(" + ")}. The local-time pair must flow end-to-end through the edge function (SPEC §5.2).`,
  );
}

// Check 5 — edge function 400s on both city AND location (M2.1 reinforcement).
// Quote-agnostic phrase match with comments stripped (same approach as Gate 2 Check 7).
const edgeCodeOnlyForCheck5 = edgeSrc
  ? edgeSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
  : "";
if (
  edgeCodeOnlyForCheck5 &&
  !/pass either city or location, not both/.test(edgeCodeOnlyForCheck5)
) {
  failures.push(
    "Check 5 FAIL: ticketmaster-events/index.ts must reject `both city AND location` with HTTP 400 containing the phrase `pass either city or location, not both`. This is the M2.1 server-boundary guard preventing silent city-precedence (re-audit §13).",
  );
}

if (failures.length > 0) {
  console.error("ORCH-0809 Gate 3 (tm-local-time-window) FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0809 Gate 3 (tm-local-time-window) PASS — 5/5 checks.");
