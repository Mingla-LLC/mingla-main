import {
  MAX_PAGE_DEPTH,
  MAX_PAGES_PER_SITE,
} from "../contracts/generated/limits.ts";
import {
  findPathCollisions,
  isCollectionKind,
  isRedirectRules,
  isReservedSegment,
  isSlug,
  resolveSiteRoutes,
  type RedirectRule,
  type SiteRoutes,
} from "../contracts/generated/routes.ts";

/*
 * #2829 AD-5 — the page tree, as one pure function shared by the Pages hook
 * (refuse a bad edit) and the publication builder (compute every address).
 *
 * A page is `{ id, slug, parent }`. The home page is the one page with an
 * empty slug and no parent; every other page has a slug and an optional
 * parent, and its address is its ancestors' slugs then its own, joined by "/".
 * Home cannot be a parent (its children would be top-level pages anyway).
 */
export type TreePage = {
  id: string;
  slug: string | null;
  parent: string | null;
  kind?: unknown;
  collection?: unknown;
};

export type TreeProblem =
  | "PAGE_LIMIT_EXCEEDED"
  | "HOME_MISSING"
  | "HOME_DUPLICATE"
  | "HOME_HAS_PARENT"
  | "SLUG_INVALID"
  | "SLUG_RESERVED"
  | "PARENT_MISSING"
  | "PARENT_IS_HOME"
  | "PARENT_CYCLE"
  | "DEPTH_EXCEEDED"
  | "SLUG_DUPLICATE"
  | "COLLECTION_INVALID";

export function relationId(value: unknown): string | null {
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    return id == null || id === "" ? null : String(id);
  }
  return value == null || value === "" ? null : String(value);
}

export function treePageOf(doc: {
  id: unknown;
  slug?: unknown;
  parent?: unknown;
  kind?: unknown;
  collection_kind?: unknown;
}): TreePage {
  const slug = typeof doc.slug === "string" && doc.slug !== "" ? doc.slug : null;
  return {
    id: String(doc.id),
    slug,
    parent: relationId(doc.parent),
    kind: doc.kind,
    collection: doc.collection_kind,
  };
}

/**
 * Every page's address, or the first problem found. `requireHome` is false
 * only while Studio edits a tenant that has not been given its home yet.
 */
export function pageTreePaths(
  pages: readonly TreePage[],
  options: { requireHome?: boolean } = {},
): { ok: true; paths: Map<string, string> } | { ok: false; problem: TreeProblem; pageId?: string } {
  if (pages.length > MAX_PAGES_PER_SITE) return { ok: false, problem: "PAGE_LIMIT_EXCEEDED" };
  const byId = new Map(pages.map((page) => [page.id, page]));
  const homes = pages.filter((page) => page.slug === null);
  if (homes.length > 1) return { ok: false, problem: "HOME_DUPLICATE", pageId: homes[1]!.id };
  if (homes.length === 0 && options.requireHome !== false) return { ok: false, problem: "HOME_MISSING" };
  const home = homes[0];
  if (home && home.parent !== null) return { ok: false, problem: "HOME_HAS_PARENT", pageId: home.id };
  for (const page of pages) {
    if (page === home) continue;
    if (!isSlug(page.slug)) return { ok: false, problem: "SLUG_INVALID", pageId: page.id };
    if (page.parent === null && isReservedSegment(page.slug!)) {
      return { ok: false, problem: "SLUG_RESERVED", pageId: page.id };
    }
    if (page.parent !== null) {
      if (!byId.has(page.parent)) return { ok: false, problem: "PARENT_MISSING", pageId: page.id };
      if (home && page.parent === home.id) return { ok: false, problem: "PARENT_IS_HOME", pageId: page.id };
    }
    if (page.kind === "collection_index" && !isCollectionKind(page.collection)) {
      return { ok: false, problem: "COLLECTION_INVALID", pageId: page.id };
    }
  }
  const paths = new Map<string, string>();
  if (home) paths.set(home.id, "");
  for (const page of pages) {
    if (page === home) continue;
    const segments: string[] = [];
    const seen = new Set<string>();
    let cursor: TreePage | undefined = page;
    while (cursor) {
      if (seen.has(cursor.id)) return { ok: false, problem: "PARENT_CYCLE", pageId: page.id };
      seen.add(cursor.id);
      segments.unshift(cursor.slug!);
      if (segments.length > MAX_PAGE_DEPTH) {
        return { ok: false, problem: "DEPTH_EXCEEDED", pageId: page.id };
      }
      cursor = cursor.parent === null ? undefined : byId.get(cursor.parent);
    }
    paths.set(page.id, segments.join("/"));
  }
  const taken = new Map<string, string>();
  for (const [id, path] of paths) {
    if (taken.has(path)) return { ok: false, problem: "SLUG_DUPLICATE", pageId: id };
    taken.set(path, id);
  }
  return { ok: true, paths };
}

