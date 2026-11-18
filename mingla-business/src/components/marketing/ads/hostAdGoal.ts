/**
 * #4238 — client mirror of the server's Host ad goal rules (the server's
 * `_shared/adHostGoal.ts` stays the authority). Pure and import-light so the
 * builder route can use it without loading the lazy Host Ads service.
 */

type Platform = "meta" | "tiktok" | "snapchat" | "google" | "reddit";

/**
 * Platforms with a website-sales path a Host ad may use. #4238 W6a: Google
 * stays off this list (ADV-3: it is never frozen as sales here). The builder
 * shows Google as "Needs setup" for sales and sign-ups and never puts it in
 * such a plan; the server refuses one with host_ad_google_needs_setup.
 */
export const HOST_AD_SALES_PLATFORMS: readonly Platform[] = [
  "meta",
  "snapchat",
  "tiktok",
];

/** #4238 item 3: platforms with a sign-ups path (free and RSVP pages). */
export const HOST_AD_SIGNUP_PLATFORMS: readonly Platform[] = ["meta", "snapchat"];

/** Page types whose result is a sign-up (no ticket is sold). */
const HOST_AD_SIGNUP_RESULTS: readonly string[] = ["rsvp", "signups", "registrations"];

/**
 * #4238 W6a: the one goal a Host sees, from the page they picked: ticket
 * pages sell tickets, RSVP and free pages get sign-ups, everything else gets
 * visits. The server stays the authority (a free ticket page is refused for
 * sales and the builder moves it to sign-ups).
 */
export function hostAdPageGoal(
  page: { page_type: string; result_kind: string | null } | null | undefined,
): "sales" | "signups" | "visits" {
  if (hostAdPageSellsTickets(page)) return "sales";
  if (page && (page.page_type === "rsvp" || HOST_AD_SIGNUP_RESULTS.includes(page.result_kind ?? ""))) {
    return "signups";
  }
  return "visits";
}

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

/**
 * #4238 honest Review: why an app aims for page visits instead of the page's
 * goal. "not_yet" = the app can aim for this goal but its signal for this
 * brand isn't ready (`ready !== true`), so the copy may say "yet". "cannot"
 * = anything else (the app has no path for this goal), so the copy must not
 * say "yet". Mirrors the rule in hostOptimizationByPlatform
 * (hostAdPlanService.ts).
 */
export function hostAdGoalFallbackReason(
  goal: "sales" | "signups",
  connection: {
    platform: string;
    sales?: { ready: boolean } | null;
    signups?: { ready: boolean } | null;
  },
): "cannot" | "not_yet" {
  const platforms: readonly string[] =
    goal === "sales" ? HOST_AD_SALES_PLATFORMS : HOST_AD_SIGNUP_PLATFORMS;
  if (!platforms.includes(connection.platform)) return "cannot";
  const signal = goal === "sales" ? connection.sales : connection.signups;
  return signal?.ready === true ? "cannot" : "not_yet";
}
