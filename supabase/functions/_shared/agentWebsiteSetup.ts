// Issue #2830 — deterministic Website setup entry and Fix-all ownership.
// Website setup is a product workflow, not a best-effort model suggestion:
// required reads and Ari-state creation happen before the first response.

import type { AgentLoopObservation, AgentLoopToolCall } from "./agentLoop.ts";

export type WebsiteSetupIntent = "audit" | "fix_all";

type JsonObject = Record<string, unknown>;

const PART_LABELS: Readonly<Record<string, string>> = Object.freeze({
  offer: "What you'll offer",
  brand: "Your brand details",
  look: "Choose your design",
  story: "Your story",
  approve: "Approve the plan",
  build: "Build your pages",
  first_offering: "Add your first trip or event",
  publish: "Check and publish",
});

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => typeof item === "string" ? [item] : [])
    : [];
}

function naturalList(values: readonly string[]): string {
  if (values.length === 0) return "none";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function fieldLabel(field: JsonObject, fallback: string): string {
  return text(field.label) ?? fallback.replaceAll("_", " ");
}

function findField(completeness: JsonObject, key: string): JsonObject {
  const fields = Array.isArray(completeness.fields)
    ? completeness.fields.map(object)
    : [];
  return fields.find((field) => field.key === key) ?? {};
}

function gapFields(completeness: JsonObject): JsonObject[] {
  return (Array.isArray(completeness.fields)
    ? completeness.fields.map(object)
    : []).filter((field) =>
      field.requirement !== "optional" &&
      !["verified", "not_applicable"].includes(String(field.state ?? "missing"))
    );
}

export function detectWebsiteSetupIntent(
  message: string,
): WebsiteSetupIntent | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (
    /\bfix all\b[^.?!]*(?:website|brand[- ]context|gap)/i.test(normalized) ||
    /(?:website|brand[- ]context)[^.?!]*\bfix all\b/i.test(normalized)
  ) return "fix_all";
  if (
    /\b(?:start|continue|resume)\s+(?:the\s+)?website setup\b/i.test(
      normalized,
    ) ||
    /\bwebsite setup\b[^.?!]*(?:audit|plan|gap|complete)/i.test(normalized)
  ) return "audit";
  return null;
}

export function websiteSetupInitialCalls(
  intent: WebsiteSetupIntent,
  brandId: string,
): AgentLoopToolCall[] {
  const reads: AgentLoopToolCall[] = [{
    name: "get_site_plan",
    args: { brand_id: brandId },
  }];
  if (intent === "fix_all") {
    reads.push({
      name: "start_brand_completeness_job",
      args: { brand_id: brandId, takeover: false },
    });
  }
  return reads;
}

export function websiteSetupWorkflowInitialCalls(args: {
  intent: WebsiteSetupIntent | null;
  brandId: string;
  activeFixAllJob: boolean;
}): AgentLoopToolCall[] {
  if (args.intent) return websiteSetupInitialCalls(args.intent, args.brandId);
  return websiteSetupInitialCalls(
    args.activeFixAllJob ? "fix_all" : "audit",
    args.brandId,
  );
}

function setupQuestion(fieldKey: string, field: JsonObject): string {
  if (field.human_action_required === true) {
    const label = fieldLabel(field, fieldKey);
    return `${label} needs your upload. Can you use Add it myself to upload it, then tell me when it is ready so I can re-audit the next gap?`;
  }
  switch (fieldKey) {
    case "name":
      return "What public brand name should the Website use?";
    case "description":
      return "In one or two sentences, how should the Website describe this brand?";
    case "offerings_selected":
      return "Which Mingla offerings should this Website feature?";
    case "venue_descriptor":
      return "How should the Website describe the venue or meeting place?";
    case "design_key":
      return "Which starting design should I save: Atelier or Voyage?";
    case "story.who":
      return "Who usually comes with you?";
    case "story.why":
      return "Why do they choose you?";
    case "story.main_action":
      return "What should the main Website action be?";
    case "contact_email":
      return "What public contact email should the Website show?";
    case "contact_phone":
      return "What public contact phone number should the Website show?";
    case "address":
      return "What public street address should the Website show?";
    case "city_country":
      return "Which city and country should the Website show?";
    case "social_links":
      return "Which public Website or social profile should I verify first?";
    case "theme":
      return "What visual theme should the Website use?";
    case "approved_plan":
      return "Everything before approval is ready. Would you like to review and approve the Website plan now?";
    default:
      return `What should I use for ${fieldLabel(field, fieldKey)}?`;
  }
}

