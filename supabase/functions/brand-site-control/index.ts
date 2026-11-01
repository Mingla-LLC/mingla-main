import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  requireSha256,
  requireUuid,
  signSitesEnvelope,
  SITES_PROVISION_RENDERER_KEY,
  SITES_SAFE_CUSTOMER_CODES,
  sitesFailure,
  sitesJson,
  sitesOwnerFixableRefusal,
  type SitesSafeCustomerCode,
  sitesSha256Hex,
} from "../_shared/sitesContracts.ts";
import {
  guardSitesEnvironment,
  resolveCoreToCmsSigner,
} from "../_shared/sitesSecurity.ts";
import { observeSitesRequest } from "../_shared/sitesObservability.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { handleSitePlanRoute, planFailureFromRpc } from "./sitePlan.ts";
import { handleSiteContentRoute } from "./siteContent.ts";
import { handleSiteShareRoute } from "./siteShare.ts";
import { ARI_CMS_ACTIONS, ARI_DESIGNER_ACTIONS, ariFailureFrom, siteEvidence } from "./siteAri.ts";

type JsonObject = Record<string, unknown>;
const CUSTOMER_FAILURE_CODES = new Set<string>(SITES_SAFE_CUSTOMER_CODES);

function clients(req: Request) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  return {
    user: createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    }),
    service: createClient(url, serviceKey, { auth: { persistSession: false } }),
  };
}

function relativePath(req: Request): string {
  const path = new URL(req.url).pathname;
  const marker = "/brand-site-control";
  const index = path.indexOf(marker);
  return index < 0 ? path : (path.slice(index + marker.length) || "/");
}

async function body(req: Request): Promise<JsonObject> {
  if (req.method === "GET") return {};
  const value = await req.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("VALIDATION_FAILED");
  }
  return value as JsonObject;
}

type CmsTarget = { cms_origin: string; environment: string };

// #2829 — a 'local' row (loopback CMS origin) is refused outside a local
// stack, so Core can never sign a request to a loopback origin in production.
async function cmsTarget(
  service: ReturnType<typeof clients>["service"],
): Promise<CmsTarget | null> {
  const { data: configData } = await service
    .from("brand_site_service_config")
    .select("cms_origin,environment")
    .eq("config_key", "sites_v1")
    .maybeSingle();
  const config = configData as CmsTarget | null;
  let environmentAllowed = config !== null;
  if (config !== null) {
    try {
      guardSitesEnvironment(config.environment, config.cms_origin);
    } catch {
      environmentAllowed = false;
    }
  }
  if (config === null || !environmentAllowed) return null;
  return config;
}

