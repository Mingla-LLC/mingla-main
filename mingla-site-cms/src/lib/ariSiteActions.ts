/**
 * #2829 W9b (AD-11) — Ari as the website designer: the Studio side of Ari's
 * typed proposal tools.
 *
 * Core is the only caller (brand-site-control POST /v1/sites/<id>/ari, after
 * the member confirmed Ari's proposal card): it checked the member's live
 * rank, bound the request to the site, and signed the Mingla facts this file
 * checks copy against (`evidence`: the brand's live offerings and its own
 * words). Here, for every write:
 *   1. the proposal is validated against the schemas generated from
 *      site-contracts (the same ones Ari was given) — a block, layout, field
 *      or colour the runtime would refuse is refused before anything is saved;
 *   2. the revision the proposal was made against must still be current, or
 *      it is refused with REVISION_CONFLICT (a Studio edit in between wins;
 *      Ari re-reads and proposes again);
 *   3. it must cite at least one source (the owner's words, a Mingla record
 *      of this brand, or the owner's own approved photo or video);
 *   4. a number, price, date or superlative in new copy must be backed by the
 *      feed, the brand's own words or a cited owner source, or it is refused
 *      (CLAIM_NOT_BACKED, naming each claim);
 *   5. the change is written to the DRAFT only, then the work log row
 *      ("Why it looks like this") with the reason and citations.
 * Nothing here publishes, and nothing here can mark a review as real.
 */
import type { PayloadRequest } from "payload";
import {
  ariBlockProblems,
  ariCopyFields,
  MAX_WORK_LOG_DECISION,
  workLogCitesProblem,
  type WorkLogCite,
} from "../contracts/generated/ariToolSchemas.ts";
import { BLOCK_CATALOG, isBlockType, type FieldSpec } from "../contracts/generated/blocks.ts";
import { buildClaimEvidence, claimSentence, unbackedClaims, type ClaimOffering } from "../contracts/generated/claims.ts";
import { designFor, designFontSlots, DESIGNS, isDesignKey, type DesignKey } from "../contracts/generated/designs.ts";
import { assertOwnerTokenOverrides, resolveTokens, type OwnerTokenOverrides } from "../contracts/generated/tokens.ts";
import { nearestPassingShade, readabilityWarnings, warningSentence } from "../contracts/generated/readability.ts";
import { findCatalogFont } from "../contracts/generated/fontCatalog.ts";
import { MAX_BLOCKS_PER_PAGE, MAX_NAV_ITEMS, MAX_NAV_LABEL_LENGTH, MAX_PAGE_TITLE_LENGTH, MAX_SLUG_LENGTH } from "../contracts/generated/limits.ts";
import { SLUG_PATTERN } from "../contracts/generated/routes.ts";
import { MAX_HERO_VIDEO_MS } from "../contracts/generated/video.ts";
import { publicationDraftDigest } from "./artifactBuilder";
import { findAllTenantPages } from "./tenantPages";
import { findTenantContent } from "./siteContent";
import { tenantPagePaths } from "./pageTree";
import { ownerFontsOf, ownerTokensOf } from "./siteLook";
import { designCheckWarningCount, runDesignChecks, type DesignCheckResult } from "./designChecks";
import { CONTENT_COLLECTIONS, runContentAction, scopedRequest, type ContentCollection } from "../endpoints/contentEndpoint";

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AriRefusal extends Error {
  constructor(code: string, readonly extra: Record<string, unknown> = {}) {
    super(code);
    this.name = "AriRefusal";
  }
}
function refuse(code: string, extra: Record<string, unknown> = {}): never {
  throw new AriRefusal(code, extra);
}

/** The Mingla facts Core signed into the request (copy is checked against these). */
export type AriEvidence = {
  brand: { id: string; name: string | null; description: string | null; city: string | null };
  offerings: Array<ClaimOffering & { id: string; kind?: string | null }>;
};

export type AriActionContext = {
  req: PayloadRequest;
  /** The member's tenant-scoped Payload request (overrideAccess false). */
  scoped: PayloadRequest;
  tenantId: string;
  siteId: string;
  brandId: string;
  userId: string;
  rank: number;
  evidence: AriEvidence | null;
};

/** Validates the Core-signed evidence's shape (anything else is treated as no evidence). */
export function parseAriEvidence(value: unknown, brandId: string): AriEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as AnyDoc;
  if (!raw.brand || raw.brand.id !== brandId || !Array.isArray(raw.offerings)) return null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    brand: { id: brandId, name: text(raw.brand.name, 200), description: text(raw.brand.description, 5000), city: text(raw.brand.city, 200) },
    offerings: raw.offerings.slice(0, 500).filter((row: AnyDoc) => row && typeof row.id === "string" && UUID.test(row.id)).map((row: AnyDoc) => ({
      id: row.id.toLowerCase(),
      kind: text(row.kind, 20),
      title: text(row.title, 300),
      summary: text(row.summary, 1000),
      destination_text: text(row.destination_text, 300),
      start_at: text(row.start_at, 40),
      end_at: text(row.end_at, 40),
      timezone: text(row.timezone, 60),
      min_price_minor: num(row.min_price_minor),
      currency: text(row.currency, 3),
      capacity: num(row.capacity),
      spots_left: num(row.spots_left),
      group_minimum: num(row.group_minimum),
    })),
  };
}

// ---------------------------------------------------------------------------
// The draft, read once the same way Publish reads it (so digests agree).
// ---------------------------------------------------------------------------

export type DraftState = {
  pages: AnyDoc[];
  settings: AnyDoc | null;
  navigation: AnyDoc | null;
  footer: AnyDoc | null;
  media: AnyDoc[];
  content: Awaited<ReturnType<typeof findTenantContent>>;
  digest: string;
};

