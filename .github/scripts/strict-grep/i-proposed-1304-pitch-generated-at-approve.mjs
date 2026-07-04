#!/usr/bin/env node
/**
 * ORCH-1304 [approve generates the pitch] —
 * I-PROPOSED-1304-PITCH-GENERATED-AT-APPROVE.
 *
 * RULE: the business venue pitch (place_pool.generative_summary) is generated at
 * APPROVE by the `evaluate_signals` handler (handleEvaluateSignals) — NOT by any
 * owner-side pre-approval affordance. This supersedes META-ORCH-1290 D-3 (which
 * had the owner self-draft the pitch before submit via "Generate pitch with AI").
 * Reverting ORCH-1304 (removing the approve-time bio-draft + generative_summary
 * write from handleEvaluateSignals) re-introduces owner-side pre-approval pitch
 * generation.
 *
 * ORCH-1304: the pitch is generated at APPROVE (only when empty — never clobber
 * an owner edit or a seeded summary). Reverting hides the auto-pitch behavior.
 *
 * Enforcement (over supabase/functions/run-business-place-authoring-pipeline/
 * index.ts, comment-stripped so a doc comment naming a token never counts):
 *   Slice the handleEvaluateSignals body (declaration → the trailing Deno.serve).
 *   FAIL unless that slice contains BOTH:
 *     (a) a `callGeminiForBioDraft(` call (the approve-time pitch draft), AND
 *     (b) a `generative_summary` key (written into the place_pool.update).
 *
 * `--self-test`: GOOD = handleEvaluateSignals that draughts the bio + writes
 * generative_summary. BAD = handleEvaluateSignals without them (D-3 reverted) →
 * FAILS. Proves FAIL-on-revert.
 *
 * DRAFT until CLOSE (orchestrator flips
 * I-PROPOSED-1304-PITCH-GENERATED-AT-APPROVE ACTIVE).
 */
import fs from "node:fs";
import path from "node:path";

const PIPELINE_FILE = path.join(
  process.cwd(),
  "supabase/functions/run-business-place-authoring-pipeline/index.ts",
);

const BIO_DRAFT_RE = /callGeminiForBioDraft\s*\(/;
const PITCH_KEY_RE = /generative_summary/;

function stripComments(src) {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

// Slice the handleEvaluateSignals body: from its declaration to the trailing
// Deno.serve (it is the last handler before the server). This scopes the gate to
// the APPROVE-time handler.
function sliceHandleEvaluateSignals(src) {
  const start = src.indexOf("function handleEvaluateSignals");
  if (start < 0) return null;
  const end = src.indexOf("Deno.serve", start);
  return end > start ? src.slice(start, end) : src.slice(start);
}

function check(pipelineSrc, failures) {
  const src = stripComments(pipelineSrc);
  const slice = sliceHandleEvaluateSignals(src);
  if (slice === null) {
    failures.push(
      "handleEvaluateSignals handler not found — the approve-time eval handler " +
        "must exist so this gate can prove it generates the pitch.",
    );
    return;
  }
  if (!BIO_DRAFT_RE.test(slice)) {
    failures.push(
      "handleEvaluateSignals does not call callGeminiForBioDraft — ORCH-1304 " +
        "requires the pitch to be drafted at APPROVE.",
    );
  }
  if (!PITCH_KEY_RE.test(slice)) {
    failures.push(
      "handleEvaluateSignals does not write generative_summary — ORCH-1304 " +
        "requires the approve-time bio to be written to place_pool.generative_summary.",
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: handleEvaluateSignals drafts the bio + writes generative_summary → PASS.
  const good =
    "export async function handleEvaluateSignals(client, body) {\n" +
    "  const scores = buildAiSignalScores(signals, gemini.evaluations, at);\n" +
    "  let generatedPitch = null;\n" +
    "  if (existingPitch.length === 0) {\n" +
    "    const d = await callGeminiForBioDraft({ brand, place, tier2, imageUrls, websiteText });\n" +
    "    if (d.bio.trim().length > 0) generatedPitch = d.bio.trim();\n" +
    "  }\n" +
    "  await client.from('place_pool').update({ ai_signal_scores: scores, ...(generatedPitch !== null ? { generative_summary: generatedPitch } : {}) }).eq('id', id);\n" +
    "}\n" +
    "Deno.serve(async (req) => {});\n";
  let f = [];
  check(good, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD: handleEvaluateSignals with NO bio-draft + NO generative_summary (D-3
  // reverted — owner writes the pitch pre-submit again) → FAIL.
  const bad =
    "export async function handleEvaluateSignals(client, body) {\n" +
    "  const scores = buildAiSignalScores(signals, gemini.evaluations, at);\n" +
    "  await client.from('place_pool').update({ ai_signal_scores: scores }).eq('id', id);\n" +
    "}\n" +
    "Deno.serve(async (req) => {});\n";
  f = [];
  check(bad, f);
  if (f.length === 0) self.push("reverted approve-time pitch-gen not flagged");

  // GUARD: comments naming the tokens must NOT count (stripped).
  const commentOnly =
    "export async function handleEvaluateSignals(client, body) {\n" +
    "  // callGeminiForBioDraft writes generative_summary — but not really here.\n" +
    "  await client.from('place_pool').update({ ai_signal_scores: scores }).eq('id', id);\n" +
    "}\n" +
    "Deno.serve(async (req) => {});\n";
  f = [];
  check(commentOnly, f);
  if (f.length === 0) self.push("comment-only mention wrongly passed (should FAIL)");

  // GUARD: missing handler → flagged.
  f = [];
  check("export async function somethingElse() {}\nDeno.serve(() => {});\n", f);
  if (f.length === 0) self.push("missing handleEvaluateSignals not flagged");

  if (self.length) {
    console.error("I-PROPOSED-1304-PITCH-GENERATED-AT-APPROVE self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-PROPOSED-1304-PITCH-GENERATED-AT-APPROVE self-test PASS (4/4 cases).",
  );
  process.exit(0);
}

if (!fs.existsSync(PIPELINE_FILE)) {
  console.error(
    `I-PROPOSED-1304-PITCH-GENERATED-AT-APPROVE FAIL — pipeline not found at ${PIPELINE_FILE}.`,
  );
  process.exit(1);
}

const failures = [];
check(fs.readFileSync(PIPELINE_FILE, "utf8"), failures);
if (failures.length > 0) {
  console.error(
    "I-PROPOSED-1304-PITCH-GENERATED-AT-APPROVE FAIL:\n  " + failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "I-PROPOSED-1304-PITCH-GENERATED-AT-APPROVE PASS — handleEvaluateSignals drafts " +
    "the pitch at approve and writes place_pool.generative_summary.",
);
