// Issue #4637 — one per-turn owner for model usage, spend and phase timings.
// The meter is intentionally provider-agnostic: callers feed it the usage
// returned by each model call, then persist one terminal snapshot.

import {
  GEMINI_INPUT_MICROUSD_PER_TOKEN,
  GEMINI_OUTPUT_MICROUSD_PER_TOKEN,
  GEMINI_PRICING_VERSION,
} from "./geminiModel.ts";
import type { GeminiUsage } from "./agentGemini.ts";

export type AriRouteTier = "quick" | "considered" | "deep";
export type AriStreamMode = "streamed" | "buffered" | "none";
export type AriAttemptStatus =
  | "completed"
  | "failed"
  | "stopped"
  | "reconciliation_required";

export interface AriTurnMeterSnapshot {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  thinking_tokens: number;
  model_calls: number;
  estimated_cost_micros: number;
  pricing_version: string;
  phase_ms: Record<string, number>;
  first_progress_ms: number | null;
  first_text_ms: number | null;
  complete_ms: number;
  route_tier: AriRouteTier;
  stream_mode: AriStreamMode;
  runtime_keys: string[];
  attempt_status: AriAttemptStatus;
  answer_ready_ms: number | null;
  first_word_shown_ms: number | null;
  pace_tier: string | null;
  held_ms: number;
}

interface AriTurnMeterOptions {
  startedAtMs?: number;
  now?: () => number;
}

const ARI_TURN_PHASES = [
  "pre_model",
  "intent",
  "context",
  "main_call",
  "tools",
  "followup_call",
  "claim_check",
  "commit",
] as const;

function nonnegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export class AriTurnMeter {
  private readonly startedAtMs: number;
  private readonly now: () => number;
  private inputTokens = 0;
  private outputTokens = 0;
  private cachedInputTokens = 0;
  private thinkingTokens = 0;
  private modelCalls = 0;
  private readonly phaseMs = new Map<string, number>();
  private readonly phaseStartedAt = new Map<string, number>();
  private firstProgressMs: number | null = null;
  private firstTextMs: number | null = null;
  private answerReadyMs: number | null = null;
  private firstWordShownMs: number | null = null;
  private paceTier: string | null = null;
  private readonly runtimeKeys = new Set<string>();

  constructor(options: AriTurnMeterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.startedAtMs = options.startedAtMs ?? this.now();
    for (const phase of ARI_TURN_PHASES) this.phaseMs.set(phase, 0);
  }

  markModelCallStarted(): void {
    this.modelCalls += 1;
  }

  addModelUsage(usage: GeminiUsage | null | undefined): void {
    this.inputTokens += nonnegativeInteger(usage?.prompt_tokens);
    this.outputTokens += nonnegativeInteger(usage?.completion_tokens);
    this.cachedInputTokens += nonnegativeInteger(usage?.cached_input_tokens);
    this.thinkingTokens += nonnegativeInteger(usage?.thinking_tokens);
  }

  startPhase(name: string): void {
    if (!name || this.phaseStartedAt.has(name)) return;
    this.phaseStartedAt.set(name, this.now());
  }

  endPhase(name: string): void {
    const started = this.phaseStartedAt.get(name);
    if (started === undefined) return;
    this.phaseStartedAt.delete(name);
    this.addPhase(name, this.now() - started);
  }

  addPhase(name: string, elapsedMs: number): void {
    if (!name) return;
    const duration = nonnegativeInteger(elapsedMs);
    this.phaseMs.set(name, (this.phaseMs.get(name) ?? 0) + duration);
  }

  markFirstProgress(): void {
    if (this.firstProgressMs === null) this.firstProgressMs = this.elapsed();
  }

  markFirstText(): void {
    if (this.firstTextMs === null) this.firstTextMs = this.elapsed();
  }

  markAnswerReady(): void {
    if (this.answerReadyMs === null) this.answerReadyMs = this.elapsed();
  }

  markFirstWordShown(): void {
    if (this.firstWordShownMs === null) {
      this.firstWordShownMs = this.elapsed();
    }
  }

  setPaceTier(tier: string | null): void {
    this.paceTier = tier?.trim() || null;
  }

  markRuntimeKey(key: string | null | undefined): void {
    const normalized = key?.trim();
    if (normalized) this.runtimeKeys.add(normalized);
  }

  snapshot(args: {
    attemptStatus: AriAttemptStatus;
    routeTier?: AriRouteTier;
    streamMode?: AriStreamMode;
    runtimeKeys?: readonly string[];
  }): AriTurnMeterSnapshot {
    for (const name of [...this.phaseStartedAt.keys()]) this.endPhase(name);
    const estimatedCostMicros = Math.ceil(
      this.inputTokens * GEMINI_INPUT_MICROUSD_PER_TOKEN +
        (this.outputTokens + this.thinkingTokens) *
          GEMINI_OUTPUT_MICROUSD_PER_TOKEN,
    );
    const answerReadyMs = this.answerReadyMs;
    const firstWordShownMs = this.firstWordShownMs;
    const runtimeKeys = new Set([
      ...this.runtimeKeys,
      ...(args.runtimeKeys ?? []),
    ]);
    if (!runtimeKeys.has("loop_on") && !runtimeKeys.has("loop_off")) {
      runtimeKeys.add("loop_off");
    }
    return {
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      cached_input_tokens: this.cachedInputTokens,
      thinking_tokens: this.thinkingTokens,
      model_calls: this.modelCalls,
      estimated_cost_micros: estimatedCostMicros,
      pricing_version: GEMINI_PRICING_VERSION,
      phase_ms: Object.fromEntries(
        [...this.phaseMs.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
      first_progress_ms: this.firstProgressMs,
      first_text_ms: this.firstTextMs,
      complete_ms: this.elapsed(),
      route_tier: args.routeTier ?? "quick",
      stream_mode: args.streamMode ?? "none",
      runtime_keys: [...runtimeKeys].sort(),
      attempt_status: args.attemptStatus,
      answer_ready_ms: answerReadyMs,
      first_word_shown_ms: firstWordShownMs,
      pace_tier: this.paceTier,
      held_ms: answerReadyMs !== null && firstWordShownMs !== null
        ? Math.max(0, firstWordShownMs - answerReadyMs)
        : 0,
    };
  }

  private elapsed(): number {
    return nonnegativeInteger(this.now() - this.startedAtMs);
  }
}
