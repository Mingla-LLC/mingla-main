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

export type HostAdOptimization = "visits" | "sales";

/** Platforms with a website-sales path a Host ad may use (= Admin Sales). */
export const HOST_SALES_GOAL_PLATFORMS: readonly Platform[] = [
  "meta",
  "snapchat",
  "tiktok",
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

/** The provider objective fields a Host body may never carry itself. */
export const HOST_GOAL_BODY_FIELDS = [
  "objective",
  "optimization_goal",
  "billing_event",
] as const;

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
  return value === "visits" || value === "sales" ? value : null;
}

export type HostOptimizationValidation =
  | { ok: true; map: Record<string, HostAdOptimization> }
  | {
    ok: false;
    detail: "optimization_invalid" | "optimization_sales_unsupported";
  };

/**
 * create_version authority for a Host plan's goal. The map's keys must equal
 * the plan's platforms; "sales" is allowed only on Meta, Snapchat and TikTok
 * for a page that sells tickets (hostPageSellsTickets). A missing map becomes all "visits" so the
 * plan hash always carries the goal.
 */
export function validateHostOptimization(
  input: unknown,
  platforms: readonly string[],
  destination:
    | { page_type?: unknown; result_kind?: unknown }
    | null
    | undefined,
): HostOptimizationValidation {
  const sellsTickets = hostPageSellsTickets(destination);
  if (input === undefined || input === null) {
    return {
      ok: true,
      map: Object.fromEntries(platforms.map((p) => [p, "visits" as const])),
    };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, detail: "optimization_invalid" };
  }
  const entries = Object.entries(input as Record<string, unknown>);
  const keys = new Set(entries.map(([key]) => key));
  if (
    keys.size !== platforms.length || !platforms.every((p) => keys.has(p))
  ) {
    return { ok: false, detail: "optimization_invalid" };
  }
  const map: Record<string, HostAdOptimization> = {};
  for (const [platform, value] of entries) {
    if (value !== "visits" && value !== "sales") {
      return { ok: false, detail: "optimization_invalid" };
    }
    if (
      value === "sales" &&
      (!(HOST_SALES_GOAL_PLATFORMS as readonly string[]).includes(platform) ||
        !sellsTickets)
    ) {
      return { ok: false, detail: "optimization_sales_unsupported" };
    }
    map[platform] = value;
  }
  return { ok: true, map };
}

/** A Host create body that names its own objective is refused. */
export function hostGoalBodyError(
  body: Record<string, unknown>,
): "plan_optimization_mismatch" | null {
  return HOST_GOAL_BODY_FIELDS.some((field) => body[field] !== undefined)
    ? "plan_optimization_mismatch"
    : null;
}

/**
 * A Host plan may bind only the accounts HOST_AD_LANE names, on the platform
 * the allocation says. Returns the refusal detail, or null.
 */
export function hostAllocationLaneError(
  rows: readonly { id?: unknown; platform?: unknown; lane?: unknown }[],
  requested: readonly { platform: string; connection_id: string }[],
): "host_connection_lane_invalid" | null {
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const allocation of requested) {
    const row = byId.get(allocation.connection_id);
    if (
      !row || row.lane !== HOST_AD_LANE ||
      row.platform !== allocation.platform
    ) return "host_connection_lane_invalid";
  }
  return null;
}
