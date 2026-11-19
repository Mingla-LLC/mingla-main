/**
 * #4453 (contract section I) — which brand a screen is about, read from the
 * pathname and the route's params alone: `brandIdFromRoute`.
 *
 * This is the ONE part of the workspace brand switcher the app shell needs
 * before anything draws (the top bar must name the brand of the screen you
 * are on), so it lives alone in this small file. Where "the same screen" is
 * for another brand (the whole route table) is only needed when the host
 * switches, and loads with the switcher: config/workspaceBrandRoutes.ts.
 *
 * Dependency-free and pure (no React, no React Native, no router).
 */

export type WorkspaceRouteParams = Readonly<
  Record<string, string | string[] | undefined>
>;

/** The first value of a route param, or null when it is absent or empty. */
export const firstParam = (value: string | string[] | undefined): string | null => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.length > 0 ? first : null;
};

/** Path segments without the query string or `(group)` segments. */
export const workspacePathSegments = (
  pathname: string | null | undefined,
): string[] =>
  typeof pathname !== "string"
    ? []
    : (pathname.split(/[?#]/)[0] ?? "")
        .split("/")
        .filter((segment) => segment.length > 0 && !/^\(.*\)$/.test(segment));

/** `/(tabs)/hub/events?x=1` and `/hub/events/` both read `/hub/events`. */
export const workspaceRoutePath = (
  pathname: string | null | undefined,
): string => `/${workspacePathSegments(pathname).join("/")}`;

/**
 * Host screens that carry their brand in the query string. Public buyer
 * routes (`/reserve/[brandId]`, `/b/...`) are deliberately absent: a visitor's
 * page never moves the host's current brand.
 */
const QUERY_BRAND_SCREENS: Readonly<Record<string, readonly string[]>> = {
  "/ari": ["brandId"],
  "/account/tap-to-pay": ["brandId"],
  "/people/import": ["brandId"],
  "/venue/deck-readiness": ["brand_id"],
};

/**
 * The brand this screen is about, or null when the screen follows the
 * current-brand store. `/brand/new` is the create flow, not a brand.
 */
export function brandIdFromRoute(
  pathname: string | null | undefined,
  params: WorkspaceRouteParams | null | undefined,
): string | null {
  const segments = workspacePathSegments(pathname);
  if (segments[0] === "brand") {
    const id = segments[1];
    if (id === undefined || id === "new") return null;
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }
  const keys = QUERY_BRAND_SCREENS[`/${segments.join("/")}`];
  if (keys === undefined || params == null) return null;
  for (const key of keys) {
    const value = firstParam(params[key]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Screens above brand level: they are about the person signed in (their
 * account, their notifications, help) or about brands as a set (creating one),
 * not about one brand. No brand name is shown at the top of these, so nothing
 * there suggests the screen belongs to the brand last worked on.
 */
const ABOVE_BRAND_SCREENS: ReadonlySet<string> = new Set([
  "account",
  "notifications",
  "support",
  "recent",
  "partner",
  "promoting",
]);

export function isAboveBrandScreen(pathname: string | null | undefined): boolean {
  const segments = workspacePathSegments(pathname);
  const head = segments[0] ?? "";
  if (head === "brand") return segments[1] === "new";
  // A screen that names its brand in the address (Tap to Pay under Account) is that brand's.
  if (head === "account" && segments[1] === "tap-to-pay") return false;
  return ABOVE_BRAND_SCREENS.has(head);
}

/**
 * On a phone, the brand to name above a brand's own screen (`/brand/<id>/...`),
 * or null when it is not one brand's screen. Website is included: its setup,
 * overview and "try again" screens have no bar of their own to carry the name
 * (the workspace, which does, tells the shell so: phoneBrandSwitcherOwner).
 * The full-screen preview shows only the website.
 */
export function phoneBrandStripFor(pathname: string | null | undefined, routeBrandId: string | null): string | null {
  const segments = workspacePathSegments(pathname);
  if (segments[0] !== "brand" || routeBrandId === null || segments[1] === "new") return null;
  if (segments[2] === "website" && segments[3] === "preview") return null;
  return routeBrandId;
}
