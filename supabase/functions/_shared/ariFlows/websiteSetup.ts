/**
 * Issue #2830 P4 — Website setup on the Ari flow engine (the proof consumer).
 *
 * One versioned flow, one step per plan part, in plan order:
 *
 *   offer → brand → look → story → approve → build → first_offering → publish
 *
 * Every probe reads canonical state only: the live Website plan read
 * (`get_site_plan`: the eight server-derived part ticks + the field-level
 * completeness audit), the brand's site, the draft's validation receipt and
 * the design checks. The runner, never the model and never the phone, moves
 * the run; every "done" carries what the probe saw.
 *
 * How each part is resolved:
 *   - offer / brand / look / story: ONE field at a time, asked with the same
 *     control the Brand details form / plan screens use (the existing
 *     Website answer cards). An answer becomes one protected proposal; after
 *     the confirm, the receipt line is built from the re-read plan (never
 *     from the request). Logo and cover are upload handoffs: Ari never adds
 *     media, it re-checks after the owner returns.
 *   - look: "Use Mingla's default design" saves the default design (labelled
 *     changeable) through the same protected confirmation (Seth 2026-11-01,
 *     decision 7), so skipping the look is never a dead end at build.
 *   - approve: owner-only. A review handoff to the plan's approval part;
 *     Ari never approves the plan.
 *   - build: refuses until the plan's first five parts, the context audit
 *     and the owner's approval are all true; then proposes ONE draft build
 *     (create_site_draft reuses the brand's site — never a second website),
 *     and verifies the saved site and pages before moving on.
 *   - first_offering (optional): create through the existing lane after the
 *     readiness preamble, or "Not now" (it stays on the plan). The created
 *     record is checked by id; it is never offered twice.
 *   - publish: validate the exact draft, run the first-publish design checks
 *     on that same digest, show problems instead of guessing, and propose a
 *     publish bound to that exact revision and digest. Publishing happens
 *     only after the owner confirms that card; the plan is read back after.
 *
 * "Not now" (Seth 2026-11-01): a skipped item stays on the to-do list and Ari
 * proceeds. Items the Website cannot be built without say so plainly; the
 * build step lists whatever is still open and offers to add it.
 */

import {
  buildWebsiteSetupFlowRendition,
  resolveWebsiteSetupContextAnswer,
  WEBSITE_SETUP_SUBMISSION_SUFFIX,
  WEBSITE_SETUP_THEME_PRESETS,
  websiteSetupApprovalRoute,
  websiteSetupContextAnswer,
  websiteSetupDesignAnswer,
  websiteSetupFieldLabel,
  websiteSetupMergedPlanAnswers,
  websiteSetupPlanAnswer,
  websiteSetupPlanRevision,
  websiteSetupQuestion,
  websiteSetupUploadHandoff,
  websiteSetupUploadRoute,
} from "../agentWebsiteSetup.ts";
import {
  DESIGN_KEYS,
  type DesignKey,
  DESIGNS,
} from "../siteContracts/designs.ts";
import {
  PLAN_OFFERING_OPTIONS,
  PLAN_PARTS,
  type PlanPartKey,
} from "../siteContracts/sitePlan.ts";
import {
  formatPhoneNational,
  parsePhoneEntry,
  phoneDialCodeForCountry,
} from "../../../../packages/phone-input/phoneNumber.ts";
import { COUNTRY_DIRECTORY } from "../../../../packages/phone-input/countryDirectory.ts";
import { itemHandoff } from "./brandGate.ts";
import { isResearchField, researchSourceLine } from "../ariBrandResearchCopy.ts";
import type {
  AnswerOutcome,
  AskSpec,
  FlowAnswer,
  FlowAnswerValues,
  FlowContext,
  FlowDefinition,
  FlowEvidence,
  FlowRun,
  ProbeResult,
  StepDefinition,
} from "./types.ts";

export const WEBSITE_SETUP_FLOW_KEY = "website_setup";

/** Mingla's default Website design (the composer's own fallback). */
export const WEBSITE_DEFAULT_DESIGN: DesignKey = "atelier";

const FORM = "answer";

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function listWords(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** The live Website plan, or null when it cannot be read right now. */
async function readPlan(ctx: FlowContext): Promise<Json | null> {
  if (!ctx.deps.readTool) return null;
  try {
    const plan = object(
      await ctx.deps.readTool("get_site_plan", { brand_id: ctx.run.brand_id }),
    );
    return Object.keys(plan).length > 0 ? plan : null;
  } catch (_error) {
    return null;
  }
}

function parts(plan: Json): Json[] {
  const status = object(plan.status);
  return Array.isArray(status.parts) ? status.parts.map(object) : [];
}

export function websitePartDone(plan: Json, key: PlanPartKey): boolean {
  return parts(plan).some((part) => part.key === key && part.done === true);
}

function completeness(plan: Json): Json {
  return object(plan.completeness);
}

function fieldsOf(plan: Json): Json[] {
  const audit = completeness(plan);
  return Array.isArray(audit.fields) ? audit.fields.map(object) : [];
}

function fieldOf(plan: Json, key: string): Json {
  return fieldsOf(plan).find((field) => field.key === key) ?? {};
}

function settledField(field: Json): boolean {
  return ["verified", "not_applicable"].includes(String(field.state ?? ""));
}

function fieldNeeded(field: Json): boolean {
  return field.requirement !== "optional" && !settledField(field) &&
    typeof field.key === "string";
}

const skipKey = (fieldKey: string) => `website:${fieldKey}`;

function partNumber(key: PlanPartKey): number {
  return PLAN_PARTS.findIndex((part) => part.key === key) + 1;
}

function partLabel(key: PlanPartKey): string {
  return PLAN_PARTS.find((part) => part.key === key)?.label ?? "Website setup";
}

function planEvidence(plan: Json, observed: unknown): FlowEvidence {
  return {
    probe: "site_plan",
    observed,
    context_revision: str(completeness(plan).context_revision),
  };
}

function unavailableAsk(stepKey: string): ProbeResult {
  return {
    done: false,
    ask: {
      kind: "question",
      reuse_key: `website:${stepKey}:unavailable`,
      title: "Website setup",
      text:
        "I couldn't read your Website plan just now, so I haven't changed anything. Try again in a moment.",
      options: [{ id: "check", label: "Try again" }],
      record: {},
    },
  };
}

// ── Owner words for a value read back from the plan ────────────────────────

function countryName(code: string): string {
  return COUNTRY_DIRECTORY.find((country) => country.code === code)?.name ??
    code;
}

function phoneWords(e164: string): string {
  const parsed = parsePhoneEntry(e164, { mode: "any" });
  if (!parsed.ok || !parsed.countryIso) return e164;
  const dial = phoneDialCodeForCountry(parsed.countryIso);
  if (!dial || !e164.startsWith(dial)) return e164;
  return `${dial} ${
    formatPhoneNational(parsed.countryIso, e164.slice(dial.length))
  }`;
}

const SOCIAL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  website: "Website",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
});

const NOT_SHOWN: Readonly<Record<string, string>> = Object.freeze({
  contact_email: "a public contact email",
  contact_phone: "a public phone number",
  address: "a street address",
  city_country: "a city and country",
  social_links: "a public website or social link",
  theme: "a Mingla page theme",
  venue_descriptor: "a venue description",
});

