import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  requireSha256,
  requireUuid,
  sitesJson,
  verifySitesEnvelope,
} from "../_shared/sitesContracts.ts";
import { resolveCmsToCoreVerifier } from "../_shared/sitesSecurity.ts";

function decodeEnvelope(value: string | null): unknown {
  if (value === null || value.length > 16_384) {
    throw new Error("SIGNATURE_INVALID");
  }
  try {
    return JSON.parse(atob(value));
  } catch {
    throw new Error("SIGNATURE_INVALID");
  }
}

export async function handleBrandSiteCmsCallback(
  req: Request,
): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) {
    return sitesJson({ ok: false }, 405);
  }
  const path =
    new URL(req.url).pathname.replace(/^.*\/brand-site-cms-callback/, "") ||
    "/";
  const raw = await req.text();
  let parsed: Record<string, unknown>;
  try {
    const value = req.method === "GET" ? {} : JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return sitesJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400);
  }
  try {
    const envelope = await verifySitesEnvelope({
      envelope: decodeEnvelope(req.headers.get("x-mingla-sites-envelope")),
      expectedAudience: "mingla-core",
      expectedDirection: "cms_to_core",
      method: req.method,
      path,
      body: raw,
      keys: resolveCmsToCoreVerifier(),
    });
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const service = createClient(url, key, { auth: { persistSession: false } });
    const { error: nonceError } = await service
      .from("brand_site_gateway_nonces")
      .insert({
        direction: envelope.direction,
        nonce: envelope.nonce,
        operation_id: envelope.operation_id,
        site_id: envelope.site_id,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
    if (nonceError) {
      return sitesJson({ ok: false, error: { code: "REPLAY_DETECTED" } }, 409);
    }

    if (path === "/internal/v1/editor-exchanges/consume") {
      const { data, error } = await service.rpc(
        "brand_site_consume_editor_exchange",
        {
          p_code: String(parsed.code ?? ""),
          p_destination: String(parsed.destination ?? ""),
        },
      );
      return error
        ? sitesJson({ ok: false, error: { code: "SESSION_EXPIRED" } }, 403)
        : sitesJson({ ok: true, data });
    }
    const provisionMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/provision-results$/,
    );
    if (provisionMatch) {
      const siteId = requireUuid(provisionMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      const { data, error } = await service.rpc(
        "brand_site_complete_provision",
        {
          p_site_id: siteId,
          p_operation_id: requireUuid(envelope.operation_id),
          p_payload_tenant_id: requireUuid(parsed.tenant_id),
        },
      );
      return error
        ? sitesJson({ ok: false, error: { code: "CALLBACK_AMBIGUOUS" } }, 409)
        : sitesJson({ ok: true, data });
    }
    const projectionMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/projection$/,
    );
    if (projectionMatch && req.method === "GET") {
      const siteId = requireUuid(projectionMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      const offeringIds = new URL(req.url).searchParams.getAll("offering_id")
        .map(requireUuid);
      const { data, error } = await service.rpc(
        "brand_site_commercial_projection",
        { p_site_id: siteId, p_offering_ids: offeringIds },
      );
      return error
        ? sitesJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 409)
        : sitesJson({ ok: true, data: { offerings: data ?? [] } });
    }
    const retentionMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/retention-protection$/,
    );
    if (retentionMatch && req.method === "GET") {
      const siteId = requireUuid(retentionMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      const [{ data: site }, { data: publications, error }] = await Promise.all(
        [
          service.from("brand_sites")
            .select("active_publication_id,last_successful_publication_id")
            .eq("id", siteId)
            .maybeSingle(),
          service.from("brand_site_publications")
            .select(
              "id,artifact_key,requested_at,rollback_source_publication_id",
            )
            .eq("site_id", siteId)
            .not("artifact_key", "is", null)
            .order("requested_at", { ascending: false })
            .limit(5000),
        ],
      );
      if (error || !site) {
        return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
      }
      const rows = publications ?? [];
      const alwaysProtected = new Set([
        String(site.active_publication_id || ""),
        String(site.last_successful_publication_id || ""),
        ...rows.map((row) => String(row.rollback_source_publication_id || "")),
      ]);
      const cutoff = Date.now() - 90 * 24 * 60 * 60_000;
      const protectedArtifactKeys = rows
        .filter((row, index) =>
          index < 50 || alwaysProtected.has(String(row.id)) ||
          Date.parse(row.requested_at) >= cutoff
        )
        .map((row) => String(row.artifact_key));
      return sitesJson({
        ok: true,
        data: { protected_artifact_keys: protectedArtifactKeys },
      });
    }
    const publicationMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/publication-results$/,
    );
    if (publicationMatch) {
      const siteId = requireUuid(publicationMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      const { data, error } = await service.rpc(
        "brand_site_complete_publication",
        {
          p_site_id: siteId,
          p_operation_id: requireUuid(envelope.operation_id),
          p_publication_id: requireUuid(parsed.publication_id),
          p_source_revision_id: String(parsed.source_revision_id ?? ""),
          p_source_digest: requireSha256(parsed.source_digest),
          p_artifact_key: String(parsed.artifact_key ?? ""),
          p_artifact_digest: requireSha256(parsed.artifact_digest),
          p_probe_summary: parsed.probe_summary ?? {},
        },
      );
      return error
        ? sitesJson({ ok: false, error: { code: "CALLBACK_AMBIGUOUS" } }, 409)
        : sitesJson({ ok: true, data });
    }
    const authorizeMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/authorize$/,
    );
    if (authorizeMatch) {
      const { data, error } = await service.rpc(
        "brand_site_internal_authorize",
        {
          p_site_id: requireUuid(authorizeMatch[1]),
          p_user_id: requireUuid(parsed.user_id),
          p_min_rank: Number(parsed.min_rank ?? 20),
        },
      );
      return error
        ? sitesJson({ ok: false, error: { code: "FORBIDDEN" } }, 403)
        : sitesJson({ ok: true, data });
    }
    return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
  } catch (error) {
    const code = error instanceof Error && [
        "REPLAY_DETECTED",
        "TENANT_MISMATCH",
        "SIGNATURE_INVALID",
      ].includes(error.message)
      ? error.message
      : "SIGNATURE_INVALID";
    return sitesJson({ ok: false, error: { code } }, 403);
  }
}

if (import.meta.main) serve(handleBrandSiteCmsCallback);