export async function loadDraftState(req: PayloadRequest, scoped: PayloadRequest, tenantId: string): Promise<DraftState> {
  const tenantWhere = { tenant: { equals: tenantId } };
  const one = async (collection: "site-settings" | "navigation" | "footer") =>
    ((await req.payload.find({ collection, req: scoped, overrideAccess: false, draft: true, depth: 0, limit: 1, where: tenantWhere })).docs[0] as AnyDoc | undefined) ?? null;
  const [settings, pages, navigation, footer, media, content] = await Promise.all([
    one("site-settings"),
    findAllTenantPages(scoped, tenantId),
    one("navigation"),
    one("footer"),
    req.payload.find({
      collection: "media",
      req: scoped,
      overrideAccess: false,
      depth: 0,
      limit: 500,
      sort: "id",
      where: { and: [tenantWhere, { state: { equals: "READY" } }] },
    }).then((result) => result.docs as AnyDoc[]),
    findTenantContent(scoped, tenantId),
  ]);
  const digest = await publicationDraftDigest({ pages: pages as unknown[], settings, navigation, footer, media, content });
  return { pages: pages as AnyDoc[], settings, navigation, footer, media, content, digest };
}

// ---------------------------------------------------------------------------
// Citations, the truth check and the work log.
// ---------------------------------------------------------------------------

/** Every citation must be valid and point at this brand's own things. */
export async function assertCites(ctx: AriActionContext, cites: unknown): Promise<WorkLogCite[]> {
  const problem = workLogCitesProblem(cites);
  if (problem) refuse("CITATION_REQUIRED", { problem });
  const list = cites as WorkLogCite[];
  const offeringIds = new Set((ctx.evidence?.offerings ?? []).map((row) => row.id));
  for (const cite of list) {
    if (cite.kind === "mingla_record") {
      const id = String(cite.record_id).toLowerCase();
      if (id !== ctx.brandId.toLowerCase() && !offeringIds.has(id)) refuse("CITATION_INVALID", { problem: "That Mingla record isn't one of this brand's." });
    }
  }
  const mediaIds = list.filter((cite) => cite.kind === "owner_material").map((cite) => String(cite.media_id));
  if (mediaIds.length) await readyMedia(ctx, mediaIds, "any");
  return list;
}

function ownerQuotes(cites: readonly WorkLogCite[]): string[] {
  return cites.filter((cite) => cite.kind === "owner_words" && typeof cite.quote === "string").map((cite) => cite.quote!);
}

/** Refuses copy that says something nothing backs (CLAIM_NOT_BACKED lists every claim). */
export function assertBacked(ctx: AriActionContext, texts: readonly string[], ownerTexts: readonly string[]): void {
  const evidence = buildClaimEvidence({
    offerings: ctx.evidence?.offerings ?? [],
    brandTexts: [ctx.evidence?.brand.name, ctx.evidence?.brand.description, ctx.evidence?.brand.city],
    ownerTexts,
  });
  const claims = texts.flatMap((text) => unbackedClaims(text, evidence));
  if (claims.length) refuse("CLAIM_NOT_BACKED", { claims: claims.slice(0, 12).map(claimSentence) });
}

function decisionOf(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_WORK_LOG_DECISION || /<\s*\/?\s*[a-z!]/i.test(value)) {
    refuse("VALIDATION_FAILED", { problems: [`why must be plain text up to ${MAX_WORK_LOG_DECISION} characters`] });
  }
  return value.trim();
}

export async function writeWorkLog(ctx: AriActionContext, entry: {
  part: string;
  decision: string;
  cites: readonly WorkLogCite[];
  tool: string;
  target: string | null;
  revision: string | null;
  req?: PayloadRequest;
}): Promise<string> {
  const created = await ctx.req.payload.create({
    collection: "work-log",
    overrideAccess: true,
    depth: 0,
    ...(entry.req ? { req: entry.req } : {}),
    data: {
      tenant: ctx.tenantId,
      part: entry.part,
      decision: entry.decision,
      cites: entry.cites,
      actor: "ari",
      actor_user_id: ctx.userId,
      tool: entry.tool,
      target: entry.target?.slice(0, 200) ?? null,
      revision: entry.revision?.slice(0, 200) ?? null,
    } as never,
  });
  return String((created as AnyDoc).id);
}

// ---------------------------------------------------------------------------
// Pages, blocks and media.
// ---------------------------------------------------------------------------

async function pageAt(ctx: AriActionContext, pagePath: unknown, req = ctx.scoped): Promise<{ page: AnyDoc; pages: AnyDoc[]; paths: Map<string, string> }> {
  if (typeof pagePath !== "string") refuse("VALIDATION_FAILED", { problems: ["page_path is required (\"\" is the home page)"] });
  const pages = (await findAllTenantPages(req, ctx.tenantId)) as AnyDoc[];
  const paths = tenantPagePaths(pages as never);
  const page = pages.find((candidate) => paths.get(String(candidate.id)) === pagePath);
  if (!page) refuse("PAGE_NOT_FOUND");
  return { page, pages, paths };
}

function checkRevision(current: unknown, expected: unknown): void {
  if (typeof expected !== "string" || String(current ?? "") !== expected) refuse("REVISION_CONFLICT", { latest_revision: String(current ?? "") });
}

function siteDesign(settings: AnyDoc | null | undefined): DesignKey {
  return isDesignKey(settings?.design) ? (settings!.design as DesignKey) : "atelier";
}

async function currentSettings(ctx: AriActionContext, req = ctx.scoped): Promise<AnyDoc> {
  const doc = (await ctx.req.payload.find({
    collection: "site-settings",
    req,
    overrideAccess: false,
    draft: true,
    depth: 0,
    limit: 1,
    where: { tenant: { equals: ctx.tenantId } },
  })).docs[0] as AnyDoc | undefined;
  return doc ?? refuse("NOT_FOUND");
}

