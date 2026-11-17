/**
 * #4453 milestone 10 (spec v2.1 §2.2-§2.3) — Studio's plan preview: composer
 * v2 in a DRY RUN and the artifact builder in plan mode, in memory.
 *
 * For each style Core signed in, Studio composes the brand's plan exactly as
 * Build would (same composer, same inputs: the owner's own answers and
 * Mingla's facts), builds the artifact with the normal builder from those
 * in-memory documents, validates it with the normal contract plus the plan
 * marker, and writes ONE object to `plan-previews/{brand}/plan-{nonce}/{sha}.json`.
 *
 * I-SITES-PLAN-PREVIEW-WRITES-NOTHING: no Payload document is created or
 * changed (no tenant, page, setting, menu, media, work-log or nonce-free row);
 * the only writes are object-store keys under `plan-previews/`.
 *
 * Sample content (§2.5): for a kind the brand has ZERO live rows of, the plan
 * artifact carries that format's sample pack in `plan_samples` (never in the
 * offerings snapshot). Build never reads a sample pack.
 */
import type { PayloadRequest } from "payload";
import { assertArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { isFormatKey, styleFitLevel, type FormatKey } from "../contracts/generated/formats.ts";
import { isDesignKey, type DesignKey } from "../contracts/generated/designs.ts";
import {
  PLAN_PREVIEW_HOST,
  PLAN_PREVIEW_MAX_LIVE_OBJECTS,
  PLAN_PREVIEW_MAX_STYLES,
  PLAN_PREVIEW_PREFIX,
  SAMPLE_STRIP,
  parsePlanPreviewKey,
  planPreviewCacheMaterial,
  planPreviewFeedMaterial,
  planPreviewFresh,
  planPreviewKey,
  splitPlanArtifact,
  type PlanSamples,
} from "../contracts/generated/planPreview.ts";
import { buildPublicationArtifact, publicationDraftDigest, stable } from "./artifactBuilder";
import { composeFormatSite, type ComposeV2Result } from "./composeFormat";
import { inventoryAndSources, parseSignedDesignPass, type StudioRecords } from "./designPassInputs";
import type { FontPipelineDeps } from "./fontAssets";
import type { CoverRenditionDeps } from "./offeringCoverRenditions";
import { samplesFor } from "./samplePacks";
import { sha256 } from "./crypto";

type AnyDoc = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEED_KIND_FOR_FORMAT: Readonly<Partial<Record<FormatKey, "trip" | "event" | "experience" | "stay">>> = {
  trips: "trip", events: "event", experiences: "experience", hotels: "stay",
};

export type PlanPreviewBody = {
  brandId: string;
  planRevision: number;
  format: FormatKey;
  styles: DesignKey[];
  plan: AnyDoc;
  answers: AnyDoc;
  brand: { name: string; tagline: string | null; bio: string | null; contact_email: string | null; city: string | null };
  address: string | null;
  facts: AnyDoc;
  feed: AnyDoc;
  liveFingerprints: unknown[];
};

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** Core's signed body, checked key by key (anything unexpected is refused). */
export function parsePlanPreviewBody(body: unknown, envelopeScope: string): PlanPreviewBody | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const v = body as AnyDoc;
  const allowed = new Set(["kind", "brand_id", "plan_revision", "format", "styles", "plan", "answers", "brand", "address", "facts", "feed", "live_fingerprints"]);
  if (Object.keys(v).some((key) => !allowed.has(key))) return null;
  if (v.kind !== "plan_preview") return null;
  // The envelope's scope slot carries the brand id for this path (there may be no site yet).
  if (typeof v.brand_id !== "string" || !UUID.test(v.brand_id) || v.brand_id.toLowerCase() !== envelopeScope.toLowerCase()) return null;
  if (!Number.isInteger(v.plan_revision) || !isFormatKey(v.format)) return null;
  if (!Array.isArray(v.styles) || v.styles.length === 0 || v.styles.length > PLAN_PREVIEW_MAX_STYLES) return null;
  if (!v.styles.every(isDesignKey) || new Set(v.styles).size !== v.styles.length) return null;
  // Never a ✕ style for the format (Core refuses first; Studio refuses again).
  if ((v.styles as DesignKey[]).some((style) => styleFitLevel(v.format as FormatKey, style) === "avoid")) return null;
  const plan = v.plan && typeof v.plan === "object" && !Array.isArray(v.plan) ? v.plan as AnyDoc : null;
  const brand = v.brand && typeof v.brand === "object" && !Array.isArray(v.brand) ? v.brand as AnyDoc : null;
  const feed = v.feed && typeof v.feed === "object" && !Array.isArray(v.feed) ? v.feed as AnyDoc : null;
  if (!plan || !brand || !feed || !Array.isArray(feed.offerings)) return null;
  const name = text(brand.name, 120);
  if (!name) return null;
  return {
    brandId: v.brand_id.toLowerCase(),
    planRevision: v.plan_revision as number,
    format: v.format,
    styles: v.styles as DesignKey[],
    plan,
    answers: v.answers && typeof v.answers === "object" ? v.answers as AnyDoc : {},
    brand: {
      name,
      tagline: text(brand.tagline, 300),
      bio: typeof brand.bio === "string" && brand.bio.trim() ? brand.bio.slice(0, 5000) : null,
      contact_email: text(brand.contact_email, 254),
      city: text(brand.city, 120),
    },
    address: text(v.address, 300),
    facts: v.facts && typeof v.facts === "object" ? v.facts as AnyDoc : {},
    feed,
    liveFingerprints: Array.isArray(v.live_fingerprints) ? v.live_fingerprints.slice(0, 500) : [],
  };
}

