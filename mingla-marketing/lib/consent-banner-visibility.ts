// Issue #905 [links-banner-suppress] — route-aware consent-banner visibility.
//
// On the `/links` no-scroll viewport (`components/marketing/links-experience.tsx`
// is `100dvh` + `overflow-hidden`), the global bottom-fixed consent banner
// (`components/marketing/consent-banner.tsx`, `z-[90]`) paints on top of the
// download CTAs and the socials row with no scroll escape hatch. This pure,
// dependency-free predicate decides whether the banner may render for a given
// route, so `/links` (and any future no-scroll route added to the list below)
// suppresses it. Privacy-safe: analytics are opt-out (PostHog) / GA-denied by
// default until Accept, so suppression leaves the safe denied default and
// solicits nothing on `/links`.
//
// Dependency-free BY DESIGN (no React, no `next`, no other imports) so it
// compiles and runs standalone under the repo's `tsc + node` test pattern with
// NO DOM/browser — mirrors `lib/device-platform.ts` / `lib/links-src.ts`.

/**
 * Single source of truth for no-scroll routes that suppress the global consent
 * banner. Add a future no-scroll route ONLY here. Exact-match, never prefix.
 */
export const SUPPRESSED_CONSENT_ROUTES = ['/links'] as const

/**
 * Should the global marketing consent banner render on this route?
 *
 * Returns `false` (SUPPRESS) iff the trailing-slash-normalized pathname is an
 * EXACT member of `SUPPRESSED_CONSENT_ROUTES`. Everything else returns `true`
 * (SHOW), including a null/undefined/empty/unknown pathname (safe default:
 * unknown route → banner shown, consent solicited).
 *
 * Match rules:
 *  - `'/links'`  → false (suppress).
 *  - `'/links/'` → false (one trailing slash normalized off).
 *  - `'/linksomething'` / `'/links/deep'` → true (EXACT match, NEVER prefix/substring).
 *  - `null` / `undefined` / `''` → true (unknown → show).
 *  - `'/LINKS'` → true (case-sensitive; Next routes are case-sensitive — do NOT fold).
 *
 * @param pathname the current route pathname (no query/hash — `usePathname()`
 *   never passes them). `null` is the documented App-Router edge case.
 */
export function shouldRenderConsentBanner(pathname: string | null): boolean {
  if (!pathname) return true
  // Strip ONE trailing slash, but never collapse the root '/' to ''.
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  return !(SUPPRESSED_CONSENT_ROUTES as readonly string[]).includes(normalized)
}