/** The tenant's READY media for these ids, refusing any other (and the wrong kind). */
async function readyMedia(ctx: AriActionContext, ids: readonly string[], kind: "image" | "video" | "any"): Promise<Map<string, AnyDoc>> {
  const unique = [...new Set(ids)];
  if (unique.some((id) => !UUID.test(id))) refuse("MEDIA_NOT_FOUND");
  const result = await ctx.req.payload.find({
    collection: "media",
    req: ctx.scoped,
    overrideAccess: false,
    depth: 0,
    pagination: false,
    where: { and: [{ tenant: { equals: ctx.tenantId } }, { id: { in: unique } }] },
  });
  const byId = new Map((result.docs as AnyDoc[]).map((doc) => [String(doc.id), doc]));
  for (const id of unique) {
    const doc = byId.get(id);
    if (!doc) refuse("MEDIA_NOT_FOUND");
    if (doc.state !== "READY") refuse("MEDIA_PROCESSING");
    const mime = String(doc.detected_mime ?? "");
    if (kind === "image" && !mime.startsWith("image/")) refuse("MEDIA_WRONG_KIND", { problem: "That spot needs a photo." });
    if (kind === "video" && mime !== "video/mp4") refuse("MEDIA_WRONG_KIND", { problem: "That spot needs an MP4 video." });
  }
  return byId;
}

function plainTextToLexical(value: string): Record<string, unknown> {
  const paragraphs = value.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: "ltr",
      children: (paragraphs.length ? paragraphs : [""]).map((text) => ({
        type: "paragraph",
        format: "",
        indent: 0,
        version: 1,
        direction: "ltr",
        textFormat: 0,
        textStyle: "",
        children: text ? [{ type: "text", detail: 0, format: 0, mode: "normal", style: "", text, version: 1 }] : [],
      })),
    },
  };
}

/** Offering lists Ari writes as `{ id }`; Studio stores `{ offering_id }`. */
const OFFERING_LISTS = new Set(["offering_ids", "linked_offering_ids"]);

/** One block as Ari wrote it → the block as Studio stores it (declared renames only). */
export function ariBlockToStudio(block: AnyDoc): AnyDoc {
  const out: AnyDoc = { blockType: block.type, variant: block.variant };
  for (const [key, value] of Object.entries(block)) {
    if (key === "type" || key === "variant") continue;
    if (key === "media_id") out.media = value;
    else if (key === "video_media_id") out.video = value;
    else if (key === "poster_media_id") out.poster = value;
    else if (block.type === "rich_text" && key === "body") out.content = plainTextToLexical(String(value));
    else if ((key === "images") && Array.isArray(value)) out.images = value.map((row: AnyDoc) => ({ media: row.media_id, alt: row.alt ?? null }));
    else if (OFFERING_LISTS.has(key) && Array.isArray(value)) out[key] = value.map((row: AnyDoc) => ({ offering_id: row.id }));
    else if (key === "series" && Array.isArray(value)) {
      out.series = value.map((row: AnyDoc) => ({ label: row.label, offering_ids: (row.offering_ids ?? []).map((item: AnyDoc) => ({ offering_id: item.id })) }));
    } else out[key] = value;
  }
  return out;
}

/** Media ids a block (as Ari wrote it) uses, by kind. */
function blockMedia(block: AnyDoc): { images: string[]; videos: string[]; heroVideos: string[] } {
  const images: string[] = [];
  const videos: string[] = [];
  const heroVideos: string[] = [];
  if (typeof block.media_id === "string") images.push(block.media_id);
  if (typeof block.poster_media_id === "string") images.push(block.poster_media_id);
  if (typeof block.video_media_id === "string") (block.type === "hero" ? heroVideos : videos).push(block.video_media_id);
  for (const row of Array.isArray(block.images) ? block.images : []) if (typeof row?.media_id === "string") images.push(row.media_id);
  return { images, videos, heroVideos };
}

/** Offering ids a block names must be this brand's own. */
function blockOfferingIds(block: AnyDoc): string[] {
  const ids: string[] = [];
  for (const key of OFFERING_LISTS) for (const row of Array.isArray(block[key]) ? block[key] : []) ids.push(String(row?.id ?? ""));
  for (const run of Array.isArray(block.series) ? block.series : []) for (const row of Array.isArray(run?.offering_ids) ? run.offering_ids : []) ids.push(String(row?.id ?? ""));
  return ids;
}

/** Visitor-facing text in a block as Ari wrote it (for the truth check). */
function blockTexts(block: AnyDoc): string[] {
  const type = String(block.type);
  if (!isBlockType(type)) return [];
  const texts: string[] = [];
  const { fields, listFields } = ariCopyFields(type);
  for (const key of fields) if (typeof block[key] === "string") texts.push(block[key]);
  for (const [list, inner] of Object.entries(listFields)) {
    for (const row of Array.isArray(block[list]) ? block[list] : []) for (const key of inner) if (typeof row?.[key] === "string") texts.push(row[key]);
  }
  for (const row of Array.isArray(block.images) ? block.images : []) if (typeof row?.alt === "string") texts.push(row.alt);
  return texts;
}

async function assertBlocks(ctx: AriActionContext, blocks: unknown, design: DesignKey, path: string, ownerTexts: readonly string[]): Promise<AnyDoc[]> {
  if (!Array.isArray(blocks) || blocks.length > MAX_BLOCKS_PER_PAGE) refuse("VALIDATION_FAILED", { problems: [`${path} must be a list of at most ${MAX_BLOCKS_PER_PAGE} blocks`] });
  const problems = blocks.flatMap((block, index) => ariBlockProblems(block, design, `${path}[${index}]`));
  if (problems.length) refuse("VALIDATION_FAILED", { problems: problems.slice(0, 20) });
  const typed = blocks as AnyDoc[];
  const images = typed.flatMap((block) => blockMedia(block).images);
  const videos = typed.flatMap((block) => blockMedia(block).videos);
  const heroVideos = typed.flatMap((block) => blockMedia(block).heroVideos);
  if (images.length) await readyMedia(ctx, images, "image");
  if (videos.length || heroVideos.length) {
    const found = await readyMedia(ctx, [...videos, ...heroVideos], "video");
    for (const id of heroVideos) {
      const duration = found.get(id)?.duration_ms;
      if (typeof duration !== "number" || duration > MAX_HERO_VIDEO_MS) refuse("VIDEO_TOO_LONG");
    }
  }
  const known = new Set((ctx.evidence?.offerings ?? []).map((row) => row.id));
  if (typed.flatMap(blockOfferingIds).some((id) => !known.has(id.toLowerCase()))) refuse("OFFERING_NOT_FOUND");
  assertBacked(ctx, typed.flatMap(blockTexts), ownerTexts);
  return typed.map(ariBlockToStudio);
}

