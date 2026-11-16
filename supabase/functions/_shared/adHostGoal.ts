/**
 * #4238 — the single server-side owner of Host and Ari ad goals.
 *
 * Clients never author Host provider objectives; the plan hash does. A Host
 * plan carries `canonical_plan.optimization_by_platform` ({platform: "visits" |
 * "sales"}) inside the immutable hash. admin-ad-create-campaign derives the
 * provider objective fields from it with hostAdGoalFields and refuses a Host
 * body that names its own objective. Pure module: no I/O.
 */

import { HOST_AD_LANE, type Platform } from "./adChannelCore.ts";

export type HostAdOptimization = "visits" | "sales" | "signups";

export const HOST_AD_OPTIMIZATIONS: readonly HostAdOptimization[] = [
  "visits",
  "sales",
  "signups",
];

/** Platforms with a website-sales path a Host ad may use (= Admin Sales). */
export const HOST_SALES_GOAL_PLATFORMS: readonly Platform[] = [
  "meta",
  "snapchat",
  "tiktok",
];

/**
 * #4238 item 3: platforms where a Host ad may optimise for sign-ups (a free
 * RSVP or an all-free ticket page). Step 0 doc gate (W1): Meta fires
 * CompleteRegistration and Snapchat SIGN_UP for free bookings already, and
 * Snap's ad-squad docs pair PIXEL_SIGNUP with the SALES objective (Z-2 pass).
 * TikTok (Z-1: the ON_WEB_REGISTER event name could not be confirmed from
 * official docs), Reddit (Z-3: conversion ad-group fields not confirmed) and
 * Google (needs a buyer sign-up conversion action, #4452) take the spec's
 * fallback: page visits, which the Host must acknowledge (amendment A U-3).
 */
export const HOST_SIGNUPS_GOAL_PLATFORMS: readonly Platform[] = [
  "meta",
  "snapchat",
];

/**
 * Page types that sell tickets through Mingla checkout (ad_advertisable_pages
 * event / trip / experience rows). A brand website ('site') also reports
 * result_kind 'tickets' in the wave-1 resolver but sells nothing itself, and
 * the brand page and rsvp/venue/reservation pages never fire a Purchase, so
 * none of them may optimise for sales.
 */
export const HOST_SALES_PAGE_TYPES: readonly string[] = [
  "event",
  "trip",
  "experience",
];

/** True only for a page that actually sells tickets. */
export function hostPageSellsTickets(
  destination:
    | { page_type?: unknown; result_kind?: unknown }
    | null
    | undefined,
): boolean {
  return destination?.result_kind === "tickets" &&
    typeof destination.page_type === "string" &&
    HOST_SALES_PAGE_TYPES.includes(destination.page_type);
}

/**
 * #4238 item 3: a ticket page whose every sellable tier is free. A tier
 * counts as free only when BOTH is_free is true AND price_cents is 0; an
 * empty tier list is not "all free" (nothing to sign up for).
 */
export function hostPageIsAllFree(
  tiers: readonly { is_free?: unknown; price_cents?: unknown }[] | null,
): boolean {
  if (!Array.isArray(tiers) || tiers.length === 0) return false;
  return tiers.every((tier) =>
    tier.is_free === true && Number(tier.price_cents) === 0
  );
}

/** Sign-ups fit an RSVP page, or a ticket page whose tiers are all free. */
export function hostPageAcceptsSignups(
  destination:
    | { page_type?: unknown; result_kind?: unknown }
    | null
    | undefined,
  allFree: boolean,
): boolean {
  if (destination?.page_type === "rsvp") return true;
  return hostPageSellsTickets(destination) && allFree;
}

/** The provider objective fields a Host body may never carry itself. */
export const HOST_GOAL_BODY_FIELDS = [
  "objective",
  "optimization_goal",
  "billing_event",
  // #4238 item 3: the conversion event is the plan's too.
  "custom_event_type",
  "promoted_object",
] as const;

/**
 * #4238 item 3 / I-4238-NO-PURCHASE-GOAL-WITHOUT-PURCHASE: the Meta
 * promoted-object event follows the Host goal (never a hard-coded PURCHASE
 * on a sign-ups ad). Null for a goal with no conversion event.
 */
export function hostMetaCustomEventType(
  optimization: HostAdOptimization,
): "PURCHASE" | "COMPLETE_REGISTRATION" | null {
  if (optimization === "sales") return "PURCHASE";
  if (optimization === "signups") return "COMPLETE_REGISTRATION";
  return null;
}

/**
 * The provider objective fields for a Host ad. "visits" is byte-equal to the
 * mapping the Business client used to send; "sales" equals Admin's website
 * sales ("conversions") goal. null means the platform cannot run that goal.
 */
