// Issue #3355 — deterministic quality detection and the independent sanitised
// improvement archive. No raw transcript is copied into these tables.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sanitizeAriText, sanitizeAriValue } from "./agentSanitization.ts";

export type AriQualitySignal =
  | "generic_error"
  | "tool_failure"
  | "repeated_request"
  | "unsupported_capability"
  | "unverified_claim"
  | "missing_citation"
  | "excessive_latency"
  | "loop_budget_exhausted"
  | "negative_feedback"
  | "intent_mismatch"
  | "presentation_defect";

export interface AriQualityInput {
  userId: string;
  conversationId: string;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  userText: string;
  assistantText: string;
  toolTrace?: unknown[];
  promptVersion?: string | null;
  modelVersion?: string | null;
  capabilityIds?: string[];
  errorCodes?: string[];
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCostMicros?: number | null;
  loopBudgetExhausted?: boolean;
  researchExpected?: boolean;
  hasSources?: boolean;
  previousUserTexts?: string[];
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")
    .trim();
}

export function detectAriQualitySignals(
  input: AriQualityInput,
): AriQualitySignal[] {
  const signals = new Set<AriQualitySignal>();
  const answer = normalized(input.assistantText);
  const request = normalized(input.userText);
  if (
    /\b(something went wrong|having trouble|try again|unexpected error|could not complete)\b/
      .test(answer)
  ) signals.add("generic_error");
  if ((input.errorCodes?.length ?? 0) > 0) signals.add("tool_failure");
  if (
    /\b(i can(?:not|'t)|not available|not supported|unable to)\b/.test(answer)
  ) signals.add("unsupported_capability");
  if (
    /\b(done|published|sent|created successfully|completed)\b/.test(answer) &&
    (input.toolTrace?.length ?? 0) === 0
  ) signals.add("unverified_claim");
  if (input.researchExpected && !input.hasSources) {
    signals.add("missing_citation");
  }
  if ((input.latencyMs ?? 0) > 25_000) signals.add("excessive_latency");
  if (input.loopBudgetExhausted) signals.add("loop_budget_exhausted");
  if (
    /\b(no|wrong|that is not|you misunderstood|again|still not|bad answer)\b/
      .test(request)
  ) signals.add("negative_feedback");
  // A narrow, high-confidence detector for a damaging routing failure found
  // during #3355's Harmattan pass: ordinary business-planning language was
  // mistaken for an entertainment "show" and Ari asked for an event date.
  // Keep this asymmetric so a real event-planning request is never flagged.
  const asksForBusinessPlan =
    /\b(plan|strategy|improv(?:e|ing|ement)|grow|growth|marketing|sales|operations)\b/
      .test(request);
  const asksForListing =
    /\b(event|trip|experience|rsvp|concert|party|dinner|listing)\b/.test(
      request,
    ) || /\b(?:live|stage|comedy|fashion) show\b/.test(request);
  const answersWithEventIntake =
    /\b(event direction|future date and time|what date and time|start date and time)\b/
      .test(answer);
  if (asksForBusinessPlan && !asksForListing && answersWithEventIntake) {
    signals.add("intent_mismatch");
  }
  if (/(^|\n)\s*(?:#{1,6}\s|```|\*\*)/.test(input.assistantText)) {
    signals.add("presentation_defect");
  }
  if (
    request.length > 12 &&
    (input.previousUserTexts ?? []).some((value) =>
      normalized(value) === request
    )
  ) signals.add("repeated_request");
  return [...signals];
}

const SIGNAL_TITLE: Record<AriQualitySignal, string> = {
  generic_error: "Ari ended with a generic error",
  tool_failure: "Ari encountered a tool failure",
  repeated_request: "The user had to repeat the request",
  unsupported_capability: "Ari reported a capability gap",
  unverified_claim: "Ari claimed success without a readback",
  missing_citation: "Research answer had no usable sources",
  excessive_latency: "Ari took too long to complete the turn",
  loop_budget_exhausted: "Ari exhausted its bounded work budget",
  negative_feedback: "The user corrected Ari",
  intent_mismatch: "Ari pursued the wrong goal",
  presentation_defect: "Ari emitted a presentation defect",
};

function stableGapHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function inferAriCapabilityGap(userText: string): {
  capabilityKey: string;
  title: string;
  description: string;
  exampleRequest: string;
} {
  const sanitized = sanitizeAriText(userText).text.slice(0, 800);
  const request = normalized(sanitized);
  const known: Array<[RegExp, string, string]> = [
    [
      /\b(instagram|tiktok|youtube|twitter|social profile|social media)\b/,
      "research.public_social",
      "Read and compare public social profiles",
    ],
    [
      /\b(browser|research|website|web page|online|public document)\b/,
      "research.public_web",
      "Research the public web with citations",
    ],
    [
      /\b(voice note|audio|video|flyer|document|pdf|image)\b/,
      "media.multimodal_intake",
      "Understand supplied media and documents",
    ],
    [
      /\b(onboard|set up my business|launch my business|launch my brand)\b/,
      "onboarding.end_to_end",
      "Complete host onboarding from supplied materials",
    ],
  ];
  const match = known.find(([pattern]) => pattern.test(request));
  const capabilityKey = match?.[1] ?? `request.${stableGapHash(request)}`;
  const title = match?.[2] ??
    "Support a repeated host request Ari cannot complete";
  return {
    capabilityKey,
    title,
    description:
      "Observed when Ari explicitly reported that the requested capability was unavailable.",
    exampleRequest: sanitized,
  };
}

function severityFor(
  signals: readonly AriQualitySignal[],
): "low" | "medium" | "high" | "critical" {
  if (signals.includes("unverified_claim")) return "high";
  if (
    signals.includes("tool_failure") || signals.includes("repeated_request") ||
    signals.includes("loop_budget_exhausted") ||
    signals.includes("intent_mismatch")
  ) return "high";
  if (
    signals.includes("generic_error") ||
    signals.includes("unsupported_capability")
  ) return "medium";
  return "low";
}

export async function recordAriTrainingTurn(
  client: SupabaseClient,
  input: AriQualityInput,
): Promise<
  {
    trainingTurnId: string | null;
    caseId: string | null;
    signals: AriQualitySignal[];
  }
> {
  const user = sanitizeAriText(input.userText).text;
  const assistant = sanitizeAriText(input.assistantText).text;
  const trace = sanitizeAriValue(input.toolTrace ?? []);
  const signals = detectAriQualitySignals(input);
  const capabilityGap = signals.includes("unsupported_capability")
    ? inferAriCapabilityGap(input.userText)
    : null;
  const { data: turn, error: turnError } = await client.from(
    "ari_training_turns",
  ).insert({
    archive_conversation_key: input.conversationId,
    source_user_id: input.userId,
    source_conversation_id: input.conversationId,
    source_user_message_id: input.userMessageId ?? null,
    source_assistant_message_id: input.assistantMessageId ?? null,
    sanitized_user_text: user,
    sanitized_assistant_text: assistant,
    sanitized_tool_trace: trace,
    prompt_version: input.promptVersion ?? null,
    model_version: input.modelVersion ?? null,
    capability_ids: input.capabilityIds ?? [],
    signal_codes: signals,
    latency_ms: input.latencyMs ?? null,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    estimated_cost_micros: input.estimatedCostMicros ?? null,
  }).select("id").maybeSingle();
  if (turnError) {
    console.error(
      "[ari-quality] training turn insert failed",
      turnError.message,
    );
    return { trainingTurnId: null, caseId: null, signals };
  }
  const trainingTurnId = typeof turn?.id === "string" ? turn.id : null;
  if (signals.length === 0) return { trainingTurnId, caseId: null, signals };

  const title = SIGNAL_TITLE[signals[0]];
  const { data: qualityCase, error: caseError } = await client.from(
    "ari_quality_cases",
  ).insert({
    training_turn_id: trainingTurnId,
    source_user_id: input.userId,
    source_conversation_id: input.conversationId,
    title,
    redacted_summary: `${
      sanitizeAriText(input.userText).text.slice(0, 320)
    } — ${sanitizeAriText(input.assistantText).text.slice(0, 520)}`,
    sanitized_transcript: [
      { role: "user", text: user },
      { role: "assistant", text: assistant },
    ],
    signal_codes: signals,
    severity: severityFor(signals),
    tool_names: (input.toolTrace ?? []).map((entry) =>
      typeof entry === "object" && entry && "tool" in entry
        ? String((entry as { tool: unknown }).tool)
        : ""
    ).filter(Boolean),
    error_codes: input.errorCodes ?? [],
    capability_id: capabilityGap?.capabilityKey ?? null,
  }).select("id").maybeSingle();
  if (caseError) {
    console.error(
      "[ari-quality] quality case insert failed",
      caseError.message,
    );
  }
  const caseId = typeof qualityCase?.id === "string" ? qualityCase.id : null;
  if (capabilityGap) {
    const { error: gapError } = await client.rpc(
      "ari_record_capability_gap",
      {
        p_capability_key: capabilityGap.capabilityKey,
        p_title: capabilityGap.title,
        p_description: capabilityGap.description,
        p_example_request: capabilityGap.exampleRequest,
      },
    );
    if (gapError) {
      console.error(
        "[ari-quality] capability gap upsert failed",
        gapError.message,
      );
    }
  }
  return { trainingTurnId, caseId, signals };
}