/**
 * The receipt line, built only from what the re-read plan holds now.
 * Exported for tests.
 */
export function websiteReadbackLine(fieldKey: string, field: Json): string {
  const label = websiteSetupFieldLabel(field, fieldKey);
  if (field.state === "not_applicable") {
    return `Saved. Your Website won't show ${
      NOT_SHOWN[fieldKey] ?? lowerFirst(label)
    }.`;
  }
  const value = field.value;
  let words: string | null = null;
  switch (fieldKey) {
    case "contact_phone":
      words = str(value) ? phoneWords(String(value)) : null;
      break;
    case "design_key": {
      const key = str(value) as DesignKey | null;
      words = key && DESIGNS[key] ? DESIGNS[key].label : null;
      break;
    }
    case "offerings_selected":
      words = Array.isArray(value)
        ? listWords(value.flatMap((key) => {
          const option = PLAN_OFFERING_OPTIONS.find((o) => o.key === key);
          return option ? [option.label] : [];
        }))
        : null;
      break;
    case "city_country": {
      const place = object(value);
      const city = str(place.city);
      const code = str(place.country_code);
      words = city && code ? `${city}, ${countryName(code)}` : city;
      break;
    }
    case "social_links": {
      // The saved link itself, named by where it goes ("Website: https://…"),
      // not just the platform name.
      const links = object(object(value).social_links);
      const saved = Object.entries(links).flatMap(([key, url]) =>
        str(url) ? [`${SOCIAL_NAMES[key] ?? key}: ${str(url)}`] : []
      );
      if (saved.length > 0) {
        const shownLinks = listWords(saved);
        return `Saved. ${
          shownLinks.length > 240 ? `${shownLinks.slice(0, 237)}…` : shownLinks
        }.`;
      }
      words = null;
      break;
    }
    case "theme": {
      const theme = object(value);
      const preset = WEBSITE_SETUP_THEME_PRESETS.find((candidate) =>
        candidate.theme.color === theme.color &&
        candidate.theme.font === theme.font
      );
      words = preset?.label ?? null;
      break;
    }
    default:
      words = str(value);
  }
  if (!words) return `Saved. ${label} is set.`;
  const shown = words.length > 140 ? `${words.slice(0, 137)}…` : words;
  return `Saved. ${label}: ${sentenceEnd(shown)}`;
}

/** Ends a quoted answer with one full stop: "…locals." never "…locals..". */
function sentenceEnd(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

// ── Form answers ───────────────────────────────────────────────────────────

const LEGACY =
  /^Use my answer for (.+?), confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap\.(?: Choices: (.*?))?(?: Country: ([A-Za-z]{2}))?(?: Response: (.*))?$/i;
const QUESTION_LIKE =
  /\?\s*$|^(?:how|what|why|where|when|which|who|can|could|should|do|does|is|are|will|would)\b/i;
const NOT_AN_ANSWER =
  /\b(?:website setup|fix all|review (?:every|the)|start over|cancel|stop)\b/i;

const CHOICE_FIELDS = new Set([
  "offerings_selected",
  "design_key",
  "theme",
]);

/** A choice card's options: the label the owner sees and the option's id. */
function choiceOptions(fieldKey: string): { id: string; label: string }[] {
  switch (fieldKey) {
    case "offerings_selected":
      return PLAN_OFFERING_OPTIONS.map((option) => ({
        id: option.key,
        label: option.label,
      }));
    case "design_key":
      return DESIGN_KEYS.map((key) => ({ id: key, label: DESIGNS[key].label }));
    case "theme":
      return WEBSITE_SETUP_THEME_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
      }));
    default:
      return [];
  }
}

/** Case-, whitespace- and punctuation-insensitive form of a typed choice. */
function choiceKey(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "").replace(/[\s_-]+/g, " ")
    .replace(/[.!]+$/, "").trim();
}

/**
 * The option a typed part names, by its label or its id ("Warm and
 * welcoming", "warm and  welcoming.", "warm"), or null.
 */
function matchChoice(fieldKey: string, part: string): string | null {
  const key = choiceKey(part);
  if (!key) return null;
  const option = choiceOptions(fieldKey).find((candidate) =>
    choiceKey(candidate.label) === key || choiceKey(candidate.id) === key
  );
  return option?.label ?? null;
}

/**
 * A typed reply read as the open field's answer: an older Host's card
 * submission, or a plain value typed into the composer. Questions and
 * Website commands are never answers (the model or the engine takes them).
 */
export function websiteTextAnswer(
  fieldKey: string,
  text: string,
): FlowAnswerValues | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 2000) return null;
  const legacy = normalized.match(LEGACY);
  if (legacy) {
    return {
      choices: (legacy[2] ?? "").split(",").map((part) => part.trim())
        .filter(Boolean),
      country: legacy[3] ? legacy[3].toUpperCase() : null,
      response: (legacy[4] ?? "").trim(),
    };
  }
  if (QUESTION_LIKE.test(normalized) || NOT_AN_ANSWER.test(normalized)) {
    return null;
  }
  if (CHOICE_FIELDS.has(fieldKey)) {
    // The whole reply first: a label may itself contain "and" ("Warm and
    // welcoming"), so splitting it would lose the exact choice the card
    // shows. Only then a list of several choices ("Trips, events").
    const whole = matchChoice(fieldKey, normalized);
    if (whole) return { choices: [whole], country: null, response: "" };
    const picked = normalized.split(/,|\band\b|&/i).map((part) => part.trim())
      .filter(Boolean);
    const matched = picked.flatMap((part) => {
      const label = matchChoice(fieldKey, part);
      return label ? [label] : [];
    });
    return matched.length > 0 && matched.length === picked.length
      ? { choices: [...new Set(matched)], country: null, response: "" }
      : null;
  }
  return { choices: [], country: null, response: normalized };
}

/** The exact message shape the existing Website parsers read. */
export function websiteAnswerMessage(
  label: string,
  values: FlowAnswerValues,
): string {
  return [
    `Use my answer for ${label}${WEBSITE_SETUP_SUBMISSION_SUFFIX}`,
    values.choices.length > 0 ? `Choices: ${values.choices.join(", ")}` : "",
    values.country && /^[A-Z]{2}$/.test(values.country)
      ? `Country: ${values.country}`
      : "",
    values.response.trim() ? `Response: ${values.response.trim()}` : "",
  ].filter(Boolean).join(" ");
}

type Resolution =
  | { kind: "propose"; tool_name: string; tool_args: Json }
  | { kind: "retry"; problem: string }
  | { kind: "stale" };

/**
 * Turn one form answer for `fieldKey` into the exact protected proposal it
 * represents, against a fresh plan read — reusing the Website setup parsers
 * and validators unchanged. Anything Ari cannot use writes nothing and
 * re-asks the same question with what was wrong.
 */
