import type { Endpoint, PayloadRequest } from "payload";
import { composeFromPlan, type ComposeBrand, type ComposePlan, type ComposedPage } from "../lib/composeFromPlan";
import { findAllTenantPages } from "../lib/tenantPages";
import { sitesJsonResponse } from "../lib/http";
import { observeCmsEndpoint } from "../lib/observability";
import { verifyCoreRequest } from "../lib/gateway";
import { PLAN_OFFERING_KEYS } from "../contracts/generated/sitePlan.ts";
import { scopedRequest } from "./contentEndpoint";
import { importBrandCover } from "../lib/brandCoverImport";
import { defaultBrandLibraryDeps, importBrandLibrary, libraryHeroPicture, parseLibrarySources, type LibrarySource } from "../lib/brandLibrary";
import { defaultHeroPictureDeps, heroPictureFromOfferings } from "../lib/heroPictureImport";
import { storageCoverRenditionDeps } from "../lib/artifactBuilder";
import { materializeSetupContent, parseStagedRows, type StagedSetupRow } from "../lib/setupContent";
import { composeFormatSite, plannedKeysOf } from "../lib/composeFormat";
import { inventoryAndSources, loadStudioRecords, parseSignedDesignPass, type SignedDesignPass } from "../lib/designPassInputs";
import { pageAllDraft, sameMenu, writeComposition } from "../lib/designPassWrite";
import { isDesignKey, type DesignKey } from "../contracts/generated/designs.ts";
import { emitCmsObservation } from "../lib/observability";

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
): { siteId: string; brandId: string; plan: ComposePlan; brand: ComposeBrand; coverPhotoPath: string | null; userId: string; reviewDrafts: boolean; setupContent: StagedSetupRow[]; designPass: SignedDesignPass | null; bookingBlocks: boolean } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as AnyDoc;
  // #4453 — `review_drafts` (SITES_PROOF_PART on: composed sections start Draft)
  // and `setup_content` (the owner's staged Website-setup entries).
  // #4453 milestone 7 — `design_pass` (SITES_ARI_DESIGN_PASS on for this brand: composer v2).
  // #4453 — `booking_blocks` (SITES_BOOKING_BLOCKS, signed in by Core; absent = off).
  const allowed = new Set(["kind", "site_id", "brand_id", "user_id", "plan", "brand", "review_drafts", "setup_content", "design_pass", "booking_blocks"]);
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
  if (value.review_drafts !== undefined && typeof value.review_drafts !== "boolean") return null;
  if (value.booking_blocks !== undefined && typeof value.booking_blocks !== "boolean") return null;
  const designPass = value.design_pass === undefined ? null : parseSignedDesignPass(value.design_pass);
  if (value.design_pass !== undefined && !designPass) return null;
  let setupContent: StagedSetupRow[];
  try {
    setupContent = parseStagedRows(value.setup_content);
  } catch {
    return null;
  }
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
  // #4572 item 3 — the brand's logo, cover still and flyers (one bad entry refuses the envelope).
  const librarySources = parseLibrarySources(brand.library_sources);
  if (librarySources === null) return null;
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
    librarySources,
    userId: value.user_id,
    reviewDrafts: value.review_drafts === true || designPass !== null,
    setupContent,
    designPass,
    bookingBlocks: value.booking_blocks === true,
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
      context: {
        ...req.context,
        minglaSignedCore: true,
        minglaInternalTenantId: tenantId,
        // #4453 — composed sections are Draft until the owner reviews them.
        ...(parsed.reviewDrafts ? { minglaReviewSource: "composer" } : {}),
        // #4453 — Core signed SITES_BOOKING_BLOCKS in as on: the composed
        // booking blocks may be added (the Pages booking-blocks gate).
        ...(parsed.bookingBlocks ? { minglaBookingBlocks: true } : {}),
      },
    } as PayloadRequest;

    // #4453 — the owner's setup entries exist in Studio before composing
    // (each once: a rerun finds it by its setup_ref).
    const materialized = await materializeSetupContent(req, {
      tenantId,
      siteId: envelope.site_id,
      brandId: parsed.brandId,
      userId: parsed.userId,
      rows: parsed.setupContent,
    });

    const pages = await findAllTenantPages(internal, tenant.id, { overrideAccess: true });
    // #4453 milestone 7 — composer v2: the brand's format in its chosen style,
    // only from Mingla's facts and the owner's own answers; every section Draft.
    if (parsed.designPass && isDesignKey(parsed.designPass.design_key)) {
      const navigationDoc = (await req.payload.find({
        collection: "navigation", overrideAccess: true, draft: true, depth: 0, limit: 1, where: { tenant: { equals: tenant.id } },
      })).docs[0] as unknown as AnyDoc | undefined;
      // #4453 — Build composes in the design the site is drawn in (Studio's
      // own setting), never only the plan's first pick: on Gameland Lagos the
      // plan still named Voyage while the site was Pop, so Build wrote Voyage's
      // over-the-picture hero and poster cards onto a Pop site.
      const settingsDoc = (await req.payload.find({
        collection: "site-settings", overrideAccess: true, draft: true, depth: 0, limit: 1, where: { tenant: { equals: tenant.id } },
      })).docs[0] as unknown as AnyDoc | undefined;
      const design = siteDesignKey(settingsDoc, parsed.designPass.design_key);
      const scoped = scopedRequest(req, { action: "compose_from_plan", userId: parsed.userId, siteId: envelope.site_id, brandId: parsed.brandId, rank: 50, args: {} }, tenantId);
      // #4572 item 3 — the brand's own pictures into the library first; the
      // hero takes the cover still, then the first flyer still.
      const library = await importBrandLibrary(scoped, tenantId, parsed.librarySources, defaultBrandLibraryDeps());
      let coverMediaId = libraryHeroPicture(library) ??
        (parsed.coverPhotoPath ? await importBrandCover(scoped, tenantId, parsed.coverPhotoPath, storageCoverRenditionDeps()) : null);
      const records = await loadStudioRecords(req, tenant.id);
      // #4453 booking-first Home — no brand cover and no photo in Media: the
      // hero takes the next offering's own Mingla picture (imported once).
      if (!coverMediaId && records.photos.length === 0) {
        coverMediaId = await heroPictureFromOfferings(scoped, { tenantId, next: parsed.designPass.facts.next_offering }, defaultHeroPictureDeps(envelope.site_id));
      }
      const { inventory, sources } = inventoryAndSources({
        signed: parsed.designPass,
        records,
        offerings_selected: parsed.plan.offerings_selected,
        brand: parsed.brand,
        cover_media_id: coverMediaId,
      });
      const composed = composeFormatSite({
        plan: parsed.plan,
        answers: parsed.designPass.answers,
        brand: parsed.brand,
        design,
        // #4453 — with the flag off, no booking block is composed (never a failed draft).
        bookingBlocks: parsed.bookingBlocks,
        inventory,
        sources,
        existing: pages.map((page) => ({
          id: String(page.id),
          slug: typeof page.slug === "string" ? page.slug : "",
          topLevel: !page.parent,
          blockCount: Array.isArray(page.blocks) ? page.blocks.length : 0,
          allDraft: pageAllDraft(page as unknown as AnyDoc),
        })),
        currentWordmark: typeof navigationDoc?.wordmark === "string" ? navigationDoc.wordmark : null,
        // #4453 — "Rebuild my pages" builds again: a page whose every section
        // is still an unreviewed Draft (or that is empty) is replaced, exactly
        // like Ari's design pass; a page with any section the owner reviewed,
        // edited or added is kept.
        replaceDrafts: true,
      });
      if (composed) {
        const written = await writeComposition(req, internal, tenantId, composed);
        const present = new Set(written.idBySlug.keys());
        return sitesJsonResponse({
          ok: true,
          data: {
            site_id: envelope.site_id,
            pages: plannedKeysOf(composed).filter((key) => key === "home" || composed.pages.some((page) => (page.planned === key || page.key === key) && present.has(page.slug))),
            created: written.created,
            // #4453 — pages Build replaced (every section was still a Draft).
            replaced: written.replaced,
            composer: "v2",
            format: composed.format,
            left_out: composed.left_out_pages,
            skipped: composed.skipped,
            materialized: materialized.map((row) => ({ id: row.id, entry_id: row.entry_id })),
            draft_only: true,
          },
        }, 200);
      }
    }
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
      const coverMediaId = await importBrandCover(scoped, tenantId, parsed.coverPhotoPath, storageCoverRenditionDeps());
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
    // #4453 — a rebuild that lands on the menu already there writes nothing:
    // a new menu version with the same items reads in Host as "1 change"
    // that publishing would not change (Gameland Lagos, 2026-11-19).
    if (navigation) {
      if (!sameMenu(navigation, navData)) await req.payload.update({
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
        // #4453 PR 2 — planned pages left out and why (the plan tells the owner).
        left_out: result.left_out,
        // #4453 — the setup entries now in Studio (Core stamps them materialised).
        materialized: materialized.map((row) => ({ id: row.id, entry_id: row.entry_id })),
        draft_only: true,
      },
    }, 200);
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "SERVICE_TEMPORARILY_UNAVAILABLE";
    // #4453 — the refusal's own code (a fixed upper-case word, never a
    // message), so a failed compose is visible in the logs, not null.
    emitCmsObservation({
      event: "mingla_sites_state",
      metric: "cms.compose.refused",
      request_id: crypto.randomUUID(),
      operation_id: null,
      site_id: null,
      publication_id: null,
      direction: "core_to_cms",
      route: "/internal/compose-from-plan",
      state_transition: "compose_started->compose_refused",
      latency_ms: 0,
      retry_count: 0,
      safe_error_code: code,
      status_code: code === "SERVICE_TEMPORARILY_UNAVAILABLE" ? 503 : code === "FORBIDDEN" ? 403 : 409,
      version: "sites-v1",
    });
    return failure(code, code === "SERVICE_TEMPORARILY_UNAVAILABLE" ? 503 : code === "FORBIDDEN" ? 403 : 409);
  }
}

