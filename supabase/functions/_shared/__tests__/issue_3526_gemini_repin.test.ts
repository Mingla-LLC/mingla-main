// issue #3526 [Gemini repin] — IMPLEMENTOR happy-path regression suite.
//
// One test per defect the repin fixes. Each is written so that DELETING the
// product change (not commenting it out — a commented-out line still matches a
// source scan) makes it FAIL.
//
// APPEND-ONLY, IMMUTABLE: a new file on its own angle, not a renamed copy.
// The tester's adversarial suite attacks different angles by design.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  GEMINI_API_BASE,
  GEMINI_INPUT_USD_PER_TOKEN,
  GEMINI_MODEL_ID,
  GEMINI_OUTPUT_USD_PER_TOKEN,
  GEMINI_PRICING_VERSION,
  GEMINI_THINKING_LEVEL_MINIMAL,
  geminiErrorFingerprint,
  geminiGenerateContentUrl,
  parseGeminiErrorStatus,
} from "../geminiModel.ts";
import { computeCostUsdGemini, PRICING } from "../photoAestheticEnums.ts";
import {
  buildToolLeadFailure,
  FAILURE_DETAIL_MAX,
  markToolLeadFailed,
  type ProviderFailureSink,
  recordProviderFailure,
  scrubFailureDetail,
  type ToolLeadFailure,
} from "../toolLeadFailure.ts";
import { geminiProbeOk, matchClassBDepletion } from "../../api-health-probe/logic.ts";
// issue #3526 P1-R1 — the cost model is asserted at RUNTIME, not as source text.
import { buildCostModel } from "../../run-place-intelligence-trial/index.ts";

// The Gemini 2.x parameter this change removes. ASSEMBLED at runtime, never
// written as one literal: gate G-3 fails any file under supabase/functions/
// that names it, and a test asserting its absence must not be the one file that
// re-introduces it. (Comments are stripped by the gate, so prose is safe.)
const LEGACY_THINKING_PARAM = "thinking" + "Budget";

const HERE = new URL(".", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, HERE));

// The real 404 body Google returned on 2026-09-21, quoted from function_logs.
const RETIREMENT_404 = JSON.stringify({
  error: {
    code: 404,
    status: "NOT_FOUND",
    message:
      "This model models/gemini-2.5-flash is no longer available to new users. " +
      "Please update your code to use models/gemini-3.6-flash for the latest features.",
  },
});

// ─── DEFECT 1: the model id had ten owners ──────────────────────────────────
// Revert lever: re-introduce a raw literal at any call site, or change the
// constant without the migration. Both are covered by the CI gate
// i-3526-gemini-model-single-source.mjs (G-1/G-2) and its --self-test.
Deno.test("#3526 the model id is a Gemini 3 flash model and every URL is built from it", () => {
  assert(
    /^gemini-3\.\d+-flash$/.test(GEMINI_MODEL_ID),
    `GEMINI_MODEL_ID must be a Gemini 3 flash model, got "${GEMINI_MODEL_ID}"`,
  );
  assertEquals(
    geminiGenerateContentUrl(),
    `${GEMINI_API_BASE}/${GEMINI_MODEL_ID}:generateContent`,
  );
  // The pricing version must NAME the model it prices, or a stored
  // actual_microusd cannot be attributed to a rate card.
  assertStringIncludes(GEMINI_PRICING_VERSION, GEMINI_MODEL_ID);
});

Deno.test("#3526 competitor-intel-worker builds its URL from the shared constants, not a literal", () => {
  // THE trap: :1490 hardcoded `.../models/gemini-2.5-flash:generateContent` and
  // ignored its own GEMINI_MODEL_ID fifteen hundred lines above, so repinning
  // the constant alone left the worker calling the retired model.
  const src = read("../../competitor-intel-worker/index.ts");
  assertStringIncludes(
    src,
    "`${GEMINI_API_BASE}/${GEMINI_MODEL_ID}:generateContent?key=${",
  );
  // Belt: no hyphenated model literal survives in the worker's active code.
  const code = src.replace(/\/\/[^\n]*/g, "");
  assertEquals(/gemini-\d+\.\d+-flash/.test(code), false);
});