/** The home page: the one page with no slug. */
export function isHomePage(page: { slug?: unknown }): boolean {
  return page.slug == null || page.slug === "";
}

/** Every page's address by id; a broken tree refuses (VALIDATION_FAILED, or PATH_COLLISION for two pages at one address). */
export function tenantPagePaths(
  docs: ReadonlyArray<{ id: unknown; slug?: unknown; parent?: unknown; kind?: unknown; collection_kind?: unknown }>,
): Map<string, string> {
  const tree = pageTreePaths(docs.map(treePageOf));
  if (!tree.ok) {
    throw new Error(tree.problem === "SLUG_DUPLICATE" ? "PATH_COLLISION" : "VALIDATION_FAILED");
  }
  return tree.paths;
}

/** The site's collection base paths and redirects, as the shared contract reads them. */
export function siteRouting(settings: object | null | undefined): {
  routes: SiteRoutes;
  redirects: RedirectRule[];
} {
  const record = (settings ?? {}) as { routes?: unknown; redirects?: unknown };
  // An emptied field means "use the default", except for stories, where an
  // empty base path deliberately puts stories at the site root.
  const raw = { ...((record.routes as Record<string, unknown> | null | undefined) ?? {}) };
  for (const [kind, value] of Object.entries(raw)) {
    if (value === "" && kind !== "stories") raw[kind] = null;
  }
  const routes = resolveSiteRoutes(raw);
  if (!routes) throw new Error("VALIDATION_FAILED");
  const redirects = ((record.redirects as Array<Record<string, unknown>> | null | undefined) ?? [])
    .map((row) => ({
      from: String(row.from ?? ""),
      to: String(row.to ?? ""),
      status: Number(row.status) as RedirectRule["status"],
    }));
  if (!isRedirectRules(redirects)) throw new Error("VALIDATION_FAILED");
  return { routes, redirects };
}

/**
 * #2829 AD-5 — refuse (PATH_COLLISION) when two things would answer the same
 * address: two pages, two collection base paths, or a redirect away from a
 * page that is live. `livePageIds` narrows the redirect check to the pages
 * that will actually be published.
 */
export function assertNoPathCollision(
  docs: ReadonlyArray<{ id: unknown; slug?: unknown; parent?: unknown; kind?: unknown; collection_kind?: unknown; enabled?: unknown }>,
  settings: object | null | undefined,
  livePageIds?: ReadonlySet<string>,
): void {
  const paths = tenantPagePaths(docs);
  const { routes, redirects } = siteRouting(settings);
  const live = docs.filter((doc) =>
    livePageIds ? livePageIds.has(String(doc.id)) : doc.enabled !== false || isHomePage(doc)
  );
  const collisions = findPathCollisions({
    pages: live.map((doc) => ({ path: paths.get(String(doc.id)) ?? "" })),
    routes,
    redirects,
  });
  if (collisions.length) throw new Error("PATH_COLLISION");
}

/** What Ari is told about pages: the address first, and the old role name where one still applies. */
const LEGACY_ROLE_SLUGS = new Set(["about", "menu", "gallery", "contact", "reservations"]);

export function ariPageAddress(page: { id?: unknown; slug?: unknown; parent?: unknown }): {
  page_path: string | null;
  page_role: string | null;
} {
  if (isHomePage(page)) return { page_path: "", page_role: "home" };
  const topLevel = relationId(page.parent) === null;
  const slug = String(page.slug);
  return {
    page_path: topLevel ? slug : null,
    page_role: topLevel && LEGACY_ROLE_SLUGS.has(slug) ? slug : null,
  };
}

type PageSummarySource = {
  id: unknown;
  slug?: unknown;
  parent?: unknown;
  kind?: unknown;
  collection_kind?: unknown;
  title?: unknown;
  enabled?: unknown;
  revision?: unknown;
  updatedAt?: unknown;
};

export function ariPageSummaries(
  docs: ReadonlyArray<PageSummarySource>,
): Array<Record<string, unknown>> {
  const paths = tenantPagePaths(docs);
  return docs.map((page) => {
    const path = paths.get(String(page.id)) ?? null;
    return {
      id: page.id,
      path,
      role: ariPageAddress(page).page_role,
      slug: page.slug ?? "",
      kind: page.kind ?? "standard",
      title: page.title,
      enabled: page.enabled,
      revision: page.revision,
      updatedAt: page.updatedAt,
    };
  });
}
