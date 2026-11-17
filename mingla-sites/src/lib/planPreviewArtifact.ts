import { sha256 } from "./crypto";
import { runtimeConfig } from "./config";
import { assertSiteArtifact } from "./siteArtifact";
import { readPrivateObject } from "./storageReader";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import type { SiteOffering } from "../contracts/generated/offerings.ts";
import {
  PLAN_PREVIEW_HOST,
  parsePlanPreviewKey,
  planPreviewFresh,
  splitPlanArtifact,
  type PlanPreviewKey,
  type PlanSamples,
} from "../contracts/generated/planPreview.ts";

/**
 * #4453 milestone 10 (spec v2.1 §2.2 step 4) — load a PLAN preview: the
 * ephemeral artifact Studio composed from the brand's plan before any site
 * exists. Served ONLY on the reserved preview host (`preview.sites.usemingla.com`;
 * in local mode a loopback or `preview.sites.localhost` host): a plan key on a
 * site host is a 404, and a site preview key on this host is a 404 (the
 * /preview route resolves a site for the host, and this host has none).
 *
 * The key is the capability (128-bit nonce, `plan-previews/` prefix and the
 * `plan-` marker required). The bytes are re-hashed against the key, the
 * brand in the key must be the artifact's, the artifact must be no older than
 * 24 h, and its body must pass the ordinary v2 contract once the plan-only
 * parts (`preview_kind`, `plan_samples`) are split off.
 */
export const PLAN_PREVIEW_PATHNAME = "/plan-preview";
/** The header proxy.ts sets on /plan-preview requests (the plan key), read by the layout. */
export const PLAN_PREVIEW_KEY_HEADER = "x-mingla-plan-preview-key";

export function isPlanPreviewHost(host: string | null | undefined, localMode: boolean): boolean {
  if (typeof host !== "string") return false;
  const name = host.toLowerCase().replace(/:\d+$/, "");
  if (name === PLAN_PREVIEW_HOST) return true;
  return localMode && (name === "preview.sites.localhost" || name === "localhost" || name === "127.0.0.1");
}

export type PlanPreview = { artifact: ArtifactV2; samples: PlanSamples | null; key: PlanPreviewKey };

export async function loadPlanPreviewArtifact(rawKey: string | null | undefined, host: string | null | undefined, now = Date.now()): Promise<PlanPreview> {
  const config = runtimeConfig();
  const key = parsePlanPreviewKey(rawKey);
  if (!key || !isPlanPreviewHost(host, config.mode === "local")) throw new Error("NOT_FOUND");
  const response = await readPrivateObject(config.artifactBucket, key.key, "no-store");
  if (!response.ok) throw new Error("NOT_FOUND");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256(bytes)) !== key.digest) throw new Error("NOT_FOUND");
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  const { body, samples } = splitPlanArtifact(parsed);
  if (String(body.brand_id).toLowerCase() !== key.brandId || !planPreviewFresh(body.generated_at, now)) throw new Error("NOT_FOUND");
  assertSiteArtifact(body, 2, bytes.byteLength);
  return { artifact: body as unknown as ArtifactV2, samples, key };
}

/** Stable ids for sample rows (never a real Mingla id: the `5a3p1e` prefix is not hex-random). */
/*
 * A sample has no date of its own. Its `start_at` is set one sort-only step
 * after `now` so an "upcoming" grid includes it; the card's dates are blanked,
 * it carries no price or link, and structured data skips it, so no date is
 * ever shown or published for a sample.
 */
export function sampleOfferings(samples: PlanSamples | null, now: Date = new Date()): (SiteOffering & { sample: true })[] {
  if (!samples) return [];
  const sortOnly = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  return samples.listings.map((row, index) => ({
    id: `00000000-5a3e-4000-8000-${String(index + 1).padStart(12, "0")}`,
    kind: row.kind,
    slug: `sample-${index + 1}`,
    title: row.title,
    summary: row.summary,
    cover: null,
    destination_text: null,
    start_at: row.kind === "stay" || row.kind === "experience" ? null : sortOnly,
    end_at: null,
    timezone: null,
    status: "scheduled",
    bookings_closed: false,
    capacity: null,
    spots_left: null,
    group_minimum: null,
    min_price_minor: null,
    currency: null,
    has_free_tier: false,
    public_url: "https://host.usemingla.com/",
    waitlist_enabled: false,
    installments_available: false,
    sample: true,
  }) as SiteOffering & { sample: true });
}