/** The design the site is drawn in (Studio's setting), else the plan's design. */
export function siteDesignKey(settings: AnyDoc | undefined, planDesign: string | null): DesignKey {
  if (isDesignKey(settings?.design)) return settings.design;
  return planDesign as DesignKey;
}

function slugOf(key: string): string {
  return key === "home" ? "" : key;
}

/**
 * #4572 item 3 — "Bring in my brand photos": the same library import Build
 * runs, for a draft built before it (signed by Core, which checked the
 * caller's rank). Idempotent by checksum: a second run adds nothing.
 */
export function parseLibraryImportBody(value: unknown, envelopeSiteId: string): { brandId: string; userId: string; sources: LibrarySource[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.kind !== "library_import" || body.site_id !== envelopeSiteId) return null;
  if (typeof body.brand_id !== "string" || typeof body.user_id !== "string") return null;
  const sources = parseLibrarySources(body.sources);
  return sources ? { brandId: body.brand_id, userId: body.user_id, sources } : null;
}

async function libraryImport(req: PayloadRequest): Promise<Response> {
  try {
    const raw = (await req.text?.()) || "";
    const envelope = await verifyCoreRequest(req, raw, "/api/internal/library-import");
    const parsed = parseLibraryImportBody(JSON.parse(raw), envelope.site_id);
    if (!parsed) return failure("VALIDATION_FAILED", 400);
    const tenant = (await req.payload.find({
      collection: "tenants", overrideAccess: true, depth: 0, limit: 1, where: { core_site_id: { equals: envelope.site_id } },
    })).docs[0];
    if (!tenant || tenant.core_brand_id !== parsed.brandId) return failure("FORBIDDEN", 403);
    const tenantId = String(tenant.id);
    const scoped = scopedRequest(req, { action: "library_import", userId: parsed.userId, siteId: envelope.site_id, brandId: parsed.brandId, rank: 20, args: {} }, tenantId);
    const imported = await importBrandLibrary(scoped, tenantId, parsed.sources, defaultBrandLibraryDeps());
    return sitesJsonResponse({ ok: true, data: { imported: imported.length, offered: parsed.sources.length } }, 200);
  } catch (error) {
    if (error instanceof Error && ["FORBIDDEN", "SESSION_EXPIRED"].includes(error.message)) return failure(error.message, 403);
    return failure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
  }
}

export const composeEndpoints: Endpoint[] = [
  {
    path: "/internal/library-import",
    method: "post",
    handler: observeCmsEndpoint("/internal/library-import", "core_to_cms", libraryImport),
  },
  {
    path: "/internal/compose-from-plan",
    method: "post",
    handler: observeCmsEndpoint("/internal/compose-from-plan", "core_to_cms", composeDraft),
  },
];