async function signedCmsFetch(
  config: CmsTarget,
  args: { siteId: string; operationId: string; path: string; payload: JsonObject },
): Promise<Response> {
  const serialized = JSON.stringify(args.payload);
  const signer = resolveCoreToCmsSigner();
  const envelope = await signSitesEnvelope({
    issuer: "mingla-core",
    audience: "mingla-site-cms",
    direction: "core_to_cms",
    siteId: args.siteId,
    operationId: args.operationId,
    method: "POST",
    path: args.path,
    body: serialized,
    kid: signer.kid,
    keyBytes: signer.keyBytes,
  });
  return await fetch(`${String(config.cms_origin)}${args.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mingla-Sites-Envelope": btoa(JSON.stringify(envelope)),
    },
    body: serialized,
    signal: AbortSignal.timeout(15_000),
  });
}

/**
 * #2829 W9r — a signed Core→Studio call whose answer comes back as Studio
 * sent it (content routes map Studio's named refusals themselves). Null when
 * Studio is not configured or can't be reached. No operation receipt exists
 * for a content edit, so nothing is marked ambiguous.
 */
async function callCmsRaw(
  service: ReturnType<typeof clients>["service"],
  args: { siteId: string; operationId: string; path: string; payload: JsonObject },
): Promise<{ status: number; body: JsonObject | null } | null> {
  const config = await cmsTarget(service);
  if (config === null) return null;
  try {
    const response = await signedCmsFetch(config, args);
    const body = await response.json().catch(() => null) as JsonObject | null;
    return { status: response.status, body };
  } catch {
    return null;
  }
}

async function callCms(
  service: ReturnType<typeof clients>["service"],
  args: {
    siteId: string;
    operationId: string;
    path: string;
    payload: JsonObject;
  },
): Promise<Response> {
  const markAmbiguous = async (): Promise<void> => {
    try {
      await service.rpc("brand_site_mark_operation_ambiguous", {
        p_site_id: args.siteId,
        p_operation_id: args.operationId,
        p_safe_error_code: "SERVICE_TEMPORARILY_UNAVAILABLE",
      });
    } catch {
      // The customer response remains safely unavailable even if recording the
      // uncertainty is itself unavailable; observability owns the alert.
    }
  };
  const config = await cmsTarget(service);
  if (config === null) {
    return sitesFailure(
      "SERVICE_TEMPORARILY_UNAVAILABLE",
      503,
      args.operationId,
    );
  }
  try {
    const response = await signedCmsFetch(config, args);
    const payload = await response.json().catch(() => null) as
      | { ok?: boolean; data?: unknown; error?: { code?: unknown } }
      | null;
    if (!response.ok || !payload?.ok) {
      const reportedCode = payload?.error?.code;
      // #2829 W2 — an owner-fixable refusal is neither an outage nor ambiguous.
      const ownerFixable = sitesOwnerFixableRefusal(reportedCode, args.operationId);
      if (ownerFixable) return ownerFixable;
      const safeCode: SitesSafeCustomerCode =
        typeof reportedCode === "string" &&
          CUSTOMER_FAILURE_CODES.has(reportedCode)
          ? reportedCode as SitesSafeCustomerCode
          : "SERVICE_TEMPORARILY_UNAVAILABLE";
      if (safeCode === "SERVICE_TEMPORARILY_UNAVAILABLE") {
        await markAmbiguous();
      }
      return sitesFailure(
        safeCode,
        safeCode === "SERVICE_TEMPORARILY_UNAVAILABLE" ? 503 : 409,
        args.operationId,
      );
    }
    return sitesJson({ ok: true, data: payload.data }, 202);
  } catch {
    await markAmbiguous();
    return sitesFailure(
      "SERVICE_TEMPORARILY_UNAVAILABLE",
      503,
      args.operationId,
    );
  }
}

/**
 * #2829 W10 — where visitors open a site: the scheme and port of the public
 * runtime origin (Core's service row), the host of the site's main address.
 */
async function siteVisitorOrigin(
  service: ReturnType<typeof clients>["service"],
  siteId: string,
): Promise<string | null> {
  const [{ data: config }, { data: host }] = await Promise.all([
    service.from("brand_site_service_config").select("public_runtime_origin,environment,cms_origin")
      .eq("config_key", "sites_v1").maybeSingle(),
    service.from("brand_site_hosts").select("hostname").eq("site_id", siteId)
      .eq("is_primary", true).eq("status", "active").limit(1).maybeSingle(),
  ]);
  if (!config || typeof host?.hostname !== "string") return null;
  try {
    guardSitesEnvironment(String(config.environment), String(config.cms_origin));
    const origin = new URL(String(config.public_runtime_origin));
    origin.hostname = host.hostname;
    return origin.origin;
  } catch {
    return null;
  }
}

/**
 * #2829 W10 — build a preview of the caller's current draft through the SAME
 * path the Website preview uses (Core authorizes a preview operation, Studio
 * mints it), then open Studio's preview route once: Studio builds the artifact
 * and reports it to Core as the site's newest preview before redirecting.
 */
async function buildFreshPreview(
  db: ReturnType<typeof clients>,
  userId: string,
  args: { siteId: string; operationId: string; sourceDigest: string; expectedRevision: string },
): Promise<boolean> {
  const argumentsDigest = await sitesSha256Hex(JSON.stringify({
    action: "previews",
    site_id: args.siteId,
    expected_revision: args.expectedRevision,
    source_digest: args.sourceDigest,
  }));
  const { data: authorization, error } = await db.user.rpc("brand_site_authorize_operation", {
    p_site_id: args.siteId,
    p_operation_id: args.operationId,
    p_kind: "preview",
    p_arguments_digest: argumentsDigest,
    p_expected_revision: args.expectedRevision,
    p_source_digest: args.sourceDigest,
  });
  if (error || !authorization) return false;
  const minted = await callCms(db.service, {
    siteId: args.siteId,
    operationId: args.operationId,
    path: "/api/mingla/previews",
    payload: {
      operation_id: args.operationId,
      expected_revision: args.expectedRevision,
      source_digest: args.sourceDigest,
      return_surface: "web",
      authorization,
      user_id: userId,
      brand_id: (authorization as Record<string, unknown>).brand_id,
    },
  });
  if (!minted.ok) return false;
  const previewUrl = String(((await minted.json()) as { data?: { preview_url?: unknown } }).data?.preview_url ?? "");
  const config = await cmsTarget(db.service);
  if (!config) return false;
  let token: string | null = null;
  try {
    token = new URL(previewUrl).searchParams.get("token");
  } catch {
    return false;
  }
  if (!token || token.length > 4096) return false;
  const build = new URL("/api/mingla/previews", config.cms_origin);
  build.searchParams.set("site_id", args.siteId);
  build.searchParams.set("token", token);
  const response = await fetch(build, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  await response.body?.cancel();
  return response.status === 302;
}

async function handleBrandSiteControlRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const transportPath = relativePath(req);
  const db = clients(req);
  const { data: authData } = await db.user.auth.getUser();
  if (!authData.user) return sitesFailure("FORBIDDEN", 403);

  try {
    const input = await body(req);
    const path = transportPath === "/" && typeof input.route === "string"
      ? input.route
      : transportPath;
    const method = transportPath === "/" && typeof input.method === "string"
      ? input.method.toUpperCase()
      : req.method;
    const availabilityMatch = path.match(
      /^\/v1\/brands\/([^/]+)\/site-availability$/,
    );
    const brandMatch = path.match(/^\/v1\/brands\/([^/]+)\/site$/);
    const editorMatch = path.match(/^\/v1\/brands\/([^/]+)\/editor-session$/);
    const siteMatch = path.match(
      /^\/v1\/sites\/([^/]+)\/(previews|publications|rollbacks)$/,
    );
    const operationMatch = path.match(
      /^\/v1\/sites\/([^/]+)\/operations\/([^/]+)$/,
    );
    const readMatch = path.match(
      /^\/v1\/sites\/([^/]+)\/(versions|analytics)$/,
    );
    const ariMatch = path.match(/^\/v1\/sites\/([^/]+)\/ari$/);
    const labelMatch = path.match(/^\/v1\/brands\/([^/]+)\/site-label$/);
    const offlineMatch = path.match(
      /^\/v1\/sites\/([^/]+)\/(offline|online)$/,
    );
    const exportsMatch = path.match(/^\/v1\/sites\/([^/]+)\/exports$/);
    const exportReadMatch = path.match(
      /^\/v1\/sites\/([^/]+)\/exports\/([^/]+)$/,
    );

    // #2829 W9a — the website plan (Core checks every rank and lock).
    const planResponse = await handleSitePlanRoute(path, method, input, {
      userId: authData.user.id,
      userRpc: async (fn, args) => {
        const { data, error } = await db.user.rpc(fn, args);
        return { data, error: error ? { message: error.message } : null };
      },
      serviceRpc: async (fn, args) => {
        const { data, error } = await db.service.rpc(fn, args);
        return { data, error: error ? { message: error.message } : null };
      },
      callCms: (args) => callCms(db.service, args),
    });
    if (planResponse) return planResponse;

    // #2829 W9r — Website content (destinations, stories, reviews, photos,
    // hidden past trips) and "Ask an admin"; Core checks every rank.
    const contentResponse = await handleSiteContentRoute(path, method, input, {
      userId: authData.user.id,
      userRpc: async (fn, args) => {
        const { data, error } = await db.user.rpc(fn, args);
        return { data, error: error ? { message: error.message } : null };
      },
      serviceRpc: async (fn, args) => {
        const { data, error } = await db.service.rpc(fn, args);
        return { data, error: error ? { message: error.message } : null };
      },
      callCmsRaw: (args) => callCmsRaw(db.service, args),
      activeArtifactKey: async (siteId) => {
        const { data: siteRow } = await db.service.from("brand_sites")
          .select("active_publication_id").eq("id", siteId).maybeSingle();
        if (!siteRow?.active_publication_id) return null;
        const { data: row } = await db.service.from("brand_site_publications")
          .select("artifact_key").eq("id", siteRow.active_publication_id).eq("site_id", siteId).maybeSingle();
        return typeof row?.artifact_key === "string" ? row.artifact_key : null;
      },
      readBrand: async (brandId) => {
        const { data } = await db.service.from("brands")
          .select("id,name,description,city").eq("id", brandId).is("deleted_at", null).maybeSingle();
        return (data as JsonObject | null) ?? null;
      },
      tripCovers: async (brandId, ids) => {
        if (!ids.length) return {};
        const { data } = await db.service.from("events")
          .select("id,cover_media_url,cover_media_type")
          .eq("brand_id", brandId)
          .in("id", ids.slice(0, 200));
        const covers: Record<string, string> = {};
        for (const row of (data ?? []) as Array<{ id: string; cover_media_url: string | null; cover_media_type: string | null }>) {
          if (typeof row.cover_media_url === "string" && /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)/.test(row.cover_media_url) &&
            row.cover_media_type !== "video") covers[row.id] = row.cover_media_url;
        }
        return covers;
      },
    });
    if (contentResponse) return contentResponse;

    // #2829 W10 — private share-preview links (rank 50 in Core).
    const shareResponse = await handleSiteShareRoute(path, method, input, {
      userRpc: async (fn, args) => {
        const { data, error } = await db.user.rpc(fn, args);
        return { data, error: error ? { message: error.message } : null };
      },
      buildFreshPreview: (args) => buildFreshPreview(db, authData.user!.id, args),
      previewReady: async (siteId) => {
        const { data } = await db.service.from("brand_sites")
          .select("latest_preview_artifact_key").eq("id", siteId).maybeSingle();
        return typeof data?.latest_preview_artifact_key === "string";
      },
      siteOrigin: (siteId) => siteVisitorOrigin(db.service, siteId),
    });
    if (shareResponse) return shareResponse;

    // #2829 W9b — "websites are opening brand by brand": a member of a brand
    // without Sites asked (Ari); Mingla admins see who is asking.
    const interestMatch = path.match(/^\/v1\/brands\/([^/]+)\/site-interest$/);
    if (interestMatch && method === "POST") {
      const brandId = requireUuid(interestMatch[1]);
      const { data, error } = await db.user.rpc("brand_site_record_interest", {
        p_brand_id: brandId,
        p_source: "ari",
      });
      if (error) {
        return error.message.includes("sites_forbidden")
          ? sitesFailure("FORBIDDEN", 403)
          : sitesFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
      }
      return sitesJson({ ok: true, data });
    }

    // #2829 — the address a site WILL get, shown before the owner confirms.
    if (labelMatch && method === "GET") {
      const brandId = requireUuid(labelMatch[1]);
      const { data, error } = await db.user.rpc("brand_site_propose_label", {
        p_brand_id: brandId,
      });
      if (error) {
        return error.message.includes("forbidden")
          ? sitesFailure("FORBIDDEN", 403)
          : sitesFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
      }
      return sitesJson({ ok: true, data });
    }

    // #2829 — owner/admin (rank 50) take the site offline or bring it back.
    if (offlineMatch && method === "POST") {
      const siteId = requireUuid(offlineMatch[1]);
      const operationId = requireUuid(input.operation_id);
      const reason = typeof input.reason === "string"
        ? input.reason.slice(0, 200)
        : null;
      const { data, error } = await db.user.rpc(
        "brand_site_set_owner_offline",
        {
          p_site_id: siteId,
          p_offline: offlineMatch[2] === "offline",
          p_operation_id: operationId,
          p_reason: reason,
        },
      );
      if (error) {
        return sitesFailure(
          error.message.includes("idempotency")
            ? "IDEMPOTENCY_CONFLICT"
            : error.message.includes("forbidden")
            ? "FORBIDDEN"
            : "VALIDATION_FAILED",
          error.message.includes("forbidden") ? 403 : 409,
          operationId,
        );
      }
      return sitesJson({ ok: true, data });
    }

    // #2829 — "Download everything": rank 50; the CMS writes the zip and
    // returns a 24-hour signed link, which Core records on the receipt.
    if (exportsMatch && method === "POST") {
      const siteId = requireUuid(exportsMatch[1]);
      const operationId = requireUuid(input.operation_id);
      const { data, error } = await db.user.rpc("brand_site_request_export", {
        p_site_id: siteId,
        p_operation_id: operationId,
      });
      if (error) {
        return sitesFailure(
          error.message.includes("idempotency")
            ? "IDEMPOTENCY_CONFLICT"
            : error.message.includes("forbidden")
            ? "FORBIDDEN"
            : "INVALID_STATE",
          error.message.includes("forbidden") ? 403 : 409,
          operationId,
        );
      }
      const receipt = data as Record<string, unknown>;
      if (receipt.status === "succeeded") return sitesJson({ ok: true, data });
      const { data: siteRow } = await db.service.from("brand_sites")
        .select("active_publication_id").eq("id", siteId).maybeSingle();
      const { data: activeRow } = siteRow?.active_publication_id
        ? await db.service.from("brand_site_publications").select(
          "artifact_key",
        )
          .eq("id", siteRow.active_publication_id).eq("site_id", siteId)
          .maybeSingle()
        : { data: null };
      const cms = await callCms(db.service, {
        siteId,
        operationId,
        path: "/api/internal/exports",
        payload: {
          kind: "export",
          site_id: siteId,
          brand_id: receipt.brand_id,
          operation_id: operationId,
          ...(typeof activeRow?.artifact_key === "string"
            ? { active_artifact_key: activeRow.artifact_key }
            : {}),
        },
      });
      if (!cms.ok) return cms;
      const exported = (await cms.json() as { data?: Record<string, unknown> })
        .data ?? {};
      const { data: completed, error: completeError } = await db.service.rpc(
        "brand_site_complete_export",
        {
          p_site_id: siteId,
          p_operation_id: operationId,
          p_download_url: String(exported.download_url ?? ""),
          p_expires_at: String(exported.expires_at ?? ""),
          p_bytes: Number(exported.bytes ?? -1),
        },
      );
      if (completeError) {
        return sitesFailure(
          "SERVICE_TEMPORARILY_UNAVAILABLE",
          503,
          operationId,
        );
      }
      return sitesJson({ ok: true, data: completed });
    }

    if (exportReadMatch && method === "GET") {
      const siteId = requireUuid(exportReadMatch[1]);
      const operationId = requireUuid(exportReadMatch[2]);
      // Rank is re-derived in Core: only rank >= 50 sees an export link.
      const { data: site } = await db.user
        .from("brand_sites")
        .select("brand_id")
        .eq("id", siteId)
        .maybeSingle();
      const { data: rank } = site
        ? await db.service.rpc("biz_brand_effective_rank", {
          p_brand_id: site.brand_id,
          p_user_id: authData.user.id,
        })
        : { data: 0 };
      if (typeof rank !== "number" || rank < 50) {
        return sitesFailure("FORBIDDEN", 403);
      }
      const { data, error } = await db.service
        .from("brand_site_operation_receipts")
        .select("operation_id,site_id,kind,status,error_code,result_summary")
        .eq("site_id", siteId)
        .eq("operation_id", operationId)
        .eq("kind", "export")
        .maybeSingle();
      if (error || data === null) return sitesFailure("NOT_FOUND", 404);
      return sitesJson({ ok: true, data });
    }

    if (availabilityMatch && method === "GET") {
      const brandId = requireUuid(availabilityMatch[1]);
      const { data, error } = await db.user.rpc(
        "brand_site_business_availability",
        { p_brand_id: brandId },
      );
      if (error) {
        return error.message.includes("forbidden")
          ? sitesFailure("FORBIDDEN", 403)
          : sitesFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
      }
      return sitesJson({ ok: true, data });
    }

    if (brandMatch && method === "GET") {
      const brandId = requireUuid(brandMatch[1]);
      const { data, error } = await db.user
        .from("brand_sites")
        .select(
          "id,brand_id,renderer_key,renderer_version,status,active_publication_id,last_successful_publication_id,provisioning_error_code,owner_offline_at,created_at,updated_at,brand_site_hosts(hostname,status,is_primary,kind,label)",
        )
        .eq("brand_id", brandId)
        .maybeSingle();
      if (error) return sitesFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
      if (data === null) return sitesFailure("NOT_FOUND", 404);
      const { data: receipt, error: receiptError } = await db.user
        .from("brand_site_operation_receipts")
        .select(
          "operation_id,status,error_code,authorized_at,updated_at,result_summary",
        )
        .eq("site_id", data.id)
        .eq("kind", "provision")
        .order("authorized_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (receiptError) {
        return sitesFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
      }
      /*
       * #2830 — is the live website behind Mingla's menu?
       *
       * The published site carries a baked copy of the menu, so a price or an
       * availability change in the app does not reach it until someone
       * republishes. Rather than leave that to be discovered by a customer,
       * compare the menu as it is NOW with the menu as it was AT PUBLISH and
       * tell the brand.
       *
       * Fails OPEN and quiet: if either side cannot be read we say nothing,
       * because a false "your website is out of date" badge that will not clear
       * is worse than no badge.
       */
      let menuChangedSincePublish = false;
      if (data.active_publication_id) {
        const [current, published] = await Promise.all([
          db.service.rpc("brand_site_menu_fingerprint", { p_site_id: data.id }),
          db.service
            .from("brand_site_publications")
            .select("menu_fingerprint")
            .eq("id", data.active_publication_id)
            .maybeSingle(),
        ]);
        const currentDigest = typeof current.data === "string"
          ? current.data
          : null;
        const publishedDigest =
          typeof published.data?.menu_fingerprint === "string"
            ? published.data.menu_fingerprint
            : null;
        menuChangedSincePublish = currentDigest !== null &&
          publishedDigest !== null &&
          currentDigest !== publishedDigest;
      }
      return sitesJson({
        ok: true,
        data: {
          ...data,
          latest_provision_operation: receipt ?? null,
          menu_changed_since_publish: menuChangedSincePublish,
        },
      });
    }

    if (brandMatch && method === "POST") {
      const brandId = requireUuid(brandMatch[1]);
      const operationId = requireUuid(input.operation_id);
      // #2830 — provisioning is the first moment a website draft can exist.
      // Core refuses it until setup and brand context are complete; the UI and
      // Ari cannot bypass this by calling the older provision route directly.
      const { data: setup, error: setupError } = await db.user.rpc(
        "brand_site_plan_authorize_provision",
        { p_brand_id: brandId },
      );
      if (setupError) return planFailureFromRpc(setupError.message, operationId);
      const designKey = (setup as { design_key?: unknown } | null)?.design_key;
      if (designKey !== "atelier" && designKey !== "voyage") {
        return sitesFailure("INVALID_STATE", 409, operationId);
      }
      // #2829 — an optional owner-confirmed label; otherwise Core derives it
      // from the brand (the same value site-label proposed).
      const label = typeof input.label === "string" ? input.label : null;
      const argumentsDigest = typeof input.arguments_digest === "string"
        ? requireSha256(input.arguments_digest)
        : await sitesSha256Hex(JSON.stringify({
          action: "provision",
          brand_id: brandId,
          renderer_key: SITES_PROVISION_RENDERER_KEY,
          renderer_version: 1,
          label,
        }));
      const { data, error } = await db.user.rpc("brand_site_provision", {
        p_brand_id: brandId,
        p_operation_id: operationId,
        p_arguments_digest: argumentsDigest,
        p_label: label,
      });
      if (error) {
        return sitesFailure(
          error.message.includes("idempotency")
            ? "IDEMPOTENCY_CONFLICT"
            : error.message.includes("forbidden")
            ? "FORBIDDEN"
            : error.message.includes("label_unavailable")
            ? "VALIDATION_FAILED"
            : "INVALID_STATE",
          error.message.includes("forbidden") ? 403 : 409,
          operationId,
        );
      }
      const provision = data as Record<string, unknown>;
      const siteId = requireUuid(provision.site_id);
      // #2829 — the CMS learns the brand's name and the site's address from
      // Core; it assumes nothing about any particular brand.
      const [{ data: brandRow }, { data: hostRow }] = await Promise.all([
        db.service.from("brands").select("name").eq("id", brandId)
          .maybeSingle(),
        db.service.from("brand_site_hosts").select("hostname")
          .eq("site_id", siteId).eq("is_primary", true)
          .in("status", ["pending", "active"]).limit(1).maybeSingle(),
      ]);
      if (!brandRow?.name || !hostRow?.hostname) {
        return sitesFailure("INVALID_STATE", 409, operationId);
      }
      return await callCms(db.service, {
        siteId,
        operationId,
        path: `/api/internal/reconcile/${operationId}`,
        payload: {
          kind: "provision",
          site_id: siteId,
          brand_id: brandId,
          renderer_key: SITES_PROVISION_RENDERER_KEY,
          renderer_version: 1,
          display_name: String(brandRow.name).slice(0, 120),
          primary_hostname: hostRow.hostname,
          design_key: designKey,
        },
      });
    }

    if (editorMatch && method === "POST") {
      const brandId = requireUuid(editorMatch[1]);
      const operationId = requireUuid(input.operation_id);
      if (input.destination !== "studio") {
        return sitesFailure("VALIDATION_FAILED", 400, operationId);
      }
      const destination = "studio";
      const { data, error } = await db.user.rpc(
        "brand_site_issue_editor_exchange",
        {
          p_brand_id: brandId,
          p_operation_id: operationId,
          p_destination: destination,
        },
      );
      if (error) {
        const idempotencyConflict = error.message.includes("idempotency");
        return sitesFailure(
          idempotencyConflict ? "IDEMPOTENCY_CONFLICT" : "FORBIDDEN",
          idempotencyConflict ? 409 : 403,
          operationId,
        );
      }
      if (
        !data || typeof data !== "object" ||
        typeof (data as Record<string, unknown>).code !== "string"
      ) {
        return sitesFailure("OPERATION_IN_PROGRESS", 409, operationId);
      }
      return sitesJson({ ok: true, data });
    }

    if (siteMatch && method === "POST") {
      const siteId = requireUuid(siteMatch[1]);
      const operationId = requireUuid(input.operation_id);
      const action = siteMatch[2];
      const argumentsDigest = typeof input.arguments_digest === "string" &&
          /^[0-9a-f]{64}$/.test(input.arguments_digest)
        ? input.arguments_digest
        : await sitesSha256Hex(JSON.stringify({
          action,
          site_id: siteId,
          expected_revision: String(input.expected_revision ?? ""),
          source_digest: String(input.source_digest ?? ""),
        }));
      const { data, error } = await db.user.rpc(
        "brand_site_authorize_operation",
        {
          p_site_id: siteId,
          p_operation_id: operationId,
          p_kind: action === "rollbacks"
            ? "rollback"
            : action === "previews"
            ? "preview"
            : "publish",
          p_arguments_digest: argumentsDigest,
          p_expected_revision: String(input.expected_revision ?? ""),
          p_source_digest: requireSha256(input.source_digest),
        },
      );
      if (error) {
        return sitesFailure(
          error.message.includes("idempotency")
            ? "IDEMPOTENCY_CONFLICT"
            : error.message.includes("forbidden")
            ? "FORBIDDEN"
            : "INVALID_STATE",
          error.message.includes("forbidden") ? 403 : 409,
          operationId,
        );
      }
      const cmsPath = action === "publications"
        ? "/api/internal/publications"
        : action === "rollbacks"
        ? "/api/internal/publications"
        : "/api/mingla/previews";
      // #2829 W8 — the site's CURRENT main address (it can change to the
      // brand's own domain and back), so the CMS publishes with a canonical
      // on the address the runtime will serve as primary.
      const { data: primaryHost } = await db.service
        .from("brand_site_hosts")
        .select("hostname")
        .eq("site_id", siteId)
        .eq("is_primary", true)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      return await callCms(db.service, {
        siteId,
        operationId,
        path: cmsPath,
        payload: {
          ...input,
          authorization: data,
          user_id: authData.user.id,
          brand_id: (data as Record<string, unknown>).brand_id,
          // Always Core's value: a caller-supplied one never reaches the CMS.
          primary_hostname: typeof primaryHost?.hostname === "string"
            ? primaryHost.hostname
            : null,
        },
      });
    }

    if (ariMatch && method === "POST") {
      const siteId = requireUuid(ariMatch[1]);
      const operationId = requireUuid(input.operation_id);
      const action = String(input.action || "");
      if (!ARI_CMS_ACTIONS.has(action)) return sitesFailure("VALIDATION_FAILED", 400);
      const { data: authorization, error } = await db.service.rpc(
        "brand_site_internal_authorize",
        {
          p_site_id: siteId,
          p_user_id: authData.user.id,
          p_min_rank: 20,
        },
      );
      if (error || !authorization) return sitesFailure("FORBIDDEN", 403);
      const auth = authorization as Record<string, unknown>;
      if (input.brand_id !== auth.brand_id) {
        return sitesFailure("FORBIDDEN", 403);
      }
      const payload: JsonObject = {
        action,
        site_id: siteId,
        brand_id: auth.brand_id,
        user_id: auth.user_id,
        rank: auth.rank,
        args: input.args && typeof input.args === "object" ? input.args : {},
      };
      if (!ARI_DESIGNER_ACTIONS.has(action)) {
        return await callCms(db.service, {
          siteId,
          operationId,
          path: "/api/internal/ari",
          payload,
        });
      }
      /*
       * #2829 W9b — Ari as the website designer. Studio checks every change
       * against the Mingla facts Core signs in here (never the caller's), and
       * answers named refusals (which claim, which field, the latest
       * revision) so Ari can re-propose. No operation receipt: a draft edit is
       * not a publication, so nothing is marked ambiguous.
       */
      if (action !== "get_site_tokens") {
        const evidence = await siteEvidence(
          async (fn, args) => {
            const { data, error } = await db.service.rpc(fn, args);
            return { data, error: error ? { message: error.message } : null };
          },
          async (brandId) => {
            const { data } = await db.service.from("brands")
              .select("id,name,description,city").eq("id", brandId).is("deleted_at", null).maybeSingle();
            return (data as JsonObject | null) ?? null;
          },
          siteId,
          String(auth.brand_id),
        );
        if (evidence === null) return ariFailureFrom(null, 503);
        payload.evidence = evidence;
      }
      const studio = await callCmsRaw(db.service, {
        siteId,
        operationId,
        path: "/api/internal/ari",
        payload,
      });
      if (!studio) return ariFailureFrom(null, 503);
      if (studio.status >= 300 || studio.body?.ok !== true) {
        return ariFailureFrom(studio.body, studio.status);
      }
      return sitesJson({ ok: true, data: studio.body.data }, 202);
    }

    if (operationMatch && method === "GET") {
      const siteId = requireUuid(operationMatch[1]);
      const operationId = requireUuid(operationMatch[2]);
      const { data, error } = await db.user
        .from("brand_site_operation_receipts")
        .select(
          "operation_id,site_id,brand_id,kind,status,error_code,authorized_at,started_at,completed_at,updated_at,result_summary",
        )
        .eq("site_id", siteId)
        .eq("operation_id", operationId)
        .maybeSingle();
      if (error || data === null) return sitesFailure("NOT_FOUND", 404);
      return sitesJson({ ok: true, data });
    }

    if (readMatch && method === "GET") {
      const siteId = requireUuid(readMatch[1]);
      if (readMatch[2] === "versions") {
        const { data, error } = await db.user
          .from("brand_site_publications")
          .select(
            "id,site_id,source_revision_id,source_digest,artifact_digest,renderer_version,status,previous_publication_id,rollback_source_publication_id,requested_at,completed_at,failure_code,requested_by",
          )
          .eq("site_id", siteId)
          .order("requested_at", { ascending: false })
          .limit(50);
        if (error) return sitesFailure("FORBIDDEN", 403);
        // #2829 W9r — "Published 26 Oct, 18:54 by <name>": the team name, never
        // the member's id or email.
        const names = new Map<string, string | null>();
        for (const row of (data ?? []) as Array<{ requested_by?: string | null }>) {
          const who = row.requested_by;
          if (typeof who === "string" && !names.has(who)) {
            const { data: name } = await db.service.rpc("brand_site_content_person_name", {
              p_site_id: siteId,
              p_user_id: who,
            });
            // #2829 W11 — no name on file reads as null; the app words it.
            names.set(who, typeof name === "string" && name.trim() !== "" ? name : null);
          }
        }
        return sitesJson({
          ok: true,
          data: ((data ?? []) as Array<Record<string, unknown>>).map(({ requested_by, ...row }) => ({
            ...row,
            requested_by_name: typeof requested_by === "string" ? names.get(requested_by) ?? null : null,
          })),
        });
      }
      const { data, error } = await db.user.rpc(
        "brand_site_customer_analytics",
        {
          p_site_id: siteId,
        },
      );
      if (error) return sitesFailure("FORBIDDEN", 403);
      return sitesJson({ ok: true, data });
    }
    return sitesFailure("NOT_FOUND", 404);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VALIDATION_FAILED";
    if (code === "sites_security_unavailable") {
      return sitesFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
    }
    return sitesFailure("VALIDATION_FAILED", 400);
  }
}

export async function handleBrandSiteControl(req: Request): Promise<Response> {
  const response = await observeSitesRequest(req, {
    service: "brand-site-control",
    direction: "customer_to_core",
    handler: handleBrandSiteControlRequest,
  });
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

if (import.meta.main) serve(handleBrandSiteControl);
