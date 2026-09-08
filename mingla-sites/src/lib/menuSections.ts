/*
 * #2830 — stable anchors for menu sections.
 *
 * gögi's own site links straight at a course from the homepage:
 * /menu#rice-bowls, /menu#flat-burgers, /menu#shawarmas, /menu#cocktails. A
 * link like that has to keep working, so the slug is derived from the section
 * name by one rule in one place rather than being typed twice.
 *
 * When the menu is orderable the sections are a filter rather than headings, so
 * the same slug preselects the filter instead of scrolling. Either way the URL
 * means "show me this part of the menu".
 */
export function menuSectionSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    // Strip accents so "Entrées" and "Entrees" cannot produce two anchors.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The section whose slug matches a URL fragment, or null. */
export function sectionForHash(
  hash: string,
  sections: readonly string[],
): string | null {
  const wanted = hash.replace(/^#/, "").toLowerCase();
  if (wanted === "") return null;
  return sections.find((section) => menuSectionSlug(section) === wanted) ?? null;
}