export function resolveWebsiteFormAnswer(args: {
  brandId: string;
  fieldKey: string;
  plan: Json;
  values: FlowAnswerValues;
}): Resolution {
  const field = fieldOf(args.plan, args.fieldKey);
  const label = websiteSetupFieldLabel(field, args.fieldKey);
  const message = websiteAnswerMessage(label, args.values);
  const revision = websiteSetupPlanRevision(args.plan);
  if (revision === null) {
    return {
      kind: "retry",
      problem:
        "I couldn't refresh your Website plan, so nothing was saved. Try that again in a moment.",
    };
  }
  const design = websiteSetupDesignAnswer(message);
  if (design) {
    if (args.fieldKey !== "design_key") return { kind: "stale" };
    return {
      kind: "propose",
      tool_name: "save_site_plan_design",
      tool_args: {
        brand_id: args.brandId,
        expected_plan_revision: revision,
        design_key: design.designKey,
        source_type: "owner",
        why: `The owner chose ${
          DESIGNS[design.designKey].label
        } for the Website.`,
        cites: [{ kind: "owner_words", quote: design.ownerWords }],
      },
    };
  }
  const planAnswer = websiteSetupPlanAnswer(message);
  if (planAnswer) {
    if (planAnswer.fieldKey !== args.fieldKey) return { kind: "stale" };
    return {
      kind: "propose",
      tool_name: "save_site_plan_answers",
      tool_args: {
        brand_id: args.brandId,
        expected_plan_revision: revision,
        answers: websiteSetupMergedPlanAnswers(args.plan, planAnswer.answers),
        why: `Save ${planAnswer.ownerWords} for ${planAnswer.fieldLabel}.`
          .slice(0, 300),
        cites: [{ kind: "owner_words", quote: planAnswer.ownerWords }],
      },
    };
  }
  const contextAnswer = websiteSetupContextAnswer(message);
  if (contextAnswer) {
    if (contextAnswer.fieldKey !== args.fieldKey) return { kind: "stale" };
    const resolved = resolveWebsiteSetupContextAnswer({
      brandId: args.brandId,
      plan: args.plan,
      answer: contextAnswer,
    });
    if (resolved.kind === "proposal") {
      return {
        kind: "propose",
        tool_name: "update_brand_context",
        tool_args: resolved.args,
      };
    }
    if (resolved.kind === "retry") {
      return { kind: "retry", problem: resolved.problem };
    }
    return {
      kind: "retry",
      problem:
        "I couldn't refresh your Website details, so nothing was saved. Try that again in a moment.",
    };
  }
  // A choice card answered with nothing usable, or a field the parsers do
  // not read from a form: say so, re-ask, save nothing.
  return {
    kind: "retry",
    problem: `I didn't get an answer I can save. ${
      websiteSetupQuestion(args.fieldKey, field)
    }`,
  };
}

// ── Steps ──────────────────────────────────────────────────────────────────

/** A saved draft answer (step data is JSON; read it back defensively). */
function draftOf(value: unknown): FlowAnswerValues | null {
  const raw = object(value);
  const choices = Array.isArray(raw.choices)
    ? raw.choices.filter((choice): choice is string =>
      typeof choice === "string"
    ).slice(0, 10)
    : [];
  const country = typeof raw.country === "string" &&
      /^[A-Z]{2}$/.test(raw.country)
    ? raw.country
    : null;
  const response = typeof raw.response === "string"
    ? raw.response.slice(0, 2000)
    : "";
  return choices.length > 0 || country || response.trim()
    ? { choices, country, response }
    : null;
}

/** Brand-context fields whose "not now" keeps them on the to-do list. */
function canSetAside(field: Json): boolean {
  return field.requirement === "recommended";
}

const AUDIENCE =
  "This is shown on your public Website, and I'll show you the exact change before saving anything.";

// #2830 — "Use this" / "Use another" on a value found on a public page.
const USE_FOUND = "use_found";
const USE_ANOTHER = "use_another";
const FOUND_QUESTION: Readonly<Record<string, string>> = Object.freeze({
  contact_email: "Should people use this email?",
  contact_phone: "Should people use this number?",
  address: "Is this your address?",
  city_country: "Is this where you are?",
  social_links: "Is this your page?",
});

/** One value, one source: anything else is not a clean "Use this". */
function singleFound(field: Json): Json | null {
  const rows = Array.isArray(field.evidence_candidates)
    ? field.evidence_candidates.map(object)
    : [];
  return rows.length === 1 && str(rows[0].value) &&
      rows[0].source_type === "public_research"
    ? rows[0]
    : null;
}

/**
 * #2830 — Ari's research for this field, if any, as this question's evidence.
 * Research is started by the brand step and never holds the question up. A
 * candidate becomes evidence here, not when the search finished, so it can't
 * move the context revision under a proposal the owner is looking at. Only a
 * field with no value takes a finding; a saved value is never put in question.
 */
async function withResearch(
  ctx: FlowContext,
  plan: Json,
  key: string,
  field: Json,
  declined: boolean,
): Promise<{ field: Json; found: Json | null }> {
  // The owner said "Use another": the plain question, without the candidate.
  if (declined) {
    return { field: { ...field, evidence_candidates: [] }, found: null };
  }
  let research: Record<string, Record<string, unknown>[] | undefined> | null =
    null;
  try {
    research = await ctx.deps.brandResearch?.(plan) ?? null;
  } catch (_error) {
    research = null;
  }
  // An empty answer means the brand changed since this was found: don't offer it.
  if (research && Object.keys(research).length === 0) {
    return { field: { ...field, evidence_candidates: [] }, found: null };
  }
  const existing = singleFound(field);
  if (existing) return { field, found: existing };
  if (!isResearchField(key) || field.state !== "missing") {
    return { field, found: null };
  }
  const candidates = research?.[key];
  if (!candidates || candidates.length !== 1 || !ctx.deps.recordFinding) {
    return { field, found: null };
  }
  let recorded = false;
  try {
    recorded = await ctx.deps.recordFinding(key, candidates);
  } catch (_error) {
    recorded = false;
  }
  if (!recorded) return { field, found: null };
  return {
    field: { ...field, state: "stale", evidence_candidates: candidates },
    found: object(candidates[0]),
  };
}

function formAsk(args: {
  ctx: FlowContext;
  part: PlanPartKey;
  fieldKey: string;
  field: Json;
  plan: Json;
  problem: string | null;
  attempt: number;
  extraOptions?: { id: string; label: string }[];
  /** What the owner gave last time, shown again after a refusal. */
  draft?: FlowAnswerValues | null;
  /** #2830 — one value Ari found on a public page, for the owner to decide. */
  found?: Json | null;
}): AskSpec {
  const { field, fieldKey } = args;
  const label = websiteSetupFieldLabel(field, fieldKey);
  const found = args.found && !args.problem ? args.found : null;
  const foundValue = found ? str(found.value) : null;
  const foundLine = found ? researchSourceLine(found) : null;
  const foundQuestion = FOUND_QUESTION[fieldKey] ??
    "Should people use this one?";
  const question = foundValue
    ? `${foundLine}. ${foundQuestion}`
    : websiteSetupQuestion(fieldKey, field);
  return {
    kind: "question",
    answer_mode: "form",
    reuse_key: foundValue
      ? `website:${fieldKey}:found:${args.attempt}`
      : `website:${fieldKey}:${String(field.state ?? "missing")}:${args.attempt}`,
    title: label,
    text: [args.problem, question, args.problem ? "" : AUDIENCE].filter(Boolean)
      .join(" "),
    options: [
      ...(foundValue
        ? [
          { id: USE_FOUND, label: "Use this" },
          { id: USE_ANOTHER, label: "Use another" },
        ]
        : []),
      ...(args.extraOptions ?? []),
      ...(canSetAside(field)
        ? [{ id: "not_now", label: "Not now, keep going" }]
        : []),
    ],
    rendition: buildWebsiteSetupFlowRendition({
      fieldKey,
      field,
      completeness: completeness(args.plan),
      brandId: args.ctx.run.brand_id,
      partNumber: partNumber(args.part),
      partTotal: PLAN_PARTS.length,
      partLabel: partLabel(args.part),
      problem: args.problem,
      draft: args.problem ? args.draft ?? null : null,
      found: foundValue
        ? {
          source_line: foundLine ?? "From a public page",
          value: foundValue,
          question: foundQuestion,
        }
        : null,
    }) as unknown as Record<string, unknown>,
    record: { data: { field_key: fieldKey, attempt: args.attempt } },
  };
}

