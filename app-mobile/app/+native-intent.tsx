/**
 * +native-intent — #2180 [get-app link opens the installed app and strands the user].
 *
 * PROTECTIVE — do not delete this file, and do not relax the host check.
 *
 * expo-router strips the origin from any `https://` URL with no domain allowlist
 * (`expo-router/build/fork/extractPathFromURL.js:22-34`; the prefix list that would
 * have gated it is empty — `expo-router/build/getLinkingConfig.js:53` `prefixes: []`,
 * and the `_prefixes` argument of `extractExpoPathFromURL` is unused). Without this
 * file, `https://go.usemingla.com/w36m` becomes route path `w36m`, matches nothing,
 * and dead-ends — in this app on expo-router's developer-facing "Unmatched Route"
 * view, because `app-mobile` shipped no `+not-found` screen at all. #2180.
 *
 * `redirectSystemPath` runs BEFORE `extractExactPathFromURL` and `getStateFromPath`,
 * on both entry points:
 *   - cold start   `getLinkingConfig.js:71-72` / `:78-79`  (`initial: true`)
 *   - warm link    `link/linking.js:108-109` / `:119-120`  (`initial: false`)
 * so `path` is the RAW incoming URL, not a pre-stripped route path.
 *
 * Contract (SPEC §4.1 R-1..R-7):
 *   R-1 not an absolute URL (already relative)      -> input unchanged
 *   R-2 absolute URL on a host we do not own        -> "/"
 *   R-3 owned host, first segment we do not serve   -> "/"
 *   R-4 owned host, empty path or "/"               -> "/"
 *   R-5 owned host, served segment                  -> input unchanged (query + fragment intact)
 *   R-6 custom-scheme URL                           -> R-3/R-4/R-5 on its path; scheme is trusted
 *   R-7 anything throws                             -> "/"
 *
 * "/" is the correct landing because `app/index.tsx` already gates it: resolving ->
 * AppLoadingScreen, not signed in -> WelcomeScreen, signed in + onboarded -> the tab
 * shell. This file decides WHERE, never WHAT — it never consumes, rewrites or strips
 * the AppsFlyer attribution parameters on links it passes through.
 *
 * Hard constraints: pure, synchronous, dependency-free, non-throwing. It sits on the
 * cold-start critical path, and expo-router's own docs warn that throwing here can
 * crash the app (`expo-router/build/types.d.ts:36-38`).
 */

/** Where anything unrecognised lands. `app/index.tsx` gates welcome-vs-tab-shell. */
const HOME = "/";

/**
 * Domains this app is registered to capture links for.
 *
 * Derived from `app-mobile/app.json`: `expo.ios.associatedDomains`
 * (`applinks:usemingla.com`, `applinks:host.usemingla.com`,
 * `applinks:go.usemingla.com`) and the `expo.android.intentFilters` hosts
 * (the same three).
 *
 * Compared with EXACT, lower-cased string equality against `URL.hostname` — never
 * `includes`, never `endsWith`, never a regex over the raw URL. This is a security
 * boundary: `https://go.usemingla.com@evil.example/x` parses to hostname
 * `evil.example`, and `https://go.usemingla.com.evil.example/x` to that whole
 * label, so both correctly fail this check and land on "/".
 */
const OWNED_LINK_HOSTS: ReadonlySet<string> = new Set([
  "usemingla.com",
  "host.usemingla.com",
  "go.usemingla.com",
]);

/**
 * Custom scheme that belongs to this app (`app-mobile/app.json` `expo.scheme`,
 * also registered as an Android intent filter).
 */
const OWNED_LINK_SCHEMES: ReadonlySet<string> = new Set(["com.mingla.app.v2"]);

/**
 * First path segments that exist as routes in `app-mobile/app/`.
 *
 * DERIVED by enumerating the real `app/` tree, NOT copied from anywhere: every
 * top-level entry, minus expo-router specials (`_layout`, `+not-found`,
 * `+native-intent`), minus `__tests__`, and minus `index` (that IS "/"). This app
 * has no group directories today; the enumerator in T-7 recurses into them anyway
 * so adding one cannot silently drop its routes.
 *
 * DELIBERATELY ABSENT: `invite`, `board`, `orders`, `chat`. All four are claimed by
 * `app-mobile/app.json`'s Android intent filters on `usemingla.com` but have NO
 * route in this app. Leaving them out is the correct behaviour — they now resolve
 * to "/" instead of the developer Unmatched view. Asserted by T-6. Do NOT "fix"
 * this by adding them here.
 *
 * Kept honest by T-7 (`issue_2180_native_intent.implementor.happy.test.ts`), which
 * re-enumerates the tree and fails the build on any drift.
 */
const SERVED_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  "b",
  "brand",
  "e",
  "exp",
  "p",
  "s",
  "stay",
  "t",
]);

/** `scheme:` prefix per RFC 3986. Anything without one is a relative path (R-1). */
const ABSOLUTE_URL_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * First non-empty path segment, or `null` for an empty path.
 * Not decoded: comparison is against literal route directory names.
 */
function firstSegment(pathname: string): string | null {
  for (const part of pathname.split("/")) {
    if (part.length > 0) return part;
  }
  return null;
}

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    // Defensive: expo-router only calls this with a truthy string, but a
    // non-string here must not be able to throw on the cold-start path.
    if (typeof path !== "string" || path.length === 0) return HOME;

    // R-1 — already a relative in-app path; hand it straight back.
    if (!ABSOLUTE_URL_PREFIX.test(path)) return path;

    const url = new URL(path);
    const scheme = url.protocol.replace(/:$/, "").toLowerCase();

    let effectivePath: string;

    if (scheme === "https" || scheme === "http") {
      // R-2 — exact, lower-cased hostname equality. A trailing-dot host
      // (`go.usemingla.com.`) is deliberately NOT normalised away: it is not an
      // exact match, so it lands on "/" rather than reaching a real route.
      if (!OWNED_LINK_HOSTS.has(url.hostname.toLowerCase())) return HOME;
      effectivePath = url.pathname;
    } else if (OWNED_LINK_SCHEMES.has(scheme)) {
      // R-6 — for a custom scheme the authority is really the first path
      // segment (`com.mingla.app.v2://e/acme/party` parses to host "e",
      // pathname "/acme/party"), so fold it back in before matching.
      effectivePath = url.host ? `/${url.host}${url.pathname}` : url.pathname;
    } else {
      // An absolute URL on a scheme we do not own.
      return HOME;
    }

    const segment = firstSegment(effectivePath);

    // R-4 — owned host, empty path.
    if (segment === null) return HOME;

    // R-3 — owned host, a segment this app does not serve (the #2180 case:
    // `/w36m` is an AppsFlyer OneLink template id, not a screen).
    if (!SERVED_ROUTE_SEGMENTS.has(segment)) return HOME;

    // R-5 — a real deep link. Returned byte-for-byte so query strings and
    // fragments survive intact (share tokens, AppsFlyer `pid`/`c`).
    return path;
  } catch {
    // R-7 — total catch-all. Never throw from here.
    return HOME;
  }
}

/** Exported for T-7's route-tree sync assertion. Not used at runtime. */
export const __test__ = {
  OWNED_LINK_HOSTS,
  OWNED_LINK_SCHEMES,
  SERVED_ROUTE_SEGMENTS,
  HOME,
};
