import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { hiddenOfferingIds } from "../contracts/generated/artifactV2.ts";
import { offeringKindsAtBase, hrefForPath, type OfferingDetailKind } from "../contracts/generated/routes.ts";
import { UUID_RE } from "../contracts/generated/safety.ts";
import {
  DETAIL_NOUN,
  offeringDetailHref,
  offeringDetailPath,
  offeringDetailIndexable,
  offeringHasDetailPage,
  parseOfferingDetail,
  type OfferingDetail,
} from "../contracts/generated/offeringDetail.ts";
import type { SiteOffering } from "../contracts/generated/offerings.ts";
import { signedCorePost, type SiteBinding } from "./coreGateway";
import { siteOfferings } from "./offeringsFeed";
import { emitPublicObservation } from "./observability";
import { loadLiveOfferings, offeringFilters, type LiveOfferings, type OfferingCard } from "./offeringCards";
import { offeringMediaToken } from "./offeringMedia";
import { navigablePages, type ArtifactPage } from "./pageRouting";

/*
 * #4453 milestone 9 (spec v2.1 §1.2, N1) — step 3b of the resolution order:
 * an offering detail page at `/{base}/{slug}`, after pages, destinations and
 * stories, behind SITES_DETAIL_PAGES.
 *
 * Nothing is stored per offering. The page is the live feed row (or, when
 * Core is unreachable, nothing: the snapshot fallback reads the flag as off,
 * so there is no detail route and cards link to Mingla) plus Core's
 * `brand_site_offering_detail` extras, cached 60 s per site and offering.
 *
 *   upcoming / bookable        → the full page
 *   sold out, closed, waitlist → the full page, the live status in place of Book
 *   ended                      → "This {noun} has ended", other upcoming items, noindex, not in the sitemap
 *   cancelled, hidden by the owner, another brand's, not in the feed, flag off → not found
 *   an old slug or the offering's id → 308 to its current address
 */

export const DETAIL_FRESH_MS = 60_000;
export const DETAIL_TIMEOUT_MS = 2_500;

export type DetailPhoto = { src: string; alt: string };

export type OfferingDetailView = {
  offering: SiteOffering;
  card: OfferingCard;
  /** Core's extras, or null when Core gave none (the page draws from the feed row alone). */
  extras: OfferingDetail | null;
  /** Up to 8 pictures beyond the cover (a room's own photos), token-bound. */
  photos: DetailPhoto[];
  noun: string;
  ended: boolean;
  /** The listing page this offering belongs to ("Back to Trips"), else Home. */
  parent: { href: string; label: string };
  /** Up to 3 other upcoming offerings of the same kind. */
  others: OfferingCard[];
  path: string;
};

export type DetailResolution =
  | { kind: "detail"; page: ArtifactPage; detail: OfferingDetailView; live: LiveOfferings }
  | { kind: "redirect"; location: string; status: 308 };

export type DetailFetcher = (site: SiteBinding, kind: OfferingDetailKind, slug: string) => Promise<unknown>;

type CacheEntry = { value: unknown; fetchedAt: number };
const cache = new Map<string, CacheEntry>();

/** Test hook: forget every cached detail answer. */
export function clearOfferingDetailCache(): void {
  cache.clear();
}

/** Core's extras for one offering of ONE resolved site (signed, site-bound). null = none. */
export const fetchCoreDetail: DetailFetcher = async (site, kind, slug) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
  try {
    const response = await Promise.race([
      signedCorePost({
        edgeFunction: "brand-site-runtime-resolve",
        path: `/internal/v1/sites/${site.site_id}/offering-detail`,
        site,
        body: { site_id: site.site_id, kind, slug },
      }),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("DETAIL_TIMEOUT")))),
    ]);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("DETAIL_UNAVAILABLE");
    const payload = await response.json() as { ok?: unknown; data?: unknown };
    if (payload?.ok !== true) throw new Error("DETAIL_UNAVAILABLE");
    return payload.data ?? null;
  } finally {
    clearTimeout(timer);
  }
};