export function hostAdGoalFields(
  platform: Platform,
  optimization: HostAdOptimization,
): Record<string, string> | null {
  if (optimization === "visits") {
    switch (platform) {
      case "meta":
        return {
          objective: "OUTCOME_TRAFFIC",
          optimization_goal: "LINK_CLICKS",
          billing_event: "IMPRESSIONS",
        };
      case "snapchat":
        return { objective: "TRAFFIC", optimization_goal: "SWIPES" };
      case "tiktok":
        return {
          objective: "TRAFFIC",
          optimization_goal: "TRAFFIC_LANDING_PAGE_VIEW",
          billing_event: "CPC",
        };
      case "google":
        return {};
      case "reddit":
        return { objective: "CLICKS" };
    }
    return null;
  }
  if (optimization === "signups") {
    switch (platform) {
      case "meta":
        return {
          objective: "OUTCOME_LEADS",
          optimization_goal: "OFFSITE_CONVERSIONS",
          billing_event: "IMPRESSIONS",
        };
      case "snapchat":
        return { objective: "SALES", optimization_goal: "PIXEL_SIGNUP" };
      default:
        return null;
    }
  }
  switch (platform) {
    case "meta":
      return {
        objective: "OUTCOME_SALES",
        optimization_goal: "OFFSITE_CONVERSIONS",
        billing_event: "IMPRESSIONS",
      };
    case "snapchat":
      return { objective: "SALES", optimization_goal: "PIXEL_PURCHASE" };
    case "tiktok":
      return {
        objective: "WEB_CONVERSIONS",
        optimization_goal: "CONVERT",
        billing_event: "OCPM",
      };
    default:
      return null;
  }
}

/** The frozen goal for one platform; an absent map means page visits. */
export function hostOptimizationFor(
  canonicalPlan: Record<string, unknown>,
  platform: string,
): HostAdOptimization | null {
  const map = canonicalPlan.optimization_by_platform;
  if (map === undefined || map === null) return "visits";
  if (typeof map !== "object" || Array.isArray(map)) return null;
  const value = (map as Record<string, unknown>)[platform];
  if (value === undefined) return "visits";
  return (HOST_AD_OPTIMIZATIONS as readonly unknown[]).includes(value)
    ? value as HostAdOptimization
    : null;
}

export type HostOptimizationValidation =
  | { ok: true; map: Record<string, HostAdOptimization> }
  | {
    ok: false;
    detail: string;
    /** Set only on the 409 acknowledgement refusal; every other one is 422. */
    status?: 409;
    platforms?: string[];
  };

/** What create_version knows about the page and each app beyond the map. */
export type HostOptimizationContext = {
  /** Every sellable tier is free (hostPageIsAllFree). */
  allFree?: boolean;
  /** Live readiness per app and goal; an app missing here is not ready. */
  ready?: Readonly<
    Record<string, Readonly<Partial<Record<HostAdOptimization, boolean>>>>
  >;
  /** The goal the Host asked for (canonical_plan.optimization_goal). */
  requestedGoal?: unknown;
  /** Apps the Host accepted running page visits (acknowledged_visits_fallback). */
  acknowledgedFallback?: unknown;
};

/**
 * create_version authority for a Host plan's goal. The map's keys must equal
 * the plan's platforms. "sales" needs a platform with a website-sales path
 * and a page that sells tickets and is not all free. "signups" needs a
 * sign-ups platform and an RSVP or all-free page. With a context, each
 * conversion app must be live-ready, and when the Host asked for sales or
 * sign-ups every app that runs visits instead must be acknowledged (409
 * host_ad_goal_fallback_unacknowledged). A missing map becomes all "visits"
 * so the plan hash always carries the goal.
 */
