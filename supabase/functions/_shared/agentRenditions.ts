// Issue #3355 — server-authored progress, research, and receipt renditions.
//
// The client treats this JSON as untrusted and validates it against the
// versioned Ari rendition protocol before rendering. Keep this builder
// deterministic: models may choose tools and write prose, but they never get
// to manufacture routes, confirmation controls, or source URLs for the UI.

import type { AgentLoopObservation, AgentLoopResult } from "./agentLoop.ts";
import type { AriBrandLaunchPlan } from "./agentLaunchPlan.ts";
import { sanitizeAriPublicText } from "./agentSanitization.ts";
import { canonicalizePublicResearchUrl } from "./agentWebResearch.ts";
import { toolOwnerCopy } from "./ariPresentation/toolLabels.ts";
import { ownerCopyViolations } from "./ariOwnerCopy.ts";

type JsonRecord = Record<string, unknown>;

const TOOL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  search_capabilities: "Check Mingla capabilities",
  search_mingla_guide: "Check the Mingla guide",
  request_tools: "Load the right Mingla tools",
  search_public_web: "Search public sources",
  read_public_url: "Read the public page",
  inspect_public_social_profile: "Inspect the public social profile",
  fetch_public_listing_page: "Read the public listing",
  extract_listing_candidates: "Extract listing details",
  list_brands: "Read available brands",
  list_events: "Read current listings",
  get_operator_snapshot: "Read the business workspace",
  get_brand_readiness: "Read the brand checklist",
  get_onboarding_plan: "Read the saved onboarding plan",
  update_onboarding_plan: "Save onboarding progress",
  list_memory_notes: "Read approved business memory",
  remember_note: "Save a note for later",
  // #3355 ship-prep: the rollout switch's off path still offers origin/main's
  // memory write. [TRANSITIONAL] exit: rollout active at 100%.
  save_memory_note: "Save the approved preference",
  forget_memory_note: "Remove the saved preference",
  manage_agent_job: "Save task progress",
});

function safeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return sanitizeAriPublicText(value).text.replace(/\s+/g, " ").trim().slice(
    0,
    max,
  );
}

