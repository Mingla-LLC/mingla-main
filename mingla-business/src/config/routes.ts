/** Central paths for expo-router `router.push` / `href`.
 * Note: `app/auth/index.tsx` resolves to `/auth` (not `/auth/index`).
 * `(tabs)` is an Expo Router route group — files inside collapse to
 * top-level URLs at runtime (e.g. `app/(tabs)/home.tsx` → `/home`).
 *
 * ORCH-0826 M0: tab `events` renamed to `hub`; the Hub tab now has three
 * sub-routes (events / experiences / trips). The legacy `events` key was
 * removed (hard rename — no stub redirect; old route deleted). Current
 * consumers (`app/index.tsx`, `app/auth/index.tsx`) only use `home` and
 * auth keys; hub keys added for future use without immediate consumers.
 */
const AppRoutes = {
  /** Signed-in shell — the 5-tab layout (Home / Hub / Ari / Blast / Account). */
  home: "/(tabs)/home",
  hub: "/(tabs)/hub",
  hubEvents: "/(tabs)/hub/events",
  hubExperiences: "/(tabs)/hub/experiences",
  hubTrips: "/(tabs)/hub/trips",
  account: "/(tabs)/account",
  marketing: "/(tabs)/marketing",
  ari: "/(tabs)/ari",
  auth: {
    index: "/auth",
  },
} as const;

export default AppRoutes;

// ─── #3355 Wave C (C2): the Host screen Ari is asked from ───────────────────
// The root layout records the last non-Ari pathname; each Ari message sends it
// as `client_context`, so "this event" means the event the host was looking
// at. Dependency-free on purpose: this file is already in the eager bundle.
// The server validates the route against the App Map and the entity against
// the active brand, and drops anything that does not hold.

export interface AriClientContext {
  route: string;
  entity_kind?: "event" | "trip" | "experience" | "rsvp" | "venue" | "brand";
  entity_id?: string;
}

const ARI_ENTITY_ROUTE_KINDS: Record<string, AriClientContext["entity_kind"]> = {
  event: "event",
  trip: "trip",
  experience: "experience",
  rsvp: "rsvp",
  venue: "venue",
  brand: "brand",
};
const ARI_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let lastAriHostScreen: string | null = null;

function ariPathSegments(pathname: string): string[] {
  return pathname
    .split(/[?#]/)[0]
    .split("/")
    .filter((segment) => segment.length > 0 && !/^\(.*\)$/.test(segment));
}

/** Ari's own screens are never "the screen the host is on". */
export function isAriChatPath(pathname: string): boolean {
  const segments = ariPathSegments(pathname);
  return segments[0] === "ari" || segments[segments.length - 1] === "ari";
}

export function rememberAriHostScreen(pathname: string | null | undefined): void {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return;
  if (isAriChatPath(pathname)) return;
  lastAriHostScreen = pathname;
}

/** `client_context` for the last host screen; the query string never leaves. */
export function ariClientContextFor(
  pathname: string | null = lastAriHostScreen,
): AriClientContext | undefined {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return undefined;
  const segments = ariPathSegments(pathname);
  const route = `/${segments.join("/")}`.slice(0, 300);
  const kind = ARI_ENTITY_ROUTE_KINDS[segments[0] ?? ""];
  const id = segments[1];
  return kind && id && ARI_UUID_RE.test(id)
    ? { route, entity_kind: kind, entity_id: id.toLowerCase() }
    : { route };
}
