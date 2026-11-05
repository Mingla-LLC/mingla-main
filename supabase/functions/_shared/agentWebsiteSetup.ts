// Issue #2830 — deterministic Website setup entry and Fix-all ownership.
// Website setup is a product workflow, not a best-effort model suggestion:
// required reads and Ari-state creation happen before the first response.

import type { AgentLoopObservation, AgentLoopToolCall } from "./agentLoop.ts";
import type { AriRenditionV2 } from "./ariRendition.ts";
import { researchSourceLine } from "./ariBrandResearchCopy.ts";
import { DESIGN_KEYS, DESIGNS } from "./siteContracts/designs.ts";
import {
  PLAN_OFFERING_OPTIONS,
  VENUE_DESCRIPTOR_CHIPS,
} from "./siteContracts/sitePlan.ts";
import { FORBIDDEN_TEXT } from "./siteContracts/safety.ts";
// The Host's own phone rules and country directory (dependency-free shared
// owners, imported the way buyerPhone.ts does) — never a second parser.
import {
  composePhoneE164,
  parsePhoneEntry,
  phoneDialCodeForCountry,
  resolvePhoneStartCountry,
} from "../../../packages/phone-input/phoneNumber.ts";
import { COUNTRY_DIRECTORY } from "../../../packages/phone-input/countryDirectory.ts";
import { brandPhoneE164 } from "../../../packages/brand-rendering/brandPhoneHref.ts";

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

/**
 * The three Website looks Ari offers for the "Mingla page theme" gap.
 *
 * The canonical audit (`brand_context_completeness_internal`, migration
 * 20280216002830) verifies the theme only as: at least one of color / font /
 * animation is set, color is `#RRGGBB`, and font and animation are in their
 * closed lists. Each look therefore saves one complete, schema-valid
 * {color, font, animation} triple built only from existing, vetted values:
 * the color is a named Theme-sheet preset (mingla-business themePresets.ts,
 * contrast-checked there), the font and motion are entries of the theme
 * sheet's own catalogue. The owner-facing detail names exactly what is saved,
 * so the choice is never a vaguer promise than the write.
 */
export const WEBSITE_SETUP_THEME_PRESETS = [
  {
    id: "warm",
    label: "Warm and welcoming",
    detail:
      "Sunset orange, Fraunces type, and a soft shimmer as the page opens",
    theme: { color: "#eb7825", font: "fraunces", animation: "shimmer_reveal" },
  },
  {
    id: "bold",
    label: "Bold and energetic",
    detail: "Neon magenta, Bebas Neue type, and sparkles as the page opens",
    theme: { color: "#e0157b", font: "bebas_neue", animation: "sparkles" },
  },
  {
    id: "refined",
    label: "Refined and minimal",
    detail: "Ink near-black, Playfair Display type, and no motion",
    theme: { color: "#111827", font: "playfair_display", animation: "none" },
  },
] as const;

/**
 * Logo and cover are human uploads: Ari never invents a media URL. Each one
 * routes to the exact Brand details section (`/brand/<id>/edit?section=…`,
 * validated by app/brand/[id]/edit.tsx) and re-checks when the owner returns.
 */
const WEBSITE_SETUP_UPLOAD_HANDOFFS: Readonly<
  Record<string, { section: string; actionLabel: string; body: string }>
> = Object.freeze({
  profile_photo: {
    section: "photo",
    actionLabel: "Upload your logo",
    body:
      "Open Brand details, upload your logo, and save. Ari never adds a logo for you. When you come back, Ari will re-check it and continue from the next gap.",
  },
  cover_media: {
    section: "cover",
    actionLabel: "Add cover media",
    body:
      "Open Brand details, add your cover photo or video, and save. Ari never adds cover media for you. When you come back, Ari will re-check it and continue from the next gap.",
  },
});

/** The owner approves the plan themselves, on the plan's own approval part. */
export function websiteSetupApprovalRoute(brandId: string): string {
  return `/brand/${brandId}/website/plan?part=approve`;
}

export function websiteSetupUploadRoute(
  brandId: string,
  fieldKey: string,
): string | null {
  const handoff = WEBSITE_SETUP_UPLOAD_HANDOFFS[fieldKey];
  return handoff ? `/brand/${brandId}/edit?section=${handoff.section}` : null;
}

/**
 * #3355 bug 19 — "Fix all" sent as the owner's own bubble, in the owner's
 * words. It still names "Fix all … Website … gaps", which is what
 * `detectWebsiteSetupIntent` keys the durable job on.
 */
export const WEBSITE_SETUP_FIX_ALL_MESSAGE =
  "Fix all my Website gaps with me, one question at a time. Look up public facts first, and save each change only after I approve it. Don’t build a draft yet.";

/**
 * Sent as the owner's own message when they return from a handoff. It names
 * Fix all so the server resumes the durable job and re-reads the live plan.
 */
export const WEBSITE_SETUP_RETURN_MESSAGES = Object.freeze({
  uploaded:
    "Continue Website setup: I uploaded it. Resume Fix all Website gaps, re-check the live setup plan, and ask me the next question.",
  approved:
    "Continue Website setup: I approved the plan. Resume Fix all Website gaps, re-check the live setup plan, and ask me the next question.",
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

/**
 * #3355 bug 19 — a key shown to the owner when no label exists reads as
 * words ("story.who" → "Story who"), never as snake_case or a dotted key.
 */
export function websiteSetupPlainKey(key: string): string {
  const words = key.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  return words.length > 0
    ? words.charAt(0).toUpperCase() + words.slice(1)
    : "Website detail";
}

function fieldLabel(field: JsonObject, fallback: string): string {
  return text(field.label) ?? websiteSetupPlainKey(fallback);
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
    // #2830: the page and the day, never a raw source type.
    const detail = text(candidate.source_url)
      ? researchSourceLine(candidate)
      : text(candidate.source_label)
      ? `Found in ${text(candidate.source_label)}`
      : null;
    return [{
      id: `evidence-${index + 1}`,
      label: value.slice(0, 100),
      ...(detail ? { detail: detail.slice(0, 200) } : {}),
    }];
  });
}

