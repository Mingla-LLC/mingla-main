// #4318 — the live cities a Links page strip can target.
//
// Source of truth: mingla-marketing/content/cities/registry.ts (CITY_HUB_SLUGS
// and each record's `slug` + `city`). The marketing site owns the live cities;
// this list only mirrors their slugs and names so the admin form can offer
// them. src/__tests__/issue4318_linksStrips.implementor.test.js fails when a
// slug or name here drifts from that registry.
//
// Pure module: no React, no Supabase.

export const LINKS_CITIES = Object.freeze([
  Object.freeze({ slug: "lagos", name: "Lagos" }),
  Object.freeze({ slug: "durham-nc", name: "Durham" }),
  Object.freeze({ slug: "cary-nc", name: "Cary" }),
  Object.freeze({ slug: "raleigh-nc", name: "Raleigh" }),
  Object.freeze({ slug: "new-york-city", name: "New York City" }),
  Object.freeze({ slug: "brussels", name: "Brussels" }),
  Object.freeze({ slug: "paris", name: "Paris" }),
  Object.freeze({ slug: "london", name: "London" }),
  Object.freeze({ slug: "fort-lauderdale", name: "Fort Lauderdale" }),
  Object.freeze({ slug: "washington-dc", name: "Washington, DC" }),
]);

/** A strip with no city (null) shows in every live city. */
export const EVERY_LIVE_CITY_LABEL = "Every live city";

export function linksCityName(slug) {
  if (slug == null || slug === "") return EVERY_LIVE_CITY_LABEL;
  return LINKS_CITIES.find((city) => city.slug === slug)?.name || slug;
}
