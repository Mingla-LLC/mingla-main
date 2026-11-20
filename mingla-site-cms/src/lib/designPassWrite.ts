/**
 * #4453 milestone 7 — writes one composer v2 result to the site's DRAFT:
 * new pages, Home when still empty, pages Ari's pass may replace (every block
 * still an unreviewed Draft), and the header (menu in page-set order, the
 * format's header button, the design's header layout). Nothing here publishes.
 * The caller's request carries `minglaReviewSource`, so every block written is
 * stamped Draft (UNREVIEWED_SECTIONS blocks publish until the owner reviews).
 */
import type { PayloadRequest } from "payload";
import type { ComposeV2Page, ComposeV2Result } from "./composeFormat";
import { findAllTenantPages } from "./tenantPages";

type AnyDoc = Record<string, unknown>;

function pageData(page: ComposeV2Page, tenantId: string): AnyDoc {
  return {
    tenant: tenantId,
    slug: page.slug,
    title: page.title,
    kind: page.kind,
    ...(page.collection_kind ? { collection_kind: page.collection_kind } : {}),
    ...(page.planned_offering ? { planned_offering: page.planned_offering } : {}),
    enabled: true,
    revision: 1,
    blocks: page.blocks,
  };
}

type MenuRow = { label?: unknown; target_type?: unknown; page?: unknown; url?: unknown; children?: unknown };
const menuKey = (row: MenuRow | null | undefined): unknown => {
  if (!row || typeof row !== "object") return null;
  const page = row.page && typeof row.page === "object" ? (row.page as AnyDoc).id : row.page;
  return [
    row.label ?? null,
    row.target_type ?? null,
    page === undefined || page === null ? null : String(page),
    row.url ?? null,
    (Array.isArray(row.children) ? row.children : []).map((child) => menuKey(child as MenuRow)),
  ];
};

/**
 * #4453 — true when the header Studio would write is the one already there,
 * row ids aside. Gameland Lagos's live Rebuild (2026-11-19) wrote a new menu
 * version identical but for row ids, so Host showed "1 change: The menu or
 * footer changed" that publishing would not change. Only the fields the write
 * sends are compared (an absent field is left as it is).
 */
export function sameMenu(current: AnyDoc, next: AnyDoc): boolean {
  const rows = (value: unknown) => (Array.isArray(value) ? value : []).map((row) => menuKey(row as MenuRow));
  if ((current.wordmark ?? null) !== (next.wordmark ?? null)) return false;
  if (JSON.stringify(rows(current.items)) !== JSON.stringify(rows(next.items))) return false;
  if ("header_cta" in next && JSON.stringify(menuKey(current.header_cta as MenuRow)) !== JSON.stringify(menuKey(next.header_cta as MenuRow))) return false;
  if ("header_variant" in next && (current.header_variant ?? null) !== (next.header_variant ?? null)) return false;
  return true;
}

/** Whether every block on a stored page is still an unreviewed Draft (Ari's pass may replace it). */
export function pageAllDraft(page: AnyDoc): boolean {
  const blocks = Array.isArray(page.blocks) ? page.blocks as AnyDoc[] : [];
  return blocks.length > 0 && blocks.every((block) => {
    const review = block.review as AnyDoc | null | undefined;
    return review != null && review.state === "draft";
  });
}

export async function writeComposition(
  req: PayloadRequest,
  internal: PayloadRequest,
  tenantId: string,
  result: ComposeV2Result,
): Promise<{ created: string[]; replaced: string[]; idBySlug: Map<string, string> }> {
  const pages = await findAllTenantPages(internal, tenantId, { overrideAccess: true });
  const idBySlug = new Map<string, string>();
  for (const page of pages) if (!page.parent) idBySlug.set(typeof page.slug === "string" ? page.slug : "", String(page.id));
  const created: string[] = [];
  const replaced: string[] = [];
  for (const page of result.create) {
    const doc = await req.payload.create({ collection: "pages", overrideAccess: true, req: internal, draft: true, data: pageData(page, tenantId) as never });
    idBySlug.set(page.slug, String(doc.id));
    created.push(page.key);
  }
  const updates = [
    ...(result.fillHome ? [{ id: idBySlug.get(""), page: result.fillHome, filled: true }] : []),
    ...result.replace.map((entry) => ({ ...entry, filled: false })),
  ];
  for (const { id, page, filled } of updates) {
    const stored = pages.find((candidate) => String(candidate.id) === id);
    if (!id || !stored) continue;
    await req.payload.update({
      collection: "pages",
      id,
      overrideAccess: true,
      req: internal,
      draft: true,
      data: { blocks: page.blocks, title: page.title, revision: stored.revision } as never,
    });
    // An empty Home filled is created; any page whose Drafts were replaced (Home included) is replaced.
    (filled ? created : replaced).push(page.key);
  }

  const navigation = (await req.payload.find({
    collection: "navigation", overrideAccess: true, draft: true, depth: 0, limit: 1, where: { tenant: { equals: tenantId } },
  })).docs[0] as unknown as AnyDoc | undefined;
  const target = (slug: string) => idBySlug.get(slug);
  const planned = new Set([...result.menu.items, ...result.menu.more].map((entry) => target(entry.slug)));
  const items: AnyDoc[] = result.menu.items.filter((entry) => target(entry.slug)).map((entry) => ({ label: entry.label, target_type: "page", page: target(entry.slug) }));
  const more = result.menu.more.filter((entry) => target(entry.slug));
  if (more.length) {
    items.push({ label: "More", target_type: "page", page: target(more[0]!.slug), children: more.map((entry) => ({ label: entry.label, target_type: "page", page: target(entry.slug) })) });
  }
  // Links the owner added to other websites stay; old page links the page set replaces go.
  const homeId = target("");
  for (const row of (Array.isArray(navigation?.items) ? navigation.items : []) as AnyDoc[]) {
    if (row.target_type !== "url") continue;
    const page = row.page && typeof row.page === "object" ? (row.page as AnyDoc).id : row.page;
    if (page !== undefined && page !== null && (String(page) === homeId || planned.has(String(page)))) continue;
    if (items.length >= 8) break;
    const { id: _id, ...rest } = row;
    items.push(rest);
  }
  const ctaPage = result.header_cta ? target(result.header_cta.slug) : undefined;
  const navData: AnyDoc = {
    items,
    wordmark: result.wordmark,
    ...(ctaPage ? { header_cta: { label: result.header_cta!.label, target_type: "page", page: ctaPage } } : {}),
    ...(result.header_variant ? { header_variant: result.header_variant } : {}),
  };
  if (navigation) {
    if (!sameMenu(navigation, navData)) await req.payload.update({ collection: "navigation", id: navigation.id as string, overrideAccess: true, req: internal, draft: true, data: navData as never });
  } else {
    await req.payload.create({ collection: "navigation", overrideAccess: true, req: internal, draft: true, data: { tenant: tenantId, label: "Main navigation", ...navData } as never });
  }
  return { created, replaced, idBySlug };
}
