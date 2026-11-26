/**
 * #2829 W9a (AD-11) — the website plan's fixed vocabulary, shared by the
 * Business plan screens, Studio's deterministic composer and Core's edge
 * function, so the parts, the offering options, the pages they ask for and
 * the menu order (M1) are worked out in one place.
 *
 * Server truth for whether a part is DONE lives in Core
 * (`brand_site_plan_status`); nothing here ticks a part.
 *
 * Imports only emptyStates.ts (no runtime dependencies): the Business app
 * reads this file directly, from the plan screens only (never the boot path).
 */
import { PLANNED_PAGE_LABELS, type PlannedPageKey } from "./emptyStates.ts";

export type PlanPartKey =
  | "offer"
  | "brand"
  | "look"
  | "story"
  | "proof"
  | "approve"
  | "build"
  | "first_offering"
  | "publish";

export type PlanPart = {
  readonly key: PlanPartKey;
  readonly label: string;
  /** Shown beside the part ("1 min"); "optional" for the optional part. */
  readonly duration: string;
  readonly optional: boolean;
  /** May be skipped (stays on the to-do list); Core accepts only these. */
  readonly skippable: boolean;
};

/**
 * The 9 parts, in plan order (design contract chapter 2; #4453 adds `proof`
 * after `story`). `proof` is shown only while Core lists it in the plan
 * status (SITES_PROOF_PART), and it never blocks Build.
 */
export const PLAN_PARTS: readonly PlanPart[] = [
  { key: "offer", label: "What you'll offer", duration: "1 min", optional: false, skippable: false },
  { key: "brand", label: "Your brand details", duration: "3 min", optional: false, skippable: false },
  { key: "look", label: "Choose your design", duration: "3 min", optional: false, skippable: true },
  { key: "story", label: "Your story", duration: "2 min", optional: false, skippable: false },
  { key: "proof", label: "What guests say and where you've been", duration: "5 min", optional: true, skippable: true },
  { key: "approve", label: "Approve the plan", duration: "1 min", optional: false, skippable: false },
  { key: "build", label: "Build your pages", duration: "2 min", optional: false, skippable: false },
  { key: "first_offering", label: "Add your first trip or event", duration: "optional", optional: true, skippable: true },
  { key: "publish", label: "Check and publish", duration: "1 min", optional: false, skippable: false },
];

export const PLAN_PART_KEYS: readonly PlanPartKey[] = PLAN_PARTS.map((part) => part.key);

export function isPlanPartKey(value: unknown): value is PlanPartKey {
  return typeof value === "string" && (PLAN_PART_KEYS as readonly string[]).includes(value);
}

export type PlanOfferingKey =
  | "trips"
  | "events"
  | "experiences"
  | "venue_coworking"
  | "venue_food_drink"
  | "venue_play"
  | "venue_creative_arts"
  | "venue_stay";

export type PlanOfferingOption = {
  readonly key: PlanOfferingKey;
  readonly label: string;
  readonly hint: string;
  /** A venue type (asks "Which describes you best?"). */
  readonly venue: boolean;
  /** Offered only while stay venues are switched on (STAY_VENUE_AUTHORING). */
  readonly stay: boolean;
};

/** The eight options, one grid, no grouping (design contract chapter 3). */
export const PLAN_OFFERING_OPTIONS: readonly PlanOfferingOption[] = [
  { key: "trips", label: "Trips", hint: "Group trips, tours", venue: false, stay: false },
  { key: "events", label: "Events", hint: "Ticketed or RSVP", venue: false, stay: false },
  { key: "experiences", label: "Experiences", hint: "Classes, tastings", venue: false, stay: false },
  { key: "venue_coworking", label: "Coworking & workspaces", hint: "Desks, rooms, memberships", venue: true, stay: false },
  { key: "venue_food_drink", label: "Restaurant, bar or café", hint: "Food & drink", venue: true, stay: false },
  { key: "venue_play", label: "Play", hint: "Activities, family fun", venue: true, stay: false },
  { key: "venue_creative_arts", label: "Creative & arts", hint: "Studios, galleries, shows", venue: true, stay: false },
  { key: "venue_stay", label: "Stay", hint: "Hotels, resorts, short stays", venue: true, stay: true },
];

export const PLAN_OFFERING_KEYS: readonly PlanOfferingKey[] = PLAN_OFFERING_OPTIONS.map((option) => option.key);

