/**
 * #2829 W9a (AD-11) — the website plan routes of brand-site-control.
 *
 *   GET  /v1/brands/<id>/site-plan                  plan + done-checks + lock (rank 20)
 *   POST /v1/brands/<id>/site-plan                  save {revision, patch} (rank 50; active_part rank 20)
 *   POST /v1/brands/<id>/site-plan/heartbeat        keep or take a free lock (rank 50)
 *   POST /v1/brands/<id>/site-plan/take-over        (rank 50)
 *   POST /v1/brands/<id>/site-plan/design           pre-draft design choice (rank 50)
 *   POST /v1/brands/<id>/site-start-request         "Ask an admin to start it" (rank 20 / 40)
 *   POST /v1/brands/<id>/site/compose-from-plan     "Create website draft" (rank 50)
 *
 * Every check is Core's (the RPCs re-derive the caller's rank from the user
 * JWT); this module only maps routes and refusals. "Create website draft" is
 * recorded on the plan ONLY after Studio answered that the pages exist (no
 * fabricated tick), with exactly the pages Studio reported.
 */
import { sitesJson } from "../_shared/sitesContracts.ts";
import { PLANNED_PAGE_ORDER, splitBrandDescription } from "../_shared/siteContracts/sitePlan.ts";

type JsonObject = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string } | null };
export type SitePlanContext = {
  userId: string;
  userRpc: (fn: string, args: JsonObject) => Promise<RpcResult>;
  serviceRpc: (fn: string, args: JsonObject) => Promise<RpcResult>;
  /** Signed Core→Studio call (the same signer and receipts as every other route). */
  callCms: (args: { siteId: string; operationId: string; path: string; payload: JsonObject }) => Promise<Response>;
};

export type PlanFailureCode =
  | "FORBIDDEN"
  | "NOT_ENTITLED"
  | "VALIDATION_FAILED"
  | "REVISION_CONFLICT"
  | "PLAN_LOCKED"
  | "PLAN_NOT_READY"
  | "PLAN_PAUSED"
  | "INVALID_STATE"
  | "NO_ADMIN"
  | "SERVICE_TEMPORARILY_UNAVAILABLE";

const MESSAGES: Record<PlanFailureCode, string> = {
  FORBIDDEN: "This Website action is not available for your role.",
  NOT_ENTITLED: "Websites are opening brand by brand, and this brand doesn't have one yet.",
  VALIDATION_FAILED: "Review your answers and try again.",
  REVISION_CONFLICT: "Your website plan changed on another device. Here is the latest.",
  PLAN_LOCKED: "Someone else on your team is working on your website right now.",
  PLAN_NOT_READY: "Finish the earlier parts of your website plan first.",
  PLAN_PAUSED: "Your website is paused by Mingla, so the plan is paused too.",
  INVALID_STATE: "Your website draft isn't ready for that step yet.",
  NO_ADMIN: "This brand has no admin to ask yet.",
  SERVICE_TEMPORARILY_UNAVAILABLE: "Website tools are temporarily unavailable. Please try again.",
};

/**
 * #2829 W11 (A17) — the brand's cover photo as a path in Mingla's public
 * cover storage (`brand_covers/<…>`), or null. A photo cover is used as is; a
 * video or GIF cover offers its still. Covers from anywhere else (stock-photo
 * links) are left out: Studio only ever reads Mingla's own storage.
 */