function uploadAsk(ctx: FlowContext, fieldKey: string, field: Json): AskSpec {
  const upload = websiteSetupUploadHandoff(fieldKey)!;
  const label = websiteSetupFieldLabel(field, fieldKey);
  const route = websiteSetupUploadRoute(ctx.run.brand_id, fieldKey);
  return {
    kind: "handoff",
    reuse_key: `website:handoff:${fieldKey}`,
    title: upload.actionLabel,
    // #3355 — the Host shows an upload card on this handoff (the same
    // pickers Brand details uses); Brand details stays the second way.
    text:
      `${label} is an upload only you can add — Ari never adds media for you. Choose your file here in the chat, or open Brand details, add it and save. I'll check it's there before we move on.`,
    options: [
      ...(route ? [{ id: "open", label: "Open Brand details", route }] : []),
      { id: "check", label: "I've uploaded it, check now" },
      ...(canSetAside(field)
        ? [{ id: "not_now", label: "Not now, keep going" }]
        : []),
    ],
    handoff: {
      item_key: fieldKey,
      item_label: label,
      route,
      route_label: "Brand details",
      can_caller_fix: true,
      who_can_fix: "you",
    },
    ...(mediaPresentButUnusable(field)
      ? {
        not_ready_text: `I can see a ${
          lowerFirst(label)
        }, but it isn't usable yet: it isn't saved at a secure web address your Website can show. Upload it again in Brand details and save, then tell me and I'll check.`,
      }
      : {}),
    record: { data: { field_key: fieldKey } },
  };
}

/**
 * The audit found an upload, but one the Website can't use (state
 * "invalid": not at a secure https address). Different from "missing": the
 * owner did upload something, and saying "it isn't there" would be untrue.
 */
export function mediaPresentButUnusable(field: Json): boolean {
  return field.state === "invalid" ||
    (field.state !== "missing" && !settledField(field) && !!str(field.value));
}

/** Is the owner still looking at an unconfirmed proposal from this step? */
async function proposalStillOpen(ctx: FlowContext): Promise<boolean> {
  if (!ctx.deps.hasOpenProposal) return false;
  try {
    return await ctx.deps.hasOpenProposal();
  } catch (_error) {
    return false;
  }
}

/**
 * After a confirm, the receipt comes from the re-read plan. While the owner
 * has not decided the card yet, the step waits (no second card).
 */
async function readback(
  ctx: FlowContext,
  plan: Json,
): Promise<{ note?: string; wait?: true }> {
  if (ctx.state?.state === "human_action") {
    // Back from an upload handoff: say what the re-read found.
    const fieldKey = str(ctx.state.data?.field_key);
    const field = fieldKey ? fieldOf(plan, fieldKey) : {};
    return fieldKey && settledField(field)
      ? {
        note: `I checked; your ${
          lowerFirst(websiteSetupFieldLabel(field, fieldKey))
        } is there now.`,
      }
      : {};
  }
  if (ctx.state?.state !== "awaiting_approval") return {};
  const fieldKey = str(ctx.state.data?.field_key);
  if (!fieldKey) return {};
  const field = fieldOf(plan, fieldKey);
  if (settledField(field)) {
    return { note: websiteReadbackLine(fieldKey, field) };
  }
  if (ctx.trigger !== "confirm" && await proposalStillOpen(ctx)) {
    return { wait: true };
  }
  return ctx.trigger === "confirm"
    ? {
      note:
        "That change didn't show up in your Website plan, so I'm not showing it as saved. Let's try that one again.",
    }
    : {};
}