/** Before any site exists Studio holds no records for the brand. */
const NO_RECORDS: StudioRecords = { photos: [], destination_ids: [], stories: 0, confirmed_reviews: 0, ready_videos: 0, has_logo: false } as StudioRecords;

/**
 * The plan's composition for one style: the SAME composer and inputs Build
 * uses (SC-PP4), plus — for the preview only — sample counts for a kind the
 * brand has none of, so its listing section is drawn with labelled samples.
 */
export function composePlan(body: PlanPreviewBody, style: DesignKey): { composed: ComposeV2Result | null; samples: PlanSamples | null } {
  const liveKinds = new Set((body.feed.offerings as AnyDoc[]).map((row) => String(row?.kind)));
  const kind = FEED_KIND_FOR_FORMAT[body.format];
  const listings = kind ? samplesFor(body.format, liveKinds) : [];
  const facts = structuredClone(body.facts) as AnyDoc;
  if (listings.length && kind && kind !== "stay") {
    const upcoming = (facts.upcoming && typeof facts.upcoming === "object" ? facts.upcoming : {}) as AnyDoc;
    facts.upcoming = { ...upcoming, [kind]: listings.length };
  } else if (listings.length && kind === "stay") {
    facts.live_stay_offerings = listings.length;
  }
  const signed = parseSignedDesignPass({
    design_key: style,
    plan: body.plan,
    answers: body.answers,
    address: body.address,
    facts,
    style_library: true,
    live_fingerprints: body.liveFingerprints,
  });
  if (!signed?.plan) return { composed: null, samples: null };
  const { inventory, sources } = inventoryAndSources({
    signed,
    records: NO_RECORDS,
    offerings_selected: signed.plan.offerings_selected,
    brand: body.brand,
    cover_media_id: null,
  });
  const composed = composeFormatSite({
    plan: signed.plan,
    answers: signed.answers,
    brand: body.brand,
    design: style,
    inventory,
    sources,
    existing: [],
    currentWordmark: null,
  });
  return { composed, samples: listings.length ? { strip: SAMPLE_STRIP, listings } : null };
}

/** The `type:variant` sequence of every page (SC-PP4 compares a Build with its preview). */
export function pageSequence(composed: ComposeV2Result): { slug: string; blocks: string[] }[] {
  return composed.pages.map((page) => ({
    slug: page.slug,
    blocks: (page.blocks as AnyDoc[]).map((block) => `${String(block.blockType)}:${String(block.variant ?? block.layout ?? "")}`),
  }));
}

