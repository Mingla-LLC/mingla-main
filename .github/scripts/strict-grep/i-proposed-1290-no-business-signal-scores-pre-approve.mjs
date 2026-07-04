#!/usr/bin/env node
/**
 * META-ORCH-1290 [venue authoring: score-on-approve] —
 * I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE.
 *
 * RULE (D-2): the business authoring pipeline must NOT write
 * place_pool.ai_signal_scores at SUBMIT. `handleTier2` (the run_tier2_pipeline /
 * regenerate_sales_bio handler) runs the bio-DRAFT only; the 16-signal eval + the
 * ai_signal_scores write happen at APPROVE (the `evaluate_signals` action,
 * invoked service-to-service by admin-review-venue-claim). Reverting D-2 (re-
 * adding `ai_signal_scores: ...` to handleTier2's place_pool.update) re-
 * introduces pre-approval scoring for business-authored venues.
 *
 * META-ORCH-1290 D-2: business signal scores are computed at APPROVE, never at
 * authoring — reverting re-introduces pre-approval scoring / hides the pitch.
 *
 * Enforcement (over supabase/functions/run-business-place-authoring-pipeline/
 * index.ts, comment-stripped so a doc comment naming the token never counts):
 *   FAIL if the handleTier2 function body (sliced handleTier2 → the next handler
 *   handleConfirmAiOutputs) contains an `ai_signal_scores:` object key. The
 *   `evaluate_signals` handler (handleEvaluateSignals) DOES write
 *   ai_signal_scores — legitimately, at approve — but it lives AFTER
 *   handleConfirmAiOutputs, OUTSIDE this slice, so it never trips this gate.
 *
 * `--self-test`: GOOD = handleTier2 with bio-draft only (+ a later
 * evaluate_signals that writes scores). BAD = handleTier2 with
 * `ai_signal_scores: ...` restored → FAILS. Proves FAIL-on-revert.
 *
 * DRAFT until CLOSE (orchestrator flips
 * I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE ACTIVE).
 */
import fs from "node:fs";
import path from "node:path";

const PIPELINE_FILE = path.join(
  process.cwd(),
  "supabase/functions/run-business-place-authoring-pipeline/index.ts",
);

const SCORES_KEY_RE = /ai_signal_scores\s*:/;

function stripComments(src) {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

// Slice the handleTier2 function body: from its declaration to the next handler
// (handleConfirmAiOutputs). This scopes the gate to the SUBMIT handler and
// deliberately excludes the approve-time handleEvaluateSignals (which lives
// after handleConfirmAiOutputs and legitimately writes ai_signal_scores).
function sliceHandleTier2(src) {
  const start = src.indexOf("function handleTier2");
  if (start < 0) return null;
  const end = src.indexOf("function handleConfirmAiOutputs", start);
  return end > start ? src.slice(start, end) : src.slice(start);
}

function check(pipelineSrc, failures) {
  const src = stripComments(pipelineSrc);
  const slice = sliceHandleTier2(src);
  if (slice === null) {
    failures.push(
      "handleTier2 handler not found — the run_tier2_pipeline/regenerate_sales_bio " +
        "handler must exist so this gate can prove it writes no ai_signal_scores.",
    );
    return;
  }
  if (SCORES_KEY_RE.test(slice)) {
    failures.push(
      "handleTier2 writes ai_signal_scores at SUBMIT — META-ORCH-1290 D-2 forbids " +
        "pre-approve business signal scores. The 16-signal eval + ai_signal_scores " +
        "write belong to the approve-time evaluate_signals action.",
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: handleTier2 bio-draft only; evaluate_signals writes scores AFTER
  // handleConfirmAiOutputs (outside the slice) — must PASS.
  const good =
    "export async function handleTier2(client, brand, venue, body) {\n" +
    "  const g = await callGeminiForBioDraft({});\n" +
    "  await client.from('place_pool').update({ photo_analysis: g.photo_analysis }).eq('id', id);\n" +
    "}\n" +
    "export async function handleConfirmAiOutputs() {}\n" +
    "export async function handleEvaluateSignals(client, body) {\n" +
    "  await client.from('place_pool').update({ ai_signal_scores: scores }).eq('id', id);\n" +
    "}\n";
  let f = [];
  check(good, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD: handleTier2 restores the pre-approve ai_signal_scores write → FAIL.
  const bad =
    "export async function handleTier2(client, brand, venue, body) {\n" +
    "  await client.from('place_pool').update({ ai_signal_scores: aiSignalScores, photo_analysis }).eq('id', id);\n" +
    "}\n" +
    "export async function handleConfirmAiOutputs() {}\n";
  f = [];
  check(bad, f);
  if (f.length === 0) self.push("reverted pre-approve ai_signal_scores write not flagged");

  // GUARD: a comment naming the token in handleTier2 must NOT count (stripped).
  const commentOnly =
    "export async function handleTier2(client, brand, venue, body) {\n" +
    "  // D-2: ai_signal_scores: is NOT written here — deferred to approve.\n" +
    "  await client.from('place_pool').update({ photo_analysis }).eq('id', id);\n" +
    "}\n" +
    "export async function handleConfirmAiOutputs() {}\n";
  f = [];
  check(commentOnly, f);
  if (f.length) self.push("comment mention wrongly flagged: " + f.join("; "));

  // GUARD: missing handler → flagged (can't prove the invariant).
  f = [];
  check("export async function somethingElse() {}\n", f);
  if (f.length === 0) self.push("missing handleTier2 not flagged");

  if (self.length) {
    console.error("I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE self-test PASS (4/4 cases).",
  );
  process.exit(0);
}

if (!fs.existsSync(PIPELINE_FILE)) {
  console.error(
    `I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE FAIL — pipeline not found at ${PIPELINE_FILE}.`,
  );
  process.exit(1);
}

const failures = [];
check(fs.readFileSync(PIPELINE_FILE, "utf8"), failures);
if (failures.length > 0) {
  console.error(
    "I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE FAIL:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE PASS — handleTier2 runs " +
    "the bio-draft only; ai_signal_scores is written solely at approve (evaluate_signals).",
);