/** "Which describes you best?" chips after a venue tick (shapes words only, never pages). */
export const VENUE_DESCRIPTOR_CHIPS: readonly string[] = [
  "Cocktail bar", "Café", "Restaurant", "Nightclub", "Rooftop", "Gallery", "Studio", "Activity centre", "Coworking space", "Meeting rooms",
];

/** Fixed menu order of the offering pages (M1). */
export const PLANNED_PAGE_ORDER: readonly PlannedPageKey[] = ["trips", "events", "experiences", "menu", "visit", "rooms"];

const OFFERING_PAGE: Readonly<Record<PlanOfferingKey, PlannedPageKey>> = {
  trips: "trips",
  events: "events",
  experiences: "experiences",
  venue_coworking: "visit",
  venue_food_drink: "menu",
  venue_play: "visit",
  venue_creative_arts: "visit",
  venue_stay: "rooms",
};

/** The pages a set of ticks asks for, in M1 order, each once. */
export function plannedPagesFor(offerings: readonly string[] | null | undefined): PlannedPageKey[] {
  const wanted = new Set<PlannedPageKey>();
  for (const key of offerings ?? []) {
    const page = OFFERING_PAGE[key as PlanOfferingKey];
    if (page) wanted.add(page);
  }
  return PLANNED_PAGE_ORDER.filter((page) => wanted.has(page));
}

/**
 * The owner's "main action" chips (story question 3), worded by what they
 * ticked. Each names the page it leads to, so the main offering comes first
 * in the menu (M1). "Join the list" and "Get in touch" lead nowhere special.
 */
export type MainActionChip = { readonly label: string; readonly page: PlannedPageKey | null };

const MAIN_ACTION_BY_PAGE: Readonly<Record<PlannedPageKey, string>> = {
  trips: "Reserve the next trip",
  events: "Come to an event",
  experiences: "Book an experience",
  menu: "Reserve a table",
  visit: "Book a visit",
  rooms: "Reserve a stay",
};

export function mainActionChips(offerings: readonly string[] | null | undefined): MainActionChip[] {
  return [
    ...plannedPagesFor(offerings).map((page) => ({ label: MAIN_ACTION_BY_PAGE[page], page })),
    { label: "Join the list", page: null },
    { label: "Get in touch", page: null },
  ];
}

