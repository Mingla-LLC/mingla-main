// Issue #2830 — deterministic Website setup entry and Fix-all ownership.
// Website setup is a product workflow, not a best-effort model suggestion:
// required reads and Ari-state creation happen before the first response.

import type { AgentLoopObservation, AgentLoopToolCall } from "./agentLoop.ts";
import type { AriRenditionV2 } from "./ariRendition.ts";
import { DESIGN_KEYS, DESIGNS } from "./siteContracts/designs.ts";
import {
  PLAN_OFFERING_OPTIONS,
  VENUE_DESCRIPTOR_CHIPS,
} from "./siteContracts/sitePlan.ts";

export type WebsiteSetupIntent = "audit" | "fix_all";

export type WebsiteSetupPresentation = {
  text: string;
  rendition: AriRenditionV2;
};

export const WEBSITE_SETUP_FIELD_KEYS = [
  "name",
  "description",
  "offerings_selected",
  "venue_descriptor",
  "design_key",
  "story.who",
  "story.why",
  "story.main_action",
  "contact_email",
  "contact_phone",
  "address",
  "city_country",
  "social_links",
  "profile_photo",
  "cover_media",
  "theme",
  "approved_plan",
] as const;

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

function fieldStateLabel(field: JsonObject): string {
  if (field.human_action_required === true) return "Needs your upload";
  switch (String(field.state ?? "missing")) {
    case "invalid":
      return "Needs correction";
    case "stale":
      return "Needs verification";
    case "conflict":
      return "Choose the correct detail";
    default:
      return "Needs an answer";
  }
}

function evidenceOptions(field: JsonObject): Record<string, unknown>[] {
  if (!Array.isArray(field.evidence_candidates)) return [];
  return field.evidence_candidates.slice(0, 10).flatMap((entry, index) => {
    const candidate = object(entry);
    const value = text(candidate.label) ?? text(candidate.value) ??
      text(candidate.name) ?? text(candidate.url);
    if (!value) return [];
    const source = text(candidate.source_label) ??
      text(candidate.source_type) ??
      text(candidate.source);
    return [{
      id: `evidence-${index + 1}`,
      label: value.slice(0, 100),
      ...(source ? { detail: `Found in ${source}`.slice(0, 200) } : {}),
    }];
  });
}

function fieldInteraction(
  fieldKey: string,
  field: JsonObject,
): Record<string, unknown>[] {
  if (field.human_action_required === true) {
    return [{
      type: "callout",
      version: 1,
      id: "human-action",
      tone: "warning",
      title: "You control this upload",
      body:
        "Open Brand details to upload the asset. When you return, Ari will verify it and continue from the next gap.",
    }];
  }
  const candidates = evidenceOptions(field);
  if (candidates.length > 0) {
    return [{
      type: "choices",
      version: 1,
      id: "evidence-choices",
      selection: "single",
      options: candidates,
    }];
  }
  if (fieldKey === "design_key") {
    return [{
      type: "choices",
      version: 1,
      id: "design-choice",
      selection: "single",
      options: DESIGN_KEYS.map((key) => ({
        id: key,
        label: DESIGNS[key].label,
        detail: DESIGNS[key].description,
      })),
    }];
  }
  if (fieldKey === "offerings_selected") {
    return [{
      type: "choices",
      version: 1,
      id: "offering-choices",
      selection: "multiple",
      options: PLAN_OFFERING_OPTIONS.map((option) => ({
        id: option.key,
        label: option.label,
        detail: option.hint,
      })),
    }];
  }
  if (fieldKey === "venue_descriptor") {
    return [{
      type: "choices",
      version: 1,
      id: "venue-choice",
      selection: "single",
      options: VENUE_DESCRIPTOR_CHIPS.map((label, index) => ({
        id: `venue-${index + 1}`,
        label,
      })),
    }];
  }
  if (fieldKey === "story.main_action") {
    return [{
      type: "choices",
      version: 1,
      id: "main-action-choice",
      selection: "single",
      options: [
        {
          id: "book",
          label: "Book or reserve",
          detail: "Lead visitors into a booking flow",
        },
        {
          id: "tickets",
          label: "Get tickets",
          detail: "Lead visitors to a ticketed event",
        },
        {
          id: "explore",
          label: "Explore offerings",
          detail: "Lead visitors to trips, events, or experiences",
        },
        {
          id: "contact",
          label: "Contact us",
          detail: "Lead visitors to a direct enquiry",
        },
      ],
    }];
  }
  if (fieldKey === "theme") {
    return [{
      type: "choices",
      version: 1,
      id: "theme-choice",
      selection: "single",
      options: [
        {
          id: "warm",
          label: "Warm and welcoming",
          detail: "Soft type, warm color, gentle motion",
        },
        {
          id: "bold",
          label: "Bold and energetic",
          detail: "Strong type, vivid color, expressive motion",
        },
        {
          id: "refined",
          label: "Refined and minimal",
          detail: "Editorial type, restrained color, subtle motion",
        },
      ],
    }];
  }
  if (fieldKey === "approved_plan") {
    return [{
      type: "choices",
      version: 1,
      id: "approval-choice",
      selection: "single",
      options: [
        {
          id: "review",
          label: "Review the plan now",
          detail: "Show me the complete setup before approval",
        },
        {
          id: "keep-working",
          label: "Keep working",
          detail: "Return to any detail that still needs adjustment",
        },
      ],
    }];
  }
  const label = fieldLabel(field, fieldKey);
  return [{
    type: "input",
    version: 1,
    id: "field-answer",
    field: {
      id: fieldKey.replaceAll(".", "-"),
      label,
      value: "",
      placeholder: setupQuestion(fieldKey, field).replace(/\?$/, ""),
      editable: true,
    },
  }];
}

