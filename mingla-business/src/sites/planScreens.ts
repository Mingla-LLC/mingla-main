/**
 * #2829 W9a — the plan screens' pure decisions (tested without rendering).
 */
import { planMenuPreview } from "../../../packages/site-contracts/src/sitePlan.ts";
import type { SitePlanState, SitePlanStory } from "./sitePlanState";

const KIND_WORDS: Readonly<Record<"trips" | "events" | "experiences", [one: string, many: string, page: string]>> = {
  trips: ["live trip", "live trips", "Trips"],
  events: ["live event", "live events", "Events"],
  experiences: ["live experience", "live experiences", "Experiences"],
};

/**
 * Unticking something that has live items asks first (design contract edge
 * case): "You have 2 live events. Unticking removes the Events page from your
 * site, and the events stay on Mingla." Null when nothing live is unticked.
 */
export function untickedWithLiveItems(
  saved: readonly string[],
  next: readonly string[],
  live: SitePlanState["liveCounts"],
): string | null {
  const keep = new Set(next);
  const lines: string[] = [];
  for (const kind of ["trips", "events", "experiences"] as const) {
    const count = live[kind];
    if (saved.includes(kind) && !keep.has(kind) && count > 0) {
      const [one, many, page] = KIND_WORDS[kind];
      lines.push(`You have ${count} ${count === 1 ? one : many}. Unticking removes the ${page} page from your site, and the ${kind} stay on Mingla.`);
    }
  }
  return lines.length ? lines.join(" ") : null;
}

/** All three story answers given (the server decides the tick; this guides the button). */
export function storyAnswered(story: SitePlanStory): boolean {
  return Boolean(story.who?.trim() && story.why?.trim() && story.main_action?.trim());
}

/**
 * The one-page plan the owner approves (design contract step 11), built only
 * from their answers and Mingla's facts. Lines without a source are left
 * out; "Won't do" is Mingla's fixed promise.
 */
export function approvedPlanFrom(state: SitePlanState, story: SitePlanStory): Record<string, string> {
  const offerings = state.plan?.offeringsSelected ?? state.prefillOfferings ?? [];
  const plan: Record<string, string> = {
    pages: planMenuPreview(offerings, story.main_action ?? null).slice(0, 300),
    wont_do: "Invent reviews, numbers or history",
  };
  if (story.who?.trim()) plan.for = story.who.trim().slice(0, 300);
  if (story.why?.trim()) plan.leads_with = story.why.trim().slice(0, 300);
  if (story.main_action?.trim()) plan.main_action = story.main_action.trim().slice(0, 300);
  // Only what Core knows: whether the look was chosen (no design catalogue
  // here, so the plan screens stay out of the look screen's chunk).
  plan.look = state.site?.designKey ? "Your chosen design, colours and fonts" : "Chosen in Website design";
  return plan;
}

export const APPROVED_PLAN_LABELS: ReadonlyArray<[key: string, label: string]> = [
  ["for", "For"],
  ["leads_with", "Leads with"],
  ["main_action", "Main action"],
  ["look", "Look"],
  ["pages", "Pages"],
  ["wont_do", "Won't do"],
];