export function brandCoverPhotoPath(brand: Record<string, unknown>): string | null {
  const type = brand.cover_media_type;
  const url = type === "image" ? brand.cover_media_url : type === "video" || type === "gif" ? brand.cover_media_poster_url : null;
  if (typeof url !== "string") return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = /^\/storage\/v1\/object\/public\/(brand_covers\/[A-Za-z0-9._/-]{1,400})$/.exec(pathname);
  if (!match || match[1].split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  return match[1];
}

export function planFailure(code: PlanFailureCode, status: number, operationId: string | null = null): Response {
  return sitesJson({
    ok: false,
    error: {
      code,
      message: MESSAGES[code],
      retryable: code === "SERVICE_TEMPORARILY_UNAVAILABLE",
      operation_id: operationId,
    },
  }, status);
}

/** Core's refusal → the customer code and HTTP status (unknown → unavailable). */
export function planFailureFromRpc(message: string, operationId: string | null = null): Response {
  const table: Array<[string, PlanFailureCode, number]> = [
    ["sites_forbidden", "FORBIDDEN", 403],
    ["sites_not_entitled", "NOT_ENTITLED", 403],
    ["sites_revision_conflict", "REVISION_CONFLICT", 409],
    ["sites_plan_locked", "PLAN_LOCKED", 409],
    ["sites_context_incomplete", "PLAN_NOT_READY", 409],
    ["sites_plan_not_ready", "PLAN_NOT_READY", 409],
    ["sites_plan_paused", "PLAN_PAUSED", 409],
    ["sites_invalid_state", "INVALID_STATE", 409],
    ["sites_no_admin", "NO_ADMIN", 409],
    ["sites_validation_failed", "VALIDATION_FAILED", 400],
  ];
  const hit = table.find(([needle]) => message.includes(needle));
  return hit ? planFailure(hit[1], hit[2], operationId) : planFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503, operationId);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STUDIO_PAGES = new Set<string>(["home", ...PLANNED_PAGE_ORDER, "about", "contact"]);

/**
 * #2830 — one Website setup read: the plan and its field-level context audit.
 * Both values are derived under the caller JWT. The edge function only joins
 * them so Business and Ari cannot drift into two definitions of readiness.
 */
async function withBrandCompleteness(
  ctx: SitePlanContext,
  brandId: string,
  value: unknown,
): Promise<RpcResult> {
  const { data: completeness, error } = await ctx.userRpc(
    "brand_context_completeness",
    { p_brand_id: brandId },
  );
  if (error) return { data: null, error };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { data: null, error: { message: "sites_invalid_state" } };
  }
  const joined: JsonObject = { ...(value as JsonObject), completeness };
  const plan = joined.plan;
  if (plan && typeof plan === "object" && !Array.isArray(plan)) {
    const audit = completeness && typeof completeness === "object" &&
        !Array.isArray(completeness)
      ? completeness as JsonObject
      : {};
    joined.plan = { ...(plan as JsonObject), design_key: audit.design_key ?? null };
  }
  return { data: joined, error: null };
}

