// MINGLA-INVARIANT: I-ARI-TURN-METERED | issue #4637 | Every owner turn past the durable claim records the real prompt version, aggregate model usage, cost and phase timings, including terminal failures and deterministic zero-call lanes.

import {
  assert,
  assertEquals,
  assertObjectMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AriTurnMeter } from "../ariTurnMeter.ts";
import { GEMINI_PRICING_VERSION } from "../geminiModel.ts";
import {
  detectAriQualitySignals,
  recordAriTrainingTurn,
} from "../agentQuality.ts";

Deno.test("turn meter sums every model call and prices thinking as output", () => {
  let now = 1_000;
  const meter = new AriTurnMeter({ startedAtMs: now, now: () => now });
  meter.startPhase("intent");
  now += 120;
  meter.endPhase("intent");
  meter.markModelCallStarted();
  meter.addModelUsage({
    prompt_tokens: 1_000,
    completion_tokens: 200,
    total_tokens: 1_240,
    cached_input_tokens: 300,
    thinking_tokens: 40,
  });
  meter.markModelCallStarted();
  meter.addModelUsage({
    prompt_tokens: 500,
    completion_tokens: 100,
    total_tokens: 620,
    cached_input_tokens: 0,
    thinking_tokens: 20,
  });
  meter.markModelCallStarted();
  meter.addModelUsage({
    prompt_tokens: 250,
    completion_tokens: 50,
    total_tokens: 310,
    cached_input_tokens: 50,
    thinking_tokens: 10,
  });
  now += 80;
  meter.markFirstProgress();
  now += 300;
  meter.markAnswerReady();
  now += 5_200;
  meter.markFirstWordShown();
  meter.markRuntimeKey("ari-understand-first-3355");

  const snapshot = meter.snapshot({
    attemptStatus: "completed",
    runtimeKeys: ["loop_off", "ari-4637-w2-activity", "loop_off"],
  });

  assertObjectMatch(snapshot, {
    input_tokens: 1_750,
    output_tokens: 350,
    cached_input_tokens: 350,
    thinking_tokens: 70,
    model_calls: 3,
    // ceil(1750 * .75 + (350 + 70) * 3.75) microUSD
    estimated_cost_micros: 2_888,
    pricing_version: GEMINI_PRICING_VERSION,
    first_progress_ms: 200,
    answer_ready_ms: 500,
    first_word_shown_ms: 5_700,
    held_ms: 5_200,
    attempt_status: "completed",
  });
  assertEquals(snapshot.phase_ms, {
    claim_check: 0,
    commit: 0,
    context: 0,
    followup_call: 0,
    intent: 120,
    main_call: 0,
    pre_model: 0,
    tools: 0,
  });
  assertEquals(snapshot.runtime_keys, [
    "ari-4637-w2-activity",
    "ari-understand-first-3355",
    "loop_off",
  ]);
});

Deno.test("turn meter records deterministic and failed lanes honestly", () => {
  let now = 20_000;
  const deterministic = new AriTurnMeter({
    startedAtMs: now,
    now: () => now,
  });
  now += 45;
  const zero = deterministic.snapshot({ attemptStatus: "completed" });
  assertEquals(zero.model_calls, 0);
  assertEquals(zero.estimated_cost_micros, 0);
  assertEquals(zero.complete_ms, 45);
  assertEquals(zero.runtime_keys, ["loop_off"]);

  const failed = new AriTurnMeter({ startedAtMs: now, now: () => now });
  failed.markModelCallStarted();
  now += 25_000;
  const terminal = failed.snapshot({ attemptStatus: "failed" });
  assertEquals(terminal.model_calls, 1);
  assertEquals(terminal.attempt_status, "failed");
  assertEquals(terminal.complete_ms, 25_000);
  assertEquals(
    detectAriQualitySignals({
      userId: "fixture-user",
      conversationId: "fixture-conversation",
      userText: "Please help",
      assistantText: "Ari couldn't finish that turn. Try again.",
      attemptStatus: terminal.attempt_status,
    }).includes("turn_failed"),
    true,
  );
});