function displayText(value: unknown, max: number): string {
  return safeText(value, max)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function toolLabel(name: string): string {
  const fixed = TOOL_LABELS[name];
  if (fixed) return fixed;
  // #3355 P1 (D-5): owner words for a write, a neutral step for a read —
  // never the tool name with its underscores swapped for spaces.
  const write = toolOwnerCopy(name);
  return write.verb !== "Review this change"
    ? write.verb
    : "Check your workspace";
}

/**
 * #3355 rework 6 (R6-9): codes whose message is an instruction to the MODEL
 * (start the guided setup, call the tool for real, propose the host's own
 * target). They steer the next model turn; the host never reads them.
 *
 * MINGLA-INVARIANT: I-ARI-NO-MODEL-INSTRUCTION-IN-HOST-COPY | issue #3355 | No host-visible rendition text (plan card titles, timeline rows, blocker callouts, labels) carries a model instruction, an internal tool name or a snake_case key: model-steer observations ("reasoning" and the codes below) are never rendered, and any other error message that fails the owner-copy lint or reads as an instruction is replaced by a plain sentence (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_6.implementor.test.ts).
 */
export const ARI_MODEL_STEER_CODES: ReadonlySet<string> = new Set([
  "USE_GUIDED_SETUP",
  "TOOL_CALL_AS_TEXT",
  "WRITE_PROPOSAL_REQUIRED",
  "REQUESTED_TOOL_MISMATCH",
  "SETUP_ALREADY_HANDED_OFF",
  "QUESTION_STALE",
]);

/** Words that open an instruction to the model, not a sentence for a host. */
const MODEL_INSTRUCTION =
  /^(?:call|return|make\s+that|do\s+not|don['’]t|use|your\s+reply|the\s+(?:host|user|owner)\s+(?:asked|supplied|wants)|propose|remove|answer\s+the\s+owner)\b/i;

/** An observation that only steers the model (never shown to the host). */
export function isModelSteerObservation(
  observation: Pick<AgentLoopObservation, "tool" | "error">,
): boolean {
  if (observation.tool === "reasoning") return true;
  const code = safeText(
    (observation.error as { code?: unknown } | undefined)?.code,
    80,
  ).toUpperCase();
  return ARI_MODEL_STEER_CODES.has(code);
}

/** Raw diagnostic slugs belong in traces and the Improvement Lab, never UI. */
export function ariUserFacingToolError(
  error:
    | {
      code?: unknown;
      message?: unknown;
    }
    | null
    | undefined,
): string {
  const code = safeText(error?.code, 80).toUpperCase();
  const message = safeText(error?.message, 260);
  const signal = `${code} ${message.toUpperCase()}`;
  // R6-9: a model instruction is never a host sentence.
  if (ARI_MODEL_STEER_CODES.has(code)) {
    return "Ari needed another try at this step.";
  }
  if (signal.includes("RESEARCH_UNGROUNDED")) {
    return "No usable public sources were found for this search.";
  }
  if (
    signal.includes("RESEARCH_NOT_CONFIGURED") ||
    signal.includes("NOT_CONFIGURED")
  ) {
    return "Public research is not available in this environment yet.";
  }
  if (
    signal.includes("TIMEOUT") || signal.includes("UNAVAILABLE") ||
    signal.includes("HTTP_") || signal.includes("NETWORK")
  ) {
    return "The service needed for this step could not be reached.";
  }
  if (signal.includes("PERMISSION") || signal.includes("FORBIDDEN")) {
    return "Your current access does not allow this step.";
  }
  if (signal.includes("INVALID_ARGS") || signal.includes("REQUIRED")) {
    return "This step needs different or additional information.";
  }
  if (signal.includes("TURN_STOPPED")) return "This step was stopped.";
  if (message && !/^[A-Z][A-Z0-9_]*(?:\s*\([^)]*\))?$/.test(message)) {
    const plain = message.replace(/\s*\([A-Z][A-Z0-9_]*\)\s*$/g, "");
    if (
      ownerCopyViolations(plain, "prose").length === 0 &&
      !MODEL_INSTRUCTION.test(plain.trim()) &&
      !/\b(?:flow_key|start_flow|tool\s+call|function\s+call)\b/i.test(plain)
    ) {
      return plain;
    }
  }
  return "This step could not be completed yet.";
}

function sourceRows(observations: readonly AgentLoopObservation[]) {
  const raw: JsonRecord[] = [];
  for (const observation of observations) {
    const result = asRecord(observation.result);
    if (!result) continue;
    if (Array.isArray(result.sources)) {
      for (const source of result.sources) {
        const record = asRecord(source);
        if (record) raw.push(record);
      }
    }
    const source = asRecord(result.source);
    if (source) raw.push(source);
  }
  const seen = new Set<string>();
  return raw.flatMap((source, index) => {
    const url = safeText(source.url, 1000);
    if (!url || seen.has(url)) return [];
    let safeUrl: string;
    try {
      safeUrl = canonicalizePublicResearchUrl(url);
      const parsed = new URL(safeUrl);
      if (parsed.protocol !== "https:") return [];
    } catch {
      return [];
    }
    seen.add(safeUrl);
    const label = displayText(source.title, 120) || new URL(safeUrl).hostname;
    return [{
      id: `source-${index + 1}`,
      label,
      detail: safeText(source.source_type, 120) || "Public source",
      url: safeUrl,
      publisher: new URL(safeUrl).hostname,
      accessed_at: safeText(source.fetched_at, 80) || new Date().toISOString(),
    }];
  }).slice(0, 12);
}

function timelineRows(
  observations: readonly AgentLoopObservation[],
  result: AgentLoopResult,
) {
  // R6-9: a model-steer observation is not a step the host took.
  const rows = observations.filter((observation) =>
    !isModelSteerObservation(observation)
  ).slice(0, 9).map((observation, index) => ({
    id: `step-${index + 1}`,
    label: toolLabel(observation.tool),
    detail: observation.error
      ? ariUserFacingToolError(observation.error)
      : `Completed in ${Math.max(0, Math.round(observation.elapsedMs))} ms`,
    state: observation.error ? "active" : "done",
  }));
  if (result.kind === "proposal") {
    rows.push({
      id: "step-approval",
      label: "Review the change",
      detail: `${toolLabel(result.toolCall.name)} is ready for your approval.`,
      state: "active",
    });
    rows.push({
      id: "step-verify",
      label: "Check it saved",
      detail:
        "After you approve, Ari reads it back from Mingla before calling it done.",
      state: "queued",
    });
  } else if (result.kind === "stopped") {
    // #3355 P1 (D-7): no "saved checkpoint" claim — nothing is saved here.
    rows.push({
      id: "step-resume",
      label: "Carry on from here",
      detail: result.reason === "errors"
        ? "Fix what blocked this step, then ask Ari to try again."
        : "Say 'continue' and Ari carries on from this step.",
      state: "active",
    });
  }
  if (rows.length === 0) {
    rows.push({
      id: "step-response",
      label: "Answer the request",
      detail: "Ari answered from what it already knew.",
      state: "done",
    });
  }
  return rows.slice(0, 12);
}

function progressFor(result: AgentLoopResult): number {
  if (result.kind === "text") return 100;
  if (result.kind === "proposal" || result.kind === "flow_start") return 75;
  if (result.reason === "errors") return 55;
  return 70;
}

export function buildAgentRunRendition(input: {
  renditionId: string;
  goal: string;
  result: AgentLoopResult;
  plan?: AriBrandLaunchPlan;
}): JsonRecord {
  const observedSources = sourceRows(input.result.observations);
  const sources = input.plan
    ? observedSources.filter((source) =>
      input.plan?.sourceUrls.includes(String(source.url))
    )
    : observedSources;
  const hasResearch = input.result.observations.some((observation) =>
    [
      "search_public_web",
      "read_public_url",
      "inspect_public_social_profile",
      "fetch_public_listing_page",
    ].includes(observation.tool)
  );
  // R6-9: model-steer observations are the model's, never the host's.
  const failed = input.result.observations.filter((observation) =>
    observation.error && !isModelSteerObservation(observation)
  );
  const stoppedReason = input.result.kind === "stopped"
    ? input.result.reason
    : null;
  const stopped = stoppedReason !== null;
  const title = input.plan?.title ??
    (input.result.kind === "proposal"
      ? "The next action is ready"
      : stopped
      ? stoppedReason === "errors"
        ? "Ari reached a clear blocker"
        // #3355 P1 (D-7): never "saved and ready to resume" — nothing was saved.
        : "Ari stopped here"
      : hasResearch
      ? "Here's what Ari found"
      // #3355 P1 (D-15): an answer is not a completed plan.
      : "Here's Ari's answer");
  const planCompleted =
    input.plan?.steps.filter((step) => step.state === "done").length ?? 0;
  const planProgress = input.plan
    ? Math.round((planCompleted / Math.max(1, input.plan.steps.length)) * 100)
    : progressFor(input.result);
  const blocks: JsonRecord[] = [
    {
      type: "timeline",
      version: 1,
      id: "plan-steps",
      items: input.plan?.steps ??
        timelineRows(input.result.observations, input.result),
    },
    {
      type: "progress",
      version: 1,
      id: "plan-progress",
      value: planProgress,
      label: input.plan
        ? "Plan ready for review"
        : input.result.kind === "proposal"
        ? "Waiting for your approval"
        : stopped
        ? "Stopped before the next step"
        : "Answered",
    },
  ];
  if (input.plan && input.plan.missing.length > 0) {
    blocks.push({
      type: "callout",
      version: 1,
      id: "genuinely-missing",
      tone: "warning",
      title: "Still needed",
      body: input.plan.missing.join("; ").slice(0, 1000),
    });
  }
  if (failed.length > 0 && !input.plan) {
    blocks.push({
      type: "callout",
      version: 1,
      id: "recorded-blocker",
      tone: "warning",
      title: "What blocked the plan",
      body: failed.slice(0, 2).map((observation) =>
        `${toolLabel(observation.tool)}: ${
          ariUserFacingToolError(observation.error)
        }`
      ).join(" ").slice(0, 1000),
    });
  }
  if (sources.length > 0) {
    blocks.push({
      type: "sources",
      version: 1,
      id: "verified-sources",
      items: sources,
    });
  }
  const actions = !input.plan && stopped
    ? [{
      id: stoppedReason === "errors" ? "retry-plan" : "resume-plan",
      label: stoppedReason === "errors" ? "Retry safely" : "Resume plan",
      style: "primary",
      behavior: {
        type: "local",
        command: stoppedReason === "errors" ? "retry" : "resume",
      },
    }]
    : undefined;
  return {
    schema_version: 2,
    rendition_id: safeText(input.renditionId, 80) || "agent-run",
    kind: input.plan
      ? "plan"
      : hasResearch
      ? "research"
      : stopped
      ? "blocked"
      : "plan",
    eyebrow: input.plan
      ? "LAUNCH PLAN"
      : hasResearch
      ? "EVIDENCE-LED PLAN"
      : "LIVE PLAN",
    title,
    body: input.plan?.summary ??
      `Goal: ${safeText(input.goal, 900) || "Complete this Ari task safely."}`,
    tone: stopped || failed.length > 0 || (input.plan?.missing.length ?? 0) > 0
      ? "warning"
      : "success",
    state: input.plan ? "ready" : stopped ? "error" : "ready",
    ...(!input.plan && stopped ? { transition_label: "Needs attention" } : {}),
    ...(hasResearch ? { graphic: "research" } : {}),
    blocks,
    ...(actions ? { actions } : {}),
  };
}
