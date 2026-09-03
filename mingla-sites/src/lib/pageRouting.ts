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
