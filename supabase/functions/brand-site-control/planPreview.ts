/**
 * #4453 milestone 10 (spec v2.1 §2.2) — "See your site in three styles".
 *
 *   POST /v1/brands/<id>/plan-previews   { plan_revision, styles?: DesignKey[≤3] }
 *
 * Behind SITES_PLAN_PREVIEW (per brand; off = 404 NOT_AVAILABLE, today's
 * behaviour). Core is the gate: `brand_site_plan_preview_inputs` re-derives
 * the caller's rank (content rank 20) and reads the plan and brand, the feed
 * is read BY BRAND (a preview runs before any site exists), the rate limit is
 * Core's counter (3 a minute, 20 a day), and the picks are the deterministic
 * `styleFit` (no model call). Studio composes the three styles in a dry run
 * and writes only `plan-previews/` objects: nothing here writes a site, page,
 * setting, menu, media or work-log row (I-SITES-PLAN-PREVIEW-WRITES-NOTHING).
 *
 * The signed envelope's `site_id` slot carries the BRAND id for this one path
 * (there may be no site yet); Studio checks it equals the body's brand id.
 */
import { sitesJson } from "../_shared/sitesContracts.ts";
import { splitBrandDescription, mainActionPage } from "../_shared/siteContracts/sitePlan.ts";
import {
  planPreviewPicks,
  planPreviewSkippedLine,
  planPreviewStyles,
  PLAN_PREVIEW_RATE_LIMITED,
} from "../_shared/siteContracts/planPreview.ts";
import { primaryFormat, styleFormat, type FormatKey } from "../_shared/siteContracts/formats.ts";
import { composeFacts, liveFingerprints, type ServiceRpc } from "./designPass.ts";
import { planFailure, planFailureFromRpc, type SitePlanContext } from "./sitePlan.ts";

type JsonObject = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PLAN_PREVIEW_PATH = "/api/internal/plan-preview";

/** SITES_PLAN_PREVIEW for this brand (Core's value; a failed read is off). */
export async function planPreviewOn(rpc: ServiceRpc, brandId: string): Promise<boolean> {
  const { data, error } = await rpc("brand_site_plan_preview_on", { p_brand_id: brandId });
  return !error && data === true;
}

