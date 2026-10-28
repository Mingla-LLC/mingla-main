/**
 * #2829 W9r — the Website content routes of brand-site-control.
 *
 *   POST /v1/sites/<id>/content              { action, operation_id, ...args }
 *   POST /v1/brands/<id>/site-admin-request  { action }  "Ask an admin" (rank 20–49)
 *
 * Core is the gate in front of Studio's tenant-scoped Payload APIs:
 *   1. the action is in a closed list and the member's live rank for it is
 *      checked in SQL (brand_site_content_authorize; one rank list);
 *   2. any Mingla offering id a write names is checked against THIS brand's
 *      live feed (a destination's trips, a review's trip, a hidden past trip,
 *      which must have ended);
 *   3. Studio gets a signed call carrying the site, brand, member and rank —
 *      never a tenant the caller chose;
 *   4. a change is audited (without its words) only after Studio confirmed it;
 *   5. a stale revision comes back with the latest one and the teammate's name.
 * Past trips and the offering pickers are answered from Core's own feed.
 */
import { sitesJson } from "../_shared/sitesContracts.ts";
import { siteEvidence } from "./siteAri.ts";

type JsonObject = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string } | null };

export type CmsRawResult = { status: number; body: JsonObject | null };

export type SiteContentContext = {
  userId: string;
  userRpc: (fn: string, args: JsonObject) => Promise<RpcResult>;
  serviceRpc: (fn: string, args: JsonObject) => Promise<RpcResult>;
  /** Signed Core→Studio call; the answer comes back unmapped (or null when Studio can't be reached). */
  callCmsRaw: (args: { siteId: string; operationId: string; path: string; payload: JsonObject }) => Promise<CmsRawResult | null>;
  /** The live version's stored artifact key, or null before the first publish. */
  activeArtifactKey: (siteId: string) => Promise<string | null>;
  /** Cover image URLs of this brand's trips (the address the Business app already shows). */
  tripCovers: (brandId: string, ids: string[]) => Promise<Record<string, string>>;
  /** #2829 W9b — the brand's own words (name, description, city) for the truth check. */
  readBrand?: (brandId: string) => Promise<JsonObject | null>;
  now?: () => number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORE_ONLY_ACTIONS = new Set(["offerings", "past_trips"]);
const STUDIO_ACTIONS = new Set([
  "list", "get", "create", "update", "reorder", "set_visibility", "delete",
  "categories", "create_category", "rename_category", "reorder_categories", "delete_category",
  "media_upload_grant", "media_complete", "media_status", "media_library",
  "confirm_review", "set_offering_visibility", "font_search", "font_previews", "draft_changes",
  "pages", "set_menu", "cover", "set_cover",
  // #2829 W9b — "Why it looks like this" and the six design checks (Publish review).
  "work_log", "design_checks",
]);
export const CONTENT_ACTIONS: ReadonlySet<string> = new Set([...CORE_ONLY_ACTIONS, ...STUDIO_ACTIONS]);

export type ContentFailureCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "REVISION_CONFLICT"
  | "REVIEW_NOT_CONFIRMED"
  | "TITLE_REQUIRED"
  | "QUOTE_REQUIRED"
  | "SLUG_TAKEN"
  | "SLUG_INVALID"
  | "CATEGORY_IN_USE"
  | "CONTENT_LIMIT_EXCEEDED"
  | "MEDIA_REJECTED"
  | "MEDIA_PROCESSING"
  | "OFFERING_NOT_FOUND"
  | "TRIP_NOT_ENDED"
  | "VIDEO_TOO_LONG"
  | "NOT_ENTITLED"
  | "NO_ADMIN"
  | "SERVICE_TEMPORARILY_UNAVAILABLE";

const MESSAGES: Record<ContentFailureCode, string> = {
  FORBIDDEN: "Only brand admins and owners can do this.",
  NOT_FOUND: "That isn't on your website any more. It may have been deleted.",
  VALIDATION_FAILED: "Something in what you entered needs fixing first.",
  REVISION_CONFLICT: "Someone saved a newer version while you were editing.",
  REVIEW_NOT_CONFIRMED: "Confirm this review is real before showing it.",
  TITLE_REQUIRED: "Add a name first.",
  QUOTE_REQUIRED: "Paste the review text first.",
  SLUG_TAKEN: "Another page already uses that address. Choose a different one.",
  SLUG_INVALID: "Use lowercase letters, numbers and single hyphens for the address.",
  CATEGORY_IN_USE: "Move its stories to another category before deleting it.",
  CONTENT_LIMIT_EXCEEDED: "This collection is full. Delete an entry first.",
  MEDIA_REJECTED: "That file couldn't be accepted. Photos must be JPEG, PNG or WebP under 20 MB.",
  MEDIA_PROCESSING: "That photo is still being prepared.",
  OFFERING_NOT_FOUND: "That isn't one of your public Mingla trips.",
  TRIP_NOT_ENDED: "Only trips that have ended can be hidden here.",
  VIDEO_TOO_LONG: "Cover videos can be up to 15 seconds. Choose a shorter one.",
  NOT_ENTITLED: "Websites are opening brand by brand, and this brand doesn't have one yet.",
  NO_ADMIN: "This brand has no admin to ask yet.",
  SERVICE_TEMPORARILY_UNAVAILABLE: "Website tools are temporarily unavailable. Please try again.",
};

const STATUS: Record<ContentFailureCode, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  REVISION_CONFLICT: 409,
  REVIEW_NOT_CONFIRMED: 409,
  TITLE_REQUIRED: 400,
  QUOTE_REQUIRED: 400,
  SLUG_TAKEN: 409,
  SLUG_INVALID: 400,
  CATEGORY_IN_USE: 409,
  CONTENT_LIMIT_EXCEEDED: 409,
  MEDIA_REJECTED: 409,
  MEDIA_PROCESSING: 409,
  OFFERING_NOT_FOUND: 409,
  TRIP_NOT_ENDED: 409,
  VIDEO_TOO_LONG: 409,
  NOT_ENTITLED: 403,
  NO_ADMIN: 409,
  SERVICE_TEMPORARILY_UNAVAILABLE: 503,
};