export function validateHostOptimization(
  input: unknown,
  platforms: readonly string[],
  destination:
    | { page_type?: unknown; result_kind?: unknown }
    | null
    | undefined,
  context: HostOptimizationContext = {},
): HostOptimizationValidation {
  const refuse = (detail: string): HostOptimizationValidation => ({
    ok: false,
    detail,
  });
  const sellsTickets = hostPageSellsTickets(destination);
  const allFree = context.allFree === true;
  const acceptsSignups = hostPageAcceptsSignups(destination, allFree);
  const requested = context.requestedGoal;
  if (requested !== undefined && requested !== null) {
    if (!(HOST_AD_OPTIMIZATIONS as readonly unknown[]).includes(requested)) {
      return refuse("optimization_invalid");
    }
    if (requested === "sales" && sellsTickets && allFree) {
      return refuse("optimization_sales_free_event");
    }
    if (requested === "sales" && !sellsTickets) {
      return refuse("optimization_sales_unsupported");
    }
    if (requested === "signups" && !acceptsSignups) {
      return refuse("optimization_signups_unsupported");
    }
  }
  let map: Record<string, HostAdOptimization>;
  if (input === undefined || input === null) {
    map = Object.fromEntries(platforms.map((p) => [p, "visits" as const]));
  } else {
    if (typeof input !== "object" || Array.isArray(input)) {
      return refuse("optimization_invalid");
    }
    const entries = Object.entries(input as Record<string, unknown>);
    const keys = new Set(entries.map(([key]) => key));
    if (
      keys.size !== platforms.length || !platforms.every((p) => keys.has(p))
    ) {
      return refuse("optimization_invalid");
    }
    map = {};
    for (const [platform, value] of entries) {
      if (!(HOST_AD_OPTIMIZATIONS as readonly unknown[]).includes(value)) {
        return refuse("optimization_invalid");
      }
      if (value === "sales") {
        if (sellsTickets && allFree) {
          return refuse("optimization_sales_free_event");
        }
        if (
          !(HOST_SALES_GOAL_PLATFORMS as readonly string[]).includes(
            platform,
          ) || !sellsTickets
        ) return refuse("optimization_sales_unsupported");
      }
      if (value === "signups") {
        if (!acceptsSignups) return refuse("optimization_signups_unsupported");
        if (
          !(HOST_SIGNUPS_GOAL_PLATFORMS as readonly string[]).includes(
            platform,
          )
        ) return refuse(`optimization_signups_unsupported:${platform}`);
      }
      map[platform] = value as HostAdOptimization;
    }
  }
  if (context.ready) {
    for (const [platform, value] of Object.entries(map)) {
      if (value === "visits") continue;
      if (context.ready[platform]?.[value] !== true) {
        return refuse(`optimization_${value}_not_ready:${platform}`);
      }
    }
  }
  if (requested === "sales" || requested === "signups") {
    const acknowledged = new Set(
      Array.isArray(context.acknowledgedFallback)
        ? context.acknowledgedFallback.map((value) => String(value))
        : [],
    );
    const fellBack = platforms.filter((platform) =>
      map[platform] === "visits" && !acknowledged.has(platform)
    );
    if (fellBack.length > 0) {
      return {
        ok: false,
        status: 409,
        detail: "host_ad_goal_fallback_unacknowledged",
        platforms: fellBack,
      };
    }
  }
  return { ok: true, map };
}

/**
 * #4238 Extra B: bidding, Google promotion type and TikTok placement are
 * delivery choices Mingla makes, not the Host. A Host body naming them is
 * refused the same way as an objective.
 */
export const HOST_DELIVERY_BODY_FIELDS = [
  "bid_strategy",
  "promotion_type",
  "tiktok_placement",
] as const;

/**
 * #4238: manual bids inside `budget` (TikTok bid_type / bid_price_cents,
 * Google cpc_bid_cents, Snapchat bid_cents) are Mingla's choice too.
 */
export const HOST_BUDGET_BID_FIELDS = [
  "bid_type",
  "bid_price_cents",
  "cpc_bid_cents",
  "bid_cents",
  // #4238 retest 3: budget level and campaign spend cap are Mingla's too.
  // Neither the Business client nor Ari sends them on the Host path.
  "level",
  "spend_cap_cents",
] as const;

/** A Host create body that names its own objective or delivery choice is refused. */
export function hostGoalBodyError(
  body: Record<string, unknown>,
): "plan_optimization_mismatch" | "host_delivery_field_forbidden" | null {
  if (HOST_GOAL_BODY_FIELDS.some((field) => body[field] !== undefined)) {
    return "plan_optimization_mismatch";
  }
  if (HOST_DELIVERY_BODY_FIELDS.some((field) => body[field] !== undefined)) {
    return "host_delivery_field_forbidden";
  }
  const budget = body.budget;
  if (
    budget !== null && typeof budget === "object" && !Array.isArray(budget) &&
    HOST_BUDGET_BID_FIELDS.some((field) =>
      (budget as Record<string, unknown>)[field] !== undefined
    )
  ) return "host_delivery_field_forbidden";
  return null;
}

/**
 * A Host plan may bind only connected accounts of the lane HOST_AD_LANE
 * names, on the platform the allocation says. Returns the refusal detail, or
 * null.
 */
export function hostAllocationLaneError(
  rows: readonly {
    id?: unknown;
    platform?: unknown;
    lane?: unknown;
    connected?: unknown;
    status?: unknown;
  }[],
  requested: readonly { platform: string; connection_id: string }[],
): "host_connection_lane_invalid" | null {
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const allocation of requested) {
    const row = byId.get(allocation.connection_id);
    if (
      !row || row.lane !== HOST_AD_LANE ||
      row.platform !== allocation.platform ||
      // #4238 Extra C: only a live account may be bound to a Host plan.
      row.connected !== true || row.status !== "connected"
    ) return "host_connection_lane_invalid";
  }
  return null;
}
