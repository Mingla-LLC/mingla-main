import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  requireSha256,
  requireUuid,
  signSitesEnvelope,
  SITES_SAFE_CUSTOMER_CODES,
  sitesFailure,
  sitesJson,
  type SitesSafeCustomerCode,
  sitesSha256Hex,
} from "../_shared/sitesContracts.ts";
import { resolveCoreToCmsSigner } from "../_shared/sitesSecurity.ts";
import { observeSitesRequest } from "../_shared/sitesObservability.ts";
import { corsHeaders } from "../_shared/cors.ts";

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
  const { data: configData } = await service
    .from("brand_site_service_config")
    .select("cms_origin")
    .eq("config_key", "sites_v1")
    .maybeSingle();
  const config = configData as { cms_origin: string } | null;
  if (config === null) {
    return sitesFailure(
      "SERVICE_TEMPORARILY_UNAVAILABLE",
      503,
      args.operationId,
    );
  }

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
  try {
    const response = await fetch(`${String(config.cms_origin)}${args.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mingla-Sites-Envelope": btoa(JSON.stringify(envelope)),
      },
      body: serialized,
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null) as
      | { ok?: boolean; data?: unknown; error?: { code?: unknown } }
      | null;
    if (!response.ok || !payload?.ok) {
      const reportedCode = payload?.error?.code;
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

    if (availabilityMatch && method === "GET") {
      const brandId = requireUuid(availabilityMatch[1]);
      const { data, error } = await db.user.rpc(
        "brand_site_business_availability",
        { p_brand_id: brandId },
      );
      if (error) return sitesFailure("FORBIDDEN", 403);
      return sitesJson({ ok: true, data });
    }

    if (brandMatch && method === "GET") {
      const brandId = requireUuid(brandMatch[1]);
      const { data, error } = await db.user
        .from("brand_sites")
        .select(
          "id,brand_id,renderer_key,renderer_version,status,active_publication_id,last_successful_publication_id,provisioning_error_code,created_at,updated_at,brand_site_hosts(hostname,status,is_primary)",
        )
        .eq("brand_id", brandId)
        .maybeSingle();
      if (error || data === null) return sitesFailure("NOT_FOUND", 404);
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
      const argumentsDigest = typeof input.arguments_digest === "string"
        ? requireSha256(input.arguments_digest)
        : await sitesSha256Hex(JSON.stringify({
          action: "provision",
          brand_id: brandId,
          renderer_key: "restaurant-website-v1",
          renderer_version: 1,
        }));
      const { data, error } = await db.user.rpc("brand_site_provision", {
        p_brand_id: brandId,
        p_operation_id: operationId,
        p_arguments_digest: argumentsDigest,
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
      const provision = data as Record<string, unknown>;
      const siteId = requireUuid(provision.site_id);
      return await callCms(db.service, {
        siteId,
        operationId,
        path: `/api/internal/reconcile/${operationId}`,
        payload: {
          kind: "provision",
          site_id: siteId,
          brand_id: brandId,
          renderer_key: "restaurant-website-v1",
          renderer_version: 1,
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
      return await callCms(db.service, {
        siteId,
        operationId,
        path: cmsPath,
        payload: {
          ...input,
          authorization: data,
          user_id: authData.user.id,
          brand_id: (data as Record<string, unknown>).brand_id,
        },
      });
    }

    if (ariMatch && method === "POST") {
      const siteId = requireUuid(ariMatch[1]);
      const operationId = requireUuid(input.operation_id);
      const action = String(input.action || "");
      const allowed = new Set([
        "get_brand_site",
        "list_site_pages",
        "get_site_page",
        "propose_site_content_update",
        "propose_site_settings_update",
        "attach_approved_site_media",
        "validate_site_draft",
      ]);
      if (!allowed.has(action)) return sitesFailure("VALIDATION_FAILED", 400);
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
      return await callCms(db.service, {
        siteId,
        operationId,
        path: "/api/internal/ari",
        payload: {
          action,
          site_id: siteId,
          brand_id: auth.brand_id,
          user_id: auth.user_id,
          rank: auth.rank,
          args: input.args && typeof input.args === "object" ? input.args : {},
        },
      });
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
            "id,site_id,source_revision_id,source_digest,artifact_digest,renderer_version,status,previous_publication_id,rollback_source_publication_id,requested_at,completed_at,failure_code",
          )
          .eq("site_id", siteId)
          .order("requested_at", { ascending: false })
          .limit(50);
        if (error) return sitesFailure("FORBIDDEN", 403);
        return sitesJson({ ok: true, data });
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