function rateLimited(): Response {
  return sitesJson({
    ok: false,
    error: { code: PLAN_PREVIEW_RATE_LIMITED, message: "Try again in a minute.", retryable: true, operation_id: null },
  }, 429);
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** Handles the plan-preview route, or returns null when the path is not it. */
export async function handlePlanPreviewRoute(
  path: string,
  method: string,
  input: JsonObject,
  ctx: SitePlanContext,
): Promise<Response | null> {
  const match = path.match(/^\/v1\/brands\/([^/]+)\/plan-previews$/);
  if (!match) return null;
  const brandId = match[1]!;
  if (!UUID.test(brandId)) return planFailure("VALIDATION_FAILED", 400);
  if (method !== "POST") return planFailure("VALIDATION_FAILED", 405);
  // Flag off: the route does not exist (today's behaviour).
  if (!(await planPreviewOn(ctx.serviceRpc, brandId))) return planFailure("NOT_AVAILABLE", 404);
  const revision = input.plan_revision;
  if (!Number.isInteger(revision)) return planFailure("VALIDATION_FAILED", 400);

  const read = await ctx.userRpc("brand_site_plan_preview_inputs", { p_brand_id: brandId });
  if (read.error) return planFailureFromRpc(read.error.message);
  const inputs = (read.data ?? {}) as JsonObject;
  if (inputs.brand_id !== brandId) return planFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
  if (inputs.revision !== revision) return planFailure("REVISION_CONFLICT", 409);
  const offerings = Array.isArray(inputs.offerings_selected)
    ? (inputs.offerings_selected as unknown[]).filter((key): key is string => typeof key === "string")
    : [];
  const story = inputs.story && typeof inputs.story === "object" && !Array.isArray(inputs.story) ? inputs.story as JsonObject : null;
  const mainAction = typeof story?.main_action === "string" ? story.main_action : null;
  const format: FormatKey | null = primaryFormat({ offerings_selected: offerings, main_action_page: mainActionPage(mainAction, offerings) });
  if (!format) return planFailure("PLAN_NOT_READY", 409);
  // #4572 item 6 — styles (picks, fingerprints, the skipped line) are judged by
  // the style format; Studio still composes the pages by the primary format.
  const styleKey: FormatKey = styleFormat({ offerings_selected: offerings, main_action_page: mainActionPage(mainAction, offerings) }) ?? format;

  const live = await liveFingerprints(ctx.serviceRpc, styleKey, brandId);
  const taken = live.flatMap((row) => row && typeof row === "object" && typeof (row as JsonObject).design === "string" ? [(row as JsonObject).design as string] : []);
  const signals = { venue_descriptor: typeof inputs.venue_descriptor === "string" ? inputs.venue_descriptor : null, taken: taken as never };
  const styles = planPreviewStyles(styleKey, input.styles, signals);
  // A ✕ style, an unknown key or more than three are refused (never composed).
  // Studio checks the styles against the primary format too, so both must pass.
  if (!styles || planPreviewStyles(format, styles, signals) === null) return planFailure("VALIDATION_FAILED", 400);

  const take = await ctx.serviceRpc("brand_site_plan_preview_take", { p_brand_id: brandId });
  if (take.error) return planFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
  if ((take.data as JsonObject | null)?.allowed !== true) return rateLimited();

  const feed = await ctx.serviceRpc("brand_site_offerings_feed_for_brand", { p_brand_id: brandId });
  const rows = feed.error ? null : (feed.data as { offerings?: unknown } | null)?.offerings;
  if (!Array.isArray(rows)) return planFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
  const siteId = typeof inputs.site_id === "string" && UUID.test(inputs.site_id) ? inputs.site_id : null;
  // The facts Build will compose with (SC-PP4): the site's reads when a site
  // exists, else the brand twins of the same reads (one body, same answers).
  const facts = await composeFacts(ctx.serviceRpc, siteId ?? { brandId }, rows as JsonObject[]);
  const brand = (inputs.brand ?? {}) as JsonObject;
  const words = splitBrandDescription(typeof brand.description === "string" ? brand.description : null);
  const picks = planPreviewPicks(styleKey, signals);
  const operationId = crypto.randomUUID();

  const cms = await ctx.callCms({
    siteId: brandId,
    operationId,
    path: PLAN_PREVIEW_PATH,
    payload: {
      kind: "plan_preview",
      brand_id: brandId,
      plan_revision: revision,
      format,
      styles,
      plan: { offerings_selected: offerings, venue_descriptor: text(inputs.venue_descriptor, 60), story },
      answers: {
        value_points: Array.isArray(inputs.value_points) ? inputs.value_points : [],
        faq: Array.isArray(inputs.faq) ? inputs.faq : [],
        process_steps: Array.isArray(inputs.process_steps) ? inputs.process_steps : [],
        quick_facts: inputs.quick_facts && typeof inputs.quick_facts === "object" ? inputs.quick_facts : null,
      },
      // Only Mingla's own brand fields: Studio writes no text it was not given.
      brand: {
        name: typeof brand.name === "string" ? brand.name.slice(0, 120) : "",
        tagline: words.tagline ? words.tagline.slice(0, 300) : null,
        bio: words.bio ? words.bio.slice(0, 5000) : null,
        contact_email: typeof brand.contact_email === "string" && brand.contact_email.includes("@") ? brand.contact_email.slice(0, 254) : null,
        city: text(brand.city, 120),
      },
      address: text(brand.address, 300),
      facts,
      feed: feed.data,
      live_fingerprints: live,
    },
  });
  if (!cms.ok) return cms;
  const studio = ((await cms.json()) as { data?: JsonObject }).data ?? {};
  const previews = Array.isArray(studio.previews) ? studio.previews as JsonObject[] : [];
  return sitesJson({
    ok: true,
    data: {
      format,
      picks,
      skipped_line: planPreviewSkippedLine(styleKey),
      previews: previews.flatMap((row) => typeof row?.key === "string" && typeof row?.style === "string" ? [row] : []),
      preview_origin: typeof studio.preview_origin === "string" ? studio.preview_origin : null,
      has_samples: studio.has_samples === true,
      generated_at: typeof studio.generated_at === "string" ? studio.generated_at : null,
      cached: studio.cached === true,
    },
  });
}