function fieldInteraction(
  fieldKey: string,
  field: JsonObject,
  completeness: JsonObject = {},
): Record<string, unknown>[] {
  const upload = WEBSITE_SETUP_UPLOAD_HANDOFFS[fieldKey];
  if (upload) {
    return [{
      type: "callout",
      version: 1,
      id: "human-action",
      tone: "warning",
      title: "You control this upload",
      body: upload.body,
    }];
  }
  if (fieldKey === "approved_plan") {
    return [{
      type: "callout",
      version: 1,
      id: "owner-approval",
      tone: "default",
      title: "Only you can approve the plan",
      body:
        "Ari never approves the Website plan for you. Open the plan, check every answer, and approve it yourself. When you come back, Ari will re-check it and continue.",
    }];
  }
  if (field.human_action_required === true) {
    return [{
      type: "callout",
      version: 1,
      id: "human-action",
      tone: "warning",
      title: "You control this step",
      body:
        "Open Brand details to finish this step. When you return, Ari will re-check it and continue from the next gap.",
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
      options: WEBSITE_SETUP_THEME_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        detail: preset.detail,
      })),
    }];
  }
  const label = fieldLabel(field, fieldKey);
  const input = (extra: Record<string, unknown>) => ({
    type: "input",
    version: 1,
    id: "field-answer",
    field: {
      id: fieldKey.replaceAll(".", "-"),
      label,
      value: "",
      placeholder: setupQuestion(fieldKey, field).replace(/\?$/, ""),
      editable: true,
      ...extra,
    },
  });
  // Each brand-context field is asked in the SAME SHAPE the Host's Brand
  // details form collects it (BrandEditView), so the owner sees the familiar
  // control and the server applies the same rules.
  switch (fieldKey) {
    case "contact_phone": {
      // Country chip + local number, opened exactly as the form opens it.
      const start = websiteSetupPhoneStart({
        stored: typeof field.value === "string" ? field.value : null,
        brandCountryCode: text(
          object(findField(completeness, "city_country").value).country_code,
        ),
      });
      const country = phoneCountry(start.countryIso);
      return [input({
        label: country
          ? `${label} — ${country.name} (${country.dialCode})`
          : label,
        value: start.localText,
        placeholder: "Phone number",
        kind: "phone",
        ...(country
          ? { countryIso: country.code }
          : { countryPlaceholder: "Choose country" }),
      })];
    }
    case "contact_email":
      return [input({ placeholder: "hello@yourbrand.com", kind: "email" })];
    case "address":
      return [input({ placeholder: "e.g. 12 Old Street, London EC1V 9HL" })];
    case "city_country":
      return [input({ placeholder: "City, country — e.g. Lisbon, Portugal" })];
    case "social_links":
      return [
        {
          type: "choices",
          version: 1,
          id: "link-platform",
          selection: "single",
          options: WEBSITE_SETUP_LINK_PLATFORMS.map((platform) => ({
            id: `link-${platform.key}`,
            label: platform.label,
          })),
        },
        input({ placeholder: "Paste the link here", kind: "url" }),
      ];
    default:
      return [input({})];
  }
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
  // Rendition submissions are answers inside the active durable Fix-all job,
  // not requests to restart its audit. The generated message intentionally
  // mentions the next "Website setup gap", so this precedence guard must run
  // before the broader audit matcher below.
  if (/^use my answer for\b/i.test(normalized)) return null;
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