// ─── DEFECT 2: the Gemini 2.x thinking parameter does not exist on Gemini 3 ──
//
// issue #3526 P1-2 — the FIRST version of this test wrote its own list of six
// sender files. All six passed; the four public growth tools and the health
// probe were not in the list, so the assertion in the test's own NAME could not
// fail for them — and it did not, while four senders shipped with no thinking
// config at all. That is the unfalsifiable-test shape
// (feedback_unfalsifiable_test_bug_class.md) and the same failure mode that put
// three P0s past 12,500 passing tests on #3429.
//
// The sender set is DERIVED from the tree now: any non-test file under
// supabase/functions/ that both builds a `:generateContent` URL and sends a
// `generationConfig`. The derivation is itself guarded below so it cannot pass
// vacuously, and it is proven by adding a synthetic sender with no thinking
// config and watching this test fail.

/** Walk supabase/functions/ for .ts files, excluding tests. */
function allFunctionSources(): Array<{ path: string; source: string }> {
  const root = new URL("../../", HERE);
  const out: Array<{ path: string; source: string }> = [];
  const walk = (dir: URL, rel: string) => {
    for (const entry of Deno.readDirSync(dir)) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        walk(new URL(`${entry.name}/`, dir), childRel);
      } else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
        out.push({
          path: childRel,
          source: Deno.readTextFileSync(new URL(entry.name, dir)),
        });
      }
    }
  };
  walk(root, "");
  return out;
}

/**
 * A file is a Gemini SENDER when it sends a `generationConfig` AND reaches the
 * Gemini generateContent endpoint.
 *
 * "Reaches the endpoint" is deliberately NOT "contains the literal
 * `:generateContent`" — most senders build the URL through
 * `geminiGenerateContentUrl()` or `GEMINI_API_BASE`, so a literal-only test
 * found 3 of 11 and would have been another scope authored to match the
 * implementation. It is "imports the single source, or names the literal",
 * which is exhaustive BY INTERLOCK: gate G-1 fails any file under
 * supabase/functions/ that carries its own model literal, so importing
 * _shared/geminiModel.ts is the only legal way to reach the endpoint. A sender
 * that evades this derivation has to fail G-1 to do it.
 */
export function deriveGeminiSenders(
  files: Array<{ path: string; source: string }>,
): string[] {
  return files
    .filter(({ path, source }) => {
      if (path === "_shared/geminiModel.ts") return false; // the source itself
      const code = source.replace(/\/\/[^\n]*/g, "");
      if (!/generationConfig\s*:/.test(code)) return false;
      return /:generateContent/.test(code) ||
        /from\s+["'][^"']*geminiModel\.ts["']/.test(code);
    })
    .map(({ path }) => path)
    .sort();
}

Deno.test("#3526 the sender derivation is not vacuous", () => {
  // If the derivation silently matched nothing, the test below would pass on an
  // empty set and guarantee nothing at all. Pin both ends: it must find the
  // real senders, and it must REJECT a file that only looks like one.
  const senders = deriveGeminiSenders(allFunctionSources());
  assert(
    senders.length >= 11,
    `expected the real sender set, derived ${senders.length}: ${senders.join(", ")}`,
  );
  for (
    const expected of [
      "_shared/agentGemini.ts",
      "competitor-intel-worker/index.ts",
      "growth-tools-run/index.ts",
      "run-place-intelligence-trial/index.ts",
      "api-health-probe/index.ts",
    ]
  ) {
    assert(senders.includes(expected), `derivation missed a known sender: ${expected}`);
  }
  // Negative controls — neither half alone makes a sender.
  assertEquals(
    deriveGeminiSenders([{ path: "x.ts", source: "const u = ':generateContent';" }]),
    [],
  );
  assertEquals(
    deriveGeminiSenders([{ path: "x.ts", source: "const g = { generationConfig: {} };" }]),
    [],
  );
  // The import route must count — that is how 8 of the 11 real senders reach
  // the endpoint, and keying on the literal alone found only 3.
  assertEquals(
    deriveGeminiSenders([{
      path: "x.ts",
      source: 'import { GEMINI_MODEL_ID } from "../_shared/geminiModel.ts";\n' +
        "const g = { generationConfig: { temperature: 0 } };",
    }]),
    ["x.ts"],
  );
  // And a comment-only mention is not a sender.
  assertEquals(
    deriveGeminiSenders([{
      path: "x.ts",
      source: "// :generateContent with a generationConfig\nconst a = 1;",
    }]),
    [],
  );
});