/** The page the owner's main action leads to, or null. */
export function mainActionPage(mainAction: string | null | undefined, offerings: readonly string[] | null | undefined): PlannedPageKey | null {
  const wanted = (mainAction ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const chip = mainActionChips(offerings).find((candidate) => candidate.label.toLowerCase() === wanted);
  return chip?.page ?? null;
}

export type MenuEntryKey = PlannedPageKey | "about" | "contact";
export type MenuEntry = { readonly key: MenuEntryKey; readonly label: string };
export type PlanMenu = {
  /** The header menu (the logo is Home). */
  readonly items: readonly MenuEntry[];
  /** Items from the 6th onward, under "More" (M1). Empty when 6 or fewer. */
  readonly more: readonly MenuEntry[];
};

/**
 * M1: Home is the logo; then the main offering, the other offerings in fixed
 * order, then About, then Contact; more than 6 items → the 6th onward under
 * "More". Unticked offerings get no page and no menu item.
 */
export function planMenu(offerings: readonly string[] | null | undefined, mainAction?: string | null): PlanMenu {
  const pages = plannedPagesFor(offerings);
  const main = mainActionPage(mainAction ?? null, offerings);
  const ordered = main ? [main, ...pages.filter((page) => page !== main)] : pages;
  const all: MenuEntry[] = [
    ...ordered.map((page) => ({ key: page, label: PLANNED_PAGE_LABELS[page].menu })),
    { key: "about", label: "About" },
    { key: "contact", label: "Contact" },
  ];
  if (all.length <= 6) return { items: all, more: [] };
  return { items: all.slice(0, 5), more: all.slice(5) };
}

/** "Home · Trips · Events · About · Contact" — the live line under the ticks. */
export function planMenuPreview(offerings: readonly string[] | null | undefined, mainAction?: string | null): string {
  const menu = planMenu(offerings, mainAction);
  const labels = ["Home", ...menu.items.map((item) => item.label)];
  if (menu.more.length) labels.push(`More (${menu.more.map((item) => item.label).join(", ")})`);
  return labels.join(" · ");
}

/**
 * Tagline and bio share one Mingla field (`brands.description`): the first
 * paragraph is the tagline when there is more than one, the rest is the bio;
 * a single paragraph is the bio. Mirrors the Business app's brand mapping.
 */
export function splitBrandDescription(description: string | null | undefined): { tagline: string | null; bio: string | null } {
  const raw = (description ?? "").trim();
  if (!raw) return { tagline: null, bio: null };
  const parts = raw.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { tagline: null, bio: parts[0] ?? null };
  return { tagline: parts[0] ?? null, bio: parts.slice(1).join("\n\n") || null };
}

export type StoryQuestions = { readonly who: string; readonly why: string; readonly main_action: string };

/** Story questions worded by what the brand ticked (design contract chapter 6). */
export function storyQuestions(offerings: readonly string[] | null | undefined): StoryQuestions {
  const ticks = new Set(offerings ?? []);
  const venue = [...ticks].some((key) => key.startsWith("venue_"));
  const trips = ticks.has("trips");
  if (trips) {
    return {
      who: "Who comes with you?",
      why: "Why come with you rather than do it themselves?",
      main_action: "What should someone do when they find you?",
    };
  }
  if (venue) {
    return {
      who: "Who walks in?",
      why: "Why come to you rather than somewhere else?",
      main_action: "What should someone do when they find you?",
    };
  }
  return {
    who: "Who comes to you?",
    why: "Why choose you rather than someone else?",
    main_action: "What should someone do when they find you?",
  };
}

/** A brand-context field as the plan read returns it (snake or camel case). */
export type PlanBlockerField = {
  readonly key?: unknown;
  readonly label?: unknown;
  readonly requirement?: unknown;
  readonly state?: unknown;
};

/** The parts that must be done before "Build your pages" (`proof` never blocks). */
export const BUILD_REQUIRED_PARTS: readonly PlanPartKey[] = ["offer", "brand", "look", "story", "approve"];

/** #4572 item 4 — `requirement` says whether the owner may mark it "Doesn't apply" (recommended fields only). */
export type PlanBuildBlocker = { readonly key: string; readonly label: string; readonly requirement?: "required" | "recommended" };

/**
 * #2830 — what still stands between a plan and "Build your pages", in order:
 * the required parts before Build not yet done, then every required or recommended
 * brand-context field not yet settled (while the context is incomplete).
 *
 * One rule for Ari's build step and the Host setup screen's Build step, read
 * from the same plan (brand_site_plan_get), so both name the same things
 * before anyone presses Build. `labelOf` resolves a field's owner label.
 */
export function planBuildBlockers(input: {
  partDone: (key: PlanPartKey) => boolean;
  contextComplete: boolean;
  fields: readonly PlanBlockerField[];
  labelOf: (field: PlanBlockerField, key: string) => string;
}): PlanBuildBlocker[] {
  const out: PlanBuildBlocker[] = [];
  // #4453 — an explicit list (a slice would drop `approve` once `proof` sits before it).
  for (const part of PLAN_PARTS.filter((entry) => BUILD_REQUIRED_PARTS.includes(entry.key))) {
    if (!input.partDone(part.key)) out.push({ key: `part:${part.key}`, label: part.label, requirement: "required" });
  }
  if (input.contextComplete) return out;
  for (const field of input.fields) {
    if (typeof field.key !== "string" || field.key === "approved_plan") continue;
    if (field.requirement === "optional") continue;
    if (field.state === "verified" || field.state === "not_applicable") continue;
    out.push({ key: field.key, label: input.labelOf(field, field.key), requirement: field.requirement === "recommended" ? "recommended" : "required" });
  }
  return out;
}

/*
 * #4453 (spec v1 §3.2, spec v2 §6.7) — the setup part "What guests say and
 * where you've been". Every answer is the owner's own words, saved verbatim;
 * nothing here writes copy. The limits mirror Core's validator CHECKs
 * (20280807014453_issue_4453_website_proof_part.sql).
 */
export const PROOF_LIMITS = {
  reviews: 24,
  past_trips: 24,
  destinations: 12,
  stories: 12,
  value_points: { max: 4, title: 120, sentence: 500 },
  faq: { max: 12, question: 240, answer: 1000 },
  process_steps: { min: 3, max: 5, title: 80, text: 300, time: 24 },
  quick_facts: { max: 3, big: 12, small: 40, ticker: 12, phrase: 80 },
  review: { reviewer: 80, quote: 1200, trip_name: 120, source: 500 },
  past_trip: { title: 200, where: 200, description: 1000 },
  destination: { name: 120, country: 80, short_line: 200, summary: 600 },
  story: { title: 160, summary: 400, story: 5000 },
} as const;

export type ValuePoint = { title: string; sentence: string };
export type FaqItem = { question: string; answer: string };
export type ProcessStep = { title: string; text: string; time?: string };
export type QuickFacts = { facts: { big: string; small: string }[]; use_in_ticker: boolean; ticker: string[] };

/** Q7 (process steps) is asked only for formats whose recipe uses them: experiences, play and art. */
export function proofAsksProcessSteps(offerings: readonly string[] | null | undefined): boolean {
  return (offerings ?? []).some((key) => key === "experiences" || key === "venue_play" || key === "venue_creative_arts");
}

const MARKUP = /[<>]/;

function textProblem(value: unknown, label: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null || value === "") return required ? `Add ${label}.` : null;
  if (typeof value !== "string") return `Check ${label}.`;
  if (required && value.trim() === "") return `Add ${label}.`;
  if (value.length > max) return `Keep ${label} to ${max} characters.`;
  if (MARKUP.test(value)) return `Take the < and > out of ${label}.`;
  return null;
}

