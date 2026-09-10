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

/*
 * #3149 wave 4 — ONE OWNER for splitting a Mingla section name.
 *
 * Mingla's own section names carry their course as a prefix: "FOOD — Rice
 * Bowls", "DRINKS — Cocktails". The menu's filter chips need the part BEFORE
 * the separator so several sections collapse into one course; the footer's
 * menu column needs the part AFTER it, because "FOOD — Rice Bowls" in a
 * footer column reads as a database row rather than as something to eat.
 *
 * Both halves live here rather than beside either caller. The splitting rule
 * is the same rule, and two copies of it would eventually disagree about what
 * a dash is — which would show up as a chip that filters nothing.
 */
const SEPARATOR = /\s+[\u2014\u2013-]\s+/;

/** "FOOD — Rice Bowls" → "FOOD". A name with no separator is its own group. */
export function menuGroupOf(name: string): string {
  return name.split(SEPARATOR)[0]?.trim() || name;
}

/**
 * "FOOD — Rice Bowls" → "Rice Bowls". A name with no separator is returned
 * whole: a section called "Desserts" is already what a reader should see.
 */
export function menuSubNameOf(name: string): string {
  const parts = name.split(SEPARATOR);
  return (parts.length > 1 ? parts.slice(1).join(" — ").trim() : name.trim()) ||
    name;
}