/** Handles a plan route, or returns null when the path is not one. */
export async function handleSitePlanRoute(
  path: string,
  method: string,
  input: JsonObject,
  ctx: SitePlanContext,
): Promise<Response | null> {
  const plan = path.match(/^\/v1\/brands\/([^/]+)\/site-plan(?:\/(heartbeat|take-over|design))?$/);
  const start = path.match(/^\/v1\/brands\/([^/]+)\/site-start-request$/);
  const compose = path.match(/^\/v1\/brands\/([^/]+)\/site\/compose-from-plan$/);
  const brandId = (plan ?? start ?? compose)?.[1];
  if (brandId === undefined) return null;
  if (!UUID.test(brandId)) return planFailure("VALIDATION_FAILED", 400);

  if (plan && !plan[2] && method === "GET") {
    const { data, error } = await ctx.userRpc("brand_site_plan_get", { p_brand_id: brandId });
    if (error) return planFailureFromRpc(error.message);
    const joined = await withBrandCompleteness(ctx, brandId, data);
    return joined.error
      ? planFailureFromRpc(joined.error.message)
      : sitesJson({ ok: true, data: joined.data });
  }
  if (plan && !plan[2] && method === "POST") {
    const revision = input.revision;
    const patch = input.patch;
    if (!Number.isInteger(revision) || !patch || typeof patch !== "object" || Array.isArray(patch)) {
      return planFailure("VALIDATION_FAILED", 400);
    }
    const { data, error } = await ctx.userRpc("brand_site_plan_save", {
      p_brand_id: brandId,
      p_revision: revision,
      p_patch: patch,
    });
    if (error) {
      // #2829 — on a conflict the caller gets the latest plan to re-show,
      // never a silent overwrite.
      if (error.message.includes("sites_revision_conflict")) {
        const latest = await ctx.userRpc("brand_site_plan_get", { p_brand_id: brandId });
        const joined = latest.error
          ? latest
          : await withBrandCompleteness(ctx, brandId, latest.data);
        return sitesJson({
          ok: false,
          error: { code: "REVISION_CONFLICT", message: MESSAGES.REVISION_CONFLICT, retryable: false, operation_id: null },
          latest: joined.error ? null : joined.data,
        }, 409);
      }
      return planFailureFromRpc(error.message);
    }
    const joined = await withBrandCompleteness(ctx, brandId, data);
    return joined.error
      ? planFailureFromRpc(joined.error.message)
      : sitesJson({ ok: true, data: joined.data });
  }
  if (plan && plan[2] === "design" && method === "POST") {
    const revision = input.revision;
    const designKey = input.design_key;
    const sourceType = typeof input.source_type === "string"
      ? input.source_type
      : "owner";
    const sourceUrl = typeof input.source_url === "string"
      ? input.source_url
      : null;
    if (!Number.isInteger(revision) ||
      (designKey !== "atelier" && designKey !== "voyage")) {
      return planFailure("VALIDATION_FAILED", 400);
    }
    const { data, error } = await ctx.userRpc("brand_site_plan_save_design", {
      p_brand_id: brandId,
      p_revision: revision,
      p_design_key: designKey,
      p_source_type: sourceType,
      p_source_url: sourceUrl,
    });
    if (error) return planFailureFromRpc(error.message);
    const joined = await withBrandCompleteness(ctx, brandId, data);
    return joined.error
      ? planFailureFromRpc(joined.error.message)
      : sitesJson({ ok: true, data: joined.data });
  }
  if (plan && plan[2] && method === "POST") {
    const fn = plan[2] === "heartbeat" ? "brand_site_plan_heartbeat" : "brand_site_plan_take_over";
    const { data, error } = await ctx.userRpc(fn, { p_brand_id: brandId });
    if (error) return planFailureFromRpc(error.message);
    const joined = await withBrandCompleteness(ctx, brandId, data);
    return joined.error
      ? planFailureFromRpc(joined.error.message)
      : sitesJson({ ok: true, data: joined.data });
  }
  if (start && method === "POST") {
    const { data, error } = await ctx.userRpc("brand_site_request_start", { p_brand_id: brandId });
    return error ? planFailureFromRpc(error.message) : sitesJson({ ok: true, data });
  }
  if (compose && method === "POST") {
    const operationId = typeof input.operation_id === "string" && UUID.test(input.operation_id)
      ? input.operation_id
      : null;
    if (!operationId) return planFailure("VALIDATION_FAILED", 400);
    const { data, error } = await ctx.userRpc("brand_site_plan_authorize_compose", { p_brand_id: brandId });
    if (error) return planFailureFromRpc(error.message, operationId);
    const inputs = data as JsonObject;
    const siteId = String(inputs.site_id ?? "");
    if (!UUID.test(siteId) || inputs.brand_id !== brandId) {
      return planFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503, operationId);
    }
    const brand = (inputs.brand ?? {}) as JsonObject;
    const words = splitBrandDescription(typeof brand.description === "string" ? brand.description : null);
    const cms = await ctx.callCms({
      siteId,
      operationId,
      path: "/api/internal/compose-from-plan",
      payload: {
        kind: "compose_from_plan",
        site_id: siteId,
        brand_id: brandId,
        user_id: ctx.userId,
        plan: {
          offerings_selected: Array.isArray(inputs.offerings_selected) ? inputs.offerings_selected : [],
          venue_descriptor: typeof inputs.venue_descriptor === "string" ? inputs.venue_descriptor : null,
          story: inputs.story && typeof inputs.story === "object" ? inputs.story : null,
        },
        // Only Mingla's own brand fields: Studio writes no text it was not given.
        brand: {
          name: typeof brand.name === "string" ? brand.name.slice(0, 120) : "",
          tagline: words.tagline ? words.tagline.slice(0, 300) : null,
          bio: words.bio ? words.bio.slice(0, 5000) : null,
          contact_email: typeof brand.contact_email === "string" && brand.contact_email.includes("@")
            ? brand.contact_email.slice(0, 254)
            : null,
          city: typeof brand.city === "string" && brand.city.trim() ? brand.city.trim().slice(0, 120) : null,
          ...(brandCoverPhotoPath(brand) ? { cover_photo_path: brandCoverPhotoPath(brand) } : {}),
        },
      },
    });
    if (!cms.ok) return cms;
    const composed = ((await cms.json()) as { data?: { pages?: unknown } }).data ?? {};
    const pages = Array.isArray(composed.pages)
      ? composed.pages.filter((page): page is string => typeof page === "string" && STUDIO_PAGES.has(page))
      : [];
    if (!pages.includes("home")) return planFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503, operationId);
    const recorded = await ctx.serviceRpc("brand_site_plan_record_build", {
      p_brand_id: brandId,
      p_site_id: siteId,
      p_actor: ctx.userId,
      p_pages: pages,
    });
    if (recorded.error) return planFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503, operationId);
    return sitesJson({ ok: true, data: { ...composed, site_id: siteId, pages } });
  }
  return planFailure("VALIDATION_FAILED", 405);
}