/** The first problem with a list of owner answers (null when it can be saved), mirroring Core's CHECK. */
function listProblem<T extends Record<string, unknown>>(
  items: readonly T[],
  bounds: { min: number; max: number; what: string },
  fields: readonly { key: keyof T & string; label: string; max: number; required: boolean }[],
): string | null {
  if (items.length < bounds.min) return `Add at least ${bounds.min} ${bounds.what}.`;
  if (items.length > bounds.max) return `Keep it to ${bounds.max} ${bounds.what}.`;
  for (const item of items) {
    for (const field of fields) {
      const problem = textProblem(item[field.key], field.label, field.max, field.required);
      if (problem) return problem;
    }
  }
  return null;
}

export function valuePointsProblem(items: readonly ValuePoint[]): string | null {
  const l = PROOF_LIMITS.value_points;
  return listProblem(items, { min: 1, max: l.max, what: "points" }, [
    { key: "title", label: "a title", max: l.title, required: true },
    { key: "sentence", label: "a sentence", max: l.sentence, required: true },
  ]);
}

export function faqProblem(items: readonly FaqItem[]): string | null {
  const l = PROOF_LIMITS.faq;
  return listProblem(items, { min: 1, max: l.max, what: "questions" }, [
    { key: "question", label: "the question", max: l.question, required: true },
    { key: "answer", label: "the answer", max: l.answer, required: true },
  ]);
}

export function processStepsProblem(items: readonly ProcessStep[]): string | null {
  const l = PROOF_LIMITS.process_steps;
  return listProblem(items, { min: l.min, max: l.max, what: "steps" }, [
    { key: "title", label: "a step title", max: l.title, required: true },
    { key: "text", label: "what happens", max: l.text, required: true },
    { key: "time", label: "the time", max: l.time, required: false },
  ]);
}

export function quickFactsProblem(value: QuickFacts): string | null {
  const l = PROOF_LIMITS.quick_facts;
  if (value.facts.length > l.max) return `Keep it to ${l.max} facts.`;
  if (value.ticker.length > l.ticker) return `Keep it to ${l.ticker} phrases.`;
  for (const fact of value.facts) {
    const problem = textProblem(fact.big, "the big line", l.big, true) ?? textProblem(fact.small, "the small line", l.small, true);
    if (problem) return problem;
  }
  for (const phrase of value.ticker) {
    const problem = textProblem(phrase, "each phrase", l.phrase, true);
    if (problem) return problem;
  }
  return null;
}

/** Ticker phrases that count toward the marquee (Q8 facts when ticked, plus typed phrases). */
export function tickerPhrases(value: QuickFacts | null | undefined): string[] {
  if (!value) return [];
  const fromFacts = value.use_in_ticker ? value.facts.map((fact) => `${fact.big} ${fact.small}`.trim()) : [];
  return [...fromFacts, ...value.ticker].filter((phrase) => phrase.trim() !== "");
}