const WEBSITE_SETUP_RETURN =
  /^(?:(?:ok(?:ay)?|great|thanks)[,.!]?\s+)?(?:(?:i[’']?ve|i have|i)\s+)?(?:just\s+)?(?:uploaded|added|approved|saved|finished|done)\b|^(?:all\s+)?(?:done|finished|ready)\b|^(?:continue|resume)\b/i;

/**
 * Inside the Website workflow with an active Fix-all job, an owner returning
 * from a handoff ("I uploaded it", "Continue Website setup") resumes that job:
 * the server re-reads the live plan and presents the next gap itself rather
 * than restarting the audit or asking a model what to do next.
 */
export function websiteSetupEffectiveIntent(args: {
  intent: WebsiteSetupIntent | null;
  message: string;
  workflow: boolean;
  activeFixAllJob: boolean;
}): WebsiteSetupIntent | null {
  if (args.intent === "fix_all") return "fix_all";
  if (!args.workflow || !args.activeFixAllJob) return args.intent;
  const normalized = args.message.replace(/\s+/g, " ").trim();
  return WEBSITE_SETUP_RETURN.test(normalized) ? "fix_all" : args.intent;
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

/**
 * A Website Fix-all job is durable and the live plan is authoritative. Feeding
 * old chat turns back into the model can resurrect stale errors or completed
 * answers, so reasoning receives only the current answer plus fresh plan/job
 * observations.
 */
export function websiteSetupCurrentTurnOnly<T>(
  contents: readonly T[],
): T[] {
  const current = contents.at(-1);
  return current === undefined ? [] : [current];
}

export type WebsiteSetupDesignAnswer = {
  designKey: "atelier" | "voyage";
  ownerWords: string;
};

export type WebsiteSetupPlanAnswer = {
  fieldKey:
    | "offerings_selected"
    | "venue_descriptor"
    | "story.who"
    | "story.why"
    | "story.main_action";
  fieldLabel: string;
  answers: Record<string, unknown>;
  ownerWords: string;
};

/**
 * The Website rendition owns this message shape. Parse it before model
 * reasoning so a structured choice becomes the exact, confirmable plan write
 * it represents instead of asking a model to rediscover it.
 */
export function websiteSetupDesignAnswer(
  message: string,
): WebsiteSetupDesignAnswer | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /^Use my answer for Website design, confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap\. Choices: (Atelier|Voyage)$/i,
  );
  const rawLabel = match?.[1];
  if (!rawLabel) return null;
  const label = rawLabel[0].toUpperCase() + rawLabel.slice(1).toLowerCase();
  return {
    designKey: label.toLowerCase() as "atelier" | "voyage",
    ownerWords: `Choices: ${label}`,
  };
}

export function websiteSetupPlanAnswer(
  message: string,
): WebsiteSetupPlanAnswer | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /^Use my answer for (What you(?:'|’)?ll offer|What you offer|Venue description|Who comes with you|Why they choose you|Main visitor action), confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap\.(?: Choices: (.*?))?(?: Response: (.*))?$/i,
  );
  const rawLabel = match?.[1];
  if (!rawLabel) return null;
  const choices = match?.[2]?.trim() ?? "";
  const response = match?.[3]?.trim() ?? "";
  const ownerWords = [
    choices ? `Choices: ${choices}` : "",
    response ? `Response: ${response}` : "",
  ].filter(Boolean).join(" ");
  if (!ownerWords) return null;

  // The canonical audit labels this field "What you offer"; the plan screens
  // say "What you'll offer". Both name the same offerings answer.
  const labelKey = /^what you/i.test(rawLabel)
    ? "what you'll offer"
    : rawLabel.toLowerCase();
  switch (labelKey) {
    case "what you'll offer": {
      const selected = choices.split(",").map((value) => value.trim()).filter(
        Boolean,
      );
      const keys = selected.flatMap((label) => {
        const option = PLAN_OFFERING_OPTIONS.find((candidate) =>
          candidate.label.toLowerCase() === label.toLowerCase()
        );
        return option ? [option.key] : [];
      });
      if (keys.length !== selected.length || keys.length === 0) return null;
      return {
        fieldKey: "offerings_selected",
        fieldLabel: "What you'll offer",
        answers: { offerings_selected: keys },
        ownerWords,
      };
    }
    case "venue description": {
      const value = response || choices;
      return value
        ? {
          fieldKey: "venue_descriptor",
          fieldLabel: "Venue description",
          answers: { venue_descriptor: value },
          ownerWords,
        }
        : null;
    }
    case "who comes with you":
      return response
        ? {
          fieldKey: "story.who",
          fieldLabel: "Who comes with you",
          answers: { story: { who: response } },
          ownerWords,
        }
        : null;
    case "why they choose you":
      return response
        ? {
          fieldKey: "story.why",
          fieldLabel: "Why they choose you",
          answers: { story: { why: response } },
          ownerWords,
        }
        : null;
    case "main visitor action": {
      const value = response || choices;
      return value
        ? {
          fieldKey: "story.main_action",
          fieldLabel: "Main visitor action",
          answers: { story: { main_action: value } },
          ownerWords,
        }
        : null;
    }
    default:
      return null;
  }
}

export function websiteSetupPlanRevision(result: unknown): number | null {
  const root = object(result);
  // #3355 — an entitled brand that has never saved a plan reads `plan: null`.
  // Its first save creates the row at revision 0, exactly as the Website
  // screen sends it; without this a brand-new brand could never answer Ari.
  if (root.entitled === true && "plan" in root && root.plan === null) return 0;
  const nested = object(root.plan);
  const candidate = nested.revision ?? root.revision;
  return Number.isInteger(candidate) && Number(candidate) >= 0
    ? Number(candidate)
    : null;
}

/** A partial story answer must not erase story answers saved in earlier steps. */
export function websiteSetupMergedPlanAnswers(
  result: unknown,
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const incomingStory = object(answers.story);
  if (Object.keys(incomingStory).length === 0) return answers;
  const root = object(result);
  const plan = Object.keys(object(root.plan)).length > 0
    ? object(root.plan)
    : root;
  const existingStory = object(plan.story);
  const preservedStory = Object.fromEntries(
    ["who", "why", "main_action"].flatMap((key) => {
      const value = text(existingStory[key]);
      return value ? [[key, value]] : [];
    }),
  );
  return {
    ...answers,
    story: { ...preservedStory, ...incomingStory },
  };
}

/**
 * The Host resumes the durable Website Fix-all job after a confirmed plan
 * write. The generic post-approval model loop must not race that owner or
 * report a false blocker after the write has already succeeded.
 */
export function websiteSetupApprovedWriteFollowup(
  toolName: string,
): string | null {
  return [
      "save_site_plan_design",
      "save_site_plan_answers",
      "update_brand_context",
    ].includes(toolName)
    ? "Saved and verified. I’m re-checking the Website plan now and continuing to the next gap."
    : null;
}

/** The fixed tail of every "Continue with Ari" setup submission. */
export const WEBSITE_SETUP_SUBMISSION_SUFFIX =
  ", confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap.";

export type WebsiteSetupContextFieldKey =
  | "name"
  | "description"
  | "contact_email"
  | "contact_phone"
  | "address"
  | "city_country"
  | "social_links"
  | "theme"
  | "profile_photo"
  | "cover_media"
  | "approved_plan";

/**
 * The owner-facing labels the canonical audit gives each brand-context field
 * (`brand_context_completeness_internal`), which the rendition echoes back in
 * its submission. Matching on the audit's own label keeps one definition.
 */
const CONTEXT_FIELD_BY_LABEL: Readonly<
  Record<string, WebsiteSetupContextFieldKey>
> = Object.freeze({
  "brand name": "name",
  "brand story": "description",
  "contact email": "contact_email",
  "contact phone": "contact_phone",
  "address": "address",
  "city and country": "city_country",
  "public website or social link": "social_links",
  "mingla page theme": "theme",
  "brand logo": "profile_photo",
  "cover media": "cover_media",
  "owner-approved plan": "approved_plan",
});

/** Fields the owner may mark as not applicable (update_brand_context exceptions). */
const CONTEXT_EXCEPTION_FIELD_KEYS = new Set<string>([
  "contact_email",
  "contact_phone",
  "address",
  "city_country",
  "social_links",
  "theme",
]);

export type WebsiteSetupContextAnswer = {
  fieldKey: WebsiteSetupContextFieldKey;
  fieldLabel: string;
  choices: string;
  /** The country chip the owner submitted with a phone answer, if any. */
  country: string | null;
  response: string;
  ownerWords: string;
};

export function websiteSetupContextAnswer(
  message: string,
): WebsiteSetupContextAnswer | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /^Use my answer for (.+?), confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap\.(?: Choices: (.*?))?(?: Country: ([A-Za-z]{2}))?(?: Response: (.*))?$/i,
  );
  const rawLabel = match?.[1]?.trim();
  if (!rawLabel) return null;
  // The phone card's label carries its country ("Contact phone — United
  // States (+1)"); the field is the part before the dash.
  const fieldKey =
    CONTEXT_FIELD_BY_LABEL[rawLabel.split(" — ")[0].toLowerCase()];
  if (!fieldKey) return null;
  const choices = match?.[2]?.trim() ?? "";
  const country = match?.[3]?.trim().toUpperCase() ?? null;
  const response = match?.[4]?.trim() ?? "";
  return {
    fieldKey,
    fieldLabel: rawLabel,
    choices,
    country,
    response,
    ownerWords: [
      choices ? `Choices: ${choices}` : "",
      country ? `Country: ${country}` : "",
      response ? `Response: ${response}` : "",
    ].filter(Boolean).join(" "),
  };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

const NOT_APPLICABLE =
  /\b(?:not applicable|n\/a|does\s?n[’']?t apply|does not apply|do\s?n[’']?t have|do not have|have no|has no|there is no|there[’']?s no|no public)\b/i;

/** The owner said this detail does not apply to them. */
export function websiteSetupSaysNotApplicable(value: string): boolean {
  const trimmed = value.trim();
  return /^(?:none|no|nope|n\/a)\.?$/i.test(trimmed) ||
    NOT_APPLICABLE.test(trimmed);
}

/**
 * The Host form's rule for Contact email (mingla-business
 * `utils/brandContactEmail.ts` BRAND_CONTACT_EMAIL_RE, byte-identical and
 * pinned by the #2830 parity test): the whole trimmed field must be one
 * address. Ari does not dig an address out of a sentence.
 */
export const WEBSITE_SETUP_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function websiteSetupEmail(value: string): Parsed<string> {
  const email = value.trim();
  if (!WEBSITE_SETUP_EMAIL_RE.test(email) || email.length > 254) {
    return {
      ok: false,
      problem:
        "That doesn’t look like an email address. What public email should the Website show?",
    };
  }
  return { ok: true, value: email };
}

/**
 * Byte-identical to mingla-business `BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE`
 * (brandContactPhoneRules.ts, #3380), pinned by the #2830 parity test.
 */
export const WEBSITE_SETUP_PHONE_CHOOSE_COUNTRY =
  "Choose the country for this number.";
const WEBSITE_SETUP_PHONE_CHOOSE_COUNTRY_FOR_NUMBER =
  "Choose the country for this phone number.";
const WEBSITE_SETUP_PHONE_UK_PLUS_ADVICE =
  "If it is a UK number, type it starting with +44.";

type PhoneCountry = { code: string; name: string; dialCode: string };

function phoneCountry(iso: string | null | undefined): PhoneCountry | null {
  if (typeof iso !== "string") return null;
  const upper = iso.trim().toUpperCase();
  const entry = COUNTRY_DIRECTORY.find((country) => country.code === upper);
  if (!entry) return null;
  // A characterised country's own dial code always wins (phoneNumber.ts).
  return {
    code: entry.code,
    name: entry.name,
    dialCode: phoneDialCodeForCountry(entry.code) ?? entry.dialCode,
  };
}

/**
 * The country a saved E.164 number belongs to — the Host form's order
 * (`brandPhoneCountryFromStored`) without its in-memory session hint: the
 * longest dial code decides; a shared code (+1, +44, +7) goes to the brand's
 * own country when it shares it, then the shared phone rules, then the first
 * directory match.
 */
export function websiteSetupPhoneCountryFromStored(
  stored: string | null | undefined,
  brandCountryCode: string | null | undefined,
): PhoneCountry | null {
  const e164 = brandPhoneE164(stored);
  if (e164 === null) return null;
  const candidates = COUNTRY_DIRECTORY.filter((country) =>
    e164.startsWith(country.dialCode)
  );
  if (candidates.length === 0) return null;
  const longest = Math.max(
    ...candidates.map((country) => country.dialCode.length),
  );
  const tied = candidates.filter((country) =>
    country.dialCode.length === longest
  );
  const own = tied.find((country) =>
    country.code === String(brandCountryCode ?? "").toUpperCase()
  );
  if (own) return phoneCountry(own.code);
  const parsed = parsePhoneEntry(e164, { mode: "any" });
  const named = parsed.ok
    ? tied.find((country) => country.code === parsed.countryIso)
    : undefined;
  return phoneCountry((named ?? tied[0]).code);
}

export type WebsiteSetupPhoneStart = {
  /** The country the chip opens on, or null for "Choose country". */
  countryIso: string | null;
  source: "stored" | "brand" | "fallback";
  /** What the number box shows. */
  localText: string;
};

/**
 * Where the phone chip opens, in the Host form's order (#3380): the country
 * read out of a stored E.164 number, then the brand's own country, otherwise
 * nobody chose one ("Choose country"). Never a default dial code.
 */
export function websiteSetupPhoneStart(args: {
  stored: string | null | undefined;
  brandCountryCode: string | null | undefined;
}): WebsiteSetupPhoneStart {
  const fromStored = websiteSetupPhoneCountryFromStored(
    args.stored,
    args.brandCountryCode,
  );
  const e164 = brandPhoneE164(args.stored);
  if (fromStored && e164) {
    return {
      countryIso: fromStored.code,
      source: "stored",
      localText: e164.slice(fromStored.dialCode.length),
    };
  }
  const brandIso = resolvePhoneStartCountry(
    [args.brandCountryCode],
    (iso) => phoneCountry(iso) !== null,
  );
  return {
    countryIso: brandIso,
    source: brandIso ? "brand" : "fallback",
    localText: typeof args.stored === "string" ? args.stored.trim() : "",
  };
}

/**
 * The Host form's save rule for a typed phone (`brandPhoneForSave`, edit
 * branch), run on the server through the ONE shared parser
 * (packages/phone-input/phoneNumber.ts). `countryIso` is the chip the owner
 * submitted; without one, the start country stands in exactly as the form's
 * chip would. A "+" or "00" number names its own country and overrides the
 * chip. Digits under no chosen country are refused, never given a code.
 */
export function websiteSetupPhone(args: {
  text: string;
  countryIso: string | null;
  stored: string | null | undefined;
  brandCountryCode: string | null | undefined;
}): Parsed<string> {
  const text = args.text.trim();
  if (!text) return { ok: false, problem: "Enter a phone number." };
  const start = websiteSetupPhoneStart({
    stored: args.stored,
    brandCountryCode: args.brandCountryCode,
  });
  const chosenIso = args.countryIso ?? start.countryIso;
  const compact = text.replace(/[\s().-]/g, "");
  const namesOwnCountry = compact.startsWith("+") || /^00[1-9]/.test(compact);
  if (chosenIso === null && !namesOwnCountry) {
    return { ok: false, problem: WEBSITE_SETUP_PHONE_CHOOSE_COUNTRY };
  }
  const country = chosenIso === null ? null : phoneCountry(chosenIso);
  if (chosenIso !== null && country === null) {
    return {
      ok: false,
      problem: WEBSITE_SETUP_PHONE_CHOOSE_COUNTRY_FOR_NUMBER,
    };
  }
  if (namesOwnCountry) {
    const parsed = parsePhoneEntry(text, {
      countryIso: country?.code ?? null,
      dialCode: country?.dialCode ?? null,
      mode: "any",
    });
    return parsed.ok
      ? { ok: true, value: parsed.e164 }
      : { ok: false, problem: parsed.message };
  }
  if (country === null) {
    return { ok: false, problem: WEBSITE_SETUP_PHONE_CHOOSE_COUNTRY };
  }
  const national = text.replace(/\D/g, "").replace(/^0+/, "");
  const ukFreephone = country.dialCode === "+44" &&
    national.startsWith("800");
  const probe = ukFreephone ? null : parsePhoneEntry(text, {
    countryIso: country.code,
    dialCode: country.dialCode,
    mode: "mobile",
  });
  if (probe !== null && !probe.ok && probe.problem === "wrong_country") {
    const maybeUk = country.dialCode === "+44" &&
      /^(70|808|9)/.test(national);
    return {
      ok: false,
      problem: maybeUk
        ? `${probe.message} ${WEBSITE_SETUP_PHONE_UK_PLUS_ADVICE}`
        : probe.message,
    };
  }
  const e164 = composePhoneE164(country.dialCode, text);
  if (e164 === null) {
    const problem = parsePhoneEntry(text, {
      countryIso: country.code,
      dialCode: country.dialCode,
      mode: "any",
    });
    return {
      ok: false,
      problem: problem.ok
        ? "That phone number doesn't look right. Check the country and the number."
        : problem.message,
    };
  }
  return { ok: true, value: e164 };
}

const SOCIAL_HOSTS: ReadonlyArray<readonly [string, string]> = [
  ["instagram.com", "instagram"],
  ["tiktok.com", "tiktok"],
  ["x.com", "x"],
  ["twitter.com", "x"],
  ["facebook.com", "facebook"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["linkedin.com", "linkedin"],
  ["threads.net", "threads"],
  ["threads.com", "threads"],
];

const SOCIAL_KEY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  website: "website",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
});

const SOCIAL_LINK_KEYS = new Set(Object.keys(SOCIAL_KEY_LABELS));

/**
 * The Host form's SOCIAL LINKS section, in its order: one box per platform
 * (BrandEditView "Paste your <platform> link here"). Ari asks the same way:
 * pick the platform, paste its link.
 */
export const WEBSITE_SETUP_LINK_PLATFORMS = [
  { key: "website", label: "Website" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "x", label: "X" },
  { key: "facebook", label: "Facebook" },
  { key: "youtube", label: "YouTube" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "threads", label: "Threads" },
] as const;

/** Which public-link slot a host belongs to; anything unknown is the website. */
export function websiteSetupSocialKey(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, "");
  return SOCIAL_HOSTS.find(([domain]) =>
    host === domain || host.endsWith(`.${domain}`)
  )?.[1] ?? "website";
}

const BARE_DOMAIN =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:[/?#]\S*)?$/i;

/**
 * Public links are HTTPS only. A bare domain is upgraded to https:// only when
 * that is unambiguous: it is the whole answer, it starts with www., or it is
 * a known social host. Anything served over plain http is refused.
 */
export function websiteSetupLinks(
  value: string,
): Parsed<Record<string, string>> {
  const tokens = value.split(/[\s,;]+/).map((token) =>
    token.replace(/^[(<“"']+|[)>.!?”"']+$/g, "")
  ).filter(Boolean);
  if (tokens.some((token) => /^http:\/\//i.test(token))) {
    return {
      ok: false,
      problem:
        "That link starts with http://, which isn’t secure, so I didn’t save it. What is the https:// address?",
    };
  }
  const links: Record<string, string> = {};
  for (const token of tokens) {
    let candidate: string | null = null;
    if (/^https:\/\//i.test(token)) candidate = token;
    else if (!token.includes("@") && BARE_DOMAIN.test(token)) {
      const host = token.split(/[/?#]/)[0];
      if (
        tokens.length === 1 || /^www\./i.test(token) ||
        websiteSetupSocialKey(host) !== "website"
      ) candidate = `https://${token}`;
    }
    if (!candidate) continue;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (
      url.protocol !== "https:" || !url.hostname.includes(".") ||
      url.username || url.password || candidate.length > 500
    ) continue;
    const key = websiteSetupSocialKey(url.hostname);
    if (links[key] && links[key] !== candidate) {
      return {
        ok: false,
        problem: `That answer has two ${
          SOCIAL_KEY_LABELS[key]
        } links. Which one should the Website show?`,
      };
    }
    links[key] = candidate;
  }
  if (Object.keys(links).length === 0) {
    return {
      ok: false,
      problem:
        "I couldn’t find a web address in that answer. What is the full link to your website or social profile, starting with https://?",
    };
  }
  return { ok: true, value: links };
}

// Two-letter US state and territory abbreviations. Several are also ISO
// country codes (CA, GA, IN, AL, …), so "Los Angeles, CA" must never become
// Canada: a code that could be either is refused and the full name requested.
const US_STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR GU VI AS MP"
    .split(" "),
);

// The same country truth the Host uses for a place's country
// (mingla-business utils/phoneCountryIsoFromPlaceCountry.ts): the shared
// directory's names plus its small alias table, nothing guessed.
const COUNTRY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "usa": "US",
  "u s": "US",
  "u s a": "US",
  "united states of america": "US",
  "america": "US",
  "uk": "GB",
  "u k": "GB",
  "gbr": "GB",
  "great britain": "GB",
  "england": "GB",
  "scotland": "GB",
  "wales": "GB",
  "northern ireland": "GB",
  "nga": "NG",
});

function countryKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ")
    .trim();
}

let countryIndex: { byName: Map<string, string>; codes: Set<string> } | null =
  null;

function countries(): { byName: Map<string, string>; codes: Set<string> } {
  if (countryIndex) return countryIndex;
  const byName = new Map<string, string>();
  const codes = new Set<string>();
  for (const country of COUNTRY_DIRECTORY) {
    codes.add(country.code);
    byName.set(countryKey(country.name), country.code);
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    byName.set(alias, code);
  }
  countryIndex = { byName, codes };
  return countryIndex;
}

type CountryMatch = { code: string } | { ambiguous: string } | null;

/** Resolve only an explicit country name or ISO code the owner typed. */
export function websiteSetupCountryCode(value: string): CountryMatch {
  const trimmed = value.trim().replace(/[.!?]+$/, "");
  const index = countries();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const code = trimmed.toUpperCase();
    if (US_STATE_CODES.has(code)) return { ambiguous: code };
    if (index.codes.has(code)) return { code };
  }
  const code = index.byName.get(countryKey(trimmed));
  return code ? { code } : null;
}

export function websiteSetupCityCountry(
  value: string,
): Parsed<{ city: string; country_code: string }> {
  const text = value.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  const askAgain =
    "Which city and country should the Website show? Send both, for example: Lisbon, Portugal.";
  let city = "";
  let country: CountryMatch = null;
  let countryText = "";
  if (text.includes(",")) {
    const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
    countryText = parts.at(-1) ?? "";
    country = websiteSetupCountryCode(countryText);
    city = parts.slice(0, -1).join(", ");
  } else {
    const words = text.split(" ").filter(Boolean);
    for (let size = Math.min(4, words.length); size >= 1; size -= 1) {
      const candidate = websiteSetupCountryCode(words.slice(-size).join(" "));
      if (candidate) {
        country = candidate;
        countryText = words.slice(-size).join(" ");
        city = words.slice(0, -size).join(" ");
        break;
      }
    }
  }
  if (country && "ambiguous" in country) {
    return {
      ok: false,
      problem:
        `“${country.ambiguous}” could be a state or a country, so I won’t guess. ${askAgain}`,
    };
  }
  if (!country) {
    return {
      ok: false,
      problem: countryText
        ? `I couldn’t match “${
          countryText.slice(0, 60)
        }” to a country, and I won’t guess one from the city. ${askAgain}`
        : `I need the country as well as the city, and I won’t guess it. ${askAgain}`,
    };
  }
  city = city.replace(/^(?:in|at)\s+/i, "").trim();
  if (!city) {
    return {
      ok: false,
      problem: `I have the country but not the city. ${askAgain}`,
    };
  }
  if (city.length > 120) {
    return {
      ok: false,
      problem: `That city name is too long to show. ${askAgain}`,
    };
  }
  return { ok: true, value: { city, country_code: country.code } };
}

export type WebsiteSetupContextResolution =
  | { kind: "proposal"; args: Record<string, unknown> }
  | {
    kind: "retry";
    fieldKey: WebsiteSetupContextFieldKey;
    field: JsonObject;
    completeness: JsonObject;
    problem: string;
  }
  | { kind: "unavailable" };

export function websiteSetupContextRevision(result: unknown): string | null {
  const root = object(result);
  const candidate = object(root.completeness).context_revision ??
    root.context_revision;
  return typeof candidate === "string" && /^[0-9a-f]{64}$/.test(candidate)
    ? candidate
    : null;
}

function existingSocialLinks(field: JsonObject): Record<string, string> {
  const value = object(object(field.value).social_links);
  return Object.fromEntries(
    Object.entries(value).filter(([key, url]) =>
      SOCIAL_LINK_KEYS.has(key) && typeof url === "string" &&
      /^https:\/\//.test(url) && url.length <= 500
    ) as [string, string][],
  );
}

const NOT_APPLICABLE_WHY: Readonly<Record<string, string>> = Object.freeze({
  contact_email: "a public contact email",
  contact_phone: "a public phone number",
  address: "a street address",
  city_country: "a city and country",
  social_links: "a public website or social link",
  theme: "a Mingla page theme",
});

/**
 * Turn one structured brand-context answer into the exact update_brand_context
 * proposal it represents, bound to the plan and context revisions of the
 * fresh plan read. Anything Ari cannot use becomes a deterministic retry that
 * writes nothing. Owner-only steps (approval, uploads) are never written.
 */
export function resolveWebsiteSetupContextAnswer(args: {
  brandId: string;
  plan: unknown;
  answer: WebsiteSetupContextAnswer;
}): WebsiteSetupContextResolution {
  const { brandId, plan, answer } = args;
  const fieldKey = answer.fieldKey;
  const completeness = object(object(plan).completeness);
  const field = findField(completeness, fieldKey);
  const retry = (problem: string): WebsiteSetupContextResolution => ({
    kind: "retry",
    fieldKey,
    field,
    completeness,
    problem,
  });
  if (fieldKey === "approved_plan") {
    return retry(
      "Only you can approve the Website plan, and Ari never approves it for you. Open the plan, check it, and approve it there. When you come back, I’ll re-check it and continue.",
    );
  }
  if (WEBSITE_SETUP_UPLOAD_HANDOFFS[fieldKey]) {
    return retry(setupQuestion(fieldKey, field));
  }
  const planRevision = websiteSetupPlanRevision(plan);
  const contextRevision = websiteSetupContextRevision(plan);
  if (planRevision === null || contextRevision === null) {
    return { kind: "unavailable" };
  }
  // Links pair a platform choice with the pasted link, like the form's one
  // box per platform: the response is the value, the choice is the slot.
  const value = fieldKey === "social_links"
    ? answer.response
    : answer.response || answer.choices;
  const question = setupQuestion(fieldKey, field);
  const brandCountryCode = text(
    object(findField(completeness, "city_country").value).country_code,
  );
  if (!value) {
    return retry(`I didn’t get an answer for that one. ${question}`);
  }
  if (FORBIDDEN_TEXT.test(answer.ownerWords)) {
    return retry(
      `That answer contains text I can’t save safely. ${question}`,
    );
  }
  const base = {
    brand_id: brandId,
    expected_plan_revision: planRevision,
    expected_context_revision: contextRevision,
    evidence: { source_type: "owner" },
    cites: [{ kind: "owner_words", quote: answer.ownerWords.slice(0, 500) }],
  };
  const proposal = (
    patch: Record<string, unknown>,
    why: string,
  ): WebsiteSetupContextResolution => ({
    kind: "proposal",
    args: { ...base, patch, why: why.slice(0, 300) },
  });

  const notApplicable = websiteSetupSaysNotApplicable(value);
  const hasValueSignal = fieldKey === "contact_email"
    ? value.includes("@")
    : fieldKey === "contact_phone"
    ? /\d{6,}|\d[\d\s().-]{6,}\d/.test(value)
    : fieldKey === "social_links"
    ? websiteSetupLinks(value).ok
    : fieldKey === "city_country"
    ? websiteSetupCityCountry(value).ok
    : false;
  if (notApplicable && !hasValueSignal) {
    if (!CONTEXT_EXCEPTION_FIELD_KEYS.has(fieldKey)) {
      return retry(
        `The Website needs this detail, so it can’t be skipped. ${question}`,
      );
    }
    const reason = (answer.response || answer.choices).slice(0, 500);
    return {
      kind: "proposal",
      args: {
        ...base,
        exceptions: [{ field_key: fieldKey, reason }],
        why: `The owner said the Website should not show ${
          NOT_APPLICABLE_WHY[fieldKey]
        }: “${reason}”`.slice(0, 300),
      },
    };
  }

  switch (fieldKey) {
    case "name": {
      const name = value.trim();
      if (name.length > 80) {
        return retry(
          "That name is longer than 80 characters. What shorter public brand name should the Website use?",
        );
      }
      return proposal(
        { name },
        "The owner gave the public brand name during Website setup.",
      );
    }
    case "description": {
      const description = value.trim();
      if (description.length > 500) {
        return retry(
          "That description is longer than 500 characters. In one or two shorter sentences, how should the Website describe this brand?",
        );
      }
      return proposal(
        { description },
        "The owner described the brand in their own words during Website setup.",
      );
    }
    case "contact_email": {
      const email = websiteSetupEmail(value);
      return email.ok
        ? proposal(
          { contact_email: email.value },
          "The owner gave the public contact email during Website setup.",
        )
        : retry(email.problem);
    }
    case "contact_phone": {
      const phone = websiteSetupPhone({
        text: value,
        countryIso: answer.country,
        stored: typeof field.value === "string" ? field.value : null,
        brandCountryCode,
      });
      return phone.ok
        ? proposal(
          { contact_phone: phone.value },
          "The owner gave the public phone number, with its country code, during Website setup.",
        )
        : retry(phone.problem);
    }
    case "address": {
      const address = value.trim();
      if (address.length < 3 || !/[A-Za-z0-9]/.test(address)) {
        return retry(`That doesn’t look like an address. ${question}`);
      }
      if (address.length > 240) {
        return retry(
          "That address is longer than 240 characters. What shorter public street address should the Website show?",
        );
      }
      return proposal(
        { address },
        "The owner gave the public street address during Website setup.",
      );
    }
    case "city_country": {
      const place = websiteSetupCityCountry(value);
      return place.ok
        ? proposal(
          { city: place.value.city, country_code: place.value.country_code },
          "The owner gave the city and country during Website setup.",
        )
        : retry(place.problem);
    }
    case "social_links": {
      const links = websiteSetupLinks(value);
      if (!links.ok) return retry(links.problem);
      const slot = WEBSITE_SETUP_LINK_PLATFORMS.find((platform) =>
        platform.label.toLowerCase() === answer.choices.trim().toLowerCase()
      );
      if (answer.choices && !slot) {
        return retry(`Pick where this link belongs. ${question}`);
      }
      if (slot) {
        const found = Object.entries(links.value);
        if (found.length !== 1) {
          return retry(
            `Paste one ${slot.label} link at a time. ${question}`,
          );
        }
        const [hostKey, url] = found[0];
        // The website box takes any page; a platform box only that platform.
        if (slot.key !== "website" && hostKey !== slot.key) {
          return retry(
            `That link isn’t for ${slot.label}. Paste your ${slot.label} link, or pick the platform it belongs to.`,
          );
        }
        links.value = { [slot.key]: url };
      }
      return proposal(
        {
          social_links: {
            ...existingSocialLinks(field),
            ...links.value,
          },
        },
        `The owner gave their public ${
          naturalList(
            Object.keys(links.value).map((key) => SOCIAL_KEY_LABELS[key]),
          )
        } link during Website setup.`,
      );
    }
    case "theme": {
      const preset = WEBSITE_SETUP_THEME_PRESETS.find((candidate) =>
        candidate.label.toLowerCase() === value.trim().toLowerCase()
      );
      if (!preset) {
        return retry(
          `Pick one of the three looks so I can save exactly what it shows. ${question}`,
        );
      }
      return proposal(
        { theme: { ...preset.theme } },
        `The owner chose the “${preset.label}” look: ${preset.detail}.`,
      );
    }
    default:
      return retry(question);
  }
}

function setupQuestion(fieldKey: string, field: JsonObject): string {
  if (fieldKey === "profile_photo") {
    return "Your logo needs your upload. Can you upload it in Brand details, save, and tell me when it’s done so I can re-check it?";
  }
  if (fieldKey === "cover_media") {
    return "Your cover media needs your upload. Can you add it in Brand details, save, and tell me when it’s done so I can re-check it?";
  }
  if (field.human_action_required === true) {
    const label = fieldLabel(field, fieldKey);
    return `${label} needs your upload. Can you use Add it myself to upload it, then tell me when it is ready so I can check it and move on?`;
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
      return "Which look should your Mingla page use?";
    case "approved_plan":
      return "Everything before approval is ready. Can you open the plan, check it, and approve it yourself?";
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
  // #2830 — the one status, the same numbers the setup screen shows. The old
  // tick is only for the deploy window before the migration.
  const status = plan.setup_status ? object(plan.setup_status) : object(plan.status);
  const completeness = object(plan.completeness);
  const parts = Array.isArray(status.parts) ? status.parts.map(object) : [];
  const doneParts = parts.filter((part) => part.done === true).map((part) =>
    PART_LABELS[String(part.key ?? "")] ??
      text(part.label) ??
      websiteSetupPlainKey(String(part.key ?? "Setup part"))
  );
  const openParts = parts.filter((part) => part.done !== true).map((part) =>
    PART_LABELS[String(part.key ?? "")] ??
      text(part.label) ??
      websiteSetupPlainKey(String(part.key ?? "Setup part"))
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
      : "Nothing required or recommended is missing.";
    const reply =
      `Website setup for ${brand} is ${doneCount} of ${total} complete. ${partSummary}\n\n${gapSummary}\n\nChoose Fix all gaps with Ari, Review the gaps, or use Add it myself. I will not create a draft until setup and your brand details are complete.`;
    return {
      text: reply,
      rendition: {
        schema_version: 2,
        rendition_id: "website-setup:audit",
        kind: "website-setup",
        eyebrow: "Website setup",
        title: gaps.length > 0
          ? `${verifiedCount} ready · ${gaps.length} need attention`
          : "Your brand details are ready",
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
            label: "Brand details complete",
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
              body: "Nothing required or recommended is missing.",
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
                message: WEBSITE_SETUP_FIX_ALL_MESSAGE,
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
      `I read the live Website plan for ${brand}, but I couldn’t start Website setup. Nothing was changed and no draft was created. Try again and I’ll pick up where we left off.`;
    return blockedPresentation(
      reply,
      "Ari couldn’t start Website setup",
    );
  }
  const result = object(jobRead.result);
  if (result.blocked_by_other_job === true) {
    const takeover = result.takeover_available === true
      ? "An owner or admin can choose to wait or explicitly take over."
      : "Ask the teammate who owns it to finish or release it.";
    const reply =
      `Another teammate is already working through Website setup for ${brand}. I didn’t start a second one or create a draft. ${takeover}`;
    return blockedPresentation(reply, "Another teammate owns this setup");
  }
  const job = object(result.job);
  const checkpoint = object(job.checkpoint);
  const pending = stringArray(job.pending_step_keys);
  const completed = stringArray(job.completed_step_keys);
  if (pending.length === 0 || job.status === "completed") {
    const reply =
      `Every Website detail for ${brand} is filled. I checked each one and nothing required or recommended is missing. No draft has been created yet; review the setup plan next.`;
    return {
      text: reply,
      rendition: {
        schema_version: 2,
        rendition_id: "website-setup:complete",
        kind: "website-setup",
        eyebrow: "Website setup",
        title: "Every Website detail is filled",
        body:
          "Ari re-checked the saved plan: nothing required or recommended is missing.",
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
    // #3355 P1 (D-6): plain words, one counter (the card shows progress) and
    // no engine vocabulary ("durable job", "checkpoint", "re-audit").
    `${
      verb === "resumed" ? "Picking up" : "Starting"
    } Website setup for ${brand}. I’ll look up public facts first, ask only for what I can’t verify, and save each change only after you approve it. No draft will be created first.\n\nNext — ${
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
          label: "Ari saves and re-checks each answer",
        },
        ...fieldInteraction(
          currentStep,
          currentField,
          object(result.completeness),
        ),
      ],
      actions: websiteSetupFieldActions(
        currentStep,
        currentField,
        brandId,
        routeActions,
      ),
    },
  };
}

type RenditionAction = Record<string, unknown>;

/**
 * The actions for one setup step. Owner-only steps (approval, uploads) never
 * carry a "Continue with Ari" submit: their answer is something the owner
 * does in the product, so the only paths are the exact route and a return
 * message that makes Ari re-read the live plan.
 */
function websiteSetupFieldActions(
  fieldKey: string,
  field: JsonObject,
  brandId: string | null,
  routeActions: readonly RenditionAction[],
): RenditionAction[] {
  if (fieldKey === "approved_plan") {
    return [
      ...(brandId
        ? [{
          id: "review-approve-plan",
          label: "Review and approve the plan",
          style: "primary",
          behavior: {
            type: "route",
            route: websiteSetupApprovalRoute(brandId),
          },
        }]
        : []),
      {
        id: "approved-continue",
        label: "I’ve approved it",
        style: "secondary",
        behavior: {
          type: "submit",
          message: WEBSITE_SETUP_RETURN_MESSAGES.approved,
        },
      },
    ];
  }
  const upload = WEBSITE_SETUP_UPLOAD_HANDOFFS[fieldKey];
  if (upload) {
    const route = brandId ? websiteSetupUploadRoute(brandId, fieldKey) : null;
    return [
      ...(route
        ? [{
          id: "upload-handoff",
          label: upload.actionLabel,
          style: "primary",
          behavior: { type: "route", route },
        }]
        : []),
      {
        id: "uploaded-continue",
        label: "I’ve uploaded it",
        style: "secondary",
        behavior: {
          type: "submit",
          message: WEBSITE_SETUP_RETURN_MESSAGES.uploaded,
        },
      },
    ];
  }
  return [
    ...(field.human_action_required === true ? routeActions : [{
      id: "continue-with-ari",
      label: "Continue with Ari",
      style: "primary",
      behavior: {
        type: "submit",
        message: `Use my answer for ${
          fieldLabel(field, fieldKey)
        }${WEBSITE_SETUP_SUBMISSION_SUFFIX}`,
      },
    }]),
    {
      id: "review-remaining",
      label: "Review remaining gaps",
      style: "secondary",
      behavior: {
        type: "submit",
        message: "Review every remaining Website setup gap before continuing.",
      },
    },
    ...routeActions,
  ].slice(0, 3);
}

/**
 * A structured answer Ari could not use. Nothing is written: the reply says
 * exactly what was wrong and re-asks the same one question with the same
 * controls, instead of letting a model guess.
 */
export function buildWebsiteSetupRetryPresentation(args: {
  fieldKey: string;
  field: JsonObject;
  brandId: string | null;
  problem: string;
  completeness?: JsonObject;
}): WebsiteSetupPresentation {
  const { fieldKey, field, brandId, problem } = args;
  const completeness = args.completeness ?? {};
  const ownerStep = fieldKey === "approved_plan" ||
    WEBSITE_SETUP_UPLOAD_HANDOFFS[fieldKey] !== undefined;
  const routeActions = brandId
    ? [{
      id: "add-it-myself",
      label: "Add it myself",
      style: "secondary",
      behavior: { type: "route", route: `/brand/${brandId}/edit` },
    }]
    : [];
  return {
    text: problem,
    rendition: {
      schema_version: 2,
      rendition_id: `website-setup:retry-${fieldKey.replaceAll(".", "-")}`,
      kind: "website-setup",
      eyebrow: "Ari owns the setup",
      title: fieldLabel(field, fieldKey),
      body: problem,
      ...(ownerStep ? {} : { tone: "warning" }),
      state: "ready",
      graphic: "site",
      blocks: [
        ...(ownerStep ? [] : [{
          type: "callout",
          version: 1,
          id: "nothing-saved",
          tone: "warning",
          title: "Nothing was saved",
          body:
            "Answer the same question again and Ari will confirm the exact change before saving.",
        }]),
        ...fieldInteraction(fieldKey, field, completeness),
      ],
      actions: websiteSetupFieldActions(fieldKey, field, brandId, routeActions),
    } as AriRenditionV2,
  };
}

/**
 * #2830 P4 — the form-shaped card for ONE Website field on the flow engine.
 *
 * It reuses the exact controls the Website setup cards already use (the
 * Brand details form's shapes: phone = country chip + number, choices for
 * offerings / design / main action / theme, a pasted link with its
 * platform). One progress counter only — the plan's own "Part n of 8" — and
 * no "Verified / Remaining" metrics. The card's answer travels as a bound
 * flow answer; the submit message keeps the shape an older Host sends, which
 * the engine also reads (never as a model guess).
 */
export function buildWebsiteSetupFlowRendition(args: {
  fieldKey: string;
  field: Record<string, unknown>;
  completeness: Record<string, unknown>;
  brandId: string;
  partNumber: number;
  partTotal: number;
  partLabel: string;
  problem?: string | null;
  /**
   * #2830 P4 — after a refusal, what the owner gave last time: the same card
   * comes back with it filled in (their own words and choices only), so they
   * fix what was wrong instead of retyping everything.
   */
  draft?: {
    choices: string[];
    country: string | null;
    response: string;
  } | null;
  /**
   * #2830 — a value Ari found on a public page. The card shows it with where it
   * came from; the choices beside it are "Use this" and "Use another".
   */
  found?: { source_line: string; value: string; question: string } | null;
}): AriRenditionV2 {
  const { fieldKey, field, completeness, brandId } = args;
  const found = args.found ?? null;
  const question = found?.question ?? setupQuestion(fieldKey, field);
  const label = fieldLabel(field, fieldKey);
  const interaction = found
    ? [{
      type: "callout",
      version: 1,
      id: "research-found",
      tone: "default",
      title: found.source_line,
      body: found.value,
    }]
    : fieldInteraction(fieldKey, field, completeness);
  const draft = args.draft ?? null;
  const blocks = draft
    ? interaction.map((block) => withDraft(block, draft))
    : interaction;
  return {
    schema_version: 2,
    rendition_id: `website-setup:field-${fieldKey.replaceAll(".", "-")}`,
    kind: "website-setup",
    eyebrow:
      `Website setup · Part ${args.partNumber} of ${args.partTotal} · ${args.partLabel}`,
    title: label,
    body: args.problem ? `${args.problem}` : question,
    ...(args.problem ? { tone: "warning" } : {}),
    state: "ready",
    graphic: "site",
    blocks: [
      ...(args.problem
        ? [{
          type: "callout",
          version: 1,
          id: "nothing-saved",
          tone: "warning",
          title: "Nothing was saved",
          body:
            "Answer again and Ari will show you the exact change before saving.",
        }]
        : []),
      ...blocks,
    ],
    // #2830: a found value is answered by "Use this" / "Use another" beside it.
    actions: found ? [] : [
      {
        id: "continue-with-ari",
        label: "Continue with Ari",
        style: "primary",
        behavior: {
          type: "submit",
          message:
            `Use my answer for ${label}${WEBSITE_SETUP_SUBMISSION_SUFFIX}`,
        },
      },
      {
        id: "add-it-myself",
        label: "Add it myself",
        style: "secondary",
        behavior: { type: "route", route: `/brand/${brandId}/edit` },
      },
    ],
  } as AriRenditionV2;
}

/** Fill one answer block with the owner's previous answer. */
function withDraft(
  block: Record<string, unknown>,
  draft: { choices: string[]; country: string | null; response: string },
): Record<string, unknown> {
  if (block.type === "choices" && Array.isArray(block.options)) {
    const chosen = new Set(draft.choices.map((choice) => choice.toLowerCase()));
    return {
      ...block,
      options: block.options.map((option) => {
        const entry = object(option);
        return chosen.has(String(entry.label ?? "").toLowerCase())
          ? { ...entry, selected: true }
          : entry;
      }),
    };
  }
  if (block.type === "input") {
    const fieldModel = object(block.field);
    const response = draft.response.trim().slice(0, 2000);
    if (!response) return block;
    const country = fieldModel.kind === "phone" && draft.country
      ? phoneCountry(draft.country)
      : null;
    const filled: Record<string, unknown> = { ...fieldModel, value: response };
    if (country) {
      delete filled.countryPlaceholder;
      filled.countryIso = country.code;
      filled.label = `${
        fieldLabelOnly(String(fieldModel.label ?? ""))
      } — ${country.name} (${country.dialCode})`;
    }
    return { ...block, field: filled };
  }
  return block;
}

/** "Contact phone — United Kingdom (+44)" → "Contact phone". */
function fieldLabelOnly(label: string): string {
  return label.split(" — ")[0];
}

/** #2830 P4 — the one question Ari asks for a Website field. */
export function websiteSetupQuestion(
  fieldKey: string,
  field: Record<string, unknown>,
): string {
  return setupQuestion(fieldKey, field);
}

/** #2830 P4 — the owner label the canonical audit gives a field. */
export function websiteSetupFieldLabel(
  field: Record<string, unknown>,
  fieldKey: string,
): string {
  return fieldLabel(field, fieldKey);
}

/**
 * #2830 P4 — the upload handoff for logo / cover: Ari never adds media; the
 * owner uploads in Brand details and Ari re-checks.
 */
export function websiteSetupUploadHandoff(fieldKey: string): {
  actionLabel: string;
  body: string;
} | null {
  const handoff = WEBSITE_SETUP_UPLOAD_HANDOFFS[fieldKey];
  return handoff
    ? { actionLabel: handoff.actionLabel, body: handoff.body }
    : null;
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