function fieldStep(args: {
  part: PlanPartKey;
  title: string;
  fieldKeys: readonly string[];
  depends_on: string[];
  extra?: (field: string) => { id: string; label: string }[];
  /** #2830 — Ari looks for this step's open fields on the public web. */
  research?: boolean;
}): StepDefinition {
  const step: StepDefinition = {
    key: args.part,
    title: args.title,
    kind: "question",
    depends_on: args.depends_on,
    policy: "blocking",
    async probe(ctx: FlowContext): Promise<ProbeResult> {
      const plan = await readPlan(ctx);
      if (!plan) return unavailableAsk(args.part);
      const back = await readback(ctx, plan);
      if (back.wait) return { done: false, wait: true };
      const open = args.fieldKeys.flatMap((key) => {
        const field = fieldOf(plan, key);
        return fieldNeeded(field) &&
            !ctx.run.session_skips.includes(skipKey(key))
          ? [{ key, field }]
          : [];
      });
      if (open.length === 0) {
        return {
          done: true,
          note: back.note,
          evidence: planEvidence(plan, {
            fields: Object.fromEntries(
              args.fieldKeys.map((key) => [
                key,
                String(fieldOf(plan, key).state ?? "missing"),
              ]),
            ),
            set_aside: args.fieldKeys.filter((key) =>
              ctx.run.session_skips.includes(skipKey(key))
            ),
          }),
        };
      }
      const { key, field: openField } = open[0];
      if (websiteSetupUploadHandoff(key)) {
        return {
          done: false,
          note: back.note,
          ask: uploadAsk(ctx, key, openField),
        };
      }
      const data = ctx.state?.data ?? {};
      const sameField = str(data.field_key) === key;
      const attempt = sameField && typeof data.attempt === "number"
        ? data.attempt
        : 0;
      const researched = args.research
        ? await withResearch(
          ctx,
          plan,
          key,
          openField,
          sameField && data.found_declined === true,
        )
        : { field: openField, found: null };
      const field = researched.field;
      return {
        done: false,
        note: back.note,
        ask: formAsk({
          ctx,
          part: args.part,
          fieldKey: key,
          field,
          plan,
          found: researched.found,
          problem: sameField ? str(data.problem) : null,
          attempt,
          extraOptions: args.extra?.(key),
          draft: sameField ? draftOf(data.draft) : null,
        }),
      };
    },
    textAnswer(ctx: FlowContext, text: string): FlowAnswerValues | null {
      const fieldKey = str(ctx.state?.data?.field_key);
      return fieldKey ? websiteTextAnswer(fieldKey, text) : null;
    },
    async onAnswer(
      ctx: FlowContext,
      choiceId: string,
      answer?: FlowAnswer,
    ): Promise<AnswerOutcome | null> {
      const fieldKey = str(ctx.state?.data?.field_key);
      if (!fieldKey || !args.fieldKeys.includes(fieldKey)) return null;
      const attempt = typeof ctx.state?.data?.attempt === "number"
        ? ctx.state.data.attempt as number
        : 0;
      if (choiceId === "not_now") {
        const plan = await readPlan(ctx);
        const field = plan ? fieldOf(plan, fieldKey) : {};
        if (plan && !canSetAside(field)) return null;
        const label = lowerFirst(websiteSetupFieldLabel(field, fieldKey));
        return {
          record: { state: "asked", data: {} },
          session_skips: [
            ...new Set([...ctx.run.session_skips, skipKey(fieldKey)]),
          ],
          ack:
            `Okay, I'll leave your ${label} for now. It stays on your Website to-do list; your pages can't be built until it's added or marked as not applying, and I'll remind you then.`,
        };
      }
      if (choiceId === USE_ANOTHER) {
        return {
          record: {
            state: "asked",
            data: {
              field_key: fieldKey,
              attempt: attempt + 1,
              found_declined: true,
            },
          },
        };
      }
      if (choiceId === USE_FOUND) {
        const plan = await readPlan(ctx);
        const found = plan ? singleFound(fieldOf(plan, fieldKey)) : null;
        const value = found ? str(found.value) : null;
        const resolved: Resolution | null = plan && value
          ? resolveWebsiteFormAnswer({
            brandId: ctx.run.brand_id,
            fieldKey,
            plan,
            values: { choices: [], country: null, response: value },
          })
          : null;
        if (!found || !resolved || resolved.kind !== "propose") {
          // The candidate is gone or no longer valid: nothing saved, plain ask.
          return {
            record: {
              state: "asked",
              data: {
                field_key: fieldKey,
                attempt: attempt + 1,
                found_declined: true,
              },
            },
          };
        }
        // Where it came from stays on the record; the owner's yes is the save.
        return {
          record: { state: "awaiting_approval", data: { field_key: fieldKey } },
          propose: {
            tool_name: resolved.tool_name,
            tool_args: {
              ...resolved.tool_args,
              evidence: {
                source_type: "public_research",
                source_ref: str(found.source_ref) ?? "research",
                source_url: str(found.source_url),
                observed_at: str(found.observed_at),
              },
              why: `The owner chose this ${
                lowerFirst(websiteSetupFieldLabel(fieldOf(plan!, fieldKey), fieldKey))
              } from a public page Ari found.`.slice(0, 300),
              cites: [{ kind: "owner_words", quote: "Use this" }],
            },
          },
        };
      }
      if (choiceId === "use_default" && fieldKey === "design_key") {
        const plan = await readPlan(ctx);
        const revision = plan ? websiteSetupPlanRevision(plan) : null;
        if (revision === null) {
          return {
            record: {
              state: "asked",
              data: {
                field_key: fieldKey,
                attempt: attempt + 1,
                problem:
                  "I couldn't refresh your Website plan, so nothing was saved. Try that again in a moment.",
              },
            },
          };
        }
        const design = DESIGNS[WEBSITE_DEFAULT_DESIGN];
        return {
          record: { state: "awaiting_approval", data: { field_key: fieldKey } },
          propose: {
            tool_name: "save_site_plan_design",
            tool_args: {
              brand_id: ctx.run.brand_id,
              expected_plan_revision: revision,
              design_key: WEBSITE_DEFAULT_DESIGN,
              source_type: "mingla",
              why:
                `The owner skipped choosing a look, so the Website uses Mingla's default design (${design.label}). It can be changed anytime.`,
              cites: [{
                kind: "owner_words",
                quote: "Use Mingla's default design",
              }],
            },
            rows: [
              { label: "Design", value: `${design.label} (Mingla's default)` },
              {
                label: "Change it later",
                value:
                  "You can pick a different design anytime from your Website.",
              },
            ],
          },
        };
      }
      if (choiceId !== FORM || !answer?.values) return null;
      const plan = await readPlan(ctx);
      const resolved: Resolution = plan
        ? resolveWebsiteFormAnswer({
          brandId: ctx.run.brand_id,
          fieldKey,
          plan,
          values: answer.values,
        })
        : {
          kind: "retry",
          problem:
            "I couldn't refresh your Website plan, so nothing was saved. Try that again in a moment.",
        };
      if (resolved.kind === "stale") return null;
      if (resolved.kind === "retry") {
        // Nothing is saved; the same card comes back with what was wrong and
        // what the owner gave, so they correct it rather than retype it.
        return {
          record: {
            state: "asked",
            data: {
              field_key: fieldKey,
              attempt: attempt + 1,
              problem: resolved.problem,
              draft: answer.values,
            },
          },
        };
      }
      return {
        record: { state: "awaiting_approval", data: { field_key: fieldKey } },
        propose: {
          tool_name: resolved.tool_name,
          tool_args: resolved.tool_args,
        },
      };
    },
  };
  return step;
}

const offerStep = fieldStep({
  part: "offer",
  title: "What you'll offer",
  fieldKeys: ["offerings_selected", "venue_descriptor"],
  depends_on: [],
});

/**
 * City and country come before the phone and address. The audit ties a
 * phone's formatting and an address's "doesn't apply" to the brand's city and
 * country, so saving them later voided the earlier answer and Ari re-asked
 * forever. Asking them first also lets the phone chip open on that country.
 */
export const WEBSITE_BRAND_FIELD_ORDER: readonly string[] = Object.freeze([
  "name",
  "description",
  "city_country",
  "contact_email",
  "contact_phone",
  "address",
  "social_links",
  "profile_photo",
  "cover_media",
  "theme",
]);

const brandStep = fieldStep({
  part: "brand",
  title: "Your brand details",
  fieldKeys: WEBSITE_BRAND_FIELD_ORDER,
  depends_on: ["offer"],
  research: true,
});

const lookStep = fieldStep({
  part: "look",
  title: "Choose your design",
  fieldKeys: ["design_key"],
  depends_on: ["brand"],
  extra: () => [{ id: "use_default", label: "Use Mingla's default design" }],
});

const storyStep = fieldStep({
  part: "story",
  title: "Your story",
  fieldKeys: ["story.who", "story.why", "story.main_action"],
  depends_on: ["look"],
});

/** Owner-only: Ari shows the review handoff and never approves the plan. */
const approveStep: StepDefinition = {
  key: "approve",
  title: "Approve the plan",
  kind: "handoff",
  depends_on: ["story"],
  policy: "blocking",
  async probe(ctx: FlowContext): Promise<ProbeResult> {
    const plan = await readPlan(ctx);
    if (!plan) return unavailableAsk("approve");
    const field = fieldOf(plan, "approved_plan");
    if (websitePartDone(plan, "approve")) {
      return {
        done: true,
        note: ctx.state?.state === "human_action"
          ? "I checked; your plan is approved."
          : undefined,
        evidence: planEvidence(plan, {
          approve: true,
          approved_plan: String(field.state ?? "verified"),
        }),
      };
    }
    const route = websiteSetupApprovalRoute(ctx.run.brand_id);
    return {
      done: false,
      ask: {
        kind: "handoff",
        reuse_key: "website:handoff:approved_plan",
        title: "Review and approve your plan",
        text:
          "Your plan is ready for you to check. Only you can approve it — Ari never approves it for you. Open it, check every answer, approve it, then tell me and I'll check.",
        options: [
          { id: "open", label: "Review and approve the plan", route },
          { id: "check", label: "I've approved it, check now" },
        ],
        handoff: {
          item_key: "approved_plan",
          item_label: "Plan approval",
          route,
          route_label: "your Website plan",
          can_caller_fix: true,
          who_can_fix: "you",
        },
        record: {},
      },
    };
  },
};

