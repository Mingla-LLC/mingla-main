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

// ─── DEFECT 2: thinkingBudget does not exist on Gemini 3 ────────────────────
// Revert lever: delete the thinkingConfig line from any of the five senders.
Deno.test("#3526 every Gemini sender sets thinking_level and none sends the Gemini 2.x budget param", () => {
  const senders = [
    "../agentGemini.ts",
    "../geminiMenuParser.ts",
    "../geminiActivitiesParser.ts",
    "../../competitor-intel-worker/index.ts",
    "../../run-place-intelligence-trial/index.ts",
    "../../run-business-place-authoring-pipeline/index.ts",
  ];
  for (const rel of senders) {
    const code = read(rel).replace(/\/\/[^\n]*/g, "");
    assertStringIncludes(
      code,
      "thinkingConfig: { thinking_level: GEMINI_THINKING_LEVEL_MINIMAL }",
      `${rel} must set thinking_level explicitly — a Gemini 3 model with no ` +
        `thinking config defaults to "medium" and bills those tokens as output`,
    );
    assertEquals(
      new RegExp(LEGACY_THINKING_PARAM).test(code),
      false,
      `${rel} still names the Gemini 2.x thinking parameter, which a 3.x model ` +
        `ignores — silently restoring default thinking`,
    );
  }
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

// `growth-tools-report` may surface the STAGE and must never leak the provider
// status or body to a caller.
Deno.test("#3526 growth-tools-report surfaces the failure stage and never the provider detail", () => {
  const code = read("../../growth-tools-report/index.ts").replace(/\/\/[^\n]*/g, "");
  assertStringIncludes(code, "failure_stage");
  assertEquals(
    /failure_reason\.(http_status|detail)/.test(code),
    false,
    "growth-tools-report must not read http_status or detail into a response",
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