function observation(
  observations: readonly AgentLoopObservation[],
  tool: string,
): AgentLoopObservation | undefined {
  return observations.find((item) => item.tool === tool);
}

export function buildWebsiteSetupReply(
  intent: WebsiteSetupIntent,
  observations: readonly AgentLoopObservation[],
  brandName: string | null,
): string | null {
  const planRead = observation(observations, "get_site_plan");
  if (!planRead) return null;
  if (planRead.error) {
    return "I couldn’t read the live Website setup plan, so I did not guess or create a draft. Try again and I’ll resume from the saved setup.";
  }
  const plan = object(planRead.result);
  const status = object(plan.status);
  const completeness = object(plan.completeness);
  const parts = Array.isArray(status.parts) ? status.parts.map(object) : [];
  const doneParts = parts.filter((part) => part.done === true).map((part) =>
    PART_LABELS[String(part.key ?? "")] ??
      text(part.label) ??
      String(part.key ?? "Setup part")
  );
  const openParts = parts.filter((part) => part.done !== true).map((part) =>
    PART_LABELS[String(part.key ?? "")] ??
      text(part.label) ??
      String(part.key ?? "Setup part")
  );
  const doneCount = typeof status.done_count === "number"
    ? status.done_count
    : doneParts.length;
  const total = parts.length > 0 ? parts.length : 8;
  const gaps = gapFields(completeness);
  const gapLabels = gaps.map((field) =>
    fieldLabel(field, String(field.key ?? "Brand detail"))
  );
  const brand = brandName?.trim() || "this brand";

  if (intent === "audit") {
    const partSummary = parts.length > 0
      ? `Done: ${naturalList(doneParts)}. Open: ${naturalList(openParts)}.`
      : "The live plan did not return part labels, so I’m keeping the saved progress as the authority.";
    const gapSummary = gaps.length > 0
      ? `I found ${gaps.length} Website-ready ${
        gaps.length === 1 ? "gap" : "gaps"
      }: ${naturalList(gapLabels)}.`
      : "I found no required or recommended brand-context gaps.";
    return `Website setup for ${brand} is ${doneCount} of ${total} complete. ${partSummary}\n\n${gapSummary}\n\nChoose Fix all gaps with Ari, tell me one named gap to handle, or use Add it myself. I will not create a draft until setup and brand context are complete.`;
  }

  const jobRead = observation(
    observations,
    "start_brand_completeness_job",
  );
  if (!jobRead) return null;
  if (jobRead.error) {
    return `I read the live Website plan for ${brand}, but I couldn’t start the durable Fix all job. Nothing was changed and no draft was created. Try again and I’ll resume safely.`;
  }
  const result = object(jobRead.result);
  if (result.blocked_by_other_job === true) {
    const takeover = result.takeover_available === true
      ? "An owner or admin can choose to wait or explicitly take over."
      : "Ask the teammate who owns it to finish or release it.";
    return `Another teammate already owns the active Website gap job for ${brand}. I did not start a competing chain or create a draft. ${takeover}`;
  }
  const job = object(result.job);
  const checkpoint = object(job.checkpoint);
  const pending = stringArray(job.pending_step_keys);
  const completed = stringArray(job.completed_step_keys);
  if (pending.length === 0 || job.status === "completed") {
    return `The durable Website gap job for ${brand} is complete. I verified ${completed.length} brand-context steps and found no remaining required or recommended gaps. No draft has been created; the owner can review the completed setup plan next.`;
  }
  const currentStep = text(checkpoint.current_step) ?? pending[0];
  const currentField = findField(object(result.completeness), currentStep);
  const action = setupQuestion(currentStep, currentField);
  const verb = result.resumed === true ? "resumed" : "started";
  return `I ${verb} one durable Fix all job for ${brand}. ${completed.length} steps are verified and ${pending.length} remain. I’ll research safe public facts, ask only for what I can’t verify, checkpoint every confirmed change, and re-audit before moving on. No draft will be created first.\n\nCurrent step — ${
    fieldLabel(currentField, currentStep)
  }: ${action}`;
}
