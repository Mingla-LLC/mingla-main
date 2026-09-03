import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  requireSha256,
  requireUuid,
  sitesJson,
  sitesSha256Hex,
  verifySitesEnvelope,
} from "../_shared/sitesContracts.ts";
import { resolveCmsToCoreVerifier } from "../_shared/sitesSecurity.ts";
import { observeSitesRequest } from "../_shared/sitesObservability.ts";

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

const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const NIGHTLY_BACKUP_KEYS = [
  "backup_bundle_digest",
  "backup_retention_days",
  "database_backup_verified_at",
  "evidence_kind",
  "manifest_digest",
  "object_bytes",
  "object_count",
  "object_manifest_verified_at",
  "observed_at",
  "schema_version",
] as const;
const RESTORE_DRILL_KEYS = [
  "document_count",
  "evidence_kind",
  "object_bytes",
  "object_count",
  "observed_at",
  "restore_drill_evidence_digest",
  "restore_drill_verified_at",
  "schema_version",
  "tenant_count",
] as const;
const PILOT_DEACTIVATION_KEYS = [
  "hostname",
  "reason_code",
  "schema_version",
] as const;

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort());
}

function utcTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !RFC3339_UTC_RE.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function safeCount(value: unknown, minimum = 0): boolean {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

export function validReadinessEvidence(
  value: Record<string, unknown>,
  now = Date.now(),
): boolean {
  if (value.schema_version !== 1) return false;
  const observed = utcTimestamp(value.observed_at);
  if (observed === null || observed > now + 5 * 60_000) return false;
  if (value.evidence_kind === "nightly_backup") {
    const database = utcTimestamp(value.database_backup_verified_at);
    const manifest = utcTimestamp(value.object_manifest_verified_at);
    return exactKeys(value, NIGHTLY_BACKUP_KEYS) &&
      Number.isInteger(value.backup_retention_days) &&
      Number(value.backup_retention_days) >= 7 &&
      database !== null && manifest !== null &&
      database <= observed && manifest <= observed &&
      database > now - 26 * 60 * 60_000 &&
      manifest > now - 26 * 60 * 60_000 &&
      safeCount(value.object_count) && safeCount(value.object_bytes) &&
      typeof value.manifest_digest === "string" &&
      /^[0-9a-f]{64}$/.test(value.manifest_digest) &&
      typeof value.backup_bundle_digest === "string" &&
      /^[0-9a-f]{64}$/.test(value.backup_bundle_digest);
  }
  if (value.evidence_kind === "restore_drill") {
    const restored = utcTimestamp(value.restore_drill_verified_at);
    return exactKeys(value, RESTORE_DRILL_KEYS) && restored !== null &&
      restored <= observed && restored > now - 100 * 24 * 60 * 60_000 &&
      safeCount(value.tenant_count, 1) && safeCount(value.document_count, 1) &&
      safeCount(value.object_count) && safeCount(value.object_bytes) &&
      typeof value.restore_drill_evidence_digest === "string" &&
      /^[0-9a-f]{64}$/.test(value.restore_drill_evidence_digest);
  }
  return false;
}

export function validPilotDeactivation(
  value: Record<string, unknown>,
): boolean {
  return exactKeys(value, PILOT_DEACTIVATION_KEYS) &&
    value.schema_version === 1 &&
    value.hostname === "gogi.sites.usemingla.com" &&
    value.reason_code === "BACKUP_READINESS_FAILED";
}

export function safePilotDeactivationReceipt(
  value: unknown,
  siteId: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const deactivatedAt = typeof result.deactivated_at === "string"
    ? Date.parse(result.deactivated_at)
    : Number.NaN;
  if (
    result.site_id !== siteId ||
    result.hostname !== "gogi.sites.usemingla.com" ||
    result.status !== "disabled" ||
    result.last_good_preserved !== true ||
    !Number.isFinite(deactivatedAt)
  ) return null;
  return {
    site_id: siteId,
    hostname: "gogi.sites.usemingla.com",
    status: "disabled",
    deactivated_at: new Date(deactivatedAt).toISOString(),
    last_good_preserved: true,
  };
}

async function handleBrandSiteCmsCallbackRequest(
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
    const markAmbiguous = async (siteId: string): Promise<void> => {
      try {
        await service.rpc("brand_site_mark_operation_ambiguous", {
          p_site_id: siteId,
          p_operation_id: requireUuid(envelope.operation_id),
          p_safe_error_code: "CALLBACK_AMBIGUOUS",
        });
      } catch {
        // Preserve the signed callback's safe ambiguous response; the gateway
        // observation remains the alerting signal if Core cannot persist it.
      }
    };
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
    const previewResultMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/preview-results$/,
    );
    if (previewResultMatch) {
      const siteId = requireUuid(previewResultMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      const { data, error } = await service.rpc(
        "brand_site_complete_preview",
        {
          p_site_id: siteId,
          p_operation_id: requireUuid(envelope.operation_id),
          p_revision_id: String(parsed.revision_id ?? ""),
          p_expires_at: String(parsed.expires_at ?? ""),
        },
      );
      if (error) {
        await markAmbiguous(siteId);
        return sitesJson(
          { ok: false, error: { code: "CALLBACK_AMBIGUOUS" } },
          409,
        );
      }
      return sitesJson({ ok: true, data });
    }
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
      if (error) {
        await markAmbiguous(siteId);
        return sitesJson(
          { ok: false, error: { code: "CALLBACK_AMBIGUOUS" } },
          409,
        );
      }
      return sitesJson({ ok: true, data });
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
      if (error) {
        return sitesJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 409);
      }
      // #2830 — the menu travels on the SAME projection as offerings, and only
      // when the builder asks for it, so a page with no menu block costs no
      // menu read. Mingla stays the authority: the website never keeps its own
      // copy of what a restaurant sells.
      let menu: unknown[] = [];
      let menuVenueId: string | null = null;
      if (new URL(req.url).searchParams.get("include") === "menu") {
        const menuResult = await service.rpc("brand_site_menu_projection", {
          p_site_id: siteId,
        });
        if (menuResult.error) {
          return sitesJson(
            { ok: false, error: { code: "VALIDATION_FAILED" } },
            409,
          );
        }
        menu = menuResult.data ?? [];
        // Which kitchen receives a website order. NULL when the brand has no
        // verified venue, or more than one — the website then shows the menu
        // without a cart rather than guessing where dinner should be cooked.
        const venueResult = await service.rpc("brand_site_orderable_venue", {
          p_site_id: siteId,
        });
        if (venueResult.error) {
          return sitesJson(
            { ok: false, error: { code: "VALIDATION_FAILED" } },
            409,
          );
        }
        menuVenueId = typeof venueResult.data === "string"
          ? venueResult.data
          : null;
      }
      return sitesJson({
        ok: true,
        data: { offerings: data ?? [], menu, menu_venue_id: menuVenueId },
      });
    }
    const retentionMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/retention-protection$/,
    );
    const readinessMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/readiness-evidence$/,
    );
    const deactivationMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/pilot-deactivation$/,
    );
    const publicationSourceMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/publications\/([^/]+)\/source$/,
    );
    if (publicationSourceMatch && req.method === "GET") {
      const siteId = requireUuid(publicationSourceMatch[1]);
      const publicationId = requireUuid(publicationSourceMatch[2]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      const { data, error } = await service
        .from("brand_site_publications")
        .select(
          "id,site_id,source_revision_id,source_digest,artifact_key,artifact_digest,artifact_schema_version,renderer_key,renderer_version,status",
        )
        .eq("id", publicationId)
        .eq("site_id", siteId)
        .eq("status", "published")
        .maybeSingle();
      return error || !data
        ? sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404)
        : sitesJson({ ok: true, data });
    }
    if (retentionMatch && req.method === "GET") {
      const siteId = requireUuid(retentionMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      const { data, error } = await service.rpc(
        "brand_site_retention_protection",
        { p_site_id: siteId },
      );
      if (error || !data) {
        return sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
      }
      return sitesJson({ ok: true, data });
    }
    if (readinessMatch && req.method === "POST") {
      const siteId = requireUuid(readinessMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      if (!validReadinessEvidence(parsed)) {
        return sitesJson(
          { ok: false, error: { code: "VALIDATION_FAILED" } },
          400,
        );
      }
      const { data, error } = await service.rpc(
        "brand_site_record_readiness_evidence",
        {
          p_site_id: siteId,
          p_operation_id: requireUuid(envelope.operation_id),
          p_body_digest: await sitesSha256Hex(raw),
          p_evidence: parsed,
        },
      );
      if (error) {
        const conflict = error.message.includes("idempotency");
        return sitesJson({
          ok: false,
          error: { code: conflict ? "IDEMPOTENCY_CONFLICT" : "INVALID_STATE" },
        }, 409);
      }
      return sitesJson({ ok: true, data });
    }
    if (deactivationMatch && req.method === "POST") {
      const siteId = requireUuid(deactivationMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      if (!validPilotDeactivation(parsed)) {
        return sitesJson(
          { ok: false, error: { code: "VALIDATION_FAILED" } },
          400,
        );
      }
      const { data: config, error: configError } = await service
        .from("brand_site_service_config")
        .select("pilot_brand_id")
        .eq("config_key", "sites_v1")
        .eq("pilot_site_id", siteId)
        .maybeSingle();
      if (configError || !config?.pilot_brand_id) {
        return sitesJson(
          { ok: false, error: { code: "INVALID_STATE" } },
          409,
        );
      }
      const { data, error } = await service.rpc(
        "brand_site_deactivate_gogi_pilot",
        {
          p_brand_id: requireUuid(config.pilot_brand_id),
          p_site_id: siteId,
          p_hostname: parsed.hostname,
          p_operation_id: requireUuid(envelope.operation_id),
          p_reason_code: parsed.reason_code,
        },
      );
      if (error) {
        const conflict = error.message.includes("idempotency");
        return sitesJson({
          ok: false,
          error: { code: conflict ? "IDEMPOTENCY_CONFLICT" : "INVALID_STATE" },
        }, 409);
      }
      const receipt = safePilotDeactivationReceipt(data, siteId);
      return receipt ? sitesJson({ ok: true, data: receipt }) : sitesJson(
        { ok: false, error: { code: "INVALID_STATE" } },
        409,
      );
    }
    const publicationMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/publication-results$/,
    );
    const publicationFailureMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/publication-failures$/,
    );
    if (publicationFailureMatch) {
      const siteId = requireUuid(publicationFailureMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      const { data, error } = await service.rpc(
        "brand_site_fail_publication",
        {
          p_site_id: siteId,
          p_operation_id: requireUuid(envelope.operation_id),
          p_publication_id: requireUuid(parsed.publication_id),
        },
      );
      if (error) {
        await markAmbiguous(siteId);
        return sitesJson(
          { ok: false, error: { code: "CALLBACK_AMBIGUOUS" } },
          409,
        );
      }
      return sitesJson({ ok: true, data });
    }
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
      if (error) {
        await markAmbiguous(siteId);
        return sitesJson(
          { ok: false, error: { code: "CALLBACK_AMBIGUOUS" } },
          409,
        );
      }
      return sitesJson({ ok: true, data });
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

export async function handleBrandSiteCmsCallback(
  req: Request,
): Promise<Response> {
  return await observeSitesRequest(req, {
    service: "brand-site-cms-callback",
    direction: "cms_to_core",
    handler: handleBrandSiteCmsCallbackRequest,
  });
}

if (import.meta.main) serve(handleBrandSiteCmsCallback);