Deno.test("#3526 EVERY derived Gemini sender sets thinking_level and none sends the 2.x budget param", () => {
  const files = allFunctionSources();
  const senders = deriveGeminiSenders(files);
  const byPath = new Map(files.map((f) => [f.path, f.source]));

  const missingThinking: string[] = [];
  const legacyParam: string[] = [];
  for (const path of senders) {
    const code = (byPath.get(path) ?? "").replace(/\/\/[^\n]*/g, "");
    // COUNT, don't just detect. `growth-tools-run` builds TWO requests — an
    // ungrounded structured pass and a grounded competition pass — and a
    // presence check was satisfied by either one. Deleting the thinking line
    // from one of the two left this test green, which the fails-on-revert run
    // caught. Every generationConfig a sender builds must carry the level.
    const configs = (code.match(/generationConfig\s*:/g) ?? []).length;
    const levels =
      (code.match(/thinkingConfig:\s*\{\s*thinking_level:\s*GEMINI_THINKING_LEVEL_MINIMAL\s*\}/g) ?? [])
        .length;
    if (levels < configs) {
      missingThinking.push(`${path} (${levels}/${configs} requests)`);
    }
    if (new RegExp(LEGACY_THINKING_PARAM).test(code)) legacyParam.push(path);
  }

  assertEquals(
    missingThinking,
    [],
    `these Gemini senders set no thinking level, so a Gemini 3 model bills them ` +
      `at the default "medium" as output: ${missingThinking.join(", ")}`,
  );
  assertEquals(
    legacyParam,
    [],
    `these senders still name the Gemini 2.x thinking parameter, which a 3.x ` +
      `model ignores — silently restoring default thinking: ${legacyParam.join(", ")}`,
  );
  assertEquals(GEMINI_THINKING_LEVEL_MINIMAL, "minimal");
});

// ─── DEFECT 3: the cost model did not bill thinking tokens ──────────────────
// Revert lever: DELETE the `thinkingTokens` term from computeCostUsdGemini.
Deno.test("#3526 computeCostUsdGemini bills thinking tokens at the output rate", () => {
  const withoutThinking = computeCostUsdGemini({
    promptTokens: 4370,
    candidatesTokens: 906,
  });
  const withThinking = computeCostUsdGemini({
    promptTokens: 4370,
    candidatesTokens: 906,
    thinkingTokens: 500,
  });
  assert(
    withThinking > withoutThinking,
    `thinking tokens must raise the cost — got ${withThinking} vs ${withoutThinking}`,
  );
  // And by exactly the output rate, not some other rate.
  assertEquals(
    Math.round((withThinking - withoutThinking) * 1_000_000),
    Math.round(500 * GEMINI_OUTPUT_USD_PER_TOKEN * 1_000_000),
  );
  // Omitting the argument must not change any existing caller's result.
  assertEquals(
    computeCostUsdGemini({ promptTokens: 100, candidatesTokens: 10, thinkingTokens: 0 }),
    computeCostUsdGemini({ promptTokens: 100, candidatesTokens: 10 }),
  );
});

