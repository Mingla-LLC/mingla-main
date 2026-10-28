import type {
  LegacyArtifactPage,
  NavLink,
  RestaurantBlock,
  TreeArtifactPage,
  TreeNavigation,
} from "../contracts/artifact";
import { isV2Artifact, type SiteArtifact } from "./siteArtifact";
import { collectionEntryForPath, type CollectionEntry } from "./siteCollections";
import {
  hrefForPath,
  isReservedSegment,
  matchRedirect,
  RESERVED_FIRST_SEGMENTS,
  type CollectionKind,
  type PageKind,
  type RedirectRule,
  type RedirectStatus,
} from "../contracts/generated/routes.ts";

/*
 * #2829 AD-5 — ONE ROUTER FOR BOTH ARTIFACT FORMS.
 *
 * Page-tree artifacts (W2 onward) carry each page's full address. Earlier
 * artifacts carry six fixed roles; they are adapted here into the same shape
 * (home → "", every other role → its slug) so the catch-all route, the
 * navigation, the sitemap and the renderer read one model, and rollback to
 * any earlier publication keeps working through the same entry.
 */
export type ArtifactPage = {
  /** "home" for the home page; otherwise the legacy role, or the tree path. */
  key: string;
  /** The fixed role, on pages of earlier (six-role) artifacts only. */
  role?: LegacyArtifactPage["role"];
  /** The address without a leading slash; "" is the home page. */
  path: string;
  isHome: boolean;
  title: string;
  /** The label this page carried in the legacy menu (tree: its title). */
  navLabel: string;
  navOrder: number;
  enabled: boolean;
  kind: PageKind;
  collection?: CollectionKind;
  blocks: RestaurantBlock[];
  seo?: { title?: string; description?: string; noindex?: true };
};

export type SiteNavItem = NavLink & { children?: NavLink[] };

/**
 * #2830 — path segments the runtime owns, which a CUSTOMER PAGE MAY NEVER TAKE.
 *
 * The public site is served from the app root, so a page whose slug collided
 * with one of these would be shadowed by the runtime's own route and simply
 * never render. `preview` is the dangerous one: a restaurant calling a page
 * "Preview" is entirely plausible. #2829 — the list now lives in the shared
 * route contract (adds fonts, om, book, .well-known for later waves).
 */
export const RESERVED_SLUGS: readonly string[] = RESERVED_FIRST_SEGMENTS;

/** A legacy page slug is safe only if it is lowercase, simple, and takes no reserved segment. */
export function isRoutableSlug(slug: unknown): slug is string {
  return (
    typeof slug === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    slug.length <= 64 &&
    !isReservedSegment(slug)
  );
}

function fromLegacy(page: LegacyArtifactPage): ArtifactPage | null {
  const isHome = page.role === "home";
  if (!isHome && !isRoutableSlug(page.slug)) return null;
  return {
    key: page.role,
    role: page.role,
    path: isHome ? "" : page.slug,
    isHome,
    title: page.title,
    navLabel: page.nav_label,
    navOrder: page.nav_order,
    enabled: page.enabled,
    kind: "standard",
    blocks: page.blocks,
    ...(page.seo ? { seo: page.seo } : {}),
  };
}

function fromTree(page: TreeArtifactPage, index: number): ArtifactPage {
  return {
    key: page.path === "" ? "home" : page.path,
    path: page.path,
    isHome: page.path === "",
    title: page.title,
    navLabel: page.title,
    navOrder: index,
    enabled: page.enabled,
    kind: page.kind,
    ...(page.collection ? { collection: page.collection } : {}),
    blocks: page.blocks,
    ...(page.seo ? { seo: page.seo } : {}),
  };
}

const ROUTED = new WeakMap<SiteArtifact, ArtifactPage[]>();

/** True for artifacts whose pages carry full addresses (W2 tree form, and every v2 artifact). */
export function isTreeForm(artifact: SiteArtifact): boolean {
  return isV2Artifact(artifact) || artifact.site_routes !== undefined;
}

/** The site's own redirect rules (tree and v2 artifacts; none for the six-role form). */
export function siteRedirectRules(artifact: SiteArtifact): RedirectRule[] {
  return isV2Artifact(artifact) ? artifact.redirects : artifact.site_routes?.redirects ?? [];
}

/** Every page of the artifact in the one model (legacy pages with an unroutable slug are left out). */
export function sitePages(artifact: SiteArtifact): ArtifactPage[] {
  const cached = ROUTED.get(artifact);
  if (cached) return cached;
  const pages = isTreeForm(artifact)
    ? (artifact.pages as unknown as TreeArtifactPage[]).map(fromTree)
    : (artifact.pages as LegacyArtifactPage[])
      .map(fromLegacy)
      .filter((page): page is ArtifactPage => page !== null);
  ROUTED.set(artifact, pages);
  return pages;
}

/**
 * The routed page for a page object: already routed, or a raw artifact page
 * (either form) — callers and tests may hand the renderer either.
 */
export function routedPage(
  page: ArtifactPage | LegacyArtifactPage | TreeArtifactPage,
): ArtifactPage | null {
  if ("isHome" in page) return page;
  if ("path" in page) return fromTree(page, 0);
  return fromLegacy(page);
}

/** The pages that are published, in menu order (legacy) or address order (tree). */
export function navigablePages(artifact: SiteArtifact): ArtifactPage[] {
  return sitePages(artifact)
    .filter((page) => page.enabled)
    .sort((a, b) => a.navOrder - b.navOrder);
}

