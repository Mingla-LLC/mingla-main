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
 *   GET  /v1/brands/<id>/setup-content              #4453 staged reviews, destinations, stories (rank 20)
 *   POST /v1/brands/<id>/setup-content              #4453 create / update / delete one (reviews rank 50)
 *   POST /v1/brands/<id>/past-trips                 #4453 a trip run before Mingla (rank 50)
 *   POST /v1/brands/<id>/plan-previews              #4453 M10 three-style preview (rank 20; planPreview.ts)
 *
 * Every check is Core's (the RPCs re-derive the caller's rank from the user
 * JWT); this module only maps routes and refusals. "Create website draft" is
 * recorded on the plan ONLY after Studio answered that the pages exist (no
 * fabricated tick), with exactly the pages Studio reported.
 */
import { brandFlagOn, composeFacts } from "./designPass.ts";
import { handlePlanPreviewRoute, planPreviewOn } from "./planPreview.ts";
import { sitesJson } from "../_shared/sitesContracts.ts";
import { PLANNED_PAGE_ORDER, splitBrandDescription } from "../_shared/siteContracts/sitePlan.ts";
import { isDesignKey } from "../_shared/siteContracts/designs.ts";

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
  | "NOT_FOUND"
  | "USE_WEBSITE_CONTENT"
  | "REVIEW_NOT_CONFIRMED"
  | "PAST_TRIP_NOT_ENDED"
  | "SETUP_LIMIT_REACHED"
  | "NOT_AVAILABLE"
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
  NOT_FOUND: "That entry isn't there any more. Here is the latest.",
  USE_WEBSITE_CONTENT: "Your website draft exists, so add these in Website: Reviews, Destinations and Stories.",
  REVIEW_NOT_CONFIRMED: "Tick \"This is a real review from a real guest\" to save it.",
  PAST_TRIP_NOT_ENDED: "Past trips must have ended. Add upcoming trips from Create.",
  NOT_AVAILABLE: "This part of Website setup isn't available for your brand yet.",
  SETUP_LIMIT_REACHED: "You've added the most this part takes. Add more in Website once your draft exists.",
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
    // #4453 — the setup part "What guests say and where you've been".
    ["sites_not_found", "NOT_FOUND", 404],
    ["sites_use_website_content", "USE_WEBSITE_CONTENT", 409],
    ["sites_setup_content_materialized", "USE_WEBSITE_CONTENT", 409],
    ["sites_review_not_confirmed", "REVIEW_NOT_CONFIRMED", 400],
    ["historical_trip_not_ended", "PAST_TRIP_NOT_ENDED", 400],
    ["historical_trip_invalid", "VALIDATION_FAILED", 400],
    ["sites_setup_limit_reached", "SETUP_LIMIT_REACHED", 409],
    ["sites_feature_off", "NOT_AVAILABLE", 404],
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
  // #4453 milestone 10 — SITES_PLAN_PREVIEW (planPreview.ts).
  const planPreview = await handlePlanPreviewRoute(path, method, input, ctx);
  if (planPreview) return planPreview;
  const plan = path.match(/^\/v1\/brands\/([^/]+)\/site-plan(?:\/(heartbeat|take-over|design))?$/);
  const start = path.match(/^\/v1\/brands\/([^/]+)\/site-start-request$/);
  const compose = path.match(/^\/v1\/brands\/([^/]+)\/site\/compose-from-plan$/);
  const setupContent = path.match(/^\/v1\/brands\/([^/]+)\/setup-content$/);
  const pastTrips = path.match(/^\/v1\/brands\/([^/]+)\/past-trips$/);
  const brandId = (plan ?? start ?? compose ?? setupContent ?? pastTrips)?.[1];
  if (brandId === undefined) return null;
  if (!UUID.test(brandId)) return planFailure("VALIDATION_FAILED", 400);

  if (plan && !plan[2] && method === "GET") {
    const { data, error } = await ctx.userRpc("brand_site_plan_get", { p_brand_id: brandId });
    if (error) return planFailureFromRpc(error.message);
    const joined = await withBrandCompleteness(ctx, brandId, data);
    if (joined.error) return planFailureFromRpc(joined.error.message);
    // #4453 — SITES_STYLE_LIBRARY for this brand (Core's value): which styles the look picker offers.
    const styleLibrary = await brandFlagOn(ctx.serviceRpc, "SITES_STYLE_LIBRARY", brandId);
    // #4453 milestone 11 — SITES_ARI_ADD_PAGE for this brand: the Host app shows "Add a page with Ari" only while it is on.
    const ariAddPage = await brandFlagOn(ctx.serviceRpc, "SITES_ARI_ADD_PAGE", brandId);
    // #4453 milestone 10 — SITES_PLAN_PREVIEW for this brand: only then is plan_preview present (flag off = the same body as before).
    const planPreview = await planPreviewOn(ctx.serviceRpc, brandId);
    const body = joined.data && typeof joined.data === "object" && !Array.isArray(joined.data)
      ? {
        ...(joined.data as JsonObject),
        style_library: styleLibrary,
        ari_add_page: ariAddPage,
        ...(planPreview ? { plan_preview: true } : {}),
      }
      : joined.data;
    return sitesJson({ ok: true, data: body });
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
    // #4453 I-SITES-DESIGN-KEYS-ONE-LIST — the generated DESIGN_KEYS, never a literal list.
    if (!Number.isInteger(revision) || !isDesignKey(designKey)) {
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
  if (setupContent || pastTrips) return handleSetupProofRoute(Boolean(pastTrips), brandId, method, input, ctx);
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
    // #4453 — the owner's staged setup entries go to Studio with Build, and
    // composed sections start Draft while SITES_PROOF_PART is on.
    const proof = await proofForCompose(ctx, brandId);
    if (proof.error) return planFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503, operationId);
    const words = splitBrandDescription(typeof brand.description === "string" ? brand.description : null);
    // #4453 milestone 7 — SITES_ARI_DESIGN_PASS (this brand, from Core): Build
    // runs composer v2 from the owner's own answers and Mingla's facts, and
    // every composed section starts Draft.
    const designPass = await designPassForCompose(ctx, siteId, brandId, inputs);
    if (designPass === "error") return planFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503, operationId);
    // #4453 — SITES_BOOKING_BLOCKS, signed in by Core (never the caller), the
    // same way the content route signs it: Studio's page gate lets composed
    // booking blocks be added only while it is on; off or unreadable, Studio
    // composes none instead of failing the draft.
    const bookingFlag = await ctx.serviceRpc("brand_site_booking_blocks_enabled", {});
    const bookingBlocks = !bookingFlag.error && bookingFlag.data === true;
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
        ...(proof.reviewDrafts || designPass ? { review_drafts: true } : {}),
        ...(proof.rows.length ? { setup_content: proof.rows } : {}),
        ...(designPass ? { design_pass: designPass } : {}),
        ...(bookingBlocks ? { booking_blocks: true } : {}),
      },
    });
    if (!cms.ok) return cms;
    const composed = ((await cms.json()) as { data?: { pages?: unknown; materialized?: unknown } }).data ?? {};
    // #4453 — stamp each staged entry Studio created (idempotent in Core).
    const materialized = materializedRows(composed.materialized, proof.rows);
    if (materialized.length) {
      const stamped = await ctx.serviceRpc("brand_site_setup_content_mark_materialized", {
        p_brand_id: brandId,
        p_rows: materialized,
      });
      if (stamped.error) return planFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503, operationId);
    }
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

