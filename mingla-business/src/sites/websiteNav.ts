/**
 * #2829 W9r (DESIGN_SPEC §1.2–§1.3) — the Website section's one navigation:
 * which sections exist for this site, what each row shows on the right, and
 * how an address under /brand/<id>/website maps onto a section, an editor or
 * the full-screen preview (old addresses redirect).
 *
 * Pure. The rail (desktop) and the list (phone) both render from this, so the
 * two can never disagree about what exists.
 */

export const WEBSITE_SECTIONS = [
  "overview",
  "pages",
  "design",
  "destinations",
  "stories",
  "reviews",
  "past",
  "publish",
  "addresses",
  "plan",
  "settings",
] as const;
export type WebsiteSection = (typeof WEBSITE_SECTIONS)[number];

export const COLLECTION_SECTIONS = ["destinations", "stories", "reviews"] as const;
export type CollectionSection = (typeof COLLECTION_SECTIONS)[number];

export const SECTION_LABELS: Readonly<Record<WebsiteSection, string>> = {
  overview: "Overview",
  pages: "Pages",
  design: "Design",
  destinations: "Destinations",
  stories: "Stories",
  reviews: "Reviews",
  past: "Past trips",
  publish: "Publish & history",
  addresses: "Addresses",
  plan: "Setup plan",
  settings: "Settings",
};

export type WebsiteNavIcon =
  | "home" | "pages" | "palette" | "pin" | "book" | "quote" | "clock" | "upload" | "globe" | "plan" | "cog";

export const SECTION_ICONS: Readonly<Record<WebsiteSection, WebsiteNavIcon>> = {
  overview: "home",
  pages: "pages",
  design: "palette",
  destinations: "pin",
  stories: "book",
  reviews: "quote",
  past: "clock",
  publish: "upload",
  addresses: "globe",
  plan: "plan",
  settings: "cog",
};

export type WebsiteNavItem = {
  key: WebsiteSection;
  label: string;
  icon: WebsiteNavIcon;
  /** Right-hand meta (a count, the design name, "Offline", "n of 8"). */
  meta: string | null;
  /** An amber dot for needs-attention (labelled "needs attention"). */
  attention: boolean;
};

export type WebsiteNavGroup = { heading: string | null; items: WebsiteNavItem[] };

export type WebsiteNavInput = {
  hasSite: boolean;
  /** The chosen design's name ("Voyage"), shown beside Design. */
  designLabel: string | null;
  /** Does the chosen design have a page for each collection? (Voyage: all; Atelier: none.) */
  designHasCollectionPages: boolean;
  designDirty: boolean;
  /** Pages shown in the menu (null while unknown). */
  pagesInMenu: number | null;
  counts: { destinations: number | null; stories: number | null; reviews: number | null; past: number | null };
  reviewsNeedingConfirmation: number;
  /** Did the brand tick Trips in its plan (or offer trips)? */
  tripsTicked: boolean;
  unpublishedChanges: number;
  domainNeedsAttention: boolean;
  plan: { done: number; total: number } | null;
  offline: boolean;
};

function item(key: WebsiteSection, meta: string | null = null, attention = false): WebsiteNavItem {
  return { key, label: SECTION_LABELS[key], icon: SECTION_ICONS[key], meta, attention };
}

const count = (value: number | null): string | null => (value === null ? null : String(value));

function planMeta(plan: WebsiteNavInput["plan"]): string | null {
  if (!plan) return null;
  return plan.done >= plan.total ? "Done" : `${plan.done} of ${plan.total}`;
}

/**
 * The rail / list for this site (§1.2 rules): before a site exists only
 * Overview and Setup plan; content items only when the design has a page for
 * them or entries already exist; Past trips when the brand ticked Trips; the
 * Setup plan row never disappears.
 */
