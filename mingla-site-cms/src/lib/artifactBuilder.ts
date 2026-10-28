import type { PayloadRequest } from "payload";
import { cmsConfig } from "./config";
import { emitCmsObservation } from "./observability";
import { hmac, sha256 } from "./crypto";
import { readCoreProjection } from "./gateway";
import { readObject, writeObject } from "./objectStore";
import { findAllTenantPages } from "./tenantPages";
import { richTextToAst } from "./richTextToAst";
import { contentForDigest, findTenantContent, shapeSiteCollections, siteDisplayOf, type TenantContent } from "./siteContent";
import {
  assertNoPathCollision,
  isHomePage,
  siteRouting,
  tenantPagePaths,
} from "./pageTree";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { upgradeV1ToV2 } from "../contracts/generated/upgradeV1ToV2.ts";
import { parseOfferingsFeed, type SiteOffering } from "../contracts/generated/offerings.ts";
import { ATELIER, designFor, variantAfterDesignSwitch, type DesignDefinition } from "../contracts/generated/designs.ts";
import { isBlockType } from "../contracts/generated/blocks.ts";
import { resolveTokens } from "../contracts/generated/tokens.ts";
import { resolveFontSlots } from "../contracts/generated/fontSlots.ts";
import { catalogWeights } from "../contracts/generated/fontCatalog.ts";
import { resolveSiteFonts, type FontPipelineDeps, type FontWarning } from "./fontAssets";
import { payloadFontPipeline } from "./fontAssetStore";
import { ownerFontsOf, ownerTokensOf } from "./siteLook";
import { fileVideoIntegrity, fitsHero, isFileVideoRecord, isStreamVideoRecord, streamVideoRef } from "./siteVideoRefs";
import type { FileVideoIntegrity, StreamVideoRef } from "../contracts/generated/video.ts";
import { offeringCoverRenditions, MAX_COVER_SOURCE_BYTES, type CoverRenditionDeps } from "./offeringCoverRenditions";

/*
 * #3149 wave 4 — where Mingla's own guest-facing flows live. Named once so a
 * published button can only ever be a canonical Mingla address; the public
 * contract refuses anything that is not.
 */
const MINGLA_HOST_ORIGIN = "https://host.usemingla.com";

/*
 * #3149 wave 5 — the shape a Mingla slug is allowed to have before it may
 * become a path segment. Letters, digits and inner hyphens, nothing else: no
 * separator, no dot, no space, no empty string. Anything Mingla hands back that
 * does not match is treated as ABSENT rather than escaped, because a slug that
 * needs escaping is not a slug and the honest answer is to publish no link.
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;

function slugOf(value: unknown): string | null {
  return typeof value === "string" && SLUG_RE.test(value) ? value : null;
}

// Payload documents are generated dynamically from the closed collection
// schema; this private normalizer deliberately handles their heterogeneous
// field values before emitting the strictly validated public artifact.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = Record<string, any>;
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, field]) => field !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field]) => `${JSON.stringify(key)}:${stable(field)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** #2829 — the renderer the builder produces until the W3 sites-v2 builder. */
export const V1_RENDERER_KEY = "restaurant-website-v1" as const;

/** #2829 — `https://<tenant.primary_hostname>`, or undefined when unknown. */
export function tenantCanonicalUrl(tenant: { primary_hostname?: unknown }): string | undefined {
  const host = tenant?.primary_hostname;
  return typeof host === "string" &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
    ? `https://${host}`
    : undefined;
}

export async function publicationDraftDigest(input: {
  pages: unknown[];
  navigation: unknown | null;
  footer: unknown | null;
  settings: unknown;
  media: unknown[];
  /**
   * #2829 W5 — the destinations, stories, categories and testimonials the
   * publish will freeze (siteContent.ts). Covered so an edit to any of them
   * between preview/validate and publish is a REVISION_CONFLICT. Absent when
   * the tenant has none, so earlier sites keep their digest.
   */
  content?: TenantContent;
}): Promise<string> {
  const content = contentForDigest(input.content);
  return sha256(stable({
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    pages: input.pages,
    navigation: input.navigation,
    footer: input.footer,
    settings: input.settings,
    media: input.media,
    ...(content ? { content } : {}),
  }));
}
function id(value: unknown): string {
  return typeof value === "object" && value
    ? String((value as AnyDoc).id)
    : String(value || "");
}
export function lexicalText(value: unknown): string[] {
  const result: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const item = node as AnyDoc;
    if (typeof item.text === "string") result.push(item.text);
    if (Array.isArray(item.children)) {
      const before = result.length;
      item.children.forEach(walk);
      if (result.length > before) result.push("\n");
    }
  };
  /*
   * #2830 — Payload stores rich text as `{ root: { children: [...] } }`, so a
   * walk that starts at the stored value finds neither `text` nor `children`
   * on it and returns NOTHING. Every rich_text block published an empty
   * `paragraphs: []`, the artifact contract requires at least one, and the
   * publish failed closed with ARTIFACT_BLOCK_CONTENT_MISMATCH.
   *
   * That means no page carrying a rich_text block could EVER be published.
   * It went unseen because the pilot had no rich_text block until now.
   *
   * `?? value` keeps a bare root node working, so a caller that already
   * unwrapped is unaffected.
   */
  walk((value as AnyDoc)?.root ?? value);
  const paragraphs = result
    .join("")
    .split("\n")
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 30);
  if (
    paragraphs.some((text) => text.length > 2_000) ||
    paragraphs.reduce((total, text) => total + text.length, 0) > 20_000
  ) throw new Error("VALIDATION_FAILED");
  return paragraphs;
}

