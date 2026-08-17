/**
 * nextRoute — ORCH-1375 [`?next=` resume path]. The ONE validator for any
 * "return to this route after sign-in" parameter in mingla-business.
 *
 * WHY THIS MODULE EXISTS (the class, not the instance).
 * `next` is ATTACKER-CONTROLLABLE: anyone can mail
 * `https://host.usemingla.com/auth?next=https://evil.example/phish`. A naive
 * `router.replace(next)` is a CLASSIC OPEN REDIRECT — on the very domain we are
 * training users to trust with an auth flow, at the exact moment they are primed
 * to type a credential. That is the worst possible place to have one.
 *
 * WHY AN ALLOWLIST AND NOT "any same-origin relative path" (ORCH-1373 SPEC
 * §4.3.4). The only legitimate resume targets are the four known writers. A
 * general relative-path rule silently authorises EVERY FUTURE ROUTE as a
 * redirect target — including routes that may later carry credentials in the
 * URL. Enumerate, don't generalise.
 *
 * THE TRAPS THIS CLOSES (each has a test in __tests__/nextRoute.test.ts):
 * - `//evil.com` — protocol-relative. A browser reads this as an ABSOLUTE URL;
 *   it is NOT a relative path just because it starts with a slash.
 * - `/\evil.com` — some browsers normalise a backslash to `/`, making this
 *   protocol-relative too.
 * - `javascript:` / `data:` — scheme injection.
 * - `%2f%2fevil.com` / `/%252f%252fevil.com` — encoded and double-encoded
 *   variants of the above. This is why we decode-then-REVALIDATE rather than
 *   validating the raw string once.
 * - `/accept-brand-invitation-evil` — prefix confusion. Matching is
 *   SEGMENT-SAFE (`=== base || startsWith(base + "/")`), the exact discipline
 *   already proven in `coldLoadAuthGates.ts:283-300`.
 */

/**
 * The ONLY paths a sign-in may resume to. Every entry corresponds to a real
 * writer of `?next=` (ORCH-1375 investigation: 4 writers, 0 readers before this
 * module existed). Adding an entry here AUTHORISES A REDIRECT TARGET — do not
 * add one without asking whether that route can ever carry a credential in its
 * URL that an attacker would like delivered to a page they control.
 *
 * Segment-safe matching means `/accept-brand-invitation` also covers
 * `/accept-brand-invitation/success`.
 */
export const NEXT_ROUTE_ALLOWLIST: readonly string[] = [
  "/accept-brand-invitation",
  "/accept-scanner-invitation",
  "/rsvp/create",
  "/event/create",
  // #948 — dynamic brand routes carry only an RLS-scoped brand UUID, never a
  // URL credential. Segment-safe matching below rejects `/brand-evil`.
  "/brand",
] as const;

/**
 * issue #2101 [named-buyer checkout] — the PUBLIC OFFERING families.
 *
 * THE COMPLETE AUTHORIZED SET IS THE UNION of the five static workflow prefixes
 * in `NEXT_ROUTE_ALLOWLIST` above PLUS exactly these three public offering
 * families. This is CATEGORIZATION INSIDE ONE VALIDATOR — not a second
 * sanitizer, not a caller bypass, and not a parallel decision path. Both
 * categories are matched by the SAME `isAllowlistedPath` below, inside the SAME
 * `sanitizeNextRoute` decision owner, in this SAME module. This tuple is
 * deliberately NOT exported: no public function may validate either category
 * separately and no caller may consume it.
 *
 * WHY THEY EXIST. A restricted sale sends an anonymous buyer to `/auth?next=…`
 * and must return them to the exact public offering they were looking at. With
 * only the five workflow prefixes, `/t/…`, `/exp/…` and `/e/…` all sanitize to
 * `null` and `app/auth/index.tsx` falls back to `AppRoutes.home` —
 * `/(tabs)/home`, the ORGANISER tab shell. That is not "no resume", it is a
 * consumer buyer deposited in the organiser app.
 *
 * WHY `/e` CANNOT REACH `/event/*`. Matching is segment-safe in BOTH
 * directions. `"/event/create".startsWith("/e/")` is FALSE, so the `/e` family
 * admits neither `/event`, `/event/`, `/event/create`, nor any organiser route
 * `/event/{id}`, `/event/{id}/edit`, `/event/{id}/reconciliation`,
 * `/event/{id}/group-chat`. Conversely no registry entry matches `/e`, `/e/` or
 * `/e/acme/launch-party`. `/event/create` stays accepted solely because of its
 * OWN registry entry — causally unchanged.
 *
 * SAFETY OF THE ADMISSION. Each family opens exactly one public buyer route
 * that reads only its own path segments and never carries a credential in its
 * URL. Every value that survives validation with one of these heads is
 * same-origin and scheme-less, so "enumerate, don't generalise" holds: three
 * enumerated families is still an enumeration.
 */
const PUBLIC_OFFERING_NEXT_ROUTE_PREFIXES: readonly string[] = [
  "/t", // canonical Trip public paths   — tripPublicPath()
  "/exp", // canonical Experience public paths — experiencePublicPath()
  "/e", // canonical Event public paths  — eventPublicPath()
] as const;

/** Bound the surface — nothing legitimate is anywhere near this long. */
const MAX_NEXT_LENGTH = 2048;

/** Any scheme at all (`javascript:`, `data:`, `https:`) — never allowed. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Structural check: must be a single-slash-rooted, scheme-less relative path.
 * Applied to the raw value AND to its decoded form.
 */