/** Home lives at "/", every other page at "/<path>". */
export function hrefForPage(
  page: { path: string } | { role?: string; slug: string },
): string {
  if ("path" in page) return hrefForPath(page.path);
  return page.role === "home" ? "/" : `/${page.slug}`;
}

export function homePage(artifact: SiteArtifact): ArtifactPage | null {
  return sitePages(artifact).find((page) => page.isHome) ?? null;
}

/**
 * The header menu. Tree artifacts carry it explicitly (up to eight items with
 * dropdown children); legacy artifacts showed every published page in menu
 * order, labelled with its menu label, and still do.
 */
export function siteNavigation(artifact: SiteArtifact): SiteNavItem[] {
  if (isTreeForm(artifact)) return (artifact.navigation as TreeNavigation).items;
  return navigablePages(artifact).map((page) => ({
    label: String(page.navLabel ?? ""),
    href: hrefForPage(page),
  }));
}

/** The owner's header button (tree artifacts only). */
export function headerCta(artifact: SiteArtifact): NavLink | null {
  return isTreeForm(artifact) ? (artifact.navigation as TreeNavigation).header_cta ?? null : null;
}

/** The owner's text wordmark for when there is no logo (tree artifacts only). */
export function headerWordmark(artifact: SiteArtifact): string | null {
  return isTreeForm(artifact) ? (artifact.navigation as TreeNavigation).wordmark ?? null : null;
}

/**
 * #3149 wave 4 — WHERE A RETIRED PAGE'S URL GOES (legacy artifacts).
 *
 * A published page's URL outlives the page. This is a map of RUNTIME ROLES,
 * not of one brand's decision, and it only fires when the old role is
 * genuinely ABSENT from the artifact and the new one is present and routable.
 * There is no fallback to the homepage. Tree artifacts express the same thing
 * with the owner's own redirect rules instead.
 */
export const RETIRED_ROLE_REPLACEMENTS: Readonly<Record<string, readonly string[]>> = {
  contact: ["reservations"],
};

/** The page a retired slug should send a visitor to, or null to 404 as before. */
export function replacementForRetiredSlug(
  artifact: SiteArtifact,
  slug: string,
): ArtifactPage | null {
  if (isTreeForm(artifact) || !isRoutableSlug(slug)) return null;
  const live = navigablePages(artifact);
  if (live.some((page) => !page.isHome && page.path === slug)) return null;
  const replacements = RETIRED_ROLE_REPLACEMENTS[slug];
  if (!replacements) return null;
  if (sitePages(artifact).some((page) => page.key === slug && page.enabled)) return null;
  for (const role of replacements) {
    const replacement = live.find((page) => page.key === role);
    if (replacement) return replacement;
  }
  return null;
}

/** A published page at exactly this address, or null. */
export function pageForPath(artifact: SiteArtifact, path: string): ArtifactPage | null {
  return navigablePages(artifact).find((page) => page.path === path) ?? null;
}

/** Legacy name kept for callers that resolve one segment. */
export function pageForSlug(artifact: SiteArtifact, slug: string): ArtifactPage | null {
  if (!isRoutableSlug(slug)) return null;
  return pageForPath(artifact, slug);
}

export type SiteResolution =
  | { kind: "redirect"; location: string; status: RedirectStatus }
  | { kind: "page"; page: ArtifactPage }
  /* #2829 W5 — a destination or story detail page (the page is a frame for the site chrome). */
  | { kind: "entry"; page: ArtifactPage; entry: CollectionEntry }
  | { kind: "not_found" };

/** #2829 W5 — the frame a destination or story detail renders in (no blocks of its own). */
function entryFrame(entry: CollectionEntry): ArtifactPage {
  return {
    key: `${entry.collection}:${entry.entry.slug}`,
    path: entry.path,
    isHome: false,
    title: entry.entry.title,
    navLabel: entry.entry.title,
    navOrder: Number.MAX_SAFE_INTEGER,
    enabled: true,
    kind: "standard",
    blocks: [],
    ...(entry.entry.seo ? { seo: entry.entry.seo } : {}),
  };
}

/**
 * #2829 AD-5 — resolve one request path, in the fixed order:
 *   1. the site's redirect table (tree artifacts);
 *   2. a published page at the full path;
 *   3. a collection detail page under its base path;
 *   4. a root-level story (when stories live at the site root);
 *   5. the legacy retired-role replacement (legacy artifacts);
 *   6. not found.
 * Steps 3 and 4 (#2829 W5) read the v2 artifact's destinations and stories;
 * a page always wins (and publish refuses two things at one address).
 */
export function resolveSitePath(artifact: SiteArtifact, path: string): SiteResolution {
  const redirects = siteRedirectRules(artifact);
  if (redirects.length && path !== "") {
    const redirect = matchRedirect(redirects, `/${path}`);
    if (redirect) return { kind: "redirect", ...redirect };
  }
  const page = pageForPath(artifact, path);
  if (page) return { kind: "page", page };
  if (isV2Artifact(artifact)) {
    const entry = collectionEntryForPath(artifact, path);
    if (entry) return { kind: "entry", page: entryFrame(entry), entry };
  }
  if (!isTreeForm(artifact) && !path.includes("/")) {
    const replacement = replacementForRetiredSlug(artifact, path);
    if (replacement) return { kind: "redirect", location: hrefForPage(replacement), status: 308 };
  }
  return { kind: "not_found" };
}

/** Whether a page may be listed for search engines. */
export function isIndexable(page: ArtifactPage): boolean {
  return page.enabled && page.seo?.noindex !== true;
}
