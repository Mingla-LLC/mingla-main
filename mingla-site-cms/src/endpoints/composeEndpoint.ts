import type { Endpoint, PayloadRequest } from "payload";
import { composeFromPlan, type ComposeBrand, type ComposePlan, type ComposedPage } from "../lib/composeFromPlan";
import { findAllTenantPages } from "../lib/tenantPages";
import { sitesJsonResponse } from "../lib/http";
import { observeCmsEndpoint } from "../lib/observability";
import { verifyCoreRequest } from "../lib/gateway";
import { PLAN_OFFERING_KEYS } from "../contracts/generated/sitePlan.ts";
import { scopedRequest } from "./contentEndpoint";
import { importBrandCover } from "../lib/brandCoverImport";
import { storageCoverRenditionDeps } from "../lib/artifactBuilder";

/*
 * #2829 W9a — "Create website draft": Core's signed call (brand-site-control
 * POST /v1/brands/<id>/site/compose-from-plan, rank 50, approved plan) asks
 * Studio to build the draft pages from the plan. Studio writes ONLY:
 * pages that do not exist yet at their address, Home if it is still empty
 * from setup, and the header menu in M1 order (keeping any other menu items
 * the owner added). It answers with every page the plan asked for that now
 * exists — Core ticks "Build your pages" from that answer, never before.
 * Drafts only: nothing here publishes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type AnyDoc = Record<string, unknown>;

function failure(code: string, status: number): Response {
  return sitesJsonResponse({ ok: false, error: { code } }, status);
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** The signed body, checked key by key (anything unexpected is refused). */
export function parseComposeBody(
  body: unknown,
  envelopeSiteId: string,
): { siteId: string; brandId: string; plan: ComposePlan; brand: ComposeBrand; coverPhotoPath: string | null; userId: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as AnyDoc;
  const allowed = new Set(["kind", "site_id", "brand_id", "user_id", "plan", "brand"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (value.kind !== "compose_from_plan" || value.site_id !== envelopeSiteId) return null;
  if (typeof value.brand_id !== "string" || !UUID.test(value.brand_id)) return null;
  if (typeof value.user_id !== "string" || !UUID.test(value.user_id)) return null;
  const plan = value.plan as AnyDoc | undefined;
  const brand = value.brand as AnyDoc | undefined;
  if (!plan || typeof plan !== "object" || !brand || typeof brand !== "object") return null;
  const offerings = Array.isArray(plan.offerings_selected)
    ? plan.offerings_selected.filter((key): key is string => typeof key === "string" && (PLAN_OFFERING_KEYS as readonly string[]).includes(key))
    : null;
  if (offerings === null) return null;
  const story = plan.story && typeof plan.story === "object" && !Array.isArray(plan.story)
    ? {
      who: text((plan.story as AnyDoc).who, 300) ?? undefined,
      why: text((plan.story as AnyDoc).why, 300) ?? undefined,
      main_action: text((plan.story as AnyDoc).main_action, 300) ?? undefined,
    }
    : null;
  const name = text(brand.name, 120);
  if (!name) return null;
  // #2829 W11 (A17) — only a path in Mingla's public brand-cover storage.
  const coverPhotoPath = brand.cover_photo_path === undefined ? null : brand.cover_photo_path;
  if (coverPhotoPath !== null && !isBrandCoverPath(coverPhotoPath)) return null;
  return {
    siteId: envelopeSiteId,
    brandId: value.brand_id,
    plan: { offerings_selected: offerings, venue_descriptor: text(plan.venue_descriptor, 60), story },
    brand: {
      name,
      tagline: text(brand.tagline, 300),
      bio: typeof brand.bio === "string" && brand.bio.trim() ? brand.bio.slice(0, 5000) : null,
      contact_email: text(brand.contact_email, 254),
      city: text(brand.city, 120),
    },
    coverPhotoPath: coverPhotoPath as string | null,
    userId: value.user_id,
  };
}

export function isBrandCoverPath(value: unknown): value is string {
  return typeof value === "string" &&
    /^brand_covers\/[A-Za-z0-9._/-]{1,400}$/.test(value) &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..");
}

function pageData(page: ComposedPage, tenantId: string): AnyDoc {
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

async function composeDraft(req: PayloadRequest): Promise<Response> {
  let raw = "";
  try {
    raw = (await req.text?.()) || "";
    const envelope = await verifyCoreRequest(req, raw, "/api/internal/compose-from-plan");
    const parsed = parseComposeBody(JSON.parse(raw), envelope.site_id);
    if (!parsed) return failure("VALIDATION_FAILED", 400);
    const tenant = (await req.payload.find({
      collection: "tenants",
      overrideAccess: true,
      depth: 0,
      limit: 1,
      where: { core_site_id: { equals: envelope.site_id } },
    })).docs[0];
    if (!tenant || tenant.core_brand_id !== parsed.brandId) return failure("FORBIDDEN", 403);
    const tenantId = String(tenant.id);
    // Server-side work under Core's signed authority, bound to THIS tenant
    // (the same shape as Core's provisioning call).
    const internal = {
      ...req,
      payloadAPI: "local",
      context: { ...req.context, minglaSignedCore: true, minglaInternalTenantId: tenantId },
    } as PayloadRequest;

    const pages = await findAllTenantPages(internal, tenant.id, { overrideAccess: true });
    const testimonials = await req.payload.count({
      collection: "testimonials",
      overrideAccess: true,
      where: { and: [
        { tenant: { equals: tenant.id } },
        { confirmed_real: { equals: true } },
        { enabled: { not_equals: false } },
      ] },
    });
    const navigation = (await req.payload.find({
      collection: "navigation",
      overrideAccess: true,
      draft: true,
      depth: 0,
      limit: 1,
      where: { tenant: { equals: tenant.id } },
    })).docs[0] as unknown as AnyDoc | undefined;

    const compose = (coverMediaId: string | null) => composeFromPlan({
      plan: parsed.plan,
      brand: parsed.brand,
      hasConfirmedTestimonials: testimonials.totalDocs > 0,
      existing: pages.map((page) => ({
        id: String(page.id),
        slug: typeof page.slug === "string" ? page.slug : "",
        topLevel: !page.parent,
        blockCount: Array.isArray(page.blocks) ? page.blocks.length : 0,
      })),
      currentWordmark: typeof navigation?.wordmark === "string" ? navigation.wordmark : null,
      coverMediaId,
    });
    let result = compose(null);
    // #2829 W11 (A17) — Home opens with the brand's cover photo when Studio is
    // about to write Home and the brand has one: imported once through the
    // site media pipeline (stored, re-encoded, metadata stripped). A cover
    // that can't be read or is refused leaves the colour panel; never a
    // failed draft.
    const writesHome = Boolean(result.fillHome) || result.create.some((page) => page.key === "home");
    if (parsed.coverPhotoPath && writesHome) {
      // Core authorized this compose for a brand admin or owner (rank 50).
      const scoped = scopedRequest(req, {
        action: "compose_from_plan",
        userId: parsed.userId,
        siteId: envelope.site_id,
        brandId: parsed.brandId,
        rank: 50,
        args: {},
      }, tenantId);
      const coverMediaId = await importBrandCover(scoped, parsed.coverPhotoPath, storageCoverRenditionDeps());
      if (coverMediaId) result = compose(coverMediaId);
    }

    const idBySlug = new Map<string, string>();
    for (const page of pages) if (!page.parent) idBySlug.set(typeof page.slug === "string" ? page.slug : "", String(page.id));
    const created: string[] = [];
    for (const page of result.create) {
      const doc = await req.payload.create({
        collection: "pages",
        overrideAccess: true,
        req: internal,
        draft: true,
        data: pageData(page, tenantId) as never,
      });
      idBySlug.set(page.slug, String(doc.id));
      created.push(page.key);
    }
    if (result.fillHome) {
      const home = pages.find((page) => !page.parent && (page.slug ?? "") === "");
      if (home) {
        await req.payload.update({
          collection: "pages",
          id: home.id,
          overrideAccess: true,
          req: internal,
          draft: true,
          data: { blocks: result.fillHome.blocks, revision: home.revision } as never,
        });
        created.push("home");
      }
    }

    // The menu in M1 order (Home is the logo), then any other item the owner
    // already had, up to the menu's limit.
    const target = (slug: string) => idBySlug.get(slug);
    const planned = new Set([...result.menu.items, ...result.menu.more].map((entry) => target(entry.slug)));
    const items: AnyDoc[] = result.menu.items
      .filter((entry) => target(entry.slug))
      .map((entry) => ({ label: entry.label, target_type: "page", page: target(entry.slug) }));
    const more = result.menu.more.filter((entry) => target(entry.slug));
    if (more.length) {
      items.push({
        label: "More",
        target_type: "page",
        page: target(more[0]!.slug),
        children: more.map((entry) => ({ label: entry.label, target_type: "page", page: target(entry.slug) })),
      });
    }
    const homeId = target("");
    for (const row of (Array.isArray(navigation?.items) ? navigation.items : []) as AnyDoc[]) {
      const page = row.page && typeof row.page === "object" ? (row.page as AnyDoc).id : row.page;
      const pageId = page === undefined || page === null ? null : String(page);
      if (row.target_type !== "url" && (pageId === homeId || planned.has(pageId ?? undefined))) continue;
      if (items.length >= 8) break;
      const { id: _id, ...rest } = row;
      items.push(rest);
    }
    const navData = { items, wordmark: result.wordmark };
    if (navigation) {
      await req.payload.update({
        collection: "navigation",
        id: navigation.id as string,
        overrideAccess: true,
        req: internal,
        draft: true,
        data: navData as never,
      });
    } else {
      await req.payload.create({
        collection: "navigation",
        overrideAccess: true,
        req: internal,
        draft: true,
        data: { tenant: tenantId, label: "Main navigation", ...navData } as never,
      });
    }

    return sitesJsonResponse({
      ok: true,
      data: {
        site_id: envelope.site_id,
        // Only pages that now exist at their address (what Core may tick).
        pages: result.pages.filter((key) => idBySlug.has(slugOf(key))),
        created,
        draft_only: true,
      },
    }, 200);
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "SERVICE_TEMPORARILY_UNAVAILABLE";
    return failure(code, code === "SERVICE_TEMPORARILY_UNAVAILABLE" ? 503 : code === "FORBIDDEN" ? 403 : 409);
  }
}

function slugOf(key: string): string {
  return key === "home" ? "" : key;
}

export const composeEndpoints: Endpoint[] = [
  {
    path: "/internal/compose-from-plan",
    method: "post",
    handler: observeCmsEndpoint("/internal/compose-from-plan", "core_to_cms", composeDraft),
  },
];