/*
 * #4453 (spec v1 §3.3-3.4) — the setup part "What guests say and where
 * you've been". Core is the gate: each RPC re-derives the member's rank
 * (reviews need a brand admin or owner, who confirms they are real), and
 * once a site exists the workspace is the only home (USE_WEBSITE_CONTENT).
 * Every value is the owner's own words; this module only shapes the call.
 */
const SETUP_KINDS = new Set(["review", "destination", "story"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function handleSetupProofRoute(
  pastTrip: boolean,
  brandId: string,
  method: string,
  input: JsonObject,
  ctx: SitePlanContext,
): Promise<Response> {
  // #4453 — every setup-part route is off while SITES_PROOF_PART is off (the RPCs check again).
  const flag = await ctx.serviceRpc("brand_site_proof_part_enabled", {});
  if (flag.error || flag.data !== true) return planFailure("NOT_AVAILABLE", 404);
  if (pastTrip) {
    if (method !== "POST") return planFailure("VALIDATION_FAILED", 405);
    const field = (key: string, max: number): string | null =>
      typeof input[key] === "string" && (input[key] as string).length <= max ? (input[key] as string) : null;
    const start = field("start_date", 10);
    const end = field("end_date", 10);
    const title = field("title", 200);
    const where = field("where", 200);
    const timezone = field("timezone", 64);
    const description = input.description === undefined || input.description === null ? null : field("description", 1000);
    if (!title || !where || !timezone || !start || !end || !DATE.test(start) || !DATE.test(end) ||
      (input.description !== undefined && input.description !== null && description === null)) {
      return planFailure("VALIDATION_FAILED", 400);
    }
    const { data, error } = await ctx.serviceRpc("brand_site_setup_add_past_trip", {
      p_brand_id: brandId,
      p_user_id: ctx.userId,
      p_title: title,
      p_start_date: start,
      p_end_date: end,
      p_timezone: timezone,
      p_location: where,
      p_description: description,
    });
    return error ? planFailureFromRpc(error.message) : sitesJson({ ok: true, data });
  }
  if (method === "GET") {
    const { data, error } = await ctx.serviceRpc("brand_site_setup_content_list", { p_brand_id: brandId, p_user_id: ctx.userId });
    return error ? planFailureFromRpc(error.message) : sitesJson({ ok: true, data });
  }
  if (method !== "POST") return planFailure("VALIDATION_FAILED", 405);
  const kind = input.kind;
  const id = input.id === undefined || input.id === null ? null : input.id;
  const remove = input.delete === true;
  if (typeof kind !== "string" || !SETUP_KINDS.has(kind) || (id !== null && (typeof id !== "string" || !UUID.test(id)))) {
    return planFailure("VALIDATION_FAILED", 400);
  }
  const payload = input.payload;
  if (!remove && (!payload || typeof payload !== "object" || Array.isArray(payload))) return planFailure("VALIDATION_FAILED", 400);
  const expected = typeof input.updated_at === "string" ? input.updated_at : null;
  const { data, error } = await ctx.serviceRpc("brand_site_setup_content_save", {
    p_brand_id: brandId,
    p_user_id: ctx.userId,
    p_kind: kind,
    p_id: id,
    p_payload: remove ? {} : payload,
    p_confirmed_real: input.confirmed_real === true,
    p_expected_updated_at: expected,
    p_delete: remove,
  });
  if (error) {
    // A teammate saved first: the caller gets the latest list, never a silent overwrite.
    if (error.message.includes("sites_revision_conflict")) {
      const latest = await ctx.serviceRpc("brand_site_setup_content_list", { p_brand_id: brandId, p_user_id: ctx.userId });
      return sitesJson({
        ok: false,
        error: { code: "REVISION_CONFLICT", message: MESSAGES.REVISION_CONFLICT, retryable: false, operation_id: null },
        latest: latest.error ? null : latest.data,
      }, 409);
    }
    return planFailureFromRpc(error.message);
  }
  return sitesJson({ ok: true, data });
}

type StagedRow = { id: string; kind: string; payload: JsonObject; confirmed_real_by: string | null };

/**
 * #4453 milestone 7 — what Build sends Studio for composer v2 while
 * SITES_ARI_DESIGN_PASS covers this brand: the chosen design, the owner's own
 * Q5-Q8 answers (verbatim), the brand's address and Mingla's facts. Null when
 * the flag is off (Build stays composer v1, unchanged); "error" when a read
 * failed.
 */
async function designPassForCompose(ctx: SitePlanContext, siteId: string, brandId: string, inputs: JsonObject): Promise<JsonObject | null | "error"> {
  if (!(await brandFlagOn(ctx.serviceRpc, "SITES_ARI_DESIGN_PASS", brandId))) return null;
  const feed = await ctx.serviceRpc("brand_site_offerings_feed", { p_site_id: siteId });
  const rows = feed.error ? null : (feed.data as { offerings?: unknown } | null)?.offerings;
  if (!Array.isArray(rows)) return "error";
  const brand = (inputs.brand ?? {}) as JsonObject;
  return {
    design_key: typeof inputs.design_key === "string" ? inputs.design_key : null,
    answers: {
      value_points: Array.isArray(inputs.value_points) ? inputs.value_points : [],
      faq: Array.isArray(inputs.faq) ? inputs.faq : [],
      process_steps: Array.isArray(inputs.process_steps) ? inputs.process_steps : [],
      quick_facts: inputs.quick_facts && typeof inputs.quick_facts === "object" ? inputs.quick_facts : null,
    },
    address: typeof brand.address === "string" && brand.address.trim() ? brand.address.trim().slice(0, 300) : null,
    facts: await composeFacts(ctx.serviceRpc, siteId, rows as JsonObject[]),
  };
}

/** What Build sends Studio: SITES_PROOF_PART and the unmaterialised staged rows. */
async function proofForCompose(ctx: SitePlanContext, brandId: string): Promise<{ error: boolean; reviewDrafts: boolean; rows: StagedRow[] }> {
  const flag = await ctx.serviceRpc("brand_site_proof_part_enabled", {});
  // Before the migration is applied the flag reads as off (Build is unchanged).
  if (flag.error || flag.data !== true) return { error: false, reviewDrafts: false, rows: [] };
  const pending = await ctx.serviceRpc("brand_site_setup_content_pending", { p_brand_id: brandId });
  if (pending.error || !Array.isArray(pending.data)) return { error: true, reviewDrafts: true, rows: [] };
  const rows = (pending.data as JsonObject[]).flatMap((row) => {
    if (!row || typeof row.id !== "string" || !UUID.test(row.id) || typeof row.kind !== "string" || !SETUP_KINDS.has(row.kind)) return [];
    if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) return [];
    const confirmer = typeof row.confirmed_real_by === "string" && UUID.test(row.confirmed_real_by) ? row.confirmed_real_by : null;
    // Constitution rule 9: a review without its confirmer never leaves Core.
    if (row.kind === "review" && !confirmer) return [];
    return [{ id: row.id, kind: row.kind, payload: row.payload as JsonObject, confirmed_real_by: confirmer }];
  });
  return { error: false, reviewDrafts: true, rows };
}

/** Studio's answer, kept only for rows Core sent (never an id it made up). */
export function materializedRows(value: unknown, sent: readonly StagedRow[]): { id: string; entry_id: string }[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set(sent.map((row) => row.id));
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as JsonObject;
    const id = typeof record.id === "string" ? record.id.toLowerCase() : "";
    const entry = typeof record.entry_id === "string" || typeof record.entry_id === "number" ? String(record.entry_id) : "";
    return ids.has(id) && entry.length > 0 && entry.length <= 80 ? [{ id, entry_id: entry }] : [];
  });
}
