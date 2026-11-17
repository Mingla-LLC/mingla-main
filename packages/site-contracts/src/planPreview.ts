/**
 * #4453 milestone 10 (spec v2.1 §2) — the pre-build "See your site in three
 * styles" preview, behind SITES_PLAN_PREVIEW.
 *
 * A plan preview is an EPHEMERAL artifact: Studio composes the brand's plan in
 * memory (composer v2, dry run), builds it with the normal artifact builder,
 * and writes it to the object store under a `plan-previews/` key. It creates
 * or changes no site, page, setting, menu, media or work-log row
 * (I-SITES-PLAN-PREVIEW-WRITES-NOTHING). The runtime serves the key only on
 * the reserved preview host, never on a site host, and refuses it after 24 h.
 *
 * A plan artifact is a normal v2 artifact plus two plan-only fields:
 * `preview_kind: "plan"` and `plan_samples` (labelled sample listings for a
 * kind the brand has none of, spec §2.5). Any `sample` field outside a plan
 * artifact is refused (`SAMPLE_CONTENT_IN_ARTIFACT`,
 * I-SITES-SAMPLE-NEVER-PUBLISHED).
 */
import type { DesignKey } from "./designs.ts";
import { isDesignKey } from "./designs.ts";
import { skippedLine, styleFitLevel, topStylePicks, type FormatKey, type StyleFit, type StyleSignals } from "./formats.ts";

/** The reserved host plan previews are served on (and only there). */
export const PLAN_PREVIEW_HOST = "preview.sites.usemingla.com";
/** Objects and keys older than this are refused (and the bucket rule deletes them). */
export const PLAN_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
/** At most this many styles per request (Ari's three picks). */
export const PLAN_PREVIEW_MAX_STYLES = 3;
/** Per brand: requests per day, requests per minute, live objects kept. */
export const PLAN_PREVIEW_DAILY_LIMIT = 20;
export const PLAN_PREVIEW_MINUTE_LIMIT = 3;
export const PLAN_PREVIEW_MAX_LIVE_OBJECTS = 9;
export const PLAN_PREVIEW_RATE_LIMITED = "PLAN_PREVIEW_RATE_LIMITED";
export const SAMPLE_CONTENT_IN_ARTIFACT = "SAMPLE_CONTENT_IN_ARTIFACT";
/** The object-store prefix every plan preview lives under (the lifecycle rule's scope). */
export const PLAN_PREVIEW_PREFIX = "plan-previews/";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** `plan-previews/{brand_id}/plan-{128-bit nonce}/{sha256}.json` — the prefix and the `plan-` marker are required. */
const PLAN_KEY = new RegExp(`^plan-previews/(${UUID})/(plan-[0-9a-f]{32})/([0-9a-f]{64})\\.json$`);

export type PlanPreviewKey = { key: string; brandId: string; previewId: string; digest: string };

export function parsePlanPreviewKey(raw: string | null | undefined): PlanPreviewKey | null {
  if (typeof raw !== "string" || raw.length > 256) return null;
  const match = PLAN_KEY.exec(raw);
  if (!match) return null;
  return { key: raw, brandId: match[1]!, previewId: match[2]!, digest: match[3]! };
}

export function planPreviewKey(brandId: string, nonceHex: string, digest: string): string {
  const key = `plan-previews/${brandId.toLowerCase()}/plan-${nonceHex}/${digest}.json`;
  if (!parsePlanPreviewKey(key)) throw new Error("VALIDATION_FAILED");
  return key;
}

/** True when `generatedAt` is a valid instant no older than 24 h (and not from the future). */
export function planPreviewFresh(generatedAt: unknown, now: number = Date.now()): boolean {
  if (typeof generatedAt !== "string") return false;
  const at = Date.parse(generatedAt);
  return Number.isFinite(at) && at <= now + 60_000 && now - at <= PLAN_PREVIEW_TTL_MS;
}

/* ───────────────────────── Ari's three picks (§2.4) ───────────────────────── */

export type PlanPreviewPick = { key: DesignKey; rank: 1 | 2 | 3; reason: string };

/**
 * The preview's styles: the top 3 of `styleFit` that are not ✕ and are
 * shipped designs. Deterministic for the same inputs (SC-PP2). Never a ✕.
 */
export function planPreviewPicks(format: FormatKey, signals: StyleSignals = {}): PlanPreviewPick[] {
  return topStylePicks(format, signals, 10)
    .filter((fit: StyleFit) => isDesignKey(fit.style) && fit.fit !== "avoid")
    .slice(0, PLAN_PREVIEW_MAX_STYLES)
    .map((fit: StyleFit, index: number) => ({ key: fit.style, rank: (index + 1) as 1 | 2 | 3, reason: fit.reason }));
}

/** The requested styles, or Ari's picks when none were named. A ✕ style is never composed here. */
export function planPreviewStyles(format: FormatKey, requested: unknown, signals: StyleSignals = {}): DesignKey[] | null {
  if (requested === undefined || requested === null) return planPreviewPicks(format, signals).map((pick) => pick.key);
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > PLAN_PREVIEW_MAX_STYLES) return null;
  const keys: DesignKey[] = [];
  for (const value of requested) {
    if (!isDesignKey(value) || keys.includes(value)) return null;
    if (styleFitLevel(format, value) === "avoid") return null;
    keys.push(value);
  }
  return keys;
}

