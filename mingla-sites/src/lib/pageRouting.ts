import type { RestaurantArtifact } from "../contracts/artifact";

export type ArtifactPage = RestaurantArtifact["pages"][number];

/**
 * #2830 — path segments the runtime owns, which a CUSTOMER PAGE MAY NEVER TAKE.
 *
 * The public site is served from the app root, so a page whose slug collided
 * with one of these would be shadowed by the runtime's own route and simply
 * never render — silently, with no error anywhere, because Next resolves the
 * static segment first. `preview` is the dangerous one: a restaurant calling a
 * page "Preview" is entirely plausible, and it would have been swallowed by
 * the private preview route.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "api",
  "media",
  /*
   * #3149 wave 4 — the static map's tile door. A restaurant calling a page
   * "Map" is entirely plausible and it would have been swallowed silently, in
   * exactly the way `preview` would have been.
   */
  "map",
  "preview",
  "robots.txt",
  "sitemap.xml",
  "_next",
];

/** A page slug is safe only if it is lowercase, simple, and takes no reserved segment. */
export function isRoutableSlug(slug: unknown): slug is string {
  return (
    typeof slug === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    slug.length <= 64 &&
    !RESERVED_SLUGS.includes(slug)
  );
}

/** The pages that appear in navigation, in the order the brand set. */
export function navigablePages(artifact: RestaurantArtifact): ArtifactPage[] {
  return artifact.pages
    .filter((page) => page.enabled)
    .filter((page) => page.role === "home" || isRoutableSlug(page.slug))
    .sort((a, b) => a.nav_order - b.nav_order);
}

/** Home lives at "/", every other page at "/<slug>". */
export function hrefForPage(page: ArtifactPage): string {
  return page.role === "home" ? "/" : `/${page.slug}`;
}

/**
 * #3149 wave 4 — WHERE A RETIRED PAGE'S URL GOES.
 *
 * A published page's URL outlives the page. `/contact` has been live and
 * linkable, and a brand that folds its Visit page into a Reservations page
 * should not turn that link into a 404 for everyone who bookmarked it, shared
 * it, or linked to it.
 *
 * This is a map of RUNTIME ROLES, not of one brand's decision: it says which
 * role now carries what another role used to, and it only ever fires when the
 * old role is genuinely ABSENT from the artifact and the new one is present
 * and routable. A site that still has both keeps both — nothing is redirected
 * out from under a live page.
 *
 * Deliberately narrow. There is no fallback to the homepage: sending someone
 * who asked for a specific page to the front door is worse than telling them
 * the page is gone, and it hides the mistake from whoever removed it.
 */
export const RETIRED_ROLE_REPLACEMENTS: Readonly<Record<string, readonly string[]>> = {
  contact: ["reservations"],
};

/**
 * The page a retired slug should send a visitor to, or null to 404 as before.
 */
export function replacementForRetiredSlug(
  artifact: RestaurantArtifact,
  slug: string,
): ArtifactPage | null {
  if (!isRoutableSlug(slug)) return null;
  const live = navigablePages(artifact);
  // Only when nothing on the site actually answers to this slug already.
  if (live.some((page) => page.role !== "home" && page.slug === slug)) return null;
  const replacements = RETIRED_ROLE_REPLACEMENTS[slug];
  if (!replacements) return null;
  if (artifact.pages.some((page) => page.role === slug && page.enabled)) return null;
  for (const role of replacements) {
    const replacement = live.find((page) => page.role === role);
    if (replacement) return replacement;
  }
  return null;
}

/** Resolve an incoming path segment to a page, or null when nothing matches. */
export function pageForSlug(
  artifact: RestaurantArtifact,
  slug: string,
): ArtifactPage | null {
  if (!isRoutableSlug(slug)) return null;
  return (
    navigablePages(artifact).find(
      (page) => page.role !== "home" && page.slug === slug,
    ) ?? null
  );
}

export function homePage(artifact: RestaurantArtifact): ArtifactPage | null {
  return artifact.pages.find((page) => page.role === "home") ?? null;
}
