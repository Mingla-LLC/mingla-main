/**
 * ORCH-0965 [Home dashboard intelligent KPIs + tri-kind upcoming] — rule
 * ladder that picks ONE best-next-action recommendation for the brand-owner
 * home dashboard when the dashboard would otherwise be empty.
 *
 * Static rule ladder (first-match wins, top-to-bottom):
 *   1. Paid draft + Stripe inactive → Connect Stripe
 *   2. Zero offers                  → universal first-offering chooser
 *   3. Has draft, zero live          → Finish your draft (route to most-recent)
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
  | "finish_draft";

export interface HomeNextActionRung {
  rung: 1 | 2 | 3;
  kind: HomeNextActionKind;
  title: string;
  body: string;
  ctaLabel: string;
  ctaRoute: string;
}

const hasAnyDraftPaidOffering = (drafts: DraftEvent[]): boolean =>
  drafts.some((draft) =>
    (draft.tickets ?? []).some((ticket) => {
      if (ticket.isFree) return false;
      return typeof ticket.priceGbp === "number" && ticket.priceGbp > 0;
    }),
  );

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
  // Rung 1 — Stripe upsell only after a paid draft exists.
  if (brand.stripeStatus !== "active" && hasAnyDraftPaidOffering(drafts)) {
    return {
      rung: 1,
      kind: "stripe_inactive",
      title: "Connect Stripe to take payments",
      body: "You have a paid offering ready to publish. Connect Stripe to start selling.",
      ctaLabel: "Connect Stripe",
      ctaRoute: `/brand/${brand.id}/payments`,
    };
  }

  // Rung 2 — universal first-offering chooser.
  if (counts.total === 0) {
    return {
      rung: 2,
      kind: "no_offerings",
      title: "What do you want to make first?",
      body: "Mix and match anytime.",
      ctaLabel: "Create",
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

  // Healthy state — no rung applicable.
  return null;
}
