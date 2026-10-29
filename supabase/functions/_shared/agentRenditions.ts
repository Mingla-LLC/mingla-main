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

type JsonRecord = Record<string, unknown>;

const TOOL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  search_capabilities: "Check Mingla capabilities",
  request_tools: "Load the right Mingla tools",
  search_public_web: "Search public sources",
  read_public_url: "Read the public page",
  inspect_public_social_profile: "Inspect the public social profile",
  fetch_public_listing_page: "Read the public listing",
  extract_listing_candidates: "Extract listing details",
  list_brands: "Read available brands",
  list_events: "Read current listings",
  get_operator_snapshot: "Read the business workspace",
  get_onboarding_plan: "Read the saved onboarding plan",
  update_onboarding_plan: "Save onboarding progress",
  list_memory_notes: "Read approved business memory",
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
  return name.split("_").filter(Boolean).map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1)
  ).join(" ").slice(0, 120) || "Complete the next step";
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
    return message.replace(/\s*\([A-Z][A-Z0-9_]*\)\s*$/g, "");
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
  const rows = observations.slice(0, 9).map((observation, index) => ({
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
      label: "Review the protected action",
      detail: `${toolLabel(result.toolCall.name)} is ready for approval.`,
      state: "active",
    });
    rows.push({
      id: "step-verify",
      label: "Verify the result",
      detail: "Ari will read the canonical result and continue after approval.",
      state: "queued",
    });
  } else if (result.kind === "stopped") {
    rows.push({
      id: "step-resume",
      label: "Resume from the saved checkpoint",
      detail: result.reason === "errors"
        ? "Resolve the recorded blocker, then retry without repeating completed work."
        : "Continue within a fresh bounded execution window.",
      state: "active",
    });
  }
  if (rows.length === 0) {
    rows.push({
      id: "step-response",
      label: "Answer the request",
      detail: "Ari completed the reasoning step without calling a tool.",
      state: "done",
    });
  }
  return rows.slice(0, 12);
}

function progressFor(result: AgentLoopResult): number {
  if (result.kind === "text") return 100;
  if (result.kind === "proposal") return 75;
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
  const failed = input.result.observations.filter((observation) =>
    observation.error
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
        : "The plan is saved and ready to resume"
      : hasResearch
      ? "Research and verification complete"
      : "Plan complete");
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
        ? "Completed work is checkpointed"
        : "Verified complete",
    },
  ];
  if (input.plan && input.plan.missing.length > 0) {
    blocks.push({
      type: "callout",
      version: 1,
      id: "genuinely-missing",
      tone: "warning",
      title: "Genuinely missing",
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