export type PlanPreviewStore = {
  write(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<{ key: string; lastModified: string }[]>;
  remove(key: string): Promise<void>;
};

export type PlanPreviewDeps = {
  store: PlanPreviewStore;
  fontPipeline?: FontPipelineDeps;
  /** The request whose Payload serves fonts (no document is written through it). */
  req: PayloadRequest;
  now?: () => Date;
  nonce?: () => string;
};

export type PlanPreviewResult = {
  style: DesignKey;
  key: string;
  pages: { path: string; title: string }[];
  page_labels: string[];
  has_samples: boolean;
};

/** Covers are not re-encoded for a plan preview (nothing is written outside plan-previews/). */
const NO_COVER_RENDITIONS: CoverRenditionDeps = {
  fetchCover: async () => null,
  readStored: async () => null,
  writeStored: async () => { throw new Error("PLAN_PREVIEW_WRITES_NOTHING"); },
};

/** Builds one style's plan artifact in memory (validated, not stored). */
export async function buildPlanArtifact(body: PlanPreviewBody, style: DesignKey, deps: PlanPreviewDeps, generatedAt: string): Promise<{ serialized: string; result: Omit<PlanPreviewResult, "key"> }> {
  const { composed, samples } = composePlan(body, style);
  if (!composed) throw new Error("PLAN_NOT_READY");
  const ids = new Map(composed.pages.map((page, index) => [page.slug, `plan-page-${index}`]));
  const pages = composed.pages.map((page) => ({
    id: ids.get(page.slug), tenant: "plan", slug: page.slug, title: page.title, kind: page.kind, enabled: true, blocks: page.blocks,
    ...(page.collection_kind ? { collection_kind: page.collection_kind } : {}),
  }));
  const navigation = {
    id: "plan-nav", tenant: "plan", wordmark: composed.wordmark, header_variant: composed.header_variant,
    items: composed.menu.items.filter((item) => ids.has(item.slug)).map((item) => ({ label: item.label, target_type: "page", page: ids.get(item.slug) })),
    ...(composed.header_cta && ids.has(composed.header_cta.slug) ? { header_cta: { label: composed.header_cta.label, target_type: "page", page: ids.get(composed.header_cta.slug) } } : {}),
  };
  const settings = { id: "plan-settings", tenant: "plan", display_name: body.brand.name, design: style };
  const footer = { id: "plan-footer", tenant: "plan" };
  const content = { destinations: [], stories: [], categories: [], testimonials: [] };
  const collections: Record<string, unknown[]> = { pages, navigation: [navigation], footer: [footer], "site-settings": [settings], media: [], ...content };
  const sourceDigest = await publicationDraftDigest({ pages, navigation, footer, settings, media: [], content } as never);
  // An in-memory Payload for the site's own documents; fonts still come from Studio's font store.
  const memoryPayload = new Proxy(deps.req.payload, {
    get(target, prop, receiver) {
      if (prop === "find") {
        return async (args: { collection: string }) => {
          if (args.collection in collections) return { docs: collections[args.collection], totalDocs: collections[args.collection]!.length, hasNextPage: false };
          return (target as unknown as { find: (a: unknown) => Promise<unknown> }).find(args);
        };
      }
      if (prop === "create" || prop === "update" || prop === "delete") {
        return async () => { throw new Error("PLAN_PREVIEW_WRITES_NOTHING"); };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const feedRows = body.feed.offerings as AnyDoc[];
  const byId = new Map(feedRows.map((row) => [String(row.id).toLowerCase(), row]));
  const req = { ...deps.req, context: { ...(deps.req.context ?? {}) }, payload: memoryPayload } as unknown as PayloadRequest;
  const built = await buildPublicationArtifact(req, {
    tenant: { id: "plan", core_site_id: body.brandId, core_brand_id: body.brandId, primary_hostname: PLAN_PREVIEW_HOST },
    operationId: crypto.randomUUID(),
    publicationId: crypto.randomUUID(),
    sourceRevisionId: `plan-${body.planRevision}`,
    sourceDigest,
    generatedAt,
    fontPipeline: deps.fontPipeline,
    coverRenditions: NO_COVER_RENDITIONS,
    planMode: {
      projection: {
        feed: body.feed,
        menu: [],
        menu_venue_id: null,
        // Blocks that name a Mingla offering get its own row from the brand's feed (never invented).
        offerings: [...collectOfferingIds(pages)].flatMap((id) => {
          const row = byId.get(id);
          return row ? [{ id: row.id, kind: row.kind, title: row.title, summary: row.summary ?? null, url: row.public_url }] : [];
        }),
      },
    },
  });
  const artifact = JSON.parse(built.serialized) as AnyDoc;
  assertArtifactV2(artifact);
  const plan: AnyDoc = { ...artifact, preview_kind: "plan", ...(samples ? { plan_samples: samples } : {}) };
  // The plan validator: the marker, well-formed samples, and an ordinary v2 body.
  splitPlanArtifact(plan);
  const enabledPages = (artifact.pages as AnyDoc[]).filter((page) => page.enabled !== false);
  const menuLabels = composed.menu.items.map((item) => item.label);
  return {
    serialized: stable(plan),
    result: {
      style,
      pages: enabledPages.map((page) => ({ path: String(page.path ?? ""), title: String(page.title ?? "") })).slice(0, 12),
      page_labels: ["Home", ...menuLabels.filter((label) => label !== "Home")],
      has_samples: samples !== null,
    },
  };
}

function collectOfferingIds(pages: AnyDoc[]): Set<string> {
  const out = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (depth > 12 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const entry of value) walk(entry, depth + 1); return; }
    for (const [key, entry] of Object.entries(value as AnyDoc)) {
      if ((key === "offering_id" || key === "offering") && typeof entry === "string" && UUID.test(entry)) out.add(entry.toLowerCase());
      else walk(entry, depth + 1);
    }
  };
  for (const page of pages) walk(page.blocks, 0);
  return out;
}

function randomHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The whole request: cached keys within 24 h, else compose, build, validate
 * and store each style; then keep at most 9 live objects for the brand.
 */
export async function runPlanPreview(body: PlanPreviewBody, deps: PlanPreviewDeps): Promise<{ previews: PlanPreviewResult[]; cached: boolean; generated_at: string; has_samples: boolean }> {
  const now = deps.now?.() ?? new Date();
  const generatedAt = now.toISOString();
  const story = body.plan.story && typeof body.plan.story === "object" ? body.plan.story as AnyDoc : null;
  const takenDigest = await sha256(JSON.stringify(body.liveFingerprints));
  const previews: PlanPreviewResult[] = [];
  let cachedAll = true;
  for (const style of body.styles) {
    const cacheId = await sha256(planPreviewCacheMaterial({
      plan_revision: body.planRevision,
      brand_name: body.brand.name,
      logo_digest: null,
      feed_digest: planPreviewFeedMaterial(body.feed),
      style,
      format: body.format,
      main_action: typeof story?.main_action === "string" ? story.main_action : null,
      taken_digest: takenDigest,
    }) + `|${await sha256(stable({ plan: body.plan, answers: body.answers, facts: body.facts, brand: body.brand, address: body.address }))}`);
    const indexKey = `${PLAN_PREVIEW_PREFIX}${body.brandId}/cache-${cacheId}.json`;
    const index = await deps.store.read(indexKey).catch(() => null);
    if (index) {
      try {
        const hit = JSON.parse(new TextDecoder().decode(index)) as AnyDoc;
        const parsed = parsePlanPreviewKey(typeof hit.key === "string" ? hit.key : null);
        if (parsed && parsed.brandId === body.brandId && planPreviewFresh(hit.generated_at, now.getTime()) && (await deps.store.read(parsed.key).catch(() => null))) {
          previews.push({ ...(hit.result as Omit<PlanPreviewResult, "key">), style, key: parsed.key });
          continue;
        }
      } catch {
        // A damaged index is a miss (the preview is built again).
      }
    }
    cachedAll = false;
    const { serialized, result } = await buildPlanArtifact(body, style, deps, generatedAt);
    const bytes = new TextEncoder().encode(serialized);
    const key = planPreviewKey(body.brandId, deps.nonce?.() ?? randomHex(), await sha256(serialized));
    await deps.store.write(key, bytes);
    const readback = await deps.store.read(key);
    if (!readback || (await sha256(readback)) !== key.split("/").pop()!.replace(".json", "")) throw new Error("ARTIFACT_DIGEST_MISMATCH");
    await deps.store.write(indexKey, new TextEncoder().encode(JSON.stringify({ key, generated_at: generatedAt, result })));
    previews.push({ ...result, key });
  }
  if (!cachedAll) await prunePlanPreviews(deps.store, body.brandId);
  return { previews, cached: cachedAll, generated_at: generatedAt, has_samples: previews.some((preview) => preview.has_samples) };
}

/** At most 9 live plan objects per brand: the oldest are deleted (and their cache entries). */
export async function prunePlanPreviews(store: PlanPreviewStore, brandId: string): Promise<string[]> {
  const listed = await store.list(`${PLAN_PREVIEW_PREFIX}${brandId}/`);
  const objects = listed.filter((row) => parsePlanPreviewKey(row.key)?.brandId === brandId)
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified) || b.key.localeCompare(a.key));
  const stale = objects.slice(PLAN_PREVIEW_MAX_LIVE_OBJECTS);
  if (!stale.length) return [];
  const cutoff = objects[PLAN_PREVIEW_MAX_LIVE_OBJECTS - 1]!.lastModified;
  const staleIndexes = listed.filter((row) => /\/cache-[0-9a-f]{64}\.json$/.test(row.key) && row.lastModified < cutoff);
  for (const row of [...stale, ...staleIndexes]) await store.remove(row.key);
  return stale.map((row) => row.key);
}