async function updatePage(ctx: AriActionContext, page: AnyDoc, data: AnyDoc, req = ctx.scoped): Promise<AnyDoc> {
  return (await ctx.req.payload.update({
    collection: "pages",
    id: page.id,
    req,
    overrideAccess: false,
    draft: true,
    depth: 0,
    data: { ...data, revision: page.revision } as never,
  })) as AnyDoc;
}

/** Payload transactions when the adapter has them (all-or-nothing composition). */
async function inTransaction<T>(ctx: AriActionContext, work: (req: PayloadRequest) => Promise<T>): Promise<T> {
  const db = ctx.req.payload.db as unknown as {
    beginTransaction?: () => Promise<string | number | null>;
    commitTransaction?: (id: string | number) => Promise<void>;
    rollbackTransaction?: (id: string | number) => Promise<void>;
  };
  const id = db.beginTransaction ? await db.beginTransaction() : null;
  if (id === null || id === undefined) return work(ctx.scoped);
  const req = { ...ctx.scoped, transactionID: id } as PayloadRequest;
  try {
    const result = await work(req);
    await db.commitTransaction!(id);
    return result;
  } catch (error) {
    await db.rollbackTransaction!(id).catch(() => undefined);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The actions.
// ---------------------------------------------------------------------------

function tokensView(settings: AnyDoc) {
  const design = siteDesign(settings);
  const definition = designFor(design) ?? DESIGNS.atelier;
  const tokens = ownerTokensOf(settings);
  const warnings = readabilityWarnings(resolveTokens(definition.tokens, tokens)).map((warning) => ({
    ...warning,
    sentence: warningSentence(warning),
    // Shown beside the warning for the owner to choose; never applied.
    suggestion: nearestPassingShade(warning.foreground, warning.background, warning.required),
  }));
  return {
    revision: String(settings.updatedAt ?? ""),
    design,
    tokens,
    fonts: ownerFontsOf(settings),
    font_slots: designFontSlots(definition),
    readability_warnings: warnings,
  };
}

function mergeTokens(current: OwnerTokenOverrides, proposed: OwnerTokenOverrides): OwnerTokenOverrides {
  const colors = { ...(current.colors ?? {}) } as AnyDoc;
  for (const [role, value] of Object.entries(proposed.colors ?? {})) {
    colors[role] = value && typeof value === "object" ? { ...(colors[role] ?? {}), ...value } : value;
  }
  const merged: OwnerTokenOverrides = { ...current, ...proposed };
  if (proposed.colors || current.colors) merged.colors = colors as OwnerTokenOverrides["colors"];
  return merged;
}

export async function runDesignChecksFor(ctx: AriActionContext, runBy: "ari" | "user"): Promise<{ draft_digest: string; warning_count: number; checks: DesignCheckResult[]; ran_at: string }> {
  const draft = await loadDraftState(ctx.req, ctx.scoped, ctx.tenantId);
  const log = await ctx.req.payload.find({
    collection: "work-log",
    overrideAccess: true,
    depth: 0,
    limit: 200,
    where: { tenant: { equals: ctx.tenantId } },
  });
  const ownerTexts = (log.docs as AnyDoc[]).flatMap((doc) => (Array.isArray(doc.cites) ? doc.cites : []))
    .filter((cite: AnyDoc) => cite?.kind === "owner_words" && typeof cite.quote === "string")
    .map((cite: AnyDoc) => String(cite.quote));
  const checks = runDesignChecks({
    pages: draft.pages,
    settings: draft.settings,
    navigation: draft.navigation,
    media: draft.media,
    content: draft.content,
    evidence: {
      offerings: ctx.evidence?.offerings ?? [],
      brand_texts: [ctx.evidence?.brand.name, ctx.evidence?.brand.description, ctx.evidence?.brand.city].filter((text): text is string => typeof text === "string"),
    },
    owner_texts: ownerTexts,
  });
  const warningCount = designCheckWarningCount(checks);
  const run = await ctx.req.payload.create({
    collection: "design-check-runs",
    overrideAccess: true,
    depth: 0,
    data: { tenant: ctx.tenantId, draft_digest: draft.digest, results: checks, warning_count: warningCount, run_by: runBy } as never,
  });
  return { draft_digest: draft.digest, warning_count: warningCount, checks, ran_at: String((run as AnyDoc).createdAt ?? new Date().toISOString()) };
}

/** Has a design-check run been stored for exactly this draft? */
export async function designChecksRanOn(req: PayloadRequest, tenantId: string, draftDigest: string): Promise<boolean> {
  const result = await req.payload.find({
    collection: "design-check-runs",
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: { and: [{ tenant: { equals: tenantId } }, { draft_digest: { equals: draftDigest } }] },
  });
  return result.docs.length > 0;
}

/*
 * #2829 W9b (L4) — a site's FIRST publish needs the six design checks run on
 * exactly this draft (their results are warnings; running them is the
 * requirement). Nothing goes live and the owner is told to run them. Later
 * publishes and restores never wait on them.
 */
export async function assertFirstPublishChecked(req: PayloadRequest, tenantId: string, draftDigest: string): Promise<void> {
  const everPublished = (await req.payload.find({
    collection: "publication-jobs",
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: { and: [{ tenant: { equals: tenantId } }, { status: { equals: "published" } }] },
  })).docs.length > 0;
  if (!everPublished && !(await designChecksRanOn(req, tenantId, draftDigest))) {
    throw new Error("DESIGN_CHECKS_REQUIRED");
  }
}

export const ARI_DESIGNER_ACTIONS = new Set([
  "get_site_tokens",
  "run_site_design_checks",
  "propose_site_composition",
  "propose_block_variant",
  "propose_site_tokens",
  "propose_site_copy",
  "propose_site_imagery",
  "propose_site_collection_entry",
  "log_work",
]);

export async function runAriDesignerAction(action: string, args: AnyDoc, ctx: AriActionContext): Promise<Record<string, unknown>> {
  switch (action) {
    case "get_site_tokens":
      return tokensView(await currentSettings(ctx));

    case "run_site_design_checks":
      return runDesignChecksFor(ctx, "ari");

    case "log_work": {
      // A change Core itself made (plan answers, the first draft, a trip guide).
      const part = String(args.part ?? "");
      if (!["plan", "draft", "trip_guide"].includes(part)) refuse("VALIDATION_FAILED", { problems: ["part"] });
      const cites = await assertCites(ctx, args.cites);
      const id = await writeWorkLog(ctx, {
        part,
        decision: decisionOf(args.why),
        cites,
        tool: String(args.tool ?? "").slice(0, 64),
        target: typeof args.target === "string" ? args.target : null,
        revision: typeof args.revision === "string" ? args.revision : null,
      });
      return { work_log_id: id };
    }

    case "propose_site_tokens": {
      const decision = decisionOf(args.why);
      const cites = await assertCites(ctx, args.cites);
      const settings = await currentSettings(ctx);
      checkRevision(settings.updatedAt, args.expected_revision);
      const changes: AnyDoc = {};
      if (args.design !== undefined) {
        if (!isDesignKey(args.design)) refuse("VALIDATION_FAILED", { problems: ["design is not one of the designs"] });
        changes.design = args.design;
      }
      if (args.tokens !== undefined) {
        const merged = mergeTokens(ownerTokensOf(settings), args.tokens as OwnerTokenOverrides);
        try {
          assertOwnerTokenOverrides(merged);
        } catch (error) {
          refuse("VALIDATION_FAILED", { problems: [error instanceof Error ? error.message : "tokens"] });
        }
        // #2829 — stored EXACTLY as proposed: readability is reported, never "fixed".
        const { radius, button_shape, motion, ...tokens } = merged;
        changes.tokens = tokens;
        if (radius) changes.radius = radius;
        if (button_shape) changes.button_shape = button_shape;
        if (motion) changes.motion = motion;
      }
      if (args.fonts !== undefined) {
        const fonts: AnyDoc = { ...ownerFontsOf(settings) };
        for (const [slot, choice] of Object.entries((args.fonts ?? {}) as AnyDoc)) {
          const family = String((choice as AnyDoc)?.family ?? "");
          if (!findCatalogFont(family)) refuse("VALIDATION_FAILED", { problems: [`${family || "that font"} is not in the Google Fonts list`] });
          fonts[slot] = { family, source: "google" };
        }
        changes.fonts = fonts;
      }
      if (!Object.keys(changes).length) refuse("VALIDATION_FAILED", { problems: ["nothing to change"] });
      const updated = (await ctx.req.payload.update({
        collection: "site-settings",
        id: settings.id,
        req: ctx.scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        data: changes as never,
      })) as AnyDoc;
      const view = tokensView(updated);
      await writeWorkLog(ctx, { part: "tokens", decision, cites, tool: "propose_site_tokens", target: "design", revision: view.revision });
      return { previous_revision: String(settings.updatedAt), revision: view.revision, draft_only: true, design: view.design, readability_warnings: view.readability_warnings };
    }

    case "propose_block_variant": {
      const decision = decisionOf(args.why);
      const cites = await assertCites(ctx, args.cites);
      const { page, paths } = await pageAt(ctx, args.page_path);
      checkRevision(page.revision, args.expected_revision);
      const index = Number(args.block_index);
      const blocks = Array.isArray(page.blocks) ? structuredClone(page.blocks) as AnyDoc[] : [];
      const block = blocks[index];
      if (!Number.isInteger(index) || !block) refuse("VALIDATION_FAILED", { problems: ["block_index is not a block on that page"] });
      const type = String(block.blockType);
      const design = siteDesign(await currentSettings(ctx));
      if (!isBlockType(type) || !DESIGNS[design].variants[type].includes(String(args.variant))) {
        refuse("VARIANT_NOT_IN_DESIGN", { variants: isBlockType(type) ? [...DESIGNS[design].variants[type]] : [] });
      }
      block.variant = String(args.variant);
      const previous = page.revision;
      const updated = await updatePage(ctx, page, { blocks });
      await writeWorkLog(ctx, { part: "variant", decision, cites, tool: "propose_block_variant", target: `page:${paths.get(String(page.id)) ?? ""}#${index}`, revision: String(updated.revision) });
      return { page_path: paths.get(String(page.id)), previous_revision: previous, revision: updated.revision, draft_only: true };
    }

    case "propose_site_copy": {
      const decision = decisionOf(args.why);
      const cites = await assertCites(ctx, args.cites);
      const { page, paths } = await pageAt(ctx, args.page_path);
      checkRevision(page.revision, args.expected_revision);
      const blocks = Array.isArray(page.blocks) ? structuredClone(page.blocks) as AnyDoc[] : [];
      const edits = Array.isArray(args.edits) ? args.edits as AnyDoc[] : [];
      const data: AnyDoc = {};
      const texts: string[] = [];
      if (typeof args.title === "string") {
        if (!args.title.trim() || args.title.length > MAX_PAGE_TITLE_LENGTH || /<\s*\/?\s*[a-z!]/i.test(args.title)) refuse("VALIDATION_FAILED", { problems: ["title"] });
        data.title = args.title;
        texts.push(args.title);
      }
      if (!edits.length && data.title === undefined) refuse("VALIDATION_FAILED", { problems: ["edits needs at least one change"] });
      for (const [n, edit] of edits.entries()) {
        const block = blocks[Number(edit.block_index)];
        const type = String(block?.blockType ?? "");
        if (!block || !isBlockType(type)) refuse("VALIDATION_FAILED", { problems: [`edits[${n}].block_index is not a block on that page`] });
        const { fields, listFields } = ariCopyFields(type);
        const value = edit.value;
        const field = String(edit.field ?? "");
        const spec = (BLOCK_CATALOG[type].fields as Record<string, FieldSpec>)[edit.list ?? field];
        if (typeof value !== "string" || /<\s*\/?\s*[a-z!]/i.test(value)) refuse("VALIDATION_FAILED", { problems: [`edits[${n}].value must be plain text`] });
        if (typeof edit.list === "string") {
          const inner = listFields[edit.list];
          const rows = Array.isArray(block[edit.list]) ? block[edit.list] as AnyDoc[] : [];
          const row = rows[Number(edit.item_index)];
          if (!inner?.includes(field) || !row) refuse("VALIDATION_FAILED", { problems: [`edits[${n}] is not a text field of that block`] });
          const itemSpec = spec && spec.kind === "list" ? (spec.item as Record<string, FieldSpec>)[field] : undefined;
          if (itemSpec?.kind === "text" && value.length > itemSpec.max) refuse("VALIDATION_FAILED", { problems: [`edits[${n}].value is longer than ${itemSpec.max} characters`] });
          row[field] = value;
        } else {
          if (!fields.includes(field)) refuse("VALIDATION_FAILED", { problems: [`edits[${n}].field is not a text field of that block`] });
          if (spec?.kind === "text" && value.length > spec.max) refuse("VALIDATION_FAILED", { problems: [`edits[${n}].value is longer than ${spec.max} characters`] });
          if (spec?.kind === "rich_text") block.content = plainTextToLexical(value);
          else block[field] = value;
        }
        texts.push(value);
      }
      // #2829 — no number, price, date or superlative the feed, the brand or the owner can't back.
      assertBacked(ctx, texts, ownerQuotes(cites));
      if (edits.length) data.blocks = blocks;
      const previous = page.revision;
      const updated = await updatePage(ctx, page, data);
      await writeWorkLog(ctx, { part: "copy", decision, cites, tool: "propose_site_copy", target: `page:${paths.get(String(page.id)) ?? ""}`, revision: String(updated.revision) });
      return { page_path: paths.get(String(page.id)), previous_revision: previous, revision: updated.revision, draft_only: true };
    }

    case "propose_site_imagery": {
      const decision = decisionOf(args.why);
      const cites = await assertCites(ctx, args.cites);
      const { page, paths } = await pageAt(ctx, args.page_path);
      checkRevision(page.revision, args.expected_revision);
      const blocks = Array.isArray(page.blocks) ? structuredClone(page.blocks) as AnyDoc[] : [];
      const slots = Array.isArray(args.slots) ? args.slots as AnyDoc[] : [];
      if (!slots.length) refuse("VALIDATION_FAILED", { problems: ["slots needs at least one picture"] });
      const accepts: Record<string, string[]> = { media: ["hero", "media_feature", "page_header"], poster: ["video_feature"], video: ["hero", "video_feature"], gallery: ["gallery"] };
      for (const [n, slot] of slots.entries()) {
        const block = blocks[Number(slot.block_index)];
        const kind = String(slot.slot ?? "");
        if (!block || !accepts[kind]?.includes(String(block.blockType))) refuse("VALIDATION_FAILED", { problems: [`slots[${n}] doesn't fit that block`] });
        if (kind === "gallery") {
          const images = Array.isArray(slot.images) ? slot.images as AnyDoc[] : [];
          if (!images.length || images.length > 12) refuse("VALIDATION_FAILED", { problems: [`slots[${n}].images needs 1 to 12 photos`] });
          await readyMedia(ctx, images.map((row) => String(row.media_id ?? "")), "image");
          block.images = images.map((row) => ({ media: row.media_id, alt: typeof row.alt === "string" ? row.alt.slice(0, 240) : null }));
          continue;
        }
        const mediaId = String(slot.media_id ?? "");
        const found = await readyMedia(ctx, [mediaId], kind === "video" ? "video" : "image");
        if (kind === "video" && block.blockType === "hero") {
          // A hero film is a short loop (≤ 15 s, poster first).
          const duration = found.get(mediaId)?.duration_ms;
          if (typeof duration !== "number" || duration > MAX_HERO_VIDEO_MS) refuse("VIDEO_TOO_LONG");
        }
        block[kind] = mediaId;
        if (typeof slot.alt === "string" && block.blockType === "media_feature") block.alt = slot.alt.slice(0, 240);
      }
      const previous = page.revision;
      const updated = await updatePage(ctx, page, { blocks });
      await writeWorkLog(ctx, { part: "imagery", decision, cites, tool: "propose_site_imagery", target: `page:${paths.get(String(page.id)) ?? ""}`, revision: String(updated.revision) });
      return { page_path: paths.get(String(page.id)), previous_revision: previous, revision: updated.revision, draft_only: true };
    }

    case "propose_site_composition": {
      const decision = decisionOf(args.why);
      const cites = await assertCites(ctx, args.cites);
      const draft = await loadDraftState(ctx.req, ctx.scoped, ctx.tenantId);
      // The whole site at once, so the proposal names the whole draft's revision.
      checkRevision(draft.digest, args.expected_site_revision);
      const design = siteDesign(draft.settings);
      const paths = tenantPagePaths(draft.pages as never);
      const byPath = new Map(draft.pages.map((page) => [paths.get(String(page.id)) ?? "", page]));
      const owner = ownerQuotes(cites);
      const updates = Array.isArray(args.pages) ? args.pages as AnyDoc[] : [];
      const creates = Array.isArray(args.new_pages) ? args.new_pages as AnyDoc[] : [];
      if (!updates.length && !creates.length && !Array.isArray(args.menu)) refuse("VALIDATION_FAILED", { problems: ["nothing to change"] });
      const plannedUpdates: Array<{ page: AnyDoc; data: AnyDoc }> = [];
      for (const [n, row] of updates.entries()) {
        const page = byPath.get(String(row.page_path));
        if (!page || typeof row.page_path !== "string") refuse("PAGE_NOT_FOUND", { page_path: row.page_path ?? null });
        const data: AnyDoc = { blocks: await assertBlocks(ctx, row.blocks, design, `pages[${n}].blocks`, owner) };
        if (typeof row.title === "string") {
          if (!row.title.trim() || row.title.length > MAX_PAGE_TITLE_LENGTH) refuse("VALIDATION_FAILED", { problems: [`pages[${n}].title`] });
          assertBacked(ctx, [row.title], owner);
          data.title = row.title;
        }
        plannedUpdates.push({ page, data });
      }
      const plannedCreates: AnyDoc[] = [];
      for (const [n, row] of creates.entries()) {
        const slug = String(row.slug ?? "");
        const parent = typeof row.parent_path === "string" && row.parent_path ? byPath.get(row.parent_path) : null;
        if (!SLUG_PATTERN.test(slug) || slug.length > MAX_SLUG_LENGTH) refuse("VALIDATION_FAILED", { problems: [`new_pages[${n}].slug`] });
        if (typeof row.parent_path === "string" && row.parent_path && !parent) refuse("PAGE_NOT_FOUND", { page_path: row.parent_path });
        const fullPath = parent ? `${paths.get(String(parent.id))}/${slug}` : slug;
        if (byPath.has(fullPath)) refuse("PATH_COLLISION");
        if (typeof row.title !== "string" || !row.title.trim() || row.title.length > MAX_PAGE_TITLE_LENGTH) refuse("VALIDATION_FAILED", { problems: [`new_pages[${n}].title`] });
        assertBacked(ctx, [row.title], owner);
        plannedCreates.push({
          tenant: ctx.tenantId,
          title: row.title,
          slug,
          ...(parent ? { parent: parent.id } : {}),
          kind: "standard",
          enabled: true,
          blocks: await assertBlocks(ctx, row.blocks, design, `new_pages[${n}].blocks`, owner),
        });
      }
      let menu: AnyDoc[] | null = null;
      if (Array.isArray(args.menu)) {
        if (args.menu.length > MAX_NAV_ITEMS) refuse("VALIDATION_FAILED", { problems: [`menu allows at most ${MAX_NAV_ITEMS} items`] });
        menu = (args.menu as AnyDoc[]).map((item, n) => {
          const label = String(item.label ?? "");
          if (!label.trim() || label.length > MAX_NAV_LABEL_LENGTH || /<\s*\/?\s*[a-z!]/i.test(label)) refuse("VALIDATION_FAILED", { problems: [`menu[${n}].label`] });
          return { page_path: String(item.page_path ?? ""), label };
        });
        assertBacked(ctx, menu.map((item) => item.label), owner);
        for (const [n, item] of menu.entries()) {
          if (item.page_path === "") refuse("VALIDATION_FAILED", { problems: [`menu[${n}]: Home is the logo, not a menu item`] });
          const exists = byPath.has(item.page_path) || plannedCreates.some((row) => row.slug === item.page_path);
          if (!exists) refuse("PAGE_NOT_FOUND", { page_path: item.page_path });
        }
      }
      // All checks passed: apply every change together, or none.
      const result = await inTransaction(ctx, async (req) => {
        const created: AnyDoc[] = [];
        for (const data of plannedCreates) {
          created.push(await ctx.req.payload.create({ collection: "pages", req, overrideAccess: false, draft: true, depth: 0, data: data as never }) as AnyDoc);
        }
        const updated: AnyDoc[] = [];
        for (const { page, data } of plannedUpdates) updated.push(await updatePage(ctx, page, data, req));
        if (menu) {
          const navigation = (await ctx.req.payload.find({ collection: "navigation", req, overrideAccess: false, draft: true, depth: 0, limit: 1, where: { tenant: { equals: ctx.tenantId } } })).docs[0] as AnyDoc | undefined;
          if (!navigation) refuse("NOT_FOUND");
          const pagesNow = (await findAllTenantPages(req, ctx.tenantId)) as AnyDoc[];
          const pathsNow = tenantPagePaths(pagesNow as never);
          const idOf = new Map(pagesNow.map((page) => [pathsNow.get(String(page.id)) ?? "", String(page.id)]));
          // Links to other websites and "More" groups stay as they were.
          const items = (Array.isArray(navigation.items) ? navigation.items : []) as AnyDoc[];
          const keep = items.filter((item) => item.target_type === "url" || (Array.isArray(item.children) && item.children.length > 0)).map(({ id: _row, ...rest }) => rest);
          const next = [...menu.map((item) => ({ label: item.label, target_type: "page", page: idOf.get(item.page_path) })), ...keep];
          if (next.length > MAX_NAV_ITEMS) refuse("VALIDATION_FAILED", { problems: [`the menu would have more than ${MAX_NAV_ITEMS} items`] });
          await ctx.req.payload.update({ collection: "navigation", id: navigation.id, req, overrideAccess: false, draft: true, depth: 0, data: { items: next } as never });
        }
        await writeWorkLog(ctx, { part: "composition", decision, cites, tool: "propose_site_composition", target: "site", revision: null, req });
        return { created, updated };
      });
      const after = await loadDraftState(ctx.req, ctx.scoped, ctx.tenantId);
      const pathsAfter = tenantPagePaths(after.pages as never);
      return {
        previous_site_revision: draft.digest,
        site_revision: after.digest,
        pages: [...result.updated, ...result.created].map((page) => ({ page_path: pathsAfter.get(String(page.id)) ?? null, revision: page.revision })),
        draft_only: true,
      };
    }

    case "propose_site_collection_entry": {
      const decision = decisionOf(args.why);
      const cites = await assertCites(ctx, args.cites);
      const collection = String(args.collection ?? "") as ContentCollection;
      if (!(CONTENT_COLLECTIONS as readonly string[]).includes(collection)) refuse("VALIDATION_FAILED", { problems: ["collection"] });
      const operation = args.operation === "update" ? "update" : args.operation === "create" ? "create" : refuse("VALIDATION_FAILED", { problems: ["operation"] });
      const data = (args.data && typeof args.data === "object" && !Array.isArray(args.data) ? { ...args.data } : refuse("VALIDATION_FAILED", { problems: ["data"] })) as AnyDoc;
      // Showing an entry, or saying a review is real, is the owner's own act.
      for (const key of ["enabled", "confirmed_real", "confirmed_by", "confirmed_at", "drafted_by"]) {
        if (key in data) refuse("VALIDATION_FAILED", { problems: [`data.${key} is the owner's to set`] });
      }
      const source = typeof args.owner_source_text === "string" ? args.owner_source_text : null;
      if (source !== null && (source.length > 5000 || /<\s*\/?\s*[a-z!]/i.test(source))) refuse("VALIDATION_FAILED", { problems: ["owner_source_text"] });
      if (collection === "testimonials") {
        // #2829 — a review is only ever the traveller's words as the owner pasted them.
        if (!source || !source.trim()) refuse("OWNER_SOURCE_REQUIRED");
        const squash = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
        if (operation === "create" && typeof data.quote !== "string") refuse("QUOTE_REQUIRED");
        if (typeof data.quote === "string" && !squash(source).includes(squash(data.quote))) refuse("REVIEW_SOURCE_MISMATCH");
        if (typeof data.reviewer === "string" && !squash(source).includes(squash(data.reviewer))) refuse("REVIEW_SOURCE_MISMATCH");
        if (!data.source_note) data.source_note = "Pasted by the owner into Ari";
      } else {
        // Destination and story prose is checked like page copy (the pasted source counts as the owner's words).
        const texts = ["title", "tagline", "summary", "story_heading", "excerpt", "country"].map((key) => data[key]).filter((value): value is string => typeof value === "string");
        for (const key of ["body", "content"]) {
          if (typeof data[key] === "string") {
            texts.push(data[key]);
            data[key] = plainTextRichTree(data[key]);
          }
        }
        assertBacked(ctx, texts, [...ownerQuotes(cites), ...(source ? [source] : [])]);
      }
      const known = new Set((ctx.evidence?.offerings ?? []).map((row) => row.id));
      const named = [
        ...(Array.isArray(data.related_offerings) ? data.related_offerings.map((row: unknown) => String(typeof row === "string" ? row : (row as AnyDoc)?.offering_id ?? "")) : []),
        ...(typeof data.related_offering === "string" && data.related_offering ? [data.related_offering] : []),
      ];
      if (named.some((id) => !known.has(id.toLowerCase()))) refuse("OFFERING_NOT_FOUND");
      const request = {
        action: operation,
        siteId: ctx.siteId,
        brandId: ctx.brandId,
        userId: ctx.userId.toLowerCase(),
        rank: ctx.rank,
        args: { collection, data, ...(operation === "update" ? { id: args.entry_id, expected_revision: args.expected_revision } : {}) },
      };
      const scoped = scopedRequest(ctx.req, request, ctx.tenantId, operation === "create" ? { minglaAriDraft: true } : {});
      const saved = await runContentAction({ req: ctx.req, scoped, tenantId: ctx.tenantId, request }) as AnyDoc;
      const entry = saved.entry as AnyDoc;
      await writeWorkLog(ctx, { part: "collection", decision, cites, tool: "propose_site_collection_entry", target: `${collection}:${entry.id}`, revision: String(entry.revision ?? "") });
      return {
        collection,
        entry_id: entry.id,
        revision: entry.revision,
        shown_on_website: false,
        ...(collection === "testimonials" ? { confirmed_real: false, needs_owner_confirmation: true } : {}),
        draft_only: true,
      };
    }
  }
  return refuse("VALIDATION_FAILED");
}

/** Plain text → the site's closed rich-text tree (the content endpoint converts it to Lexical). */
function plainTextRichTree(value: string): Record<string, unknown> {
  const paragraphs = value.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return { type: "doc", children: paragraphs.map((text) => ({ type: "paragraph", children: [{ type: "text", text }] })) };
}

export const ARI_REFUSAL_CODES = new Set([
  "VALIDATION_FAILED", "REVISION_CONFLICT", "CLAIM_NOT_BACKED", "CITATION_REQUIRED", "CITATION_INVALID",
  "VARIANT_NOT_IN_DESIGN", "MEDIA_PROCESSING", "MEDIA_NOT_FOUND", "MEDIA_WRONG_KIND", "VIDEO_TOO_LONG",
  "OWNER_SOURCE_REQUIRED", "REVIEW_SOURCE_MISMATCH", "PAGE_NOT_FOUND", "PATH_COLLISION", "OFFERING_NOT_FOUND",
  "NOT_FOUND", "FORBIDDEN", "QUOTE_REQUIRED", "TITLE_REQUIRED", "SLUG_TAKEN", "CONTENT_LIMIT_EXCEEDED",
  "REVIEW_NOT_CONFIRMED",
]);
