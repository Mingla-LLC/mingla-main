import type { DiscoverMinglaCard } from "../../types/discoverFeed";

function routeSlug(card: DiscoverMinglaCard): string | null {
  const key = card.kind === "experience"
    ? "experienceSlug"
    : card.kind === "trip"
      ? "tripSlug"
      : card.kind === "stay"
        ? "venueSlug"
        : "eventSlug";
  const value = card.route.params[key] ?? card.route.params.slug;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The Discover feed historically returned retired internal route templates
 * (`/event/[slug]`, `/trip/[slug]`, and siblings). Keep navigation owned by the
 * app's canonical public-route contract so a feed payload cannot send an
 * authenticated Explorer user to Expo Router's not-found screen.
 */
export function canonicalDiscoverCardPath(card: DiscoverMinglaCard): string | null {
  const brandSlug = card.brand.slug.trim();
  const slug = routeSlug(card);
  if (!brandSlug || !slug) return null;

  const brand = encodeURIComponent(brandSlug);
  const offering = encodeURIComponent(slug);
  if (card.kind === "experience") return `/exp/${brand}/${offering}`;
  if (card.kind === "trip") return `/t/${brand}/${offering}`;
  if (card.kind === "stay") return `/b/${brand}/v/${offering}`;
  return `/e/${brand}/${offering}`;
}
