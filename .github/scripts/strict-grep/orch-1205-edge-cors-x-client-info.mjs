#!/usr/bin/env node
/**
 * ORCH-1205 — strict-grep gate: every Supabase edge function that DEFINES a CORS
 * `Access-Control-Allow-Headers` allow-list MUST include `x-client-info`.
 *
 * WHY: supabase-js attaches an `x-client-info` request header on EVERY call
 * (browser + native). A hardcoded inline allow-list that omits it causes the
 * browser CORS preflight (OPTIONS) to be REJECTED with net::ERR_FAILED, silently
 * breaking every fetch from business.usemingla.com to that function (this is the
 * exact ORCH-1205 bug: team/scanner invite list/send/accept/decline + the
 * beta-access lead form all died on web). The shared `_shared/cors.ts` allow-list
 * already includes `x-client-info`; importing it is the correct fix.
 *
 * RULE (structural anti-recurrence):
 *   For each `supabase/functions/<fn>/index.ts`, find every inline string literal
 *   for "Access-Control-Allow-Headers". If ANY such literal is present and does
 *   NOT contain "x-client-info" (case-insensitive), FAIL.
 *
 * EXEMPT (intentionally NOT a failure):
 *   - Functions that define NO inline Access-Control-Allow-Headers literal at all
 *     (they either import the shared cors.ts — which is correct — or do no CORS).
 *   - The shared module itself and test/helper files are not function entrypoints
 *     (only `index.ts` directly under a function dir is scanned).
 *
 * This is the structural fence: a future function that re-hardcodes
 * "authorization, apikey, content-type" (omitting x-client-info) fails CI.
 *
 * Self-test: `node orch-1205-edge-cors-x-client-info.mjs --self-test`
 * proves the gate FAILS on an omitting inline literal, PASSES on a compliant
 * inline literal, and PASSES on a shared-import (no inline literal) function.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

// Match every inline Access-Control-Allow-Headers value, whether on one line or
// wrapped across lines, capturing up to the line/object terminator.
const ALLOW_HEADERS_RE =
  /["']Access-Control-Allow-Headers["']\s*:\s*([\s\S]*?)(?:,\s*\n|\n\s*[}\]]|\})/gi;

/**
 * Scan one function's index.ts source. Returns an array of violation messages.
 * @param {string} relPath  path label for messages
 * @param {string} src      file contents
 */
function scanSource(relPath, src) {
  const violations = [];
  let m;
  ALLOW_HEADERS_RE.lastIndex = 0;
  while ((m = ALLOW_HEADERS_RE.exec(src)) !== null) {
    const value = m[1] ?? "";
    if (!/x-client-info/i.test(value)) {
      violations.push(
        `${relPath}: defines an inline Access-Control-Allow-Headers that OMITS ` +
          `x-client-info → supabase-js browser preflight will be rejected. ` +
          `Import { corsHeaders } from "../_shared/cors.ts" instead, or add ` +
          `"x-client-info" to the inline allow-list. Found: ${value.trim().replace(/\s+/g, " ").slice(0, 120)}`,
      );
    }
  }
  return violations;
}

/**
 * Walk supabase/functions/<fn>/index.ts files under rootDir.
 */
function functionIndexFiles(rootDir) {
  const functionsDir = path.join(rootDir, "supabase", "functions");
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(functionsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name === "_shared" || ent.name.startsWith("_")) continue;
    const idx = path.join(functionsDir, ent.name, "index.ts");
    if (fs.existsSync(idx)) out.push(idx);
  }
  return out;
}

function runGate(rootDir) {
  const failures = [];
  for (const file of functionIndexFiles(rootDir)) {
    let src;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    failures.push(...scanSource(path.relative(rootDir, file), src));
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const tmp = path.join("/tmp", "orch1205-selftest");
  fs.rmSync(tmp, { recursive: true, force: true });

  function writeFn(name, body) {
    const dir = path.join(tmp, "supabase", "functions", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.ts"), body);
  }

  // Case A — compliant inline allow-list (includes x-client-info): PASS.
  writeFn(
    "compliant-inline",
    `const corsHeaders = {\n  "Access-Control-Allow-Origin": "*",\n  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",\n  "Access-Control-Allow-Methods": "POST, OPTIONS",\n};\n`,
  );
  // Case B — shared import, NO inline literal: PASS (exempt).
  writeFn(
    "shared-import",
    `import { corsHeaders } from "../_shared/cors.ts";\nserve(() => new Response("ok", { headers: corsHeaders }));\n`,
  );

  let failures = runGate(tmp);
  if (failures.length !== 0) {
    console.error(
      "ORCH-1205 self-test FAIL: clean tree (compliant inline + shared import) reported failures:\n" +
        failures.join("\n"),
    );
    process.exit(1);
  }

  // Case C — the ORCH-1205 bug: inline allow-list OMITTING x-client-info: FAIL.
  writeFn(
    "bug-omits-xclientinfo",
    `const corsHeaders = {\n  "Access-Control-Allow-Origin": "*",\n  "Access-Control-Allow-Headers": "authorization, apikey, content-type",\n  "Access-Control-Allow-Methods": "POST, OPTIONS",\n};\n`,
  );
  failures = runGate(tmp);
  if (failures.length === 0) {
    console.error(
      "ORCH-1205 self-test FAIL: an inline allow-list omitting x-client-info did NOT trigger the gate",
    );
    process.exit(1);
  }
  if (!failures.some((f) => f.includes("bug-omits-xclientinfo"))) {
    console.error(
      "ORCH-1205 self-test FAIL: gate fired but not on the offending function:\n" +
        failures.join("\n"),
    );
    process.exit(1);
  }

  // Case D — multiline inline allow-list omitting x-client-info: FAIL.
  writeFn(
    "bug-omits-multiline",
    `function opts() {\n  return new Response("ok", {\n    headers: {\n      "Access-Control-Allow-Origin": "*",\n      "Access-Control-Allow-Methods": "POST, OPTIONS",\n      "Access-Control-Allow-Headers": "authorization, content-type",\n    },\n  });\n}\n`,
  );
  failures = runGate(tmp);
  if (!failures.some((f) => f.includes("bug-omits-multiline"))) {
    console.error(
      "ORCH-1205 self-test FAIL: multiline inline allow-list omitting x-client-info did NOT trigger:\n" +
        failures.join("\n"),
    );
    process.exit(1);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("ORCH-1205 gate self-test PASS (4/4 cases: A+B clean, C+D fail).");
  process.exit(0);
}

// ---- Live mode
const failures = runGate(root);
if (failures.length > 0) {
  console.error(
    `ORCH-1205 gate FAIL — ${failures.length} edge function(s) define a CORS ` +
      `allow-list that omits x-client-info:\n\n` +
      failures.join("\n") + "\n\n" +
      `supabase-js sends x-client-info on every request; an inline allow-list ` +
      `that omits it breaks the browser OPTIONS preflight (net::ERR_FAILED). ` +
      `Fix: import { corsHeaders } from "../_shared/cors.ts" (preferred) or add ` +
      `"x-client-info" to the inline Access-Control-Allow-Headers. See ORCH-1205.`,
  );
  process.exit(1);
}

console.log(
  "ORCH-1205 gate PASS — every edge function with an inline CORS allow-list includes x-client-info.",
);