function observe(site: SiteBinding, transition: string): void {
  emitPublicObservation({
    event: "mingla_sites_state",
    metric: "public.offering_detail.extras_unavailable",
    request_id: crypto.randomUUID(),
    operation_id: null,
    site_id: site.site_id,
    publication_id: null,
    direction: "public_runtime",
    route: "/offering-detail",
    state_transition: transition,
    latency_ms: 0,
    retry_count: 0,
    safe_error_code: null,
    status_code: null,
    version: "sites-v1",
  });
}

/** The extras for one feed row, validated against that row; cached 60 s. Never throws. */
export async function offeringExtras(
  site: SiteBinding,
  offering: SiteOffering,
  deps: { fetcher?: DetailFetcher; now?: () => number } = {},
): Promise<OfferingDetail | null> {
  // Venue offers and memberships keep their canonical Mingla buyer pages;
  // unlike trips/events/rooms, they have no Sites detail endpoint.
  if (offering.kind === "venue") return null;
  const key = `${site.site_id}|${offering.kind}|${offering.slug}`;
  const now = (deps.now ?? Date.now)();
  const cached = cache.get(key);
  let raw: unknown;
  if (cached && now - cached.fetchedAt < DETAIL_FRESH_MS) raw = cached.value;
  else {
    try {
      raw = await (deps.fetcher ?? fetchCoreDetail)(site, offering.kind, offering.slug);
      cache.set(key, { value: raw, fetchedAt: now });
    } catch {
      observe(site, "detail_unavailable->feed_row_only");
      return null;
    }
  }
  return raw === null || raw === undefined ? null : parseOfferingDetail(raw, { id: offering.id, kind: offering.kind });
}

/** The request path names a detail page's address shape: `{a detail base}/{one segment}`. */
export function detailCandidate(artifact: Pick<ArtifactV2, "routes">, path: string): { kinds: OfferingDetailKind[]; slug: string } | null {
  const segments = path.split("/");
  if (segments.length !== 2 || !segments[1]) return null;
  const kinds = offeringKindsAtBase(artifact.routes, segments[0]!);
  return kinds.length ? { kinds, slug: segments[1] } : null;
}

/** The pictures a detail page shows beyond its cover: `/om/<token>/original?d=<kind>:<slug>`. */
async function detailPhotos(site: SiteBinding, offering: SiteOffering, extras: OfferingDetail | null): Promise<DetailPhoto[]> {
  const photos: DetailPhoto[] = [];
  for (const photo of extras?.photos ?? []) {
    if (offering.cover && photo.path === offering.cover.path) continue;
    const hint = encodeURIComponent(`${offering.kind}:${offering.slug}`);
    photos.push({ src: `/om/${await offeringMediaToken(site.site_id, photo.path)}/original?d=${hint}`, alt: photo.alt ?? "" });
  }
  return photos;
}

function parentFor(artifact: ArtifactV2, path: string): { href: string; label: string } {
  const base = path.split("/")[0]!;
  const listing = navigablePages(artifact).find((page) => page.path === base);
  return listing ? { href: hrefForPath(listing.path), label: listing.title } : { href: "/", label: "Home" };
}

/** The frame a detail page renders in (no blocks of its own; SEO from the feed row). */
function detailFrame(offering: SiteOffering, path: string, ended: boolean): ArtifactPage {
  const description = offering.summary ? cut(offering.summary, 160) : undefined;
  return {
    key: `offering:${offering.kind}:${offering.slug}`,
    path,
    isHome: false,
    title: offering.title,
    navLabel: offering.title,
    navOrder: Number.MAX_SAFE_INTEGER,
    enabled: true,
    kind: "standard",
    blocks: [],
    seo: { ...(description ? { description } : {}), ...(ended ? { noindex: true as const } : {}) },
  };
}