// Revert lever: rename the rates back to GEMINI_2_5_FLASH_* / restore 0.30/2.50.
Deno.test("#3526 the token rates are model-agnostic names sourced from geminiModel.ts", () => {
  assertEquals(PRICING.GEMINI_INPUT_PER_TOKEN, GEMINI_INPUT_USD_PER_TOKEN);
  assertEquals(PRICING.GEMINI_OUTPUT_PER_TOKEN, GEMINI_OUTPUT_USD_PER_TOKEN);
  // The rates MUST have moved off the 2.5-flash card, or every estimate
  // under-reports by 2.5x on input.
  assertEquals(GEMINI_INPUT_USD_PER_TOKEN, 0.75 / 1_000_000);
  assertEquals(GEMINI_OUTPUT_USD_PER_TOKEN, 3.75 / 1_000_000);
  for (const key of Object.keys(PRICING)) {
    assertEquals(
      /GEMINI_\d+_\d+_FLASH/.test(key),
      false,
      `PRICING.${key} carries a model version, so a model-name sweep cannot see it`,
    );
  }
});

// ─── DEFECT 4: a failed run never recorded WHY ──────────────────────────────
// Revert lever: change markToolLeadFailed back to `update({ status: "failed" })`.
Deno.test("#3526 a failed provider call persists a non-null failure reason", async () => {
  let captured: Record<string, unknown> | null = null;
  const stub = {
    from: (_table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_col: string, _val: string) => {
          captured = values;
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };

  // The provider refuses exactly as it did on 2026-09-21.
  const sink: ProviderFailureSink = { last: null };
  recordProviderFailure(sink, "generate", 404, RETIREMENT_404);
  await markToolLeadFailed(stub, "run-id", sink.last!, "[test]");

  assert(captured !== null, "the update never fired");
  const row = captured as unknown as { status: string; failure_reason: ToolLeadFailure };
  assertEquals(row.status, "failed");
  assert(
    row.failure_reason != null,
    "failure_reason is null — the row records THAT it failed and not WHY, " +
      "which is the exact defect that left #3526 unexplainable for four days",
  );
  assertEquals(row.failure_reason.http_status, 404);
  assertEquals(row.failure_reason.stage, "generate");
  assertStringIncludes(row.failure_reason.detail ?? "", "no longer available");
});

Deno.test("#3526 a config failure still carries a reason, and the detail is bounded and scrubbed", () => {
  const cfg = buildToolLeadFailure("config", null, "GEMINI_API_KEY not configured");
  assertEquals(cfg.http_status, null);
  assertEquals(cfg.stage, "config");
  assert(cfg.detail !== null, "even a non-HTTP failure must say why");

  // Bounded: an enormous provider body cannot bloat the row.
  const huge = buildToolLeadFailure("generate", 500, "x".repeat(5000));
  assertEquals(huge.detail!.length, FAILURE_DETAIL_MAX);

  // Scrubbed: nothing key-shaped survives, in either form.
  const leaky = scrubFailureDetail(
    "call to https://x/v1beta/models/m:generateContent?key=AIza.FIXTURE.REMOVED.BY.HISTORY.REWRITE failed",
  )!;
  assertEquals(/AIza[0-9A-Za-z_-]{10,}/.test(leaky), false);
  assertStringIncludes(leaky, "[redacted]");
});

// Revert lever: restore a bare `.update({ status: "failed" })` in any tool.
Deno.test("#3526 no growth tool marks a run failed without a reason", () => {
  for (
    const rel of [
      "../../growth-tools-run/index.ts",
      "../../growth-tools-pricing/index.ts",
      "../../growth-tools-events/index.ts",
      "../../growth-tools-trips/index.ts",
    ]
  ) {
    const code = read(rel).replace(/\/\/[^\n]*/g, "");
    assertEquals(
      /update\(\s*\{\s*status:\s*"failed"\s*\}\s*\)/.test(code),
      false,
      `${rel} still writes a bare status:"failed" with no failure_reason`,
    );
    assertStringIncludes(code, "markToolLeadFailed(");
  }
});

// `growth-tools-report` DELIBERATELY does not read failure_reason yet.
//
// The spec's M-1 note says the report "should surface the real stage once the
// column exists". Doing so means adding failure_reason to APP_READ_COLUMNS,
// and that select-list is a SECURITY allowlist pinned by
// growth-tools-report/__tests__/issue_1734_app_read.test.ts
// (I-PROPOSED-1734-TOKEN-FLOW-UNTOUCHED), whose own comment warns that a
// widening "would sail past `includes` — the unfalsifiable-test class".
// Widening it is a decision for Seth and the tester, not an implementation
// detail, and no success criterion needs it: SC-6 is about PERSISTING the
// reason, which the column and the four write sites do. Raised on #3526.
//
// This test pins the deferral so it cannot happen by accident: the read path
// must expose NOTHING from failure_reason until that decision is made.
Deno.test("#3526 growth-tools-report leaks no part of failure_reason (deferred widening)", () => {
  const code = read("../../growth-tools-report/index.ts").replace(/\/\/[^\n]*/g, "");
  assertEquals(
    /failure_reason/.test(code),
    false,
    "growth-tools-report reads failure_reason — that widens the #1734 " +
      "APP_READ_COLUMNS security allowlist and needs an explicit decision first",
  );
});

// ─── DEFECT 5: the probe could not see a generation-time refusal ────────────
// Revert lever: change geminiProbeOk back to the ListModels shape
// (`Array.isArray(body?.models)`) — the ListModels case below then passes and
// the test fails.
Deno.test("#3526 probeGemini's verdict comes from a generation call, not a model list", () => {
  // The exact thing that happened: ListModels 200 while generation 404s.
  assertEquals(
    geminiProbeOk(true, JSON.parse('{"models":[{"name":"models/gemini-3.6-flash"}]}')),
    false,
    "a ListModels-shaped 200 must NOT read as healthy — it reported healthy " +
      "twenty minutes before a generation call 404'd",
  );
  // A real generation refusal.
  assertEquals(geminiProbeOk(false, JSON.parse(RETIREMENT_404)), false);
  // #1620 bodyVerdict: a 200 with no candidate is a failure, never healthy.
  assertEquals(geminiProbeOk(true, {}), false);
  assertEquals(geminiProbeOk(true, null), false);
  // The healthy case.
  assertEquals(geminiProbeOk(true, { candidates: [{ content: {} }] }), true);
});

// issue #3526 P2-5 — the verdict must not depend on a token budget.
Deno.test("#3526 a candidate-less 200 is judged on evidence, not on maxOutputTokens", () => {
  // THE FALSE RED: on Gemini 3 thinking counts against maxOutputTokens, so a
  // healthy API can answer 200 with no `candidates` key at all. The first
  // version read that as down and would have reddened the tile hourly.
  // Raising the budget narrows that window and cannot close it.
  assertEquals(
    geminiProbeOk(true, {
      modelVersion: "gemini-3.6-flash",
      usageMetadata: { promptTokenCount: 3, thoughtsTokenCount: 16, totalTokenCount: 19 },
    }),
    true,
    "a candidate-less 200 whose usage shows the model generated tokens is healthy",
  );
  assertEquals(
    geminiProbeOk(true, { candidates: [{ finishReason: "MAX_TOKENS" }] }),
    true,
    "finishReason MAX_TOKENS is the model saying it ran and hit the ceiling",
  );
  assertEquals(
    geminiProbeOk(true, { finishReason: "MAX_TOKENS" }),
    true,
    "the same signal at the top level counts too",
  );

  // …and NONE of that may become a way to pass on absence.
  assertEquals(
    geminiProbeOk(true, { modelVersion: "gemini-3.6-flash" }),
    false,
    "a modelVersion with no usage is not evidence the model ran",
  );
  assertEquals(
    geminiProbeOk(true, {
      usageMetadata: { promptTokenCount: 3, totalTokenCount: 19 },
    }),
    false,
    "usage with no modelVersion is not evidence either",
  );
  assertEquals(
    geminiProbeOk(true, {
      modelVersion: "gemini-3.6-flash",
      usageMetadata: { promptTokenCount: 3, totalTokenCount: 3 },
    }),
    false,
    "a total equal to the prompt means nothing was generated",
  );
  assertEquals(geminiProbeOk(true, { candidates: [] }), false);
  // The original false green stays rejected however it is dressed up.
  assertEquals(
    geminiProbeOk(true, {
      models: [{ name: "models/gemini-3.6-flash" }],
      modelVersion: "gemini-3.6-flash",
      usageMetadata: { promptTokenCount: 1, totalTokenCount: 99 },
    }),
    false,
    "a ListModels-shaped body is never healthy, whatever else it carries",
  );
});

// issue #3526 P1-R1 — the admin holds NO dollar amount, including the
// typed-confirmation threshold, which was the last one.
Deno.test("#3526 the server publishes every dollar figure the admin renders", () => {
  // RUNTIME, not source text. The first version of this test asserted the
  // strings were present in the file — and the field names also appear in the
  // return-TYPE declaration, so deleting the actual value from the returned
  // object left the test green. Caught by the fails-on-revert run.
  const model = buildCostModel() as unknown as Record<string, unknown>;
  for (
    const field of [
      "per_place_cost_usd",
      "cost_guard_usd",
      "cost_drift_tolerance_usd_per_place",
      "cost_review_threshold_usd",
    ]
  ) {
    assert(
      typeof model[field] === "number" && Number(model[field]) > 0,
      `buildCostModel() must return a positive ${field}, got ${
        JSON.stringify(model[field])
      }. Every dollar figure the admin renders comes from here; a missing one ` +
        `means the client either blocks the run or invents the number again.`,
    );
  }
  // The drift tolerance is DERIVED from the rate, never typed independently.
  assertEquals(
    model.cost_drift_tolerance_usd_per_place,
    +(Number(model.per_place_cost_usd) * 0.25).toFixed(6),
  );
  // Both admin read paths carry it.
  const edge = read("../../run-place-intelligence-trial/index.ts");
  assertEquals((edge.match(/cost_model:\s*buildCostModel\(\)/g) ?? []).length, 2);
});

Deno.test("#3526 the probe actually posts a generateContent request for the pinned model", () => {
  const code = read("../../api-health-probe/index.ts").replace(/\/\/[^\n]*/g, "");
  assertStringIncludes(
    code,
    "`${GEMINI_API_BASE}/${GEMINI_MODEL_ID}:generateContent?key=${encodeURIComponent(key)}`",
  );
  assertStringIncludes(code, "geminiProbeOk(res.ok, body)");
  // The old list-only probe must be gone, not merely bypassed.
  assertEquals(
    /v1beta\/models\?key=/.test(code),
    false,
    "the ListModels probe is still present — it is structurally blind to a " +
      "generation-time refusal",
  );
});

// ─── DEFECT 6: 403 and 404 were unmatchable by the health monitor ───────────
// Revert lever: collapse the gemini CLASS_B_DEPLETION entry back to the single
// {429, RESOURCE_EXHAUSTED} matcher.
Deno.test("#3526 the health matcher sees a retirement and a refusal, not only a quota", () => {
  const at = "2026-09-21T16:22:26.000Z";
  const obs = (http: number, code: string) => [{
    http_status: http,
    error_code: code,
    error_text: null,
    observed_at: at,
  }];
  const gemini = {
    reactive: [
      { http: 429, field: "type" as const, match: "RESOURCE_EXHAUSTED", kind: "depletion" as const },
      { http: 403, field: "type" as const, match: "PERMISSION_DENIED", kind: "refusal" as const },
      { http: 404, field: "type" as const, match: "NOT_FOUND", kind: "retirement" as const },
    ],
  };

  // The 21-Sep failure. A retirement is NOT a depletion — mislabelling it sends
  // the next reader to check billing instead of the model pin.
  const retired = matchClassBDepletion(gemini, obs(404, "NOT_FOUND"));
  assertEquals(retired.depleted, true);
  assertEquals(retired.kind, "retirement");

  // The 17-Sep failure.
  assertEquals(matchClassBDepletion(gemini, obs(403, "PERMISSION_DENIED")).kind, "refusal");

  // The historical matcher still works, and still means depletion.
  assertEquals(matchClassBDepletion(gemini, obs(429, "RESOURCE_EXHAUSTED")).kind, "depletion");

  // A single-object signal (every other service) is untouched.
  const openai = { reactive: { http: 429, field: "type" as const, match: "insufficient_quota" } };
  assertEquals(matchClassBDepletion(openai, obs(429, "insufficient_quota")).depleted, true);
  assertEquals(matchClassBDepletion(openai, obs(429, "rate_limit_exceeded")).depleted, false);
  // No fabrication: an unmatched status stays clean.
  assertEquals(matchClassBDepletion(gemini, obs(500, "INTERNAL")).depleted, false);
  assertEquals(matchClassBDepletion(gemini, obs(500, "INTERNAL")).kind, null);
});

// Revert lever: restore the `if (response.status === 429)` guard around the
// fingerprint so a 403/404 records error_code = null and cannot be matched.
Deno.test("#3526 a refusal fingerprint is captured for every status, not only 429", () => {
  assertEquals(parseGeminiErrorStatus(RETIREMENT_404), "NOT_FOUND");
  assertEquals(geminiErrorFingerprint(404, RETIREMENT_404)?.code, "NOT_FOUND");
  assertEquals(
    geminiErrorFingerprint(403, '{"error":{"status":"PERMISSION_DENIED"}}')?.code,
    "PERMISSION_DENIED",
  );
  // The historical 429 default survives even on a non-JSON body.
  assertEquals(geminiErrorFingerprint(429, "<html>429</html>")?.code, "RESOURCE_EXHAUSTED");
  assertEquals(parseGeminiErrorStatus("<html>nope</html>"), null);

  for (
    const rel of ["../agentGemini.ts", "../geminiMenuParser.ts", "../geminiActivitiesParser.ts"]
  ) {
    const code = read(rel).replace(/\/\/[^\n]*/g, "");
    assertStringIncludes(code, "geminiErrorFingerprint(");
    assertEquals(
      /status === 429/.test(code),
      false,
      `${rel} still fingerprints only 429 — a 403 or 404 would record ` +
        `error_code = null and be unmatchable`,
    );
  }
});

// ─── DEFECT 7: half the Gemini surface never reported at all ────────────────
// Revert lever: delete the recordApiCall call from any of these files.
Deno.test("#3526 every Gemini caller reports to the health tables", () => {
  for (
    const rel of [
      "../geminiActivitiesParser.ts",
      "../../growth-tools-run/index.ts",
      "../../growth-tools-pricing/index.ts",
      "../../growth-tools-events/index.ts",
      "../../growth-tools-trips/index.ts",
      "../../competitor-intel-worker/index.ts",
      "../../run-place-intelligence-trial/index.ts",
      "../../run-business-place-authoring-pipeline/index.ts",
    ]
  ) {
    const code = read(rel).replace(/\/\/[^\n]*/g, "");
    assert(
      /recordApiCall\(\s*"gemini"/.test(code),
      `${rel} records nothing — before #3526 the entire GEMINI_API_KEY surface ` +
        `was invisible to api_health_observations by construction`,
    );
    // Fire-and-forget: it must never be awaited into the host path.
    assertEquals(
      /(?<!void )\s await recordApiCall\(/.test(code),
      false,
      `${rel} awaits recordApiCall — it must stay void-prefixed`,
    );
  }
});

// ─── DEFECT 8: the failure log split status from detail ─────────────────────
// Revert lever: pass status and detail as separate console.error arguments.
Deno.test("#3526 a Gemini failure logs status and detail as ONE object", () => {
  for (
    const rel of [
      "../../growth-tools-run/index.ts",
      "../../growth-tools-pricing/index.ts",
      "../../growth-tools-events/index.ts",
      "../../growth-tools-trips/index.ts",
      "../../competitor-intel-worker/index.ts",
      "../../run-place-intelligence-trial/index.ts",
    ]
  ) {
    const code = read(rel).replace(/\/\/[^\n]*/g, "");
    assert(
      /status(:| =)/.test(code) && /detail: [a-zA-Z]+\.slice\(0, 200\)/.test(code),
      `${rel} must log { status, detail } together — as two console.error ` +
        `arguments a reader sees 404 and misses the sentence explaining it`,
    );
  }
});