export function websiteSetupInteractionKind(
  fieldKey: string,
  field: JsonObject = {},
): string {
  return String(fieldInteraction(fieldKey, field)[0]?.type ?? "input");
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
  return buildWebsiteSetupPresentation(
    intent,
    observations,
    brandName,
    null,
  )?.text ?? null;
}

export function buildWebsiteSetupPresentation(
  intent: WebsiteSetupIntent,
  observations: readonly AgentLoopObservation[],
  brandName: string | null,
  brandId: string | null,
): WebsiteSetupPresentation | null {
  const planRead = observation(observations, "get_site_plan");
  if (!planRead) return null;
  if (planRead.error) {
    const reply =
      "I couldn’t read the live Website setup plan, so I did not guess or create a draft. Try again and I’ll resume from the saved setup.";
    return {
      text: reply,
      rendition: {
        schema_version: 2,
        rendition_id: "website-setup:unavailable",
        kind: "website-setup",
        eyebrow: "Website setup",
        title: "The setup plan could not refresh",
        body: reply,
        tone: "warning",
        state: "error",
        graphic: "site",
        blocks: [{
          type: "callout",
          version: 1,
          id: "safe-retry",
          tone: "warning",
          title: "Nothing was changed",
          body:
            "Ari will retry the saved setup instead of guessing or creating a draft.",
        }],
        actions: [{
          id: "retry-audit",
          label: "Try the audit again",
          style: "primary",
          behavior: {
            type: "reply",
            message: "Review every remaining Website setup gap again.",
          },
        }],
      },
    };
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
  const fields = Array.isArray(completeness.fields)
    ? completeness.fields.map(object)
    : [];
  const verifiedCount =
    fields.filter((field) =>
      field.requirement !== "optional" &&
      ["verified", "not_applicable"].includes(String(field.state ?? "missing"))
    ).length;
  const applicableCount =
    fields.filter((field) => field.requirement !== "optional").length;
  const ownerActionCount =
    gaps.filter((field) => field.human_action_required === true).length;
  const progress = applicableCount > 0
    ? Math.round((verifiedCount / applicableCount) * 100)
    : Math.round((doneCount / Math.max(1, total)) * 100);
  const routeActions = brandId
    ? [{
      id: "add-it-myself",
      label: "Add it myself",
      style: "secondary",
      behavior: { type: "route", route: `/brand/${brandId}/edit` },
    }]
    : [];

  if (intent === "audit") {
    const partSummary = parts.length > 0
      ? `Done: ${naturalList(doneParts)}. Open: ${naturalList(openParts)}.`
      : "The live plan did not return part labels, so I’m keeping the saved progress as the authority.";
    const gapSummary = gaps.length > 0
      ? `I found ${gaps.length} Website-ready ${
        gaps.length === 1 ? "gap" : "gaps"
      }: ${naturalList(gapLabels)}.`
      : "I found no required or recommended brand-context gaps.";
    const reply =
      `Website setup for ${brand} is ${doneCount} of ${total} complete. ${partSummary}\n\n${gapSummary}\n\nChoose Fix all gaps with Ari, Review the gaps, or use Add it myself. I will not create a draft until setup and brand context are complete.`;
    return {
      text: reply,
      rendition: {
        schema_version: 2,
        rendition_id: "website-setup:audit",
        kind: "website-setup",
        eyebrow: "Website setup",
        title: gaps.length > 0
          ? `${verifiedCount} ready · ${gaps.length} need attention`
          : "Brand context is ready",
        body:
          "Ari checked every required and recommended Website field against the saved plan. The Website draft stays out of the way until setup is complete.",
        tone: gaps.length > 0 ? "warning" : "success",
        state: "ready",
        graphic: "site",
        blocks: [
          {
            type: "metrics",
            version: 1,
            id: "setup-summary",
            items: [
              {
                id: "verified",
                label: "Verified",
                value: String(verifiedCount),
              },
              {
                id: "remaining",
                label: "Remaining",
                value: String(gaps.length),
              },
              {
                id: "owner-actions",
                label: "Your actions",
                value: String(ownerActionCount),
              },
              {
                id: "parts",
                label: "Setup plan",
                value: `${doneCount} of ${total}`,
              },
            ],
          },
          {
            type: "progress",
            version: 1,
            id: "context-progress",
            value: progress,
            label: "Brand context completeness",
          },
          ...(gaps.length > 0
            ? [{
              type: "list",
              version: 1,
              id: "setup-gaps",
              title: "Every gap Ari found",
              style: "bullet",
              items: gaps.map((field) =>
                `${fieldLabel(field, String(field.key ?? "Brand detail"))} — ${
                  fieldStateLabel(field)
                }`
              ),
            }]
            : [{
              type: "callout",
              version: 1,
              id: "setup-complete",
              tone: "success",
              title: "Ready for review",
              body: "No required or recommended brand-context gaps remain.",
            }]),
        ],
        actions: gaps.length > 0
          ? [
            {
              id: "fix-everything",
              label: "Fix everything with Ari",
              style: "primary",
              behavior: {
                type: "submit",
                message:
                  "Fix all Website brand-context gaps with Ari. Own the complete chain and ask one question at a time.",
              },
            },
            {
              id: "review-gaps",
              label: "Review the gaps",
              style: "secondary",
              behavior: {
                type: "submit",
                message:
                  "Review every remaining Website setup gap with me, one at a time.",
              },
            },
            ...routeActions,
          ].slice(0, 3)
          : routeActions,
      },
    };
  }

  const jobRead = observation(
    observations,
    "start_brand_completeness_job",
  );
  if (!jobRead) return null;
  if (jobRead.error) {
    const reply =
      `I read the live Website plan for ${brand}, but I couldn’t start the durable Fix all job. Nothing was changed and no draft was created. Try again and I’ll resume safely.`;
    return blockedPresentation(
      reply,
      "Ari could not start the Fix everything chain",
    );
  }
  const result = object(jobRead.result);
  if (result.blocked_by_other_job === true) {
    const takeover = result.takeover_available === true
      ? "An owner or admin can choose to wait or explicitly take over."
      : "Ask the teammate who owns it to finish or release it.";
    const reply =
      `Another teammate already owns the active Website gap job for ${brand}. I did not start a competing chain or create a draft. ${takeover}`;
    return blockedPresentation(reply, "Another teammate owns this setup");
  }
  const job = object(result.job);
  const checkpoint = object(job.checkpoint);
  const pending = stringArray(job.pending_step_keys);
  const completed = stringArray(job.completed_step_keys);
  if (pending.length === 0 || job.status === "completed") {
    const reply =
      `The durable Website gap job for ${brand} is complete. I verified ${completed.length} brand-context steps and found no remaining required or recommended gaps. No draft has been created; the owner can review the completed setup plan next.`;
    return {
      text: reply,
      rendition: {
        schema_version: 2,
        rendition_id: "website-setup:complete",
        kind: "website-setup",
        eyebrow: "Website setup",
        title: "Every Website detail is filled",
        body:
          "Ari re-checked the saved plan and found no required or recommended brand-context gaps.",
        tone: "success",
        state: "submitted",
        graphic: "site",
        blocks: [{
          type: "callout",
          version: 1,
          id: "approval-next",
          tone: "success",
          title: "Setup comes before the draft",
          body:
            "Review and approve the completed setup plan before Ari creates the first Website draft.",
        }],
        actions: brandId
          ? [{
            id: "review-setup-plan",
            label: "Review setup plan",
            style: "primary",
            behavior: { type: "route", route: `/brand/${brandId}/website` },
          }]
          : [],
      },
    };
  }
  const currentStep = text(checkpoint.current_step) ?? pending[0];
  const currentField = findField(object(result.completeness), currentStep);
  const action = setupQuestion(currentStep, currentField);
  const verb = result.resumed === true ? "resumed" : "started";
  const reply =
    `I ${verb} one durable Fix all job for ${brand}. ${completed.length} steps are verified and ${pending.length} remain. I’ll research safe public facts, ask only for what I can’t verify, checkpoint every confirmed change, and re-audit before moving on. No draft will be created first.\n\nCurrent step — ${
      fieldLabel(currentField, currentStep)
    }: ${action}`;
  return {
    text: reply,
    rendition: {
      schema_version: 2,
      rendition_id: `website-setup:field-${currentStep.replaceAll(".", "-")}`,
      kind: "website-setup",
      eyebrow: "Ari owns the setup",
      title: fieldLabel(currentField, currentStep),
      body: action,
      state: "ready",
      graphic: "site",
      blocks: [
        {
          type: "metrics",
          version: 1,
          id: "chain-progress",
          items: [
            {
              id: "verified",
              label: "Verified",
              value: String(completed.length),
            },
            {
              id: "remaining",
              label: "Remaining",
              value: String(pending.length),
            },
          ],
        },
        {
          type: "progress",
          version: 1,
          id: "chain-progress-bar",
          value: Math.round(
            (completed.length /
              Math.max(1, completed.length + pending.length)) * 100,
          ),
          label: "Ari checkpoints and re-checks each answer",
        },
        ...fieldInteraction(currentStep, currentField),
      ],
      actions: [
        ...(currentField.human_action_required === true ? routeActions : [{
          id: "continue-with-ari",
          label: "Continue with Ari",
          style: "primary",
          behavior: {
            type: "submit",
            message: `Use my answer for ${
              fieldLabel(currentField, currentStep)
            }, confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap.`,
          },
        }]),
        {
          id: "review-remaining",
          label: "Review remaining gaps",
          style: "secondary",
          behavior: {
            type: "submit",
            message:
              "Review every remaining Website setup gap before continuing.",
          },
        },
        ...routeActions,
      ].slice(0, 3),
    },
  };
}

function blockedPresentation(
  reply: string,
  title: string,
): WebsiteSetupPresentation {
  return {
    text: reply,
    rendition: {
      schema_version: 2,
      rendition_id: "website-setup:blocked",
      kind: "website-setup",
      eyebrow: "Website setup",
      title,
      body: reply,
      tone: "warning",
      state: "error",
      graphic: "site",
      blocks: [{
        type: "callout",
        version: 1,
        id: "safe-stop",
        tone: "warning",
        title: "No competing work was started",
        body: "The saved setup and any completed fields remain intact.",
      }],
    },
  };
}