Deno.test("training archive persists every metering field on a failed turn", async () => {
  const inserted: Record<string, unknown> = {};
  const client = {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          inserted[table] = payload;
          return {
            select() {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: `${table}-fixture-id` },
                    error: null,
                  }),
              };
            },
          };
        },
      };
    },
  };

  await recordAriTrainingTurn(client as never, {
    userId: "fixture-user",
    conversationId: "fixture-conversation",
    userText: "Please help",
    assistantText: "The turn ended.",
    promptVersion: "ari-system-v43",
    modelVersion: "gemini-fixture",
    latencyMs: 890,
    inputTokens: 120,
    outputTokens: 30,
    cachedInputTokens: 40,
    thinkingTokens: 7,
    modelCalls: 3,
    estimatedCostMicros: 321,
    routeTier: "quick",
    streamMode: "none",
    runtimeKeys: ["loop_off"],
    phaseMs: { pre_model: 10, main_call: 500, commit: 25 },
    firstProgressMs: 15,
    firstTextMs: 700,
    completeMs: 890,
    pricingVersion: GEMINI_PRICING_VERSION,
    attemptStatus: "failed",
    answerReadyMs: 700,
    firstWordShownMs: 725,
    paceTier: "natural",
    heldMs: 25,
  });

  assertObjectMatch(
    inserted.ari_training_turns as Record<string, unknown>,
    {
      prompt_version: "ari-system-v43",
      input_tokens: 120,
      output_tokens: 30,
      cached_input_tokens: 40,
      thinking_tokens: 7,
      model_calls: 3,
      estimated_cost_micros: 321,
      route_tier: "quick",
      stream_mode: "none",
      runtime_keys: ["loop_off"],
      phase_ms: { pre_model: 10, main_call: 500, commit: 25 },
      first_progress_ms: 15,
      first_text_ms: 700,
      complete_ms: 890,
      pricing_version: GEMINI_PRICING_VERSION,
      attempt_status: "failed",
      answer_ready_ms: 700,
      first_word_shown_ms: 725,
      pace_tier: "natural",
      held_ms: 25,
    },
  );
  assert(inserted.ari_quality_cases, "failed turn must open a quality case");
});

Deno.test("agent-chat wires every current answer call through metering and deadlines", async () => {
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertEquals(chat.match(/await meteredAnswerCall\(\{/g)?.length, 3);
  assertEquals(chat.match(/await callGemini\(\{/g)?.length, 3);
  assertEquals(chat.match(/\bsignal,\s*\n\s*canRetry,/g)?.length, 3);
  assertEquals(chat.match(/callGeminiStructured\(\{/g)?.length, 2);
  assertStringIncludes(chat, 'errorCode: "MODEL_TIMEOUT"');
  assertEquals(
    chat.match(/^\s+"ACCEPTED_RESPONSE_FAILED",$/gm)?.length,
    3,
  );
  assertStringIncludes(chat, 'attemptStatus: "stopped"');
  assertStringIncludes(chat, "promptVersion: turnPromptVersion");
  assertStringIncludes(
    chat,
    'turnMeter.markRuntimeKey(useAgentLoop ? "loop_on" : "loop_off")',
  );
});

Deno.test("post-approval continuations add every model and tool phase to the originating turn", async () => {
  const [confirm, continuation, legacy] = await Promise.all([
    Deno.readTextFile(
      new URL("../../agent-confirm-action/index.ts", import.meta.url),
    ),
    Deno.readTextFile(new URL("../agentPostApproval.ts", import.meta.url)),
    Deno.readTextFile(
      new URL("../agentPostApprovalLegacy.ts", import.meta.url),
    ),
  ]);
  assertStringIncludes(
    confirm,
    '"add_ari_pending_action_turn_metering"',
  );
  assertStringIncludes(
    confirm,
    "origin_client_turn_id: pending.origin_client_turn_id",
  );
  assertStringIncludes(continuation, '"followup_call"');
  assertStringIncludes(continuation, '"claim_check"');
  assertStringIncludes(continuation, 'startPhase("tools")');
  assertStringIncludes(continuation, "meter?.addModelUsage(response.usage)");
  assertStringIncludes(legacy, '"followup_call"');
  assertStringIncludes(legacy, 'startPhase("tools")');
  assertStringIncludes(legacy, "meter?.addModelUsage(response.usage)");
});
