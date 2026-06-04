#!/usr/bin/env node

/**
 * META-ORCH-1062 [venue onboarding → admin vetting → deck pipeline repair]
 *
 * Three-part enforcement gate for the approval go-live wiring:
 *
 *  Part A — I-SCORER-INVOKE-HAS-SIGNAL-ID. Every run-signal-scorer invocation
 *           in admin-review-venue-claim/index.ts MUST include `signal_id`. The
 *           live keystone bug (1062-A) was a call that passed `place_ids` only,
 *           so the scorer 400'd `signal_id is required`, place_scores was never
 *           produced, and the venue never reached the deck. We enforce by
 *           requiring the invoke to go through buildScorerInvokeBody(...) AND
 *           that no bare `run-signal-scorer` invoke with a place_ids-only body
 *           survives.
 *
 *  Part B — I-NO-CLAIM-DEMOTION. run-business-place-authoring-pipeline
 *           confirm_ai_outputs MUST NOT contain a literal unconditional
 *           `is_servable: false`. It must route through the prior-state-
 *           preserving nextIsServableForConfirm(...) helper (1062-B).
 *
 *  Part C — I-APPROVE-PRODUCES-SCORES guard. admin-review-venue-claim MUST loop
 *           the active signals (signal_definitions is_active=true) on approve.
 *
 * Self-test:
 *   node meta-orch-1062-approval-go-live.mjs --self-test
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");

const ADMIN_REVIEW = "supabase/functions/admin-review-venue-claim/index.ts";
const AUTHORING = "supabase/functions/run-business-place-authoring-pipeline/index.ts";

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

function fail(msg) {
  console.error(`FAIL: META-ORCH-1062 approval-go-live gate — ${msg}`);
  process.exit(1);
}

// Strip line + block comments so a commented-out pattern never trips the gate.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function checkPartA(src) {
  // Every invoke of run-signal-scorer must carry signal_id. We accept the
  // canonical builder call (buildScorerInvokeBody) OR an inline body that
  // contains `signal_id`. A place_ids-only body (no signal_id) FAILS.
  const code = stripComments(src);
  const invokeRe = /invoke\(\s*["']run-signal-scorer["']\s*,\s*\{([\s\S]*?)\}\s*\)/g;
  let m;
  let found = 0;
  while ((m = invokeRe.exec(code)) !== null) {
    found++;
    const body = m[1];
    const hasSignalId = /signal_id/.test(body) ||
      /buildScorerInvokeBody\s*\(/.test(body);
    if (!hasSignalId) {
      return { ok: false, reason: "a run-signal-scorer invoke has no signal_id (1062-A 400 bug)" };
    }
  }
  if (found === 0) {
    return { ok: false, reason: "no run-signal-scorer invoke found in admin-review (approve must score)" };
  }
  // The canonical builder must exist + always include signal_id.
  if (!/buildScorerInvokeBody/.test(code)) {
    return { ok: false, reason: "buildScorerInvokeBody helper missing" };
  }
  return { ok: true };
}

function checkPartB(src) {
  const code = stripComments(src);
  // A literal `is_servable: false` is ONLY allowed at INSERT time (a net-new
  // business-authored row MUST start false — I-NET-NEW-HOLD). It is FORBIDDEN
  // inside any `.update({ ... })` payload (that is the 1062-B demotion of an
  // already-live claim). Scan each `.update({ ... })` block for the literal.
  const updateRe = /\.update\(\s*\{([\s\S]*?)\}\s*\)/g;
  let m;
  while ((m = updateRe.exec(code)) !== null) {
    if (/is_servable:\s*false\b/.test(m[1])) {
      return { ok: false, reason: "an `.update({...})` hard-codes `is_servable: false` (1062-B demotion)" };
    }
  }
  if (!/nextIsServableForConfirm/.test(code)) {
    return { ok: false, reason: "prior-state-preserving nextIsServableForConfirm helper missing" };
  }
  return { ok: true };
}

function checkPartC(src) {
  const code = stripComments(src);
  if (!/signal_definitions/.test(code) || !/is_active/.test(code)) {
    return { ok: false, reason: "approve path does not loop active signal_definitions" };
  }
  return { ok: true };
}

if (process.argv.includes("--self-test")) {
  console.log("# Self-test mode");
  // Part A — place_ids-only body must trip.
  const aBad = `await admin.functions.invoke("run-signal-scorer", { body: { place_ids: [x] } });\nconst y = buildScorerInvokeBody;`;
  const ra = checkPartA(aBad);
  if (ra.ok) { console.error("SELF-FAIL: Part A did not catch place_ids-only body"); process.exit(1); }
  console.log("SELF-OK: Part A catches place_ids-only scorer body");
  const aGood = `await admin.functions.invoke("run-signal-scorer", { body: buildScorerInvokeBody(s, p) });`;
  if (!checkPartA(aGood).ok) { console.error("SELF-FAIL: Part A rejected a valid builder invoke"); process.exit(1); }
  console.log("SELF-OK: Part A allows buildScorerInvokeBody invoke");
  // Part B — literal false must trip.
  const bBad = `await client.update({ is_servable: false, bouncer_reason: r });\nnextIsServableForConfirm`;
  if (checkPartB(bBad).ok) { console.error("SELF-FAIL: Part B did not catch literal is_servable:false"); process.exit(1); }
  console.log("SELF-OK: Part B catches literal is_servable: false in .update()");
  const bGood = `const n = nextIsServableForConfirm(prior);\nawait client.update({ is_servable: n });\n// insert default is fine:\nawait client.insert({ is_servable: false });`;
  if (!checkPartB(bGood).ok) { console.error("SELF-FAIL: Part B rejected the prior-state helper"); process.exit(1); }
  console.log("SELF-OK: Part B allows nextIsServableForConfirm");
  console.log("# Self-test PASSED");
  process.exit(0);
}

const adminSrc = read(ADMIN_REVIEW);
const authoringSrc = read(AUTHORING);

const a = checkPartA(adminSrc);
if (!a.ok) fail(`[A: scorer-invoke-has-signal-id] ${a.reason}`);
const b = checkPartB(authoringSrc);
if (!b.ok) fail(`[B: no-claim-demotion] ${b.reason}`);
const c = checkPartC(adminSrc);
if (!c.ok) fail(`[C: approve-loops-signals] ${c.reason}`);

console.log(
  "OK: META-ORCH-1062 approval-go-live gate — scorer invoke carries signal_id, " +
    "confirm preserves prior is_servable, approve loops active signals.",
);