/** The fixed "Ari skipped …" line under the cards. */
export function planPreviewSkippedLine(format: FormatKey): string {
  return skippedLine(format);
}

/* ───────────────────────── sample content (§2.5) ───────────────────────── */

/** The strip every plan-preview page with sample content shows. */
export const SAMPLE_STRIP = "Sample listings. Your real Mingla listings replace these when you add them.";
/** The card subtitle when a preview carries any sample. */
export const SAMPLE_SUBTITLE = "Your name and details, sample listings";
export const SAMPLE_TAG = "Sample";

/** True when `value` holds a `sample` key anywhere (depth-limited walk). */
export function containsSampleContent(value: unknown, depth = 0): boolean {
  if (depth > 40 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => containsSampleContent(entry, depth + 1));
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "sample" || key === "plan_samples" || key === "preview_kind") return true;
    if (containsSampleContent(entry, depth + 1)) return true;
  }
  return false;
}

/**
 * I-SITES-SAMPLE-NEVER-PUBLISHED — the publication and site-preview
 * validators refuse any artifact carrying sample content or the plan marker.
 */
export function assertNoSampleContent(artifact: unknown): void {
  if (containsSampleContent(artifact)) throw new Error(SAMPLE_CONTENT_IN_ARTIFACT);
}

/** One labelled sample listing (text only: no price, count, rating, review or person). */
export type PlanSampleListing = {
  sample: true;
  kind: "trip" | "event" | "experience" | "stay";
  title: string;
  summary: string;
};

export type PlanSamples = { strip: string; listings: PlanSampleListing[] };

const SAMPLE_KINDS = new Set(["trip", "event", "experience", "stay"]);
const SAMPLE_TEXT = /^[^<>{}\u0000-\u001f]{1,200}$/;

export function isPlanSamples(value: unknown): value is PlanSamples {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => key !== "strip" && key !== "listings")) return false;
  if (v.strip !== SAMPLE_STRIP || !Array.isArray(v.listings) || v.listings.length > 24) return false;
  return v.listings.every((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const r = row as Record<string, unknown>;
    return Object.keys(r).every((key) => ["sample", "kind", "title", "summary"].includes(key)) &&
      r.sample === true && SAMPLE_KINDS.has(String(r.kind)) &&
      typeof r.title === "string" && SAMPLE_TEXT.test(r.title) &&
      typeof r.summary === "string" && SAMPLE_TEXT.test(r.summary);
  });
}

/**
 * Splits a plan artifact into its ordinary v2 body (which the caller then
 * validates with the normal contract) and its plan-only parts. Throws
 * NOT_PLAN_PREVIEW when the marker is missing or the samples are malformed.
 */
export function splitPlanArtifact(value: Record<string, unknown>): { body: Record<string, unknown>; samples: PlanSamples | null } {
  if (value.preview_kind !== "plan") throw new Error("NOT_PLAN_PREVIEW");
  const { preview_kind: _kind, plan_samples: samples, ...body } = value;
  void _kind;
  if (samples !== undefined && !isPlanSamples(samples)) throw new Error("NOT_PLAN_PREVIEW");
  if (containsSampleContent(body)) throw new Error(SAMPLE_CONTENT_IN_ARTIFACT);
  return { body, samples: (samples as PlanSamples | undefined) ?? null };
}

/* ───────────────────────── cache key (§2.3) ───────────────────────── */

export type PlanPreviewCacheInput = {
  plan_revision: number;
  brand_name: string;
  logo_digest: string | null;
  /** The feed's `generated_at` hour plus its row ids (and versions when known). */
  feed_digest: string;
  style: string;
  format: string;
  main_action: string | null;
  taken_digest: string;
};

/** The canonical string the cache key is the sha-256 of (field order fixed). */
export function planPreviewCacheMaterial(input: PlanPreviewCacheInput): string {
  return JSON.stringify([
    "plan-preview/v1",
    input.plan_revision,
    input.brand_name,
    input.logo_digest,
    input.feed_digest,
    input.style,
    input.format,
    input.main_action,
    input.taken_digest,
  ]);
}

/** The feed part of the cache key: the generated hour and every row id, sorted. */
export function planPreviewFeedMaterial(feed: { generated_at?: unknown; offerings?: unknown } | null): string {
  const hour = typeof feed?.generated_at === "string" ? feed.generated_at.slice(0, 13) : "none";
  const ids = Array.isArray(feed?.offerings)
    ? (feed!.offerings as { id?: unknown; status?: unknown }[]).map((row) => `${String(row?.id)}:${String(row?.status ?? "")}`).sort()
    : [];
  return `${hour}|${ids.join(",")}`;
}

/* ───────────────────────── confirm sheet copy (§2.1 step 4) ───────────────────────── */

const FORMAT_NOUN: Readonly<Record<FormatKey, string>> = {
  trips: "trip",
  events: "event",
  experiences: "experience",
  restaurants: "menu",
  play: "session",
  art: "exhibition",
  hotels: "room",
};

export function planBuildSentence(pageLabels: readonly string[], format: FormatKey): string {
  const labels = pageLabels.length ? pageLabels.join(", ") : "Home";
  const count = Math.max(1, pageLabels.length);
  // Venue formats have no per-listing pages (restaurants: the menu sits on a page).
  const each = format === "restaurants" ? "" : `, plus a page for each ${FORMAT_NOUN[format]}`;
  return `Ari builds ${count} ${count === 1 ? "page" : "pages"}: ${labels}${each}.`;
}