/** What still stops the build, in plan order (owner labels). */
function buildBlockers(plan: Json): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const part of PLAN_PARTS.slice(0, 5)) {
    if (!websitePartDone(plan, part.key)) {
      out.push({ key: `part:${part.key}`, label: part.label });
    }
  }
  if (completeness(plan).context_complete !== true) {
    for (const field of fieldsOf(plan)) {
      if (!fieldNeeded(field) || field.key === "approved_plan") continue;
      out.push({
        key: String(field.key),
        label: websiteSetupFieldLabel(field, String(field.key)),
      });
    }
  }
  return out;
}

async function siteRow(ctx: FlowContext): Promise<Json | null> {
  if (!ctx.deps.readTool) return null;
  try {
    return object(
      await ctx.deps.readTool("get_brand_site", { brand_id: ctx.run.brand_id }),
    );
  } catch (_error) {
    return null;
  }
}

function siteIdOf(site: Json | null): string | null {
  if (!site) return null;
  return str(site.id) ?? str(site.site_id) ?? str(object(site.site).id);
}

const buildStep: StepDefinition = {
  key: "build",
  title: "Build your pages",
  kind: "proposal",
  depends_on: ["approve"],
  policy: "blocking",
  async probe(ctx: FlowContext): Promise<ProbeResult> {
    const plan = await readPlan(ctx);
    if (!plan) return unavailableAsk("build");
    const proposed = ctx.state?.state === "awaiting_approval";
    if (websitePartDone(plan, "build")) {
      // Verify the canonical saved site, not just the tick.
      const site = await siteRow(ctx);
      const siteId = siteIdOf(site);
      if (siteId) {
        return {
          done: true,
          note: proposed
            ? "Your draft pages are built and I've checked they're saved. Nothing is published yet — only you can see them."
            : undefined,
          evidence: planEvidence(plan, { build: true, site_id: siteId }),
        };
      }
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalStillOpen(ctx)) {
      return { done: false, wait: true };
    }
    const blockers = buildBlockers(plan);
    if (blockers.length > 0) {
      const fixable = blockers.filter((item) => !item.key.startsWith("part:"))
        .slice(0, 3);
      return {
        done: false,
        note: proposed && ctx.trigger === "confirm"
          ? "The pages weren't built, so nothing is shown as done."
          : undefined,
        ask: {
          kind: "question",
          reuse_key: `website:build:blocked:${
            blockers.map((b) => b.key).join(",")
          }`,
          title: "Before I build your pages",
          text: `I can't build your pages yet. Still needed: ${
            listWords(blockers.map((b) => lowerFirst(b.label)))
          }. Nothing has been created.`,
          options: [
            ...fixable.map((item) => ({
              id: `fix:${item.key}`,
              label: `Add ${lowerFirst(item.label)}`.slice(0, 100),
            })),
            { id: "check", label: "Check again" },
          ],
          record: { data: { blockers: blockers.map((b) => b.key) } },
        },
      };
    }
    return {
      done: false,
      note: proposed && ctx.trigger === "confirm"
        ? "The pages weren't built, so nothing is shown as done. You can try again."
        : undefined,
      ask: {
        kind: "question",
        reuse_key: "website:build:ready",
        title: "Build your draft pages",
        text:
          "Everything for your plan is ready and approved. Shall I build your draft pages? I'll make your Home, About and Contact pages and a page for each thing you offer, in your design, from the plan you approved. Nothing goes live — only you will see them.",
        options: [{ id: "build", label: "Build my draft pages" }],
        record: {},
      },
    };
  },
  async onAnswer(ctx, choiceId): Promise<AnswerOutcome | null> {
    if (choiceId.startsWith("fix:")) {
      const key = choiceId.slice("fix:".length);
      return {
        record: { state: "pending" },
        session_skips: ctx.run.session_skips.filter((skip) =>
          skip !== skipKey(key)
        ),
      };
    }
    if (choiceId !== "build") return null;
    // Read before act: the owner's approval and every required detail must
    // still be true now, not when the card was shown.
    const plan = await readPlan(ctx);
    if (!plan || buildBlockers(plan).length > 0) {
      return {
        record: { state: "pending" },
        ack: "Something changed since I asked, so I haven't built anything.",
      };
    }
    if (websitePartDone(plan, "build") && siteIdOf(await siteRow(ctx))) {
      // Already built and read back: nothing to propose.
      return { record: { state: "pending" } };
    }
    return {
      record: { state: "awaiting_approval", data: {} },
      propose: {
        tool_name: "create_site_draft",
        tool_args: {
          brand_id: ctx.run.brand_id,
          why:
            "The owner approved the Website plan and asked Ari to build the draft pages.",
          cites: [{ kind: "owner_words", quote: "Build my draft pages" }],
        },
        rows: [{
          label: "What happens",
          value:
            "Ari builds private draft pages from your approved plan, on your one Website. Nothing is published.",
        }],
      },
    };
  },
};

/**
 * `ari_creates`: Ari's lane for this kind asks for every fact it saves (the
 * deterministic event planner). Trips and experiences still have lanes that
 * fill details in themselves (SPEC D-16/D-23, fixed in P8/P9), so Ari does
 * not offer to create them here — it says where to add one instead.
 */
const OFFERING_KINDS: ReadonlyArray<{
  plan: string;
  noun: string;
  request: string;
  ari_creates: boolean;
  /** #3355 — where the owner adds one themselves (the Host creator). */
  route?: string;
}> = [
  {
    plan: "events",
    noun: "event",
    request: "Create an event",
    ari_creates: true,
  },
  {
    plan: "trips",
    noun: "trip",
    request: "Create a trip",
    ari_creates: false,
    route: "/trip/create",
  },
  {
    plan: "experiences",
    noun: "experience",
    request: "Create an experience",
    ari_creates: false,
    route: "/experience/create",
  },
];

function chosenKinds(plan: Json): typeof OFFERING_KINDS[number][] {
  const chosen = fieldOf(plan, "offerings_selected").value;
  const keys = Array.isArray(chosen) ? chosen : [];
  return OFFERING_KINDS.filter((kind) => keys.includes(kind.plan));
}

/**
 * #3355 — why "Add your first trip or event" is already done, in the
 * owner's words (the plan ticks it when every chosen kind already has a
 * public offering, or when the owner skipped it on the plan).
 */
function firstOfferingDoneNote(plan: Json): string {
  const part = parts(plan).find((candidate) =>
    candidate.key === "first_offering"
  );
  if (part?.skipped === true) {
    return "You chose to skip adding a first offering on your Website plan, so I'm moving on. You can add one anytime.";
  }
  const nouns = chosenKinds(plan).map((kind) => kind.noun);
  return nouns.length > 0
    ? `Your first ${
      listWords(nouns)
    } is already on Mingla, so that part of your Website plan is done.`
    : "That part of your Website plan is already done.";
}

