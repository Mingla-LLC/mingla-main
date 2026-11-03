/**
 * #4238 — client mirror of the server's Host ad goal rules (the server's
 * `_shared/adHostGoal.ts` stays the authority). Pure and import-light so the
 * builder route can use it without loading the lazy Host Ads service.
 */

type Platform = "meta" | "tiktok" | "snapchat" | "google" | "reddit";

/** Platforms with a website-sales path a Host ad may use. */
export const HOST_AD_SALES_PLATFORMS: readonly Platform[] = [
  "meta",
  "snapchat",
  "tiktok",
];

/**
 * Page types that sell tickets through Mingla checkout. A brand website
 * reports result_kind "tickets" but sells nothing itself; brand, RSVP, venue
 * and reservation pages never record a ticket sale.
 */
export const HOST_AD_SALES_PAGE_TYPES: readonly string[] = [
  "event",
  "trip",
  "experience",
];

export function hostAdPageSellsTickets(
  page: { page_type: string; result_kind: string | null } | null | undefined,
): boolean {
  return (
    page?.result_kind === "tickets" &&
    HOST_AD_SALES_PAGE_TYPES.includes(page.page_type)
  );
}

/**
 * Review-step split of the frozen goal: which platforms chase ticket sales and
 * which chase page visits. An absent entry means visits.
 */
export function hostOptimizationSummary<P extends string>(
  optimizationByPlatform: unknown,
  platforms: readonly P[],
): { sales: P[]; visits: P[] } {
  const map =
    optimizationByPlatform !== null &&
    typeof optimizationByPlatform === "object" &&
    !Array.isArray(optimizationByPlatform)
      ? (optimizationByPlatform as Record<string, unknown>)
      : null;
  return {
    sales: platforms.filter((platform) => map?.[platform] === "sales"),
    visits: platforms.filter((platform) => map?.[platform] !== "sales"),
  };
}