export function contentFailure(code: ContentFailureCode, extra: JsonObject = {}): Response {
  return sitesJson({
    ok: false,
    error: { code, message: MESSAGES[code], retryable: code === "SERVICE_TEMPORARILY_UNAVAILABLE", ...extra },
  }, STATUS[code]);
}

function isCode(value: unknown): value is ContentFailureCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MESSAGES, value);
}

type FeedOffering = {
  id: string;
  kind: string;
  title: string;
  slug: string;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  status: string | null;
  capacity: number | null;
  spots_left: number | null;
  destination_text: string | null;
  public_url: string | null;
};

/** Ended in the offering's own sense: status ended, or its last day is past. Cancelled never ran. */
export function offeringEnded(offering: FeedOffering, now: number): boolean {
  if (offering.status === "cancelled") return false;
  if (offering.status === "ended") return true;
  const last = Date.parse(String(offering.end_at ?? offering.start_at ?? ""));
  return Number.isFinite(last) && last < now;
}

async function brandFeed(ctx: SiteContentContext, siteId: string): Promise<FeedOffering[] | null> {
  const { data, error } = await ctx.serviceRpc("brand_site_offerings_feed", { p_site_id: siteId });
  if (error || !data || typeof data !== "object") return null;
  const offerings = (data as { offerings?: unknown }).offerings;
  return Array.isArray(offerings) ? offerings as FeedOffering[] : null;
}

/** Offering ids a write names (destination trips, review trip). */
export function offeringIdsIn(action: string, args: JsonObject): string[] {
  if (action === "set_offering_visibility") return [String(args.offering_id ?? "")];
  if (action !== "create" && action !== "update") return [];
  const data = args.data && typeof args.data === "object" ? args.data as JsonObject : {};
  const ids: string[] = [];
  if (Array.isArray(data.related_offerings)) {
    for (const row of data.related_offerings) {
      ids.push(String(typeof row === "string" ? row : (row as JsonObject | null)?.offering_id ?? ""));
    }
  }
  if (typeof data.related_offering === "string" && data.related_offering) ids.push(data.related_offering);
  return ids;
}

