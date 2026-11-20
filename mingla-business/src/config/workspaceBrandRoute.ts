/**
 * #4453 (contract section I) — which brand a screen is about, read from the
 * pathname and the route's params alone: `brandIdFromRoute`, and what the
 * shell draws for it (`isAboveBrandScreen`, `phoneBrandStrip`, `itemRouteRef`).
 *
 * The app shell needs this before anything draws (the top bar must name the
 * brand of the screen you are on). ONLY the root shell and its own hooks
 * import this file, so it loads with the root layout; anything in an
 * on-demand chunk that imported it too would move it onto the boot path.
 * Where "the same screen" is for another brand (the whole route table) is
 * only needed when the host switches, and loads with the switcher:
 * config/workspaceBrandRoutes.ts, which restates the path helpers.
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
  // The person's own Ari settings (the Ari tab itself follows the brand).
  if (head === "ari") return segments[1] === "settings";
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

/** Where an item's brand is recorded: every event, RSVP, experience and trip is an `events` row. */
export type ItemRouteRef = { table: "events" | "venue_listings"; id: string };

const ITEM_TABLE: Readonly<Record<string, ItemRouteRef["table"]>> = {
  event: "events",
  rsvp: "events",
  experience: "events",
  trip: "events",
  venue: "venue_listings",
};
const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The item a screen is about (`/trip/<id>`, `/event/<id>/orders/...`), or null.
 * Create flows and other fixed words (`/event/create`, `/rsvp/pass`) are not items.
 */
export function itemRouteRef(pathname: string | null | undefined): ItemRouteRef | null {
  const segments = workspacePathSegments(pathname);
  const table = ITEM_TABLE[segments[0] ?? ""];
  const id = segments[1];
  if (table === undefined || id === undefined || !ITEM_ID.test(id)) return null;
  return { table, id: id.toLowerCase() };
}

/** The phone strip names the route's brand, or follows the current brand. */
export type PhoneBrandStrip = { brandId: string | undefined };

/**
 * On a phone, whether the shell names the brand above this screen, and which.
 *
 * - A brand's own screen (`/brand/<id>/...`): that brand.
 * - One item of a brand outside the tabs (one trip, event, RSVP, experience,
 *   listing, insight, conversation): the current brand, which is the item's.
 *   These are exactly the screens the desktop shell puts its top bar on
 *   (`shellMode` "sidebar" or "rail"), so phone and desktop agree.
 * - Tabs draw their own top bar; public, sign-in and full-screen tool routes
 *   ("none") and screens above brand level show no brand.
 */
export function phoneBrandStrip(
  pathname: string | null | undefined,
  routeBrandId: string | null,
  shellMode: "tabs" | "sidebar" | "rail" | "none",
): PhoneBrandStrip | null {
  const own = phoneBrandStripFor(pathname, routeBrandId);
  if (own !== null) return { brandId: own };
  if (workspacePathSegments(pathname)[0] === "brand") return null;
  if (shellMode !== "sidebar" && shellMode !== "rail") return null;
  if (isAboveBrandScreen(pathname)) return null;
  return { brandId: routeBrandId ?? undefined };
}