const firstOfferingStep: StepDefinition = {
  key: "first_offering",
  title: "Add your first trip or event",
  kind: "subflow",
  depends_on: ["build"],
  policy: "skippable",
  subject_tools: ["create_event", "create_trip", "create_experience"],
  async probe(ctx: FlowContext): Promise<ProbeResult> {
    const plan = await readPlan(ctx);
    if (!plan) return unavailableAsk("first_offering");
    if (websitePartDone(plan, "first_offering")) {
      // #3355 — never pass this part silently: say why it is already done.
      return {
        done: true,
        ...(ctx.state?.state === "done"
          ? {}
          : { note: firstOfferingDoneNote(plan) }),
        evidence: planEvidence(plan, { first_offering: true }),
      };
    }
    // A record the lane created in this run: verified by id, never twice.
    const created = str(ctx.state?.data?.subject_id);
    if (created && await ctx.deps.subjectExists("events", created)) {
      const kind = OFFERING_KINDS.find((candidate) =>
        candidate.request === ctx.state?.data?.request
      );
      return {
        done: true,
        note: `Your first ${
          kind?.noun ?? "offering"
        } is saved as a draft and I've checked it's there. Your Website shows it once you publish it.`,
        evidence: {
          probe: "first_offering_created",
          observed: created,
        },
      };
    }
    const kinds = chosenKinds(plan);
    if (kinds.length === 0) {
      return {
        done: true,
        evidence: planEvidence(plan, { first_offering: "nothing_to_create" }),
      };
    }
    const request = str(ctx.state?.data?.request);
    const kind = kinds.find((candidate) => candidate.request === request);
    if (kind && ctx.state?.state !== "delegated") {
      // Readiness preamble (P3): anything that blocks even a draft is a
      // handoff; nothing is created past it.
      const readiness = await ctx.deps.readiness("draft_save");
      const blocker = readiness.items.find((item) =>
        item.blocks_action && item.group !== "money"
      );
      if (blocker) {
        return {
          done: false,
          ask: itemHandoff({
            item: blocker,
            noun: kind.noun,
            title: `Before I can start your ${kind.noun}`,
            lead:
              `${blocker.label} needs sorting first, so I haven't started the ${kind.noun}.`,
            allowNotNow: true,
          }),
        };
      }
      return { done: false, delegate: true, semantic: kind.request };
    }
    if (ctx.state?.state === "delegated") {
      return { done: false, delegate: true, semantic: request ?? "" };
    }
    const nouns = kinds.map((candidate) => candidate.noun);
    const creatable = kinds.filter((candidate) => candidate.ari_creates);
    const elsewhere = kinds.filter((candidate) => !candidate.ari_creates);
    const elsewhereNouns = elsewhere.map((candidate) => candidate.noun);
    // #3355 bug 20 — one "Add my first …" per kind the brand chose that has
    // a Host creator, not just the first one (an experiences brand was only
    // ever offered a trip-less card, a trips + experiences brand only a trip).
    const addYourself = elsewhere.flatMap((candidate) =>
      candidate.route ? [{ ...candidate, route: candidate.route }] : []
    );
    return {
      done: false,
      ask: {
        kind: "question",
        reuse_key: `website:first_offering:${nouns.join(",")}`,
        title: "Add your first offering",
        text: [
          `Your Website's pages show what you offer. Adding your first ${
            listWords(nouns)
          } is optional.`,
          creatable.length > 0
            ? `I can start your first ${
              listWords(creatable.map((candidate) => candidate.noun))
            } now — I'll ask you for every detail and won't fill any in for you.`
            : "",
          // #3355 — say plainly what Ari is skipping and why (trips and
          // experiences are added in Mingla until Ari can ask for every
          // detail itself), and where to add one.
          elsewhere.length > 0
            ? `I can't add ${
              listWords(elsewhereNouns.map((noun) => `${noun}s`))
            } for you in this chat yet, so ${
              creatable.length > 0 ? "that part is" : "I'm skipping this part"
            } for now. It stays on your Website plan: add your first ${
              listWords(elsewhereNouns)
            } yourself in Mingla whenever you're ready, and your Website shows it once it's published.`
            : "",
        ].filter(Boolean).join(" "),
        options: [
          ...creatable.map((candidate) => ({
            id: `create:${candidate.plan}`,
            label: `Create my first ${candidate.noun}`,
          })),
          ...addYourself.map((candidate) => ({
            id: `open:${candidate.plan}`,
            label: `Add my first ${candidate.noun}`,
            route: candidate.route,
          })),
          {
            id: "not_now",
            label: creatable.length > 0
              ? "Not now"
              : "Skip for now, keep going",
          },
        ],
        record: {},
      },
    };
  },
  async onAnswer(ctx, choiceId): Promise<AnswerOutcome | null> {
    if (choiceId === "not_now" || choiceId === "cancel") {
      return {
        record: { state: "skipped", reason: "not_now" },
        ack:
          "Okay, no offering for now. It stays on your Website plan, and you can add one anytime.",
      };
    }
    if (choiceId.startsWith("create:")) {
      const plan = await readPlan(ctx);
      const kind = plan
        ? chosenKinds(plan).find((candidate) =>
          candidate.ari_creates &&
          candidate.plan === choiceId.slice("create:".length)
        )
        : undefined;
      if (!kind) return null;
      return { record: { state: "pending", data: { request: kind.request } } };
    }
    return null;
  },
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/** The digest Core computes when a publish does not send one. */
export function publishArgumentsDigest(args: {
  siteId: string;
  expectedRevision: string;
  sourceDigest: string;
}): Promise<string> {
  return sha256Hex(JSON.stringify({
    action: "publications",
    site_id: args.siteId,
    expected_revision: args.expectedRevision,
    source_digest: args.sourceDigest,
  }));
}

type Prepared =
  | {
    ok: true;
    site_id: string;
    expected_revision: string;
    source_digest: string;
    warnings: { label: string; message: string | null }[];
  }
  | { ok: false; problem: string; retry: boolean };

/** Validate the exact draft, then run the design checks on that same digest. */
async function preparePublish(ctx: FlowContext): Promise<Prepared> {
  const site = await siteRow(ctx);
  const siteId = siteIdOf(site);
  if (!siteId || !ctx.deps.readTool) {
    return {
      ok: false,
      retry: true,
      problem: "I couldn't find your Website draft just now.",
    };
  }
  let validation: Json;
  try {
    validation = object(
      await ctx.deps.readTool("validate_site_draft", {
        brand_id: ctx.run.brand_id,
        site_id: siteId,
      }),
    );
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : "Your draft didn't pass its check.";
    return { ok: false, retry: false, problem: message.slice(0, 300) };
  }
  const digest = str(validation.draft_digest);
  const revision = str(validation.home_revision) ??
    (typeof validation.home_revision === "number"
      ? String(validation.home_revision)
      : null);
  if (
    validation.valid !== true || !digest || !/^[0-9a-f]{64}$/.test(digest) ||
    !revision
  ) {
    return {
      ok: false,
      retry: false,
      problem:
        "Your draft didn't pass its check, so it can't be published yet.",
    };
  }
  let checks: Json;
  try {
    checks = object(
      await ctx.deps.readTool("run_site_design_checks", {
        brand_id: ctx.run.brand_id,
        site_id: siteId,
      }),
    );
  } catch (_error) {
    return {
      ok: false,
      retry: true,
      problem: "I couldn't run the design checks on your draft just now.",
    };
  }
  if (str(checks.draft_digest) !== digest) {
    return {
      ok: false,
      retry: true,
      problem:
        "Your draft changed while I was checking it, so I haven't prepared a publish.",
    };
  }
  const warnings = (Array.isArray(checks.checks) ? checks.checks : [])
    .map(object)
    .filter((check) => check.status === "warn")
    .map((check) => {
      const items = Array.isArray(check.items) ? check.items.map(object) : [];
      return {
        label: str(check.label) ?? "A design check",
        message: str(items[0]?.message),
      };
    });
  return {
    ok: true,
    site_id: siteId,
    expected_revision: revision,
    source_digest: digest,
    warnings,
  };
}

const publishStep: StepDefinition = {
  key: "publish",
  title: "Check and publish",
  kind: "proposal",
  depends_on: ["build", "first_offering"],
  policy: "blocking",
  async probe(ctx: FlowContext): Promise<ProbeResult> {
    const plan = await readPlan(ctx);
    if (!plan) return unavailableAsk("publish");
    const proposed = ctx.state?.state === "awaiting_approval";
    if (websitePartDone(plan, "publish")) {
      return {
        done: true,
        note: proposed || ctx.state?.data?.confirmed === true
          ? "Your Website is live — I checked that it published."
          : undefined,
        evidence: planEvidence(plan, { publish: true }),
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalStillOpen(ctx)) {
      return { done: false, wait: true };
    }
    {
      if (
        // #3355 P7: a refused publish (ctx.failed) never reads as started.
        (proposed && ctx.trigger === "confirm" && !ctx.failed) ||
        ctx.state?.data?.confirmed === true
      ) {
        // Publishing runs on Mingla's side; read back until it's live.
        return {
          done: false,
          ask: {
            kind: "question",
            reuse_key: "website:publish:finishing",
            title: "Publishing your Website",
            text:
              "Your publish has started but it isn't live yet. It usually takes under a minute — I'll check again whenever you like.",
            options: [{ id: "check", label: "Check if it's live" }],
            record: { data: { ...(ctx.state?.data ?? {}), confirmed: true } },
          },
        };
      }
    }
    const prepared = await preparePublish(ctx);
    if (!prepared.ok) {
      const route = `/brand/${ctx.run.brand_id}/website`;
      return {
        done: false,
        ask: {
          kind: "question",
          reuse_key: `website:publish:problem:${prepared.problem}`,
          title: "Before you publish",
          text: prepared.retry
            ? `${prepared.problem} Nothing was published. Try again in a moment.`
            : `${prepared.problem} Nothing was published. Open your Website to fix it, then tell me to check again.`,
          options: [
            ...(prepared.retry ? [] : [{
              id: "open",
              label: "Open your Website",
              route,
            }]),
            { id: "check", label: "Check again" },
          ],
          record: {},
        },
      };
    }
    const data = {
      site_id: prepared.site_id,
      expected_revision: prepared.expected_revision,
      source_digest: prepared.source_digest,
    };
    if (prepared.warnings.length === 0) {
      return {
        done: false,
        ask: {
          kind: "question",
          reuse_key: `website:publish:ready:${prepared.source_digest}`,
          title: "Ready to publish",
          text:
            "Your draft passed every design check. Publishing puts your Website live at its address for anyone to see. Shall I prepare the publish for you to confirm?",
          options: [
            { id: "publish", label: "Publish my Website" },
            { id: "not_now", label: "Not yet" },
          ],
          record: { data },
        },
      };
    }
    const shown = prepared.warnings.slice(0, 3).map((warning) =>
      warning.message ? `${warning.label}: ${warning.message}` : warning.label
    );
    return {
      done: false,
      ask: {
        kind: "question",
        reuse_key: `website:publish:warnings:${prepared.source_digest}`,
        title: "Before you publish",
        text: `The design checks found ${prepared.warnings.length} thing${
          prepared.warnings.length === 1 ? "" : "s"
        } to look at: ${shown.join("; ")}. You can fix ${
          prepared.warnings.length === 1 ? "it" : "them"
        } in your Website first, or publish as it is.`,
        options: [
          {
            id: "open",
            label: "Fix it in my Website",
            route: `/brand/${ctx.run.brand_id}/website`,
          },
          { id: "publish", label: "Publish anyway" },
          { id: "check", label: "Check again" },
          { id: "not_now", label: "Not yet" },
        ],
        record: { data },
      },
    };
  },
  async onAnswer(ctx, choiceId): Promise<AnswerOutcome | null> {
    if (choiceId === "not_now") {
      return {
        record: { state: "skipped", reason: "not_now" },
        ack:
          "Okay, I won't publish. Your draft stays private until you tell me to publish it.",
      };
    }
    if (choiceId !== "publish") return null;
    const checked = ctx.state?.data ?? {};
    // Read before act: publish only the exact draft that was just checked.
    const now = await preparePublish(ctx);
    if (
      !now.ok || now.site_id !== checked.site_id ||
      now.source_digest !== checked.source_digest ||
      now.expected_revision !== checked.expected_revision
    ) {
      return {
        record: { state: "pending" },
        ack:
          "Your draft changed since I checked it, so I didn't prepare a publish. Here's the latest check.",
      };
    }
    return {
      record: { state: "awaiting_approval", data: { ...checked } },
      propose: {
        tool_name: "publish_site",
        tool_args: {
          brand_id: ctx.run.brand_id,
          site_id: now.site_id,
          expected_revision: now.expected_revision,
          source_digest: now.source_digest,
          arguments_digest: await publishArgumentsDigest({
            siteId: now.site_id,
            expectedRevision: now.expected_revision,
            sourceDigest: now.source_digest,
          }),
        },
        rows: [
          {
            label: "What happens",
            value:
              "Your Website goes live at its address for anyone to see — exactly the draft Ari just checked.",
          },
          {
            label: "Design checks",
            value: now.warnings.length === 0
              ? "All passed"
              : `${now.warnings.length} to look at`,
          },
        ],
      },
    };
  },
};

function websiteSummary(run: FlowRun) {
  const publish = run.step_states.publish;
  const build = run.step_states.build;
  if (publish?.state === "done" && publish.evidence) {
    return {
      title: "Your Website is live",
      text:
        "Website setup is finished: every part is done and your Website is published. You can keep changing it anytime.",
      evidence: publish.evidence,
    };
  }
  if (
    publish?.state === "skipped" && build?.state === "done" && build.evidence
  ) {
    return {
      title: "Your Website draft is ready",
      text:
        "Your draft pages are built and saved, and nothing is published. Tell me \"publish my Website\" whenever you're ready and I'll check it again first.",
      evidence: build.evidence,
    };
  }
  return null;
}

export const WEBSITE_SETUP_FLOW: FlowDefinition = Object.freeze({
  key: WEBSITE_SETUP_FLOW_KEY,
  version: 1,
  title: "Website setup",
  subject: "brand",
  concurrency: "one_per_brand",
  noun: "Website",
  readiness: {
    draft: "website_build",
    publish: "website_publish",
    publish_paid: null,
  },
  subject_tools: [],
  subject_table: null,
  steps: [
    offerStep,
    brandStep,
    lookStep,
    storyStep,
    approveStep,
    buildStep,
    firstOfferingStep,
    publishStep,
  ],
  summarize: websiteSummary,
}) as FlowDefinition;

/** The plan parts the flow walks, in order (one counter: the plan's). */
export const WEBSITE_SETUP_STEP_KEYS: readonly string[] = WEBSITE_SETUP_FLOW
  .steps.map((step) => step.key);