/** Text cut at a word boundary to at most `max` characters, with an ellipsis when cut. */
export function cut(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max - 1);
  const space = slice.lastIndexOf(" ");
  return `${(space > max * 0.6 ? slice.slice(0, space) : slice).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/**
 * Step 3b. Returns null for "not a detail page" (the caller answers 404):
 * the flag is off, the base is not a detail base, the offering is unknown,
 * cancelled, hidden or another brand's (another brand's never appears in this
 * site's feed). `site` is the object Core resolved for this request's host.
 */
export async function resolveOfferingDetail(input: {
  site: SiteBinding;
  artifact: ArtifactV2;
  path: string;
  search?: Record<string, string | string[] | undefined>;
  now?: Date;
  fetcher?: DetailFetcher;
}): Promise<DetailResolution | null> {
  const { site, artifact, path } = input;
  const candidate = detailCandidate(artifact, path);
  if (!candidate) return null;
  const now = input.now ?? new Date();
  const live = await loadLiveOfferings(site, artifact, offeringFilters(input.search), now);
  if (live.detailPages !== true) return null;
  const hidden = hiddenOfferingIds(artifact);
  const ofKind = live.offerings.filter((offering) => (candidate.kinds as readonly string[]).includes(offering.kind));
  const offering = ofKind.find((row) => row.slug === candidate.slug);
  if (!offering) {
    // A slug that changed since publish (the snapshot still names the old
    // one), or the offering's own id: 308 to its current address.
    const lower = candidate.slug.toLowerCase();
    const moved = UUID_RE.test(candidate.slug)
      ? ofKind.find((row) => row.id.toLowerCase() === lower)
      : (() => {
        const old = artifact.offerings_snapshot.find((row) => row.slug === candidate.slug && (candidate.kinds as readonly string[]).includes(row.kind));
        return old ? ofKind.find((row) => row.id === old.id) : undefined;
      })();
    if (moved && !hidden.has(moved.id.toLowerCase()) && offeringHasDetailPage(moved, now)) {
      const location = offeringDetailHref(artifact.routes, moved);
      if (location && location !== hrefForPath(path)) return { kind: "redirect", location, status: 308 };
    }
    return null;
  }
  if (!offeringHasDetailPage(offering, now) || hidden.has(offering.id.toLowerCase())) return null;
  const detailPath = offeringDetailPath(artifact.routes, offering);
  if (detailPath !== path) return null;
  const card = live.cards.get(offering.id);
  if (!card) return null;
  const ended = card.state.phase === "ended";
  const extras = ended ? null : await offeringExtras(site, offering, { fetcher: input.fetcher });
  const others = live.offerings
    .filter((row) => row.id !== offering.id && row.kind === offering.kind)
    .map((row) => live.cards.get(row.id))
    .filter((row): row is OfferingCard => row !== undefined && row.state.phase !== "ended" && !row.state.cancelled)
    .slice(0, 3);
  return {
    kind: "detail",
    page: detailFrame(offering, path, ended),
    live,
    detail: {
      offering,
      card,
      extras,
      photos: await detailPhotos(site, offering, extras),
      noun: DETAIL_NOUN[offering.kind],
      ended,
      parent: parentFor(artifact, path),
      others,
      path,
    },
  };
}

/**
 * The /om route's second source of picture paths: a detail page's own photos,
 * named by the `?d=<kind>:<slug>` hint its URLs carry (the token still binds
 * the path to this site). Empty unless the flag is on and the offering is in
 * this site's feed.
 */
export async function detailPhotoPaths(
  site: SiteBinding,
  offerings: readonly SiteOffering[],
  detailPages: boolean,
  hint: string | null,
): Promise<string[]> {
  if (!detailPages || !hint) return [];
  const match = /^(trip|event|experience|stay):([A-Za-z0-9][A-Za-z0-9._~-]{0,199})$/.exec(hint);
  if (!match) return [];
  const offering = offerings.find((row) => row.kind === match[1] && row.slug === match[2]);
  if (!offering) return [];
  const extras = await offeringExtras(site, offering);
  return extras?.photos.map((photo) => photo.path) ?? [];
}

/**
 * #4453 milestone 9 — the offering detail pages that are upcoming or open,
 * while SITES_DETAIL_PAGES is on (the live feed says so; the snapshot never
 * does). Ended, cancelled and hidden ones are left out.
 */
export async function detailSitemapPaths(site: SiteBinding, artifact: ArtifactV2, now = new Date()): Promise<string[]> {
  const view = await siteOfferings(site, artifact);
  if (!view.detailPages) return [];
  const hidden = hiddenOfferingIds(artifact);
  const paths: string[] = [];
  for (const offering of view.offerings) {
    if (hidden.has(offering.id.toLowerCase()) || !offeringDetailIndexable(offering, now)) continue;
    const path = offeringDetailPath(artifact.routes, offering);
    if (path !== null && !paths.includes(path)) paths.push(path);
  }
  return paths;
}