export function websiteNavGroups(input: WebsiteNavInput): WebsiteNavGroup[] {
  if (!input.hasSite) {
    return [{ heading: null, items: [item("overview"), item("plan", planMeta(input.plan))] }];
  }
  const showCollection = (value: number | null) => input.designHasCollectionPages || (value ?? 0) > 0;
  const content: WebsiteNavItem[] = [];
  if (showCollection(input.counts.destinations)) content.push(item("destinations", count(input.counts.destinations)));
  if (showCollection(input.counts.stories)) content.push(item("stories", count(input.counts.stories)));
  if (showCollection(input.counts.reviews)) {
    content.push(input.reviewsNeedingConfirmation > 0
      ? item("reviews", null, true)
      : item("reviews", count(input.counts.reviews)));
  }
  if (input.tripsTicked) content.push(item("past", count(input.counts.past)));
  const groups: WebsiteNavGroup[] = [
    { heading: null, items: [item("overview")] },
    {
      heading: "Build",
      items: [
        item("pages", count(input.pagesInMenu)),
        input.designDirty ? item("design", null, true) : item("design", input.designLabel),
      ],
    },
  ];
  if (content.length) groups.push({ heading: "Content", items: content });
  groups.push({
    heading: "Go live",
    items: [
      item("publish", input.unpublishedChanges > 0 ? String(input.unpublishedChanges) : null),
      input.domainNeedsAttention ? item("addresses", null, true) : item("addresses"),
      item("plan", planMeta(input.plan)),
    ],
  });
  groups.push({ heading: "Manage", items: [item("settings", input.offline ? "Offline" : null)] });
  return groups;
}

export function sectionInNav(groups: readonly WebsiteNavGroup[], section: WebsiteSection): boolean {
  return groups.some((group) => group.items.some((entry) => entry.key === section));
}

/** The row's accessible name on phone: "<Section>, <meta>". */
export function navRowAccessibilityLabel(entry: WebsiteNavItem): string {
  if (entry.attention) return `${entry.label}, needs attention`;
  return entry.meta ? `${entry.label}, ${entry.meta}` : entry.label;
}

export type WebsiteRoute =
  | { kind: "section"; section: WebsiteSection; planPart?: string | null }
  | { kind: "editor"; section: CollectionSection; entryId: string | "new" }
  | { kind: "preview" }
  | { kind: "redirect"; to: string };

const ENTRY_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * /brand/<id>/website[/<section>[/<entry|new>]] → what to show. Old
 * addresses redirect: look → design, domains → addresses, plan?part=x →
 * plan with that part open. Anything unknown is the Overview.
 */
export function parseWebsitePath(
  brandId: string,
  segments: readonly string[],
  search: { part?: string | null } = {},
): WebsiteRoute {
  const [first, second, ...rest] = segments.filter((segment) => segment.length > 0);
  const base = `/brand/${brandId}/website`;
  if (!first) return { kind: "section", section: "overview" };
  if (first === "look" && !second) return { kind: "redirect", to: `${base}/design` };
  if (first === "domains" && !second) return { kind: "redirect", to: `${base}/addresses` };
  if (first === "preview" && !second) return { kind: "preview" };
  if ((COLLECTION_SECTIONS as readonly string[]).includes(first) && second && rest.length === 0) {
    if (second === "new" || ENTRY_ID.test(second)) {
      return { kind: "editor", section: first as CollectionSection, entryId: second === "new" ? "new" : second };
    }
  }
  if ((WEBSITE_SECTIONS as readonly string[]).includes(first) && !second) {
    return {
      kind: "section",
      section: first as WebsiteSection,
      ...(first === "plan" && search.part ? { planPart: search.part } : {}),
    };
  }
  return { kind: "section", section: "overview" };
}

export function websitePath(brandId: string, route: Exclude<WebsiteRoute, { kind: "redirect" }>): string {
  const base = `/brand/${brandId}/website`;
  if (route.kind === "preview") return `${base}/preview`;
  if (route.kind === "editor") return `${base}/${route.section}/${route.entryId}`;
  if (route.section === "overview") return base;
  return route.planPart ? `${base}/plan?part=${encodeURIComponent(route.planPart)}` : `${base}/${route.section}`;
}

/** Sections that show the draft preview beside them on desktop (§1.5). */
export function sectionShowsPreview(section: WebsiteSection): boolean {
  return section === "overview" || section === "design" || section === "pages" || section === "publish" || section === "plan";
}

/** The preview panel's one-line purpose (§1.5). */
export const PREVIEW_PURPOSE: Readonly<Partial<Record<WebsiteSection, string>>> = {
  design: "Your design, before you save",
  pages: "Your menu and pages",
  publish: "What will go live",
  plan: "Your draft so far",
  overview: "Your draft",
};

/**
 * #2829 W9r — what the pane renders for a route. A section the site doesn't
 * have (no site yet, a design without that page) renders the Overview until
 * the redirect lands: never the section, which would read a site that isn't
 * there (it crashed on a brand without a website).
 */
export function routeToRender(
  route: Exclude<WebsiteRoute, { kind: "redirect" }>,
  sectionMissing: boolean,
): Exclude<WebsiteRoute, { kind: "redirect" }> {
  if (route.kind === "preview" || !sectionMissing) return route;
  return { kind: "section", section: "overview" };
}