function authFailure(message: string): Response {
  if (message.includes("sites_forbidden")) return contentFailure("FORBIDDEN");
  return contentFailure("SERVICE_TEMPORARILY_UNAVAILABLE");
}

async function relayConflict(ctx: SiteContentContext, siteId: string, latest: unknown): Promise<Response> {
  const value = latest && typeof latest === "object" ? latest as JsonObject : {};
  let name: string | null = null;
  if (typeof value.updated_by === "string" && UUID.test(value.updated_by)) {
    const { data } = await ctx.serviceRpc("brand_site_content_person_name", {
      p_site_id: siteId,
      p_user_id: value.updated_by,
    });
    name = typeof data === "string" ? data : null;
  }
  return contentFailure("REVISION_CONFLICT", {
    latest: {
      revision: typeof value.revision === "string" ? value.revision : null,
      updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
      updated_by_name: name,
    },
  });
}

export async function handleSiteContentRoute(
  path: string,
  method: string,
  input: JsonObject,
  ctx: SiteContentContext,
): Promise<Response | null> {
  const askMatch = path.match(/^\/v1\/brands\/([^/]+)\/site-admin-request$/);
  if (askMatch && method === "POST") {
    if (!UUID.test(askMatch[1])) return contentFailure("VALIDATION_FAILED");
    const { data, error } = await ctx.userRpc("brand_site_request_admin", {
      p_brand_id: askMatch[1],
      p_action: String(input.action ?? ""),
    });
    if (error) {
      if (error.message.includes("sites_forbidden")) return contentFailure("FORBIDDEN");
      if (error.message.includes("sites_not_entitled")) return contentFailure("NOT_ENTITLED");
      if (error.message.includes("sites_no_admin")) return contentFailure("NO_ADMIN");
      if (error.message.includes("sites_validation_failed")) return contentFailure("VALIDATION_FAILED");
      return contentFailure("SERVICE_TEMPORARILY_UNAVAILABLE");
    }
    return sitesJson({ ok: true, data });
  }

  const match = path.match(/^\/v1\/sites\/([^/]+)\/content$/);
  if (!match || method !== "POST") return null;
  const siteId = match[1];
  const action = String(input.action ?? "");
  const operationId = String(input.operation_id ?? "");
  if (!UUID.test(siteId) || !UUID.test(operationId) || !CONTENT_ACTIONS.has(action)) {
    return contentFailure("VALIDATION_FAILED");
  }

  const auth = await ctx.userRpc("brand_site_content_authorize", { p_site_id: siteId, p_action: action });
  if (auth.error || !auth.data || typeof auth.data !== "object") return authFailure(auth.error?.message ?? "");
  const grant = auth.data as { brand_id?: unknown; user_id?: unknown; rank?: unknown };
  const brandId = String(grant.brand_id ?? "");
  const rank = Number(grant.rank);
  if (!UUID.test(brandId) || !Number.isInteger(rank) || String(grant.user_id) !== ctx.userId) {
    return contentFailure("FORBIDDEN");
  }
  const now = (ctx.now ?? Date.now)();
  const args = input.args && typeof input.args === "object" && !Array.isArray(input.args) ? input.args as JsonObject : {};

  // Offering ids must be this brand's own public offerings (a hidden one must have ended).
  const named = offeringIdsIn(action, args);
  let feed: FeedOffering[] | null = null;
  if (named.length || CORE_ONLY_ACTIONS.has(action)) {
    feed = await brandFeed(ctx, siteId);
    if (feed === null) return contentFailure("SERVICE_TEMPORARILY_UNAVAILABLE");
  }
  if (named.length) {
    const byId = new Map((feed ?? []).map((row) => [String(row.id).toLowerCase(), row]));
    for (const id of named) {
      const offering = byId.get(id.toLowerCase());
      if (!UUID.test(id) || !offering) return contentFailure("OFFERING_NOT_FOUND");
      if (action === "set_offering_visibility" && !(offering.kind === "trip" && offeringEnded(offering, now))) {
        return contentFailure("TRIP_NOT_ENDED");
      }
    }
  }

  if (action === "offerings") {
    return sitesJson({
      ok: true,
      data: {
        offerings: (feed ?? []).map((row) => ({
          id: row.id,
          kind: row.kind,
          title: row.title,
          start_at: row.start_at,
          end_at: row.end_at,
          timezone: row.timezone,
          status: row.status,
          ended: offeringEnded(row, now),
          spots_left: row.spots_left,
          public_url: row.public_url,
        })),
      },
    });
  }

  const studio = (studioAction: string, studioArgs: JsonObject) => ctx.callCmsRaw({
    siteId,
    operationId,
    path: "/api/internal/content",
    payload: { action: studioAction, site_id: siteId, brand_id: brandId, user_id: ctx.userId, rank, args: studioArgs },
  });

  if (action === "past_trips") {
    const display = await studio("get_display", {});
    if (!display || display.status >= 300 || display.body?.ok !== true) return contentFailure("SERVICE_TEMPORARILY_UNAVAILABLE");
    const data = (display.body.data ?? {}) as JsonObject;
    const hidden = new Set(Array.isArray(data.hidden_offering_ids) ? data.hidden_offering_ids.map(String) : []);
    const ended = (feed ?? []).filter((row) => row.kind === "trip" && offeringEnded(row, now));
    const covers = await ctx.tripCovers(brandId, ended.map((row) => row.id));
    return sitesJson({
      ok: true,
      data: {
        revision: typeof data.revision === "string" ? data.revision : null,
        can_hide: rank >= 50,
        trips: ended.map((row) => {
          const travellers = typeof row.capacity === "number" && typeof row.spots_left === "number"
            ? Math.max(row.capacity - row.spots_left, 0)
            : null;
          return {
            id: row.id,
            title: row.title,
            start_at: row.start_at,
            end_at: row.end_at,
            timezone: row.timezone,
            destination: row.destination_text,
            ...(travellers !== null ? { travellers } : {}),
            cover_url: covers[row.id] ?? null,
            hidden: hidden.has(String(row.id).toLowerCase()),
          };
        }),
      },
    });
  }

  // "Changes since you last published" compares the draft with the LIVE
  // version Core points at (never a key the caller names).
  let studioArgs: JsonObject = args;
  if (action === "draft_changes") studioArgs = { active_artifact_key: await ctx.activeArtifactKey(siteId) };
  if (action === "design_checks") {
    // #2829 W9b — the truth check reads Mingla's own facts, never the caller's.
    const evidence = ctx.readBrand
      ? await siteEvidence(ctx.serviceRpc, ctx.readBrand, siteId, brandId)
      : null;
    if (evidence === null) return contentFailure("SERVICE_TEMPORARILY_UNAVAILABLE");
    studioArgs = { evidence };
  }
  const result = await studio(action, studioArgs);
  if (!result) return contentFailure("SERVICE_TEMPORARILY_UNAVAILABLE");
  const body = result.body;
  if (result.status >= 300 || body?.ok !== true) {
    const error = (body?.error ?? {}) as JsonObject;
    if (error.code === "REVISION_CONFLICT") return await relayConflict(ctx, siteId, error.latest);
    return isCode(error.code) && error.code !== "SERVICE_TEMPORARILY_UNAVAILABLE"
      ? contentFailure(error.code)
      : contentFailure("SERVICE_TEMPORARILY_UNAVAILABLE");
  }
  const data = { ...((body.data ?? {}) as JsonObject) };
  const audit = data.audit as JsonObject | undefined;
  delete data.audit;
  if (audit && typeof audit.action === "string") {
    const metadata: JsonObject = {};
    if (typeof audit.visible === "boolean") metadata.visible = audit.visible;
    if (typeof audit.count === "number") metadata.count = audit.count;
    const { error } = await ctx.serviceRpc("brand_site_content_record", {
      p_site_id: siteId,
      p_actor: ctx.userId,
      p_action: audit.action,
      p_collection: typeof audit.collection === "string" ? audit.collection : null,
      p_entry: typeof audit.entry === "string" ? audit.entry : null,
      p_metadata: metadata,
    });
    // The change IS saved in Studio, so the member is told the truth (saved);
    // the missing audit row is surfaced to operators, loudly, not hidden.
    if (error) {
      console.error("[brand-site-control] content_audit_failed", { action: audit.action, site: siteId });
    }
  }
  return sitesJson({ ok: true, data });
}