const isStructurallyRelative = (value: string): boolean => {
  // Must be rooted at exactly one "/".
  if (!value.startsWith("/")) return false;
  // "//evil.com" is protocol-relative = ABSOLUTE to a browser.
  if (value.startsWith("//")) return false;
  // "/\evil.com" — backslash normalises to "/" in some browsers → also
  // protocol-relative.
  if (value.startsWith("/\\")) return false;
  // No scheme anywhere at the head.
  if (SCHEME_RE.test(value)) return false;
  return true;
};

/** The path segment only — everything before the first "?" or "#". */
const pathSegmentOf = (value: string): string => {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
};

/**
 * DOT-SEGMENT (path-traversal) REJECTION — ORCH-1373 P2-1.
 *
 * THE DEFECT THIS CLOSES: `isAllowlistedPath` matches on the PRE-RESOLUTION
 * string, but `remove_dot_segments` (RFC 3986 §5.2.4) runs LATER — inside the
 * router / URL parser. So the string the validator JUDGES and the path the
 * browser LANDS ON were different strings:
 *
 *   "/brand/123/payments"                            -> REJECTED (not allowlisted)
 *   "/accept-brand-invitation/../brand/123/payments" -> ACCEPTED, then resolves
 *                                                       to "/brand/123/payments"
 *
 * i.e. traversal walked straight through the allowlist to the EXACT path the
 * allowlist exists to refuse.
 *
 * ⚠️ SCOPE — DO NOT OVER-CLAIM THIS. It is NOT an open redirect: every accepted
 * value stays same-origin and scheme-less (`isStructurallyRelative` already
 * guarantees that, and the tester independently confirmed it against the real
 * WHATWG URL parser, 39/39). This defeats the ALLOWLIST'S STATED INTENT — the
 * "enumerate, don't generalise" promise in this file's header — which is a real
 * defect worth closing on its own terms, not a cross-origin escape.
 *
 * `%2e` is handled case-insensitively because the WHATWG URL spec's
 * "double-dot path segment" includes the percent-encoded spellings — a browser
 * resolves `/a/%2e%2e/b` to `/b` exactly like `/a/../b`. Double-encoded
 * (`%252e%252e`) is NOT traversal: it survives one decode as the literal text
 * `%2e%2e`, which a browser treats as an ordinary segment, and the allowlist
 * then judges the same string the router receives — no divergence, no bug.
 *
 * Applied to the PATH SEGMENT only (query/fragment stripped first), so a token
 * that legitimately contains dots is never touched.
 */
const hasDotSegment = (path: string): boolean =>
  path.split("/").some((segment) => {
    const decodedSegment = segment.replace(/%2e/gi, ".");
    return decodedSegment === "." || decodedSegment === "..";
  });

/**
 * Segment-safe allowlist match. `/accept-brand-invitation-evil` MUST NOT match
 * `/accept-brand-invitation` — that is the whole point of the `+ "/"`.
 * Mirrors `isSelfAuthenticatedExemptRoute` (coldLoadAuthGates.ts:283-300).
 */
const isAllowlistedPath = (path: string): boolean => {
  const trimmed = path.trim();
  if (trimmed === "") return false;
  // Strip a single trailing slash (but never the root "/" itself).
  const normalized =
    trimmed.length > 1 && trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  // ONE decision owner, TWO enumerated categories: the five static workflow
  // prefixes and the three public offering families (issue #2101). The exported
  // five-entry registry is unchanged, so the frozen ORCH-1375 assertions keep
  // asserting exactly what they always asserted.
  const authorized = [
    ...NEXT_ROUTE_ALLOWLIST,
    ...PUBLIC_OFFERING_NEXT_ROUTE_PREFIXES,
  ];
  return authorized.some((prefix) => {
    const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return normalized === base || normalized.startsWith(`${base}/`);
  });
};

/**
 * Validate an untrusted `next` param.
 *
 * @returns the sanitized RELATIVE path (safe to hand to `router.replace` /
 *          `<Redirect href>`), or `null` if the value is absent, malformed, or
 *          not an allowlisted resume target. Callers MUST treat `null` as
 *          "go home" — never as "navigate to the raw value".
 *
 * NEVER returns an absolute URL. Never prefixes `window.location.origin`.
 */
export const sanitizeNextRoute = (
  raw: string | string[] | null | undefined,
): string | null => {
  // 1. Type — an array (`?next=a&next=b`) is not a single intent. Reject.
  if (typeof raw !== "string") return null;

  const value = raw.trim();
  if (value.length === 0) return null;
  // 6. Bound the surface.
  if (value.length > MAX_NEXT_LENGTH) return null;

  // 2 + 3. Structure of the RAW value.
  if (!isStructurallyRelative(value)) return null;

  // 4. Decode-then-REVALIDATE. A single decode kills `%2f%2f…`; the allowlist
  // below kills anything deeper (e.g. `/%252f%252fevil.com`, whose decoded form
  // is still structurally "relative" but matches no allowlisted path).
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Malformed percent-encoding — cannot be reasoned about safely. Reject.
    return null;
  }
  if (!isStructurallyRelative(decoded)) return null;

  // 4b. Dot-segment rejection (ORCH-1373 P2-1) — MUST precede the allowlist.
  // The allowlist judges the pre-resolution string; the browser resolves `..`
  // afterwards. Reject traversal on BOTH forms so neither the raw nor the
  // decoded spelling can smuggle a segment past the enumeration below.
  if (hasDotSegment(pathSegmentOf(value))) return null;
  if (hasDotSegment(pathSegmentOf(decoded))) return null;

  // 5. Path allowlist — enforced on BOTH forms so no encoding trick can present
  // one path to the validator and another to the router.
  if (!isAllowlistedPath(pathSegmentOf(value))) return null;
  if (!isAllowlistedPath(pathSegmentOf(decoded))) return null;

  // Return the RAW (validated) value — it preserves the token's own encoding,
  // which the decoded form would corrupt.
  return value;
};
