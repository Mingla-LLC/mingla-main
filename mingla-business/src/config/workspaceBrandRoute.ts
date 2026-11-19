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
