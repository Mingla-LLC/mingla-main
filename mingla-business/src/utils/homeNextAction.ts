/**
 * ORCH-0965 [Home dashboard intelligent KPIs + tri-kind upcoming] — rule
 * ladder that picks ONE best-next-action recommendation for the brand-owner
 * home dashboard when the dashboard would otherwise be empty.
 *
 * Static rule ladder (first-match wins, top-to-bottom):
 *   1. Stripe not active            → Finish setting up Stripe
 *   2. Stripe active + zero offers   → kind-aware first-offering CTA
 *   3. Has draft, zero live          → Finish your draft (route to most-recent)
 *   4. Live + physical + no address  → Add your venue address
 *   else: null (healthy state — no card renders)
 *
 * Pure function. No hooks, no React. Unit-tested via
 * `__tests__/homeNextAction.test.ts`. Tier-deferred rung 5 (per-offering
 * capacity) is OUT of scope per SPEC §2 D-7 — ship in v1.5.
 *
 * Absorbs the ORCH-0855 trip-planner CTA at home.tsx:419-477 (deleted in the
 * same PR). Established by SPEC §4.4 / §5 / §7.
 */

import type { Brand } from "../store/currentBrandStore";
import type { DraftEvent } from "../store/draftEventStore";
import { routeForEventRowDefensive } from "./routeForEventRow";
import type { EventTypeForRouting } from "./routeForEventRow";
import type { UpcomingCounts } from "./upcomingBuilder";

export type HomeNextActionKind =
  | "stripe_inactive"
  | "no_offerings"
  | "finish_draft"
  | "add_address";

export interface HomeNextActionRung {
  rung: 1 | 2 | 3 | 4;
  kind: HomeNextActionKind;
  title: string;
  body: string;
  ctaLabel: string;
  ctaRoute: string;
}

/**
 * Pick the highest-priority next-action rung for the given brand state.
 * Returns null when the brand is in a healthy state (no rung applicable).
 *
 * The `drafts` array is consulted only for rung 3 (to pick the
 * most-recently-updated draft to route to).
 */
export function pickHomeNextAction(
  brand: Brand,
  counts: UpcomingCounts,
  drafts: DraftEvent[],
): HomeNextActionRung | null {
  // Rung 1 — Stripe not active.
  if (brand.stripeStatus !== "active") {
    return {
      rung: 1,
      kind: "stripe_inactive",
      title: "Finish setting up Stripe",
      body: "Mingla needs Stripe Connect to collect money. Finish setup to start selling.",
      ctaLabel: "Continue Stripe setup",
      ctaRoute: `/brand/${brand.id}/payments`,
    };
  }

  // Rung 2 — Stripe active, zero offerings (no drafts, no live, no upcoming).
  if (counts.total === 0) {
    if (brand.kind === "trip_planner") {
      return {
        rung: 2,
        kind: "no_offerings",
        title: "Plan a trip",
        body: "You're set up. Create your first trip to start selling.",
        ctaLabel: "Plan a trip",
        ctaRoute: "/trip/create",
      };
    }
    return {
      rung: 2,
      kind: "no_offerings",
      title: "Create your first event",
      body: "Your brand is ready. Create your first event to start selling tickets.",
      ctaLabel: "Create event",
      ctaRoute: "/event/create",
    };
  }

  // Rung 3 — At least one draft, zero live.
  if (counts.live === 0 && counts.draft > 0 && drafts.length > 0) {
    const mostRecentDraft = drafts
      .slice()
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
    const eventType: EventTypeForRouting =
      (mostRecentDraft as DraftEvent & { event_type?: EventTypeForRouting })
        .event_type ?? "event";
    return {
      rung: 3,
      kind: "finish_draft",
      title: "Finish your draft",
      body: "You have a draft waiting. Finish it and publish to start selling.",
      ctaLabel: "Open draft",
      ctaRoute: routeForEventRowDefensive({
        id: mostRecentDraft.id,
        event_type: eventType,
        status: "draft",
      }),
    };
  }

  // Rung 4 — Live offering exists but physical brand has no address.
  if (
    brand.kind === "physical" &&
    (brand.address === null || brand.address.trim().length === 0)
  ) {
    return {
      rung: 4,
      kind: "add_address",
      title: "Add your venue address",
      body: "Add your address so people can find you and Mingla can recommend you locally.",
      ctaLabel: "Edit brand",
      ctaRoute: `/brand/${brand.id}/edit`,
    };
  }

  // Healthy state — no rung applicable.
  return null;
}