async function tenantRequest(
  req: PayloadRequest,
  tenant: AnyDoc,
): Promise<PayloadRequest> {
  return {
    ...req,
    context: {
      ...req.context,
      minglaSignedCore: true,
      minglaInternalTenantId: String(tenant.id),
    },
    user: {
      id: crypto.randomUUID(),
      collection: "studio-users",
      siteId: tenant.core_site_id,
      brandId: tenant.core_brand_id,
      tenantId: tenant.id,
      rank: 60,
      tenants: [{ tenant: tenant.id }],
    // Payload's TypedUser union cannot express fields added by our custom
    // session strategy, though the collection and access hooks require them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

/*
 * #2829 W7c (A13.1) — where the builder reads a stored offering cover (Mingla's
 * public cover storage on the configured Core origin, never a host from a
 * request; no redirects; capped) and keeps its renditions (Sites storage).
 */
export function storageCoverRenditionDeps(): CoverRenditionDeps {
  return {
    async fetchCover(path) {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`${cmsConfig().coreBaseUrl}/storage/v1/object/public/${encoded}`, { redirect: "manual", cache: "no-store" });
      if (response.status !== 200) return null;
      if (Number(response.headers.get("content-length") ?? "0") > MAX_COVER_SOURCE_BYTES) return null;
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "" };
    },
    async readStored(key) {
      try {
        return await readObject(cmsConfig().approvedBucket, key);
      } catch {
        return null;
      }
    },
    async writeStored(key, bytes) {
      await writeObject(cmsConfig().approvedBucket, key, bytes, "image/webp");
    },
  };
}

/** #2829 W3 — what a build produced, and what Core must record about it. */
export type BuiltPublication = {
  artifact: ArtifactV2;
  serialized: string;
  artifactKey: string;
  artifactDigest: string;
  generation: { artifact_schema_version: 2; renderer_key: "sites-v2"; design_key: string; design_version: number };
  fontWarnings: FontWarning[];
};

/**
 * #2829 W3 — builds the v2 (`sites-v2`) artifact for a publish or preview.
 *
 * The page content is shaped exactly as before (the same block rules, menu
 * projection and media manifest — the v1 shape is now an internal
 * intermediate), then re-expressed as v2 under the site's design: each block
 * carries its layout, the tokens are the design's defaults plus the owner's
 * exact choices, and the chosen Google fonts are fetched once and listed as
 * first-party files. No new publish produces a v1 artifact; rollback of an
 * earlier v1 publication copies it unchanged (buildRollbackPublicationArtifact).
 */
export async function buildPublicationArtifact(
  req: PayloadRequest,
  input: {
    tenant: AnyDoc;
    operationId: string;
    publicationId: string;
    sourceRevisionId: string;
    sourceDigest: string;
    generatedAt: string;
    /** Where fonts are fetched and cached (tests pass an offline pipeline). */
    fontPipeline?: FontPipelineDeps;
    /** #2829 W7c — where offering covers are read and their renditions kept (tests pass fakes). */
    coverRenditions?: CoverRenditionDeps;
  },
): Promise<BuiltPublication> {
  const scopedReq = await tenantRequest(req, input.tenant);
  const query = { tenant: { equals: input.tenant.id } };
  const [
    pagesResult,
    navigationResult,
    footerResult,
    settingsResult,
    mediaResult,
    content,
  ] = await Promise.all([
    // #2829 — every page, never a capped read (the six-page bug).
    findAllTenantPages(scopedReq, input.tenant.id)
      .then((docs) => ({ docs })),
    req.payload.find({
      collection: "navigation",
      where: query,
      overrideAccess: false,
      req: scopedReq,
      depth: 0,
      draft: true,
      limit: 1,
    }),
    req.payload.find({
      collection: "footer",
      where: query,
      overrideAccess: false,
      req: scopedReq,
      depth: 0,
      draft: true,
      limit: 1,
    }),
    req.payload.find({
      collection: "site-settings",
      where: query,
      overrideAccess: false,
      req: scopedReq,
      depth: 0,
      draft: true,
      limit: 1,
    }),
    req.payload.find({
      collection: "media",
      where: { and: [query, { state: { equals: "READY" } }] },
      overrideAccess: false,
      req: scopedReq,
      depth: 0,
      limit: 500,
      sort: "id",
    }),
    // #2829 W5 — every destination, story, category and testimonial.
    findTenantContent(scopedReq, input.tenant.id),
  ]);
  const settings = settingsResult.docs[0] as AnyDoc | undefined;
  // #2829 W3 — the site's design (atelier when none is chosen).
  const design: DesignDefinition = designFor(settings?.design) ?? ATELIER;
  const home = pagesResult.docs.find((page: AnyDoc) => isHomePage(page));
  if (!settings || !home || home.enabled !== true)
    throw new Error("VALIDATION_FAILED");
  // #2829 W2 — every page's address from the tree (refuses a broken tree).
  const pagePaths = tenantPagePaths(pagesResult.docs);
  const routing = siteRouting(settings);
  const observedDraftDigest = await publicationDraftDigest({
    pages: pagesResult.docs,
    navigation: navigationResult.docs[0] ?? null,
    footer: footerResult.docs[0] ?? null,
    settings,
    media: mediaResult.docs,
    content,
  });
  if (observedDraftDigest !== input.sourceDigest) {
    throw new Error("REVISION_CONFLICT");
  }
  const media = new Map(
    mediaResult.docs.map((item: AnyDoc) => [String(item.id), item]),
  );
  // #2829 W6 (AD-9) — every file video's chunk digests and length, frozen
  // into the publication so the runtime can answer byte ranges verified per
  // chunk. Read from the approval record (or, for a video approved before W6,
  // computed once here from its verified stored bytes).
  const videoIntegrity = new Map<string, FileVideoIntegrity>();
  for (const record of mediaResult.docs as AnyDoc[]) {
    if (isFileVideoRecord(record)) {
      videoIntegrity.set(
        String(record.id),
        await fileVideoIntegrity(record, (key) => readObject(cmsConfig().approvedBucket, key)),
      );
    }
  }
  const streamVideos = new Map<string, StreamVideoRef>();
  // #2829 W4 — a grid with "Which dates" chosen is LIVE: its offerings come
  // from Mingla's feed at request time, so only the original (fixed) grids
  // still resolve their ids through the commercial projection.
  const isLiveGrid = (block: AnyDoc) =>
    block.blockType === "offering_grid" && typeof block.mode === "string" && block.mode.length > 0;
  const offeringIds = new Set<string>();
  // #2829 W5 — the trips-we've-run ledger, reviews linked to trips and a
  // destination's trips read the same live feed, so its snapshot is frozen too
  // (the fallback when Core is unreachable).
  let wantsFeed = content.destinations.some((doc: AnyDoc) => Array.isArray(doc.related_offerings) && doc.related_offerings.length > 0);
  for (const page of pagesResult.docs as AnyDoc[])
    for (const block of page.blocks || []) {
      if (isLiveGrid(block) || block.blockType === "offering_history" || (block.blockType === "testimonials" && block.from_collection === true)) {
        wantsFeed = true;
        continue;
      }
      for (const row of block.offering_ids || [])
        if (row.offering_id) offeringIds.add(String(row.offering_id));
    }
  // #2830 — does any page show the menu? Only then do we read one.
  let wantsMenu = false;
  for (const page of pagesResult.docs as AnyDoc[])
    for (const block of page.blocks || [])
      /*
       * #3149 wave 4 — either block shows a menu, so either block is a reason
       * to read one. Without the second slug a page carrying only the taster
       * would project an empty menu and drop its own block.
       *
       * Written as two comparisons rather than an array membership test
       * because the menu-authority suite pins this exact expression: it is how
       * "the menu is read ONLY when a page actually shows one" is asserted,
       * and that assertion must keep matching.
       */
      if (
        block.blockType === "menu_board" || block.blockType === "menu_preview"
      ) wantsMenu = true;
  /*
   * #3149 wave 5 — does any page carry a booking button? Only then are the
   * venue slugs read, on the same principle as the menu above. Kept as its own
   * loop rather than folded into the one above because that expression is
   * pinned by the menu-authority suite.
   */
  let wantsVenue = false;
  for (const page of pagesResult.docs as AnyDoc[])
    for (const block of page.blocks || [])
      if (block.blockType === "venue_reservation") wantsVenue = true;
  let commercial: AnyDoc[] = [];
  let menuRows: AnyDoc[] = [];
  let menuVenueId: string | null = null;
  let venueSlug: string | null = null;
  let brandSlug: string | null = null;
  let offeringsSnapshot: SiteOffering[] = [];
  if (offeringIds.size || wantsMenu || wantsVenue || wantsFeed) {
    const projection = await readCoreProjection(
      `/internal/v1/sites/${input.tenant.core_site_id}/projection`,
      input.tenant.core_site_id,
      input.operationId,
      [...offeringIds],
      wantsMenu,
      wantsVenue,
      wantsFeed,
    );
    /*
     * #2829 W4 — the feed as it is at publish, frozen as the fallback the
     * site renders from when Core cannot be reached. Ended and cancelled
     * offerings are part of it and never fail a publish (R-13); the feed
     * must be readable, though: no snapshot, no publish.
     */
    if (wantsFeed) {
      try {
        offeringsSnapshot = parseOfferingsFeed(projection.feed).offerings;
      } catch {
        throw new Error("VALIDATION_FAILED");
      }
    }
    commercial = Array.isArray(projection.offerings)
      ? (projection.offerings as AnyDoc[])
      : [];
    if (commercial.length !== offeringIds.size)
      throw new Error("VALIDATION_FAILED");
    menuRows = Array.isArray(projection.menu)
      ? (projection.menu as AnyDoc[])
      : [];
    menuVenueId = typeof projection.menu_venue_id === "string"
      ? projection.menu_venue_id
      : null;
    /*
     * #3149 wave 5 — VALIDATED, not merely copied. These two strings are about
     * to become path segments on Mingla's own host, so anything that is not a
     * plain slug is treated as absent: a value carrying a `/`, a `.` or a space
     * would not address the page it claims to and could walk out of `/b/../v/`
     * into another surface entirely. A rejected slug fails the block closed,
     * exactly as a missing one does.
     */
    venueSlug = slugOf(projection.venue_slug);
    brandSlug = slugOf(projection.brand_slug);
  }
  /*
   * Group Mingla's flat rows into the sections the renderer draws. The order is
   * Mingla's own (menu sort, then item sort), never re-sorted here — a brand
   * that arranged its menu in the app must see that arrangement on its site.
   *
   * A price stays NULL when Mingla has none, and currency travels per row.
   * Neither is defaulted: "price on request" is a real thing on gogi's printed
   * menu, and inventing a 0 or a currency on a restaurant's own menu is a live
   * commercial lie, not a cosmetic default.
   */
  const menuSections = (() => {
    const sections = new Map<string, AnyDoc>();
    for (const row of menuRows) {
      const key = String(row.menu_id);
      let section = sections.get(key);
      if (!section) {
        section = {
          name: String(row.menu_name ?? ""),
          description: row.menu_description ?? null,
          items: [] as AnyDoc[],
        };
        sections.set(key, section);
      }
      (section.items as AnyDoc[]).push({
        // The Mingla menu-item id. The cart sends THIS and a quantity, never a
        // price — the order is priced by Mingla, so a browser cannot name its
        // own price.
        id: String(row.item_id),
        name: String(row.item_name ?? ""),
        description: row.item_description ?? null,
        price_minor: typeof row.price_cents === "number" ? row.price_cents : null,
        currency: typeof row.currency === "string" ? row.currency : null,
      });
    }
    return [...sections.values()].filter(
      (section) => (section.items as AnyDoc[]).length > 0,
    );
  })();
  /*
   * #2830 — a video's public URL. It carries no width because there are no
   * renditions: there is no ffmpeg here, so the file is served exactly as the
   * brand uploaded it. `renderMedia` cannot be reused — it demands a rendition
   * manifest with widths and would throw on every video.
   */
  const videoReference = (record: AnyDoc) => {
    const master = record.rendition_manifest?.master;
    const integrity = videoIntegrity.get(String(record.id));
    if (!integrity) throw new Error("MEDIA_PROCESSING");
    return {
      id: String(record.id),
      // #2829 — relative: the runtime serves media on whichever host the
      // site is reached on, so no brand's address is baked into an artifact.
      url: `/media/${record.id}/video.mp4`,
      alt: "",
      // A video carries no rendered dimensions here; the poster supplies the
      // layout box. Zero is the honest value, not a guessed 1920x1080.
      width: 0,
      height: 0,
      integrity: String(master?.digest),
      object_key: String(master?.key),
      bytes: integrity.bytes,
      chunk_size: integrity.chunk_size,
      chunk_digests: integrity.chunk_digests,
      ...(integrity.duration_ms === undefined ? {} : { duration_ms: integrity.duration_ms }),
    };
  };
  const isVideoRecord = (record: AnyDoc | undefined) => isFileVideoRecord(record);
  // #2829 W6 — a block's video: this site's file video, or a ready stream
  // video (frozen into `stream_videos`). Anything else plays nothing.
  const renderVideo = (mediaId: unknown): string | null => {
    const record = media.get(id(mediaId));
    if (isStreamVideoRecord(record)) {
      const ref = streamVideoRef(record as AnyDoc);
      streamVideos.set(ref.id, ref);
      return ref.url;
    }
    if (!isVideoRecord(record)) return null;
    return videoReference(record as AnyDoc).url;
  };
  const videoLength = (mediaId: unknown): unknown => {
    const record = media.get(id(mediaId));
    if (isStreamVideoRecord(record)) return record?.duration_ms;
    return videoIntegrity.get(id(mediaId))?.duration_ms;
  };
  // A hero's background video: none while it is not ready (the still shows);
  // refused when longer than 15 seconds.
  const heroVideo = (mediaId: unknown): string | null => {
    const url = renderVideo(mediaId);
    if (url !== null && !fitsHero(videoLength(mediaId))) throw new Error("VALIDATION_FAILED");
    return url;
  };
  const renderMedia = (mediaId: unknown, alt = "") => {
    const record = media.get(id(mediaId));
    if (!record || record.state !== "READY" || !record.rendition_manifest)
      throw new Error("MEDIA_PROCESSING");
    const rendition =
      record.rendition_manifest.renditions?.find(
        (item: AnyDoc) => item.width >= 1440,
      ) || record.rendition_manifest.renditions?.at(-1);
    return {
      id: String(record.id),
      url: `/media/${record.id}/${rendition?.target_width || 960}.webp`,
      alt,
      width: Number(rendition?.width || record.width),
      height: Math.round(
        (Number(record.height) * Number(rendition?.width || record.width)) /
          Number(record.width),
      ),
      integrity: String(rendition?.digest),
      object_key: String(rendition?.key),
    };
  };
  /*
   * #2829 W7b — the picture's extra renditions (4:3 crops, 1600 wide) for a
   * design's `srcset`, on the site's media list only (blocks keep their one
   * URL). Media approved before W7b has none and is served as before.
   */
  const withVariants = (ref: ReturnType<typeof renderMedia>, record: AnyDoc) => {
    const rows = Array.isArray(record.rendition_manifest?.variants) ? record.rendition_manifest.variants as AnyDoc[] : [];
    const variants = rows
      .filter((row) => ["c400", "c768", "w1600"].includes(String(row.name)))
      .map((row) => ({
        name: String(row.name),
        url: `/media/${record.id}/${row.name}.webp`,
        width: Number(row.width),
        height: Number(row.height),
        integrity: String(row.digest),
        object_key: String(row.key),
      }));
    return variants.length ? { ...ref, variants } : ref;
  };
  // #2829 W5 — the site's own content, frozen into this publication.
  const siteCollections = shapeSiteCollections(content, (mediaId, alt) => renderMedia(mediaId, alt));
  const destinationSlugById = new Map(siteCollections.destinations.map((row) => [row.id, row.slug]));
  const categorySlugById = new Map(siteCollections.categories.map((row) => [row.id, row.slug]));
  const publishedTestimonials = new Set(siteCollections.testimonials.map((row) => row.id));
  /*
   * #3149 — carry the brand's own eyebrow, or carry NOTHING.
   *
   * The artifact contract forbids unknown keys and the publication digest is
   * taken over the serialised artifact, so an unset eyebrow must not surface
   * as `""` or `null`: an empty string is a value the renderer would then have
   * to second-guess, and either one changes the bytes of every artifact ever
   * published, which would make a republish look like a content change.
   * Absent means absent.
   */
  const optionalText = (value: unknown, key: string) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed ? { [key]: trimmed } : {};
  };
  /*
   * #3149 wave 4 — the same "absent means absent" rule for the values that are
   * not text.
   *
   * A Payload number field that was never filled in arrives as null, and a
   * checkbox that was never ticked can arrive as null OR false depending on
   * how the row was written. Publishing `preview_count: null` or
   * `always_open: false` would put a key in the artifact that the contract
   * accepts but the renderer must then second-guess, AND would change the
   * bytes of every artifact ever published — which makes a republish look like
   * a content change to anything comparing digests.
   */
  const optionalNumber = (value: unknown, key: string) =>
    typeof value === "number" && Number.isFinite(value) ? { [key]: value } : {};
  const optionalFlag = (value: unknown, key: string) =>
    value === true ? { [key]: true } : {};
  const optionalCta = (raw: AnyDoc) => ({
    ...optionalText(raw.cta_label, "cta_label"),
    ...optionalText(raw.cta_href, "cta_href"),
  });
  // #2829 W3 — every block carries its layout: the variant Studio stored when
  // the design draws it, otherwise the design's default for that type.
  const blocks = (source: AnyDoc[]) =>
    source.map((raw) => {
      const shaped = shapeBlock(raw);
      return shaped && isBlockType(raw.blockType)
        ? { ...shaped, variant: variantAfterDesignSwitch(design, raw.blockType, typeof raw.variant === "string" ? raw.variant : null) }
        : shaped;
    });
  const shapeBlock = (raw: AnyDoc) => {
      const eyebrow = optionalText(raw.eyebrow, "eyebrow");
      switch (raw.blockType) {
        case "hero":
          return {
            type: "hero",
            ...eyebrow,
            heading: raw.heading,
            // #2829 W7 — the headline line by line, and the trip search.
            ...((raw.heading_lines || []).some((row: AnyDoc) => typeof row.text === "string" && row.text.trim())
              ? { heading_lines: (raw.heading_lines || []).filter((row: AnyDoc) => typeof row.text === "string" && row.text.trim()).map((row: AnyDoc) => ({ text: row.text })) }
              : {}),
            ...optionalFlag(raw.show_search, "show_search"),
            subheading: raw.subheading,
            media_url: renderMedia(raw.media, "").url,
            // Optional, and never a replacement for the still above. A hero
            // loop is at most 15 seconds (#2829 W6; refused on save too).
            video_url: raw.video ? heroVideo(raw.video) : null,
            ctas: (raw.ctas || []).map((row: AnyDoc) => ({
              label: row.label,
              href: row.href,
            })),
          };
        case "rich_text":
          return {
            type: "rich_text",
            ...eyebrow,
            heading: raw.heading,
            /*
             * #2829 W7 — the writing keeps its structure (headings, lists,
             * links, bold) as the safe rich-text tree; plain paragraphs only
             * when the editor content has none of that to give.
             */
            ...(() => {
              const tree = richTextToAst(raw.content);
              return tree && tree.children.length ? { body: tree } : { paragraphs: lexicalText(raw.content).map((text) => ({ text })) };
            })(),
            ...optionalText(raw.width, "width"),
          };
        case "media_feature":
          return {
            type: "media_feature",
            ...eyebrow,
            media_url: renderMedia(raw.media, String(raw.alt || "")).url,
            alt: raw.alt,
            heading: raw.heading,
            caption: raw.caption,
            alignment: raw.alignment,
            // #3149 wave 4 — the story composite. Each one absent unless the
            // brand filled it in, so an untouched block publishes as before.
            ...optionalText(raw.media_shape, "media_shape"),
            ...optionalText(raw.badge_figure, "badge_figure"),
            ...optionalText(raw.badge_label, "badge_label"),
            ...optionalText(raw.quote, "quote"),
            ...optionalText(raw.quote_attribution, "quote_attribution"),
            ...optionalCta(raw),
          };
        case "cta":
          return {
            type: "cta",
            ...eyebrow,
            heading: raw.heading,
            body: raw.body,
            label: raw.label,
            href: raw.href,
          };
        case "offering_grid":
          // #2829 W4 — a live grid carries only its composition; picked
          // offerings must be the brand's own (in its feed), whatever their
          // state.
          if (isLiveGrid(raw)) {
            const known = new Set(offeringsSnapshot.map((offering) => offering.id));
            const picked = (raw.offering_ids || []).map((row: AnyDoc) => String(row.offering_id));
            if (picked.some((offeringId: string) => !known.has(offeringId))) throw new Error("VALIDATION_FAILED");
            return {
              type: "offering_grid",
              ...eyebrow,
              heading: raw.heading || undefined,
              mode: raw.mode,
              kind: raw.kind || "all",
              ...(picked.length ? { offering_ids: picked.map((offeringId: string) => ({ id: offeringId })) } : {}),
              ...(typeof raw.limit === "number" ? { limit: raw.limit } : {}),
              ...(raw.show_filters === true ? { show_filters: true } : {}),
              ...(raw.empty_text ? { empty_text: raw.empty_text } : {}),
              ...optionalText(raw.intro, "intro"),
              ...optionalCta(raw),
              ...optionalText(raw.empty_cta_label, "empty_cta_label"),
              ...optionalText(raw.empty_cta_href, "empty_cta_href"),
            };
          }
          return {
            type: "offering_grid",
            ...eyebrow,
            heading: raw.heading,
            offerings: (raw.offering_ids || []).map((row: AnyDoc) => {
              const resolved = commercial.find(
                (item) => item.id === row.offering_id,
              );
              if (!resolved) throw new Error("VALIDATION_FAILED");
              return {
                id: resolved.id,
                label: resolved.title,
                summary: resolved.summary || "",
                url: resolved.url,
              };
            }),
          };
        /*
         * #3149 wave 5 — THE BOOKING LINK POINTS AT THE VENUE'S PUBLIC PAGE.
         *
         * Wave 4 derived this from the tenant's brand id as
         * `/reserve/{brand_id}`, which was free of typos and still wrong:
         * `/reserve/[brandId]` is not where a booking STARTS, it is where a
         * payment RETURNS. That whole tree is a payment-return surface — the
         * index renders "Payment cancelled. You haven't been charged.",
         * `confirm` is the post-payment landing and `manage` edits a booking
         * that already exists. So "Continue with Mingla" took a guest who had
         * chosen nothing and charged nothing to a cancellation notice.
         *
         * The page that actually takes a booking is the venue's public one,
         * `/b/{brand_slug}/v/{venue_slug}`: it carries "BOOKING · Available
         * through Mingla" and a "Reserve a table" button. It is addressed by
         * SLUG, and the tenant row holds only ids — so the slugs travel on the
         * site projection the builder already fetches, resolved by Mingla from
         * the site id. Derived end to end; there is still no free text on the
         * way to it.
         *
         * FAILS CLOSED. No verified venue, an ambiguous one, or a slug that is
         * not a slug means no link, and the block is DROPPED. A reservation
         * section that is briefly absent is a gap; one that is present and
         * lands on a cancellation notice is a lost booking and a guest who
         * thinks the restaurant is broken.
         */
        case "venue_reservation": {
          if (!brandSlug || !venueSlug) return null;
          return {
            type: "venue_reservation",
            ...eyebrow,
            heading: raw.heading,
            body: raw.body,
            url: `${MINGLA_HOST_ORIGIN}/b/${brandSlug}/v/${venueSlug}`,
          };
        }
        case "video_feature": {
          const video = renderVideo(raw.video);
          // A video block whose file is not ready is dropped rather than
          // published as a heading over an empty frame.
          if (!video) return null;
          return {
            type: "video_feature",
            ...eyebrow,
            ...optionalText(raw.group_heading, "group_heading"),
            ...optionalText(raw.group_cta_label, "group_cta_label"),
            ...optionalText(raw.group_cta_href, "group_cta_href"),
            heading: raw.heading ?? null,
            caption: raw.caption ?? null,
            video_url: video,
            poster_url: renderMedia(raw.poster, "").url,
          };
        }
        case "team":
          return {
            type: "team",
            ...eyebrow,
            heading: raw.heading ?? null,
            caption: raw.caption ?? null,
            // #3149 wave 4 — how many are shown, and where the rest are.
            ...optionalNumber(raw.preview_count, "preview_count"),
            ...optionalCta(raw),
            members: (raw.members || []).map((row: AnyDoc) => ({
              name: row.name,
              role: row.role ?? null,
              // A person can be published by name alone.
              media_url: row.media ? renderMedia(row.media, "").url : null,
              alt: row.alt ?? null,
            })),
          };
        case "menu_board": {
          /*
           * NO MINGLA MENU MEANS NO MENU. The block is dropped, and because a
           * page whose blocks all drop is itself dropped below, the Menu tab
           * disappears from the navigation and the sitemap too. A restaurant
           * website with a Menu link that opens an empty page is worse than one
           * with no Menu link at all.
           */
          if (!menuSections.length) return null;
          return {
            type: "menu_board",
            ...eyebrow,
            heading: raw.heading ?? null,
            note: raw.note ?? null,
            // NULL venue = show the menu, no cart. The brand has no verified
            // venue, or more than one, and Mingla will not guess which kitchen
            // a website order belongs to.
            venue_id: menuVenueId,
            sections: menuSections,
          };
        }
        /*
         * #3149 wave 4 — the taste of the menu. The SAME projected sections
         * `menu_board` receives, shortened by the caps below: nothing here can
         * add a dish or a price, so the website still holds no copy of what
         * the restaurant sells.
         *
         * Dropped on an empty menu for the same reason the board is — a
         * heading promising "what people order" over nothing at all is worse
         * than no section.
         */
        case "menu_preview": {
          if (!menuSections.length) return null;
          return {
            type: "menu_preview",
            ...eyebrow,
            heading: raw.heading ?? null,
            note: raw.note ?? null,
            sections: menuSections,
            ...optionalNumber(raw.section_limit, "section_limit"),
            ...optionalNumber(raw.item_limit, "item_limit"),
            ...((raw.images || []).length
              ? {
                images: (raw.images || []).map((row: AnyDoc) =>
                  renderMedia(row.media, String(row.alt || ""))
                ),
              }
              : {}),
            ...optionalCta(raw),
          };
        }
        case "menu_link":
          return {
            type: "menu_link",
            ...eyebrow,
            heading: raw.heading,
            label: raw.label,
            href: raw.href,
          };
        case "gallery":
          return {
            type: "gallery",
            ...eyebrow,
            heading: raw.heading,
            images: (raw.images || []).map((row: AnyDoc) =>
              renderMedia(row.media, String(row.alt || ""))
            ),
          };
        case "hours_location":
          return {
            type: "hours_location",
            ...eyebrow,
            heading: raw.heading,
            address: raw.address,
            map_url: raw.map_url,
            /*
             * #3149 wave 4 — the two facts behind a live open/closed line, and
             * NOTHING derived from the hours below them. An unticked box
             * publishes no key at all rather than `always_open: false`, so a
             * site that never made the claim carries no trace of it.
             */
            ...optionalFlag(raw.always_open, "always_open"),
            ...optionalText(raw.timezone, "timezone"),
            hours: (raw.hours || []).map((row: AnyDoc) => ({
              day: row.day,
              value: row.value,
            })),
          };
        case "testimonials": {
          // #2829 W5 — reviews from the Testimonials collection (confirmed only).
          if (raw.from_collection === true) {
            const picked = (raw.testimonial_ids || [])
              .map((row: AnyDoc) => id(row.testimonial))
              .filter((testimonialId: string) => publishedTestimonials.has(testimonialId));
            if (!publishedTestimonials.size || ((raw.testimonial_ids || []).length && !picked.length)) return null;
            return {
              type: "testimonials",
              ...eyebrow,
              ...optionalText(raw.heading, "heading"),
              ...optionalText(raw.intro, "intro"),
              from_collection: true,
              ...(picked.length ? { testimonial_ids: picked.map((testimonialId: string) => ({ id: testimonialId })) } : {}),
              ...optionalNumber(raw.limit, "limit"),
              ...optionalCta(raw),
            };
          }
          return {
            type: "testimonials",
            ...eyebrow,
            heading: raw.heading,
            items: (raw.items || []).map((row: AnyDoc) => ({
              name: row.name,
              quote: row.quote,
            })),
          };
        }
        case "faq":
          return {
            type: "faq",
            ...eyebrow,
            heading: raw.heading,
            items: (raw.items || []).map((row: AnyDoc) => ({
              question: row.question,
              answer: row.answer,
            })),
          };
        case "contact_handoff":
          return {
            type: "contact_handoff",
            ...eyebrow,
            heading: raw.heading,
            body: raw.body,
            label: raw.label,
            href: raw.href,
          };
        /*
         * #3149 wave 3. Every optional key goes through `optionalText`, so an
         * emptied field is ABSENT from the published bytes rather than present
         * as `""` — the same rule the eyebrow follows, and for the same
         * reason: the artifact forbids unknown keys and its digest is taken
         * over the serialised form, so an empty value would change the bytes
         * of every artifact and make a republish look like a content change.
         */
        case "marquee":
          return {
            type: "marquee",
            phrases: (raw.phrases || []).map((row: AnyDoc) => ({
              text: row.text,
            })),
          };
        case "stats":
          return {
            type: "stats",
            ...eyebrow,
            ...optionalText(raw.heading, "heading"),
            ...optionalText(raw.body, "body"),
            items: (raw.items || []).map((row: AnyDoc) => ({
              figure: row.figure,
              ...optionalText(row.label, "label"),
              // #3149 wave 4 — the sentence, the named drawing, and the ring.
              ...optionalText(row.body, "body"),
              ...optionalText(row.icon, "icon"),
              ...optionalFlag(row.highlight, "highlight"),
            })),
          };
        case "pull_quote":
          return {
            type: "pull_quote",
            quote: raw.quote,
            ...optionalText(raw.attribution, "attribution"),
          };
        case "map_embed":
          return {
            type: "map_embed",
            ...eyebrow,
            ...optionalText(raw.heading, "heading"),
            ...optionalText(raw.body, "body"),
            /*
             * PASSED THROUGH UNTOUCHED, never coerced. `Number(null)` is 0,
             * and 0/0 is a real place in the Atlantic — a missing coordinate
             * that arrived as a number would publish a map of open ocean
             * instead of failing. Absent stays absent and the contract, which
             * requires both, refuses the publish.
             */
            latitude: raw.latitude,
            longitude: raw.longitude,
            place_label: raw.place_label,
            ...optionalText(raw.directions_url, "directions_url"),
          };
        /*
         * #2829 W5 — collection, history and form blocks. A list with nothing
         * to show (no enabled destination, no story in the category, no
         * confirmed review) is DROPPED like an empty menu, never published as
         * a heading over nothing.
         */
        case "destination_grid": {
          const picked = (raw.destinations || [])
            .map((row: AnyDoc) => destinationSlugById.get(id(row.destination)))
            .filter((slug: string | undefined): slug is string => Boolean(slug));
          if (!siteCollections.destinations.length || ((raw.destinations || []).length && !picked.length)) return null;
          return {
            type: "destination_grid",
            ...eyebrow,
            ...optionalText(raw.heading, "heading"),
            ...optionalText(raw.intro, "intro"),
            ...(picked.length ? { destinations: picked.map((slug: string) => ({ slug })) } : {}),
            ...optionalCta(raw),
          };
        }
        case "story_grid": {
          const category = raw.category ? categorySlugById.get(id(raw.category)) : undefined;
          if (raw.category && !category) return null;
          if (!siteCollections.stories.some((story) => !category || story.category === category)) return null;
          return {
            type: "story_grid",
            ...eyebrow,
            ...optionalText(raw.heading, "heading"),
            ...optionalText(raw.intro, "intro"),
            ...(category ? { category } : {}),
            ...optionalNumber(raw.limit, "limit"),
            ...optionalCta(raw),
          };
        }
        case "offering_history":
          return {
            type: "offering_history",
            ...eyebrow,
            heading: raw.heading,
            ...optionalText(raw.intro, "intro"),
            kind: raw.kind || "trip",
            ...(() => {
              const only = [...new Set((raw.offering_ids || []).map((item: AnyDoc) => String(item.offering_id || "").toLowerCase()).filter(Boolean))];
              return only.length ? { offering_ids: only.map((offeringId) => ({ id: offeringId })) } : {};
            })(),
            ...(() => {
              const series = (raw.series || [])
                .map((row: AnyDoc) => ({
                  label: typeof row.label === "string" ? row.label.trim() : "",
                  offering_ids: [...new Set((row.offering_ids || []).map((item: AnyDoc) => String(item.offering_id || "").toLowerCase()).filter(Boolean))]
                    .map((offeringId) => ({ id: offeringId })),
                }))
                .filter((row: { label: string; offering_ids: unknown[] }) => row.label && row.offering_ids.length >= 2);
              return series.length ? { series } : {};
            })(),
            ...(() => {
              const linked = [...new Set((raw.linked_offering_ids || []).map((item: AnyDoc) => String(item.offering_id || "").toLowerCase()).filter(Boolean))];
              return linked.length ? { linked_offering_ids: linked.map((offeringId) => ({ id: offeringId })) } : {};
            })(),
            ...optionalCta(raw),
          };
        case "contact_form":
          return {
            type: "contact_form",
            ...eyebrow,
            ...optionalText(raw.heading, "heading"),
            ...optionalText(raw.intro, "intro"),
            ...optionalFlag(raw.show_phone, "show_phone"),
            ...optionalText(raw.name_placeholder, "name_placeholder"),
            ...optionalText(raw.email_placeholder, "email_placeholder"),
            ...optionalText(raw.message_label, "message_label"),
            ...optionalText(raw.message_placeholder, "message_placeholder"),
            submit_label: raw.submit_label,
            ...optionalText(raw.success_text, "success_text"),
            ...optionalText(raw.fallback_email, "fallback_email"),
          };
        case "newsletter_signup":
          return {
            type: "newsletter_signup",
            ...eyebrow,
            heading: raw.heading,
            ...optionalText(raw.body, "body"),
            ...optionalText(raw.placeholder, "placeholder"),
            button_label: raw.button_label,
            ...optionalText(raw.small_print, "small_print"),
          };
        // #2829 W7 — the travel designs' page header, cards and contact tiles.
        case "page_header":
          return {
            type: "page_header",
            heading: raw.heading,
            ...optionalText(raw.subheading, "subheading"),
            ...(raw.media ? { media_url: renderMedia(raw.media, "").url } : {}),
          };
        case "feature_cards":
          return {
            type: "feature_cards",
            ...optionalText(raw.heading, "heading"),
            ...optionalText(raw.intro, "intro"),
            cards: (raw.cards || []).map((row: AnyDoc) => ({
              title: row.title,
              body: row.body,
              ...optionalText(row.icon, "icon"),
            })),
          };
        case "contact_details":
          return {
            type: "contact_details",
            ...optionalText(raw.heading, "heading"),
            ...optionalText(raw.body, "body"),
            ...optionalText(raw.email, "email"),
            ...optionalText(raw.location, "location"),
          };
        case "divider":
          return { type: "divider" };
        case "spacer":
          return { type: "spacer", size: raw.size };
        default:
          throw new Error("VALIDATION_FAILED");
      }
  };
  /*
   * #3149 wave 4 — A DROPPED BLOCK MUST LEAVE NOTHING BEHIND. Four cases above
   * return `null` to drop a block (a video whose file is not ready, a menu
   * with no items, a menu taster with none); a `null` published as a block
   * would fail the whole site with ARTIFACT_BLOCK_TYPE_MISMATCH.
   *
   * #2830 — A PAGE WITH NOTHING ON IT IS NOT A PAGE: a page whose blocks all
   * dropped is published disabled, so its menu link and sitemap entry
   * disappear. Home is exempt (a site must have one; an empty home is refused
   * by the public contract with a named reason).
   *
   * #2829 W2 — pages are ordered by address (home first) so the bytes do not
   * depend on the order pages were created in.
   */
  const renderedPages = (pagesResult.docs as AnyDoc[])
    .map((page) => {
      const rendered = blocks(page.blocks || []).filter(Boolean);
      const isHome = isHomePage(page);
      return {
        page,
        path: pagePaths.get(String(page.id)) ?? "",
        rendered,
        enabled: isHome ? page.enabled === true : page.enabled === true && rendered.length > 0,
      };
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const livePaths = new Map(
    renderedPages.filter((entry) => entry.enabled).map((entry) => [String(entry.page.id), entry.path]),
  );
  /*
   * #2829 AD-5 — PATH_COLLISION. Two things that would answer one address
   * (two pages, two collection base paths, a redirect away from a live page)
   * refuse the publish before anything is written, so the last good site
   * stays live.
   */
  assertNoPathCollision(pagesResult.docs, settings, new Set(livePaths.keys()));
  const pageSeo = (seo: unknown) => {
    const record = (seo ?? {}) as AnyDoc;
    const out = {
      ...optionalText(record.title, "title"),
      ...optionalText(record.description, "description"),
      ...optionalFlag(record.noindex, "noindex"),
    };
    return Object.keys(out).length ? { seo: out } : {};
  };
  /*
   * #2829 W2 — the header menu. A link to a page resolves to that page's
   * address; a link to a page that is not published (off, or emptied) is
   * DROPPED rather than published as a dead link. External links must be
   * secure web addresses.
   */
  const navTarget = (row: AnyDoc): string | null => {
    if (row?.target_type === "url") {
      const url = typeof row.url === "string" ? row.url : "";
      try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && !parsed.username && !parsed.password ? url : null;
      } catch {
        return null;
      }
    }
    const path = livePaths.get(id(row?.page));
    return path === undefined ? null : path === "" ? "/" : `/${path}`;
  };
  const navLink = (row: AnyDoc) => {
    const label = typeof row?.label === "string" ? row.label.trim() : "";
    const href = navTarget(row);
    return label && href ? { label, href } : null;
  };
  const navigationOf = (doc: AnyDoc | undefined) => {
    const items = ((doc?.items as AnyDoc[] | undefined) ?? [])
      .map((item) => {
        const link = navLink(item);
        if (!link) return null;
        const children = ((item.children as AnyDoc[] | undefined) ?? [])
          .map(navLink)
          .filter(Boolean);
        return children.length ? { ...link, children } : link;
      })
      .filter(Boolean);
    const cta = doc?.header_cta ? navLink(doc.header_cta as AnyDoc) : null;
    return {
      items,
      ...(cta ? { header_cta: cta } : {}),
      ...optionalText(doc?.wordmark, "wordmark"),
    };
  };
  // #2829 — no address, no build: a site publishes only under the primary
  // host Core named for it (fails before anything is written).
  if (!tenantCanonicalUrl(input.tenant)) throw new Error("INVALID_STATE");
  const source: AnyDoc = {
    schema_version: 1,
    site_id: input.tenant.core_site_id,
    brand_id: input.tenant.core_brand_id,
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    publication_id: input.publicationId,
    source_revision_id: input.sourceRevisionId,
    source_digest: input.sourceDigest,
    generated_at: input.generatedAt,
    pages: renderedPages.map(({ page, path, rendered, enabled }) => ({
      path,
      title: page.title,
      enabled,
      kind: page.kind === "collection_index" ? "collection_index" : "standard",
      ...(page.kind === "collection_index" && typeof page.collection_kind === "string"
        ? { collection: page.collection_kind }
        : {}),
      blocks: rendered,
      ...pageSeo(page.seo),
    })),
    navigation: navigationOf(navigationResult.docs[0] as AnyDoc | undefined),
    site_routes: {
      routes: routing.routes,
      redirects: routing.redirects,
      language: typeof settings.language === "string" && settings.language
        ? settings.language
        : "en",
      ...optionalText(settings.timezone, "timezone"),
    },
    footer: (() => {
      /*
       * #2829 W2 — an ALLOWLIST of what this artifact form carries, not a
       * list of keys to delete: the footer collection grew fields (tagline,
       * columns, socials, …) that the travel designs render from W3 on, and
       * copying "everything but" published them into an artifact whose
       * contract refuses unknown keys — every republish failed with
       * ARTIFACT_FOOTER_MISMATCH and the last good site stayed live.
       */
      const source = (footerResult.docs[0] as AnyDoc) || {};
      const footer: AnyDoc = {};
      for (const key of ["address", "hours_summary", "legal_text", "links"]) {
        if (source[key] !== undefined) footer[key] = source[key];
      }
      const linksOf = (rows: unknown) => (Array.isArray(rows) ? rows : []).map((row: AnyDoc) => ({ label: row.label, href: row.href }));
      if (Array.isArray(footer.links)) footer.links = linksOf(footer.links);
      /*
       * #2829 W7 — the travel footer the voyage design draws: tagline lines,
       * location, email, link columns, socials and the copyright line. The
       * builder's own credit field is not published: every site shows
       * "Powered by Mingla" in that place (A1.1).
       */
      const tagline = (source.tagline_lines || []).map((row: AnyDoc) => row.text).filter((text: unknown) => typeof text === "string" && text.trim());
      if (tagline.length) footer.tagline_lines = tagline;
      if (typeof source.location === "string" && source.location) footer.location = source.location;
      if (typeof source.email === "string" && source.email) footer.email = source.email;
      const columns = (source.columns || []).map((column: AnyDoc) => ({ heading: column.heading, links: linksOf(column.links) }));
      if (columns.length) footer.columns = columns;
      const socials = (source.socials || []).map((row: AnyDoc) => ({ network: row.network, url: row.url }));
      if (socials.length) footer.socials = socials;
      if (typeof source.copyright === "string" && source.copyright) footer.copyright = source.copyright;
      return footer;
    })(),
    site_settings: {
      display_name: settings.display_name,
      short_description: settings.short_description,
      logo: settings.logo
        ? renderMedia(settings.logo, `${settings.display_name} logo`)
        : undefined,
      seo: {
        title: settings.seo_title,
        description: settings.seo_description,
        // #2829 — the tenant's own primary address (named by Core), never a
        // stored or defaulted value. Missing → the contract refuses the build.
        canonical_url: tenantCanonicalUrl(input.tenant),
        social_image: settings.social_image
          ? renderMedia(settings.social_image, "")
          : undefined,
      },
    },
    // Videos take the video shape; everything else goes through the rendition
    // path. A video handed to renderMedia throws, because it has no widths.
    media: [...media.values()]
      .filter((item) => !isStreamVideoRecord(item))
      .map((item) => isVideoRecord(item) ? videoReference(item) : withVariants(renderMedia(item.id, ""), item)),
    commercial_references: commercial.map((item) => ({
      kind: item.kind,
      id: item.id,
      url: item.url,
    })),
  };
  // #2829 W3 — the shaped content, re-expressed as v2 under the design, with
  // the owner's exact tokens and their fonts fetched once (a font that will
  // not load falls back to the design's family with a warning, never a
  // failed publish).
  const slots = resolveFontSlots(design.fonts, ownerFontsOf(settings), catalogWeights);
  const fonts = await resolveSiteFonts(input.fontPipeline ?? payloadFontPipeline(req), {
    slots,
    designFonts: design.fonts,
  });
  const artifact = upgradeV1ToV2(source, { fontAssets: fonts.assets, fontFallbacks: fonts.fallbacks });
  artifact.offerings_snapshot = offeringsSnapshot;
  // #2829 W7c (A13.1) — every snapshot cover's renditions, made once (absent when none).
  if (offeringsSnapshot.some((offering) => offering.cover)) {
    const covers = await offeringCoverRenditions(
      input.tenant.core_site_id,
      offeringsSnapshot,
      input.coverRenditions ?? storageCoverRenditionDeps(),
    );
    if (covers.media.length) artifact.offering_media = covers.media;
    for (const warning of covers.warnings) {
      emitCmsObservation({
        event: "mingla_sites_state",
        metric: "publish.offering_cover_rendition_skipped",
        request_id: crypto.randomUUID(),
        operation_id: input.operationId,
        site_id: String(input.tenant.core_site_id),
        publication_id: input.publicationId,
        direction: "cms_to_core",
        route: "/publish",
        state_transition: "cover_read->rendition_skipped",
        latency_ms: 0,
        retry_count: 0,
        safe_error_code: warning.code,
        status_code: null,
        version: "sites-v1",
      });
    }
  }
  // #2829 W6 — stream videos a block plays (absent when there are none).
  if (streamVideos.size) artifact.stream_videos = [...streamVideos.values()].sort((a, b) => a.id.localeCompare(b.id));
  artifact.collections = siteCollections;
  // #2829 W9r — hidden past trips and owner-ordered collections (absent when none).
  const display = siteDisplayOf(settings, content);
  if (display) artifact.site_display = display;
  artifact.design = { key: design.key, version: design.version };
  artifact.tokens = resolveTokens(design.tokens, ownerTokensOf(settings));
  artifact.fonts = fonts.slots;
  artifact.font_assets = fonts.assets;
  artifact.font_fallbacks = fonts.fallbacks;
  const serialized = stable(artifact);
  // The public contract (assertArtifactV2) is enforced where it always was:
  // the runtime's candidate probe validates these exact bytes before Core
  // moves the live pointer, so a refused artifact never goes live and the
  // last good site stays.
  const digest = await sha256(serialized);
  const key = `publications/${input.tenant.core_site_id}/${input.publicationId}/${digest}.json`;
  await writeObject(
    cmsConfig().artifactBucket,
    key,
    new TextEncoder().encode(serialized),
    "application/json",
  );
  const readback = await readObject(cmsConfig().artifactBucket, key);
  if ((await sha256(readback)) !== digest)
    throw new Error("ARTIFACT_DIGEST_MISMATCH");
  return {
    artifact,
    serialized,
    artifactKey: key,
    artifactDigest: digest,
    generation: { artifact_schema_version: 2, renderer_key: "sites-v2", design_key: design.key, design_version: design.version },
    fontWarnings: fonts.warnings,
  };
}

export async function probePublicationCandidate(input: {
  siteId: string;
  brandId: string;
  /** #2829 — the site's primary host; the probe checks the canonical against it. */
  primaryHostname: string;
  publicationId: string;
  artifactKey: string;
  artifactDigest: string;
  rendererVersion: number;
  /** #2829 W3 — the generation that was written (v2 for builds, v1 or v2 for rollbacks). */
  artifactSchemaVersion: 1 | 2;
  rendererKey: "restaurant-website-v1" | "sites-v2";
}): Promise<Record<string, unknown>> {
  const config = cmsConfig();
  const body = JSON.stringify({
    site_id: input.siteId, brand_id: input.brandId,
    publication_id: input.publicationId, artifact_key: input.artifactKey,
    artifact_digest: input.artifactDigest, artifact_schema_version: input.artifactSchemaVersion,
    renderer_key: input.rendererKey, renderer_version: input.rendererVersion,
    primary_hostname: input.primaryHostname,
  });
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const signature = await hmac(
    config.candidateProbeSecret,
    `${timestamp}\n${nonce}\n${await sha256(body)}`,
  );
  /*
   * #2830 — RECORD WHY THE PROBE REFUSED.
   *
   * The probe names its failing check (#3134), but that name travels in the
   * response body and nothing here read it. A refused publish left
   * `failure_code: PROBE_FAILED` in the job row and no way to tell a corrupt
   * asset from a contract violation from a timeout. Narrowing one refusal on
   * the Gogi pilot meant downloading the artifact from its private bucket and
   * re-running all ten checks by hand.
   *
   * The latency is recorded too, because "every check passed locally" and
   * "the probe never finished" look identical from the job row, and 55 assets
   * including 22MB of video is a very different request from the single image
   * this path was built against.
   */
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${config.publicRuntimeOrigin}/api/internal/candidate-probe`, {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-mingla-probe-time": timestamp,
        "x-mingla-probe-nonce": nonce, "x-mingla-probe-signature": signature,
      },
      body,
      cache: "no-store",
    });
  } catch (error) {
    emitCmsObservation({
      event: "mingla_sites_state",
      metric: "publish.probe.unreachable",
      request_id: crypto.randomUUID(),
      operation_id: null,
      site_id: input.siteId,
      publication_id: input.publicationId,
      direction: "core_to_cms",
      route: "/api/internal/candidate-probe",
      state_transition: "probe_started->probe_unreachable",
      latency_ms: Date.now() - startedAt,
      retry_count: 0,
      safe_error_code: error instanceof Error ? error.name : "FETCH_FAILED",
      status_code: null,
      version: "sites-v1",
    });
    throw new Error("PROBE_FAILED");
  }
  const latencyMs = Date.now() - startedAt;
  const result = await response.json().catch(() => null);
  const digestMatches = result?.data?.observed_digest === input.artifactDigest;
  if (!response.ok || !result?.ok || !digestMatches) {
    /*
     * Three distinct refusals that used to be one word. `failed_check` and
     * `detail` are the probe's own vocabulary; the digest case never reaches
     * the probe's checks at all and has to be named here.
     */
    const reason = !response.ok || !result?.ok
      ? [result?.failed_check, result?.detail].filter(Boolean).join(" ") ||
        `http_${response.status}`
      : "observed_digest_mismatch";
    emitCmsObservation({
      event: "mingla_sites_state",
      metric: "publish.probe.refused",
      request_id: crypto.randomUUID(),
      operation_id: null,
      site_id: input.siteId,
      publication_id: input.publicationId,
      direction: "core_to_cms",
      route: "/api/internal/candidate-probe",
      state_transition: "probe_started->probe_refused",
      latency_ms: latencyMs,
      retry_count: 0,
      safe_error_code: String(reason).slice(0, 300),
      status_code: response.status,
      version: "sites-v1",
    });
    throw new Error("PROBE_FAILED");
  }
  return result.data as Record<string, unknown>;
}

export async function buildRollbackPublicationArtifact(input: {
  siteId: string;
  brandId: string;
  publicationId: string;
  sourceRevisionId: string;
  sourceDigest: string;
  generatedAt: string;
  rollbackSourcePublicationId: string;
  rollbackSource: Record<string, unknown>;
}) {
  const sourceArtifactDigest = String(
    input.rollbackSource.artifact_digest || "",
  );
  const sourceArtifactKey = String(input.rollbackSource.artifact_key || "");
  if (
    input.rollbackSource.id !== input.rollbackSourcePublicationId ||
    input.rollbackSource.site_id !== input.siteId ||
    input.rollbackSource.source_revision_id !== input.sourceRevisionId ||
    input.rollbackSource.source_digest !== input.sourceDigest ||
    input.rollbackSource.status !== "published" ||
    // #2829 W3 — a rollback copies either generation exactly as it was.
    !((input.rollbackSource.artifact_schema_version === 1 &&
        input.rollbackSource.renderer_key === "restaurant-website-v1") ||
      (input.rollbackSource.artifact_schema_version === 2 &&
        input.rollbackSource.renderer_key === "sites-v2")) ||
    input.rollbackSource.renderer_version !== 1 ||
    !/^[0-9a-f]{64}$/.test(sourceArtifactDigest) ||
    sourceArtifactKey !==
      `publications/${input.siteId}/${input.rollbackSourcePublicationId}/${sourceArtifactDigest}.json`
  ) throw new Error("VALIDATION_FAILED");
  const sourceBytes = await readObject(
    cmsConfig().artifactBucket,
    sourceArtifactKey,
  );
  if (await sha256(sourceBytes) !== sourceArtifactDigest) {
    throw new Error("ARTIFACT_DIGEST_MISMATCH");
  }
  const sourceArtifact = JSON.parse(
    new TextDecoder().decode(sourceBytes),
  ) as AnyDoc;
  if (
    sourceArtifact.site_id !== input.siteId ||
    sourceArtifact.brand_id !== input.brandId ||
    sourceArtifact.publication_id !== input.rollbackSourcePublicationId ||
    sourceArtifact.source_revision_id !== input.sourceRevisionId ||
    sourceArtifact.source_digest !== input.sourceDigest ||
    !(input.rollbackSource.artifact_schema_version === 2
      ? sourceArtifact.artifact_schema_version === 2 && sourceArtifact.renderer_key === "sites-v2"
      : sourceArtifact.schema_version === 1 && sourceArtifact.renderer_key === "restaurant-website-v1") ||
    sourceArtifact.renderer_version !== 1
  ) throw new Error("VALIDATION_FAILED");
  const schemaVersion = input.rollbackSource.artifact_schema_version === 2 ? 2 : 1;
  const artifact = {
    ...sourceArtifact,
    publication_id: input.publicationId,
    generated_at: input.generatedAt,
  };
  const serialized = stable(artifact);
  const artifactDigest = await sha256(serialized);
  const artifactKey =
    `publications/${input.siteId}/${input.publicationId}/${artifactDigest}.json`;
  await writeObject(
    cmsConfig().artifactBucket,
    artifactKey,
    new TextEncoder().encode(serialized),
    "application/json",
  );
  const readback = await readObject(cmsConfig().artifactBucket, artifactKey);
  if (await sha256(readback) !== artifactDigest) {
    throw new Error("ARTIFACT_DIGEST_MISMATCH");
  }
  const design = schemaVersion === 2 && sourceArtifact.design && typeof sourceArtifact.design === "object"
    ? sourceArtifact.design as { key: string; version: number }
    : null;
  return {
    artifact,
    serialized,
    artifactKey,
    artifactDigest,
    generation: schemaVersion === 2 && design
      ? { artifact_schema_version: 2 as const, renderer_key: "sites-v2" as const, design_key: design.key, design_version: design.version }
      : { artifact_schema_version: 1 as const, renderer_key: "restaurant-website-v1" as const, design_key: null, design_version: null },
    fontWarnings: [] as FontWarning[],
  };
}
