import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeSitesHost,
  publicationGeneration,
  requireSha256,
  requireUuid,
  sitesJson,
  sitesSha256Hex,
  verifySitesEnvelope,
} from "../_shared/sitesContracts.ts";
import { resolveCmsToCoreVerifier } from "../_shared/sitesSecurity.ts";
import { observeSitesRequest } from "../_shared/sitesObservability.ts";
import { bunnyBinding, handleSiteVideoRoute, serviceVideoStore } from "./siteVideos.ts";

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
const RECOVERY_STATE_KEYS = [
  "observed_at",
  "schema_version",
  "state",
] as const;
const EVIDENCE_SOURCES = new Set(["scheduled_job", "local_synthetic"]);

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

/*
 * #2829 — a late or stale backup ALERTS; it never takes a site down
 * (Seth 2026-10-12 D1: a failing recovery check means hold-and-page). This
 * replaces the old signed pilot deactivation. The body carries only the
 * observed state; nothing in it can name a host, a brand or a site to switch
 * off, because there is no longer any switch to throw.
 */
export function validRecoveryState(
  value: Record<string, unknown>,
  now = Date.now(),
): boolean {
  const observed = utcTimestamp(value.observed_at);
  return exactKeys(value, RECOVERY_STATE_KEYS) &&
    value.schema_version === 1 &&
    (value.state === "fresh" || value.state === "late" ||
      value.state === "stale") &&
    observed !== null && observed <= now + 5 * 60_000 &&
    observed > now - 7 * 24 * 60 * 60_000;
}

export function emitRecoveryAlert(
  state: string,
  operationId: string,
): void {
  // The alert IS the response to a late backup: a structured line the
  // observability sink pages on (console locally). Sites stay up.
  console.warn(JSON.stringify({
    event: "mingla_sites_alert",
    metric: `recovery.${state}`,
    request_id: crypto.randomUUID(),
    operation_id: operationId,
    site_id: null,
    publication_id: null,
    direction: "cms_to_core",
    route: "/internal/v1/sites/:site_id/recovery-state",
    state_transition: `recovery_check->${state}_recorded`,
    latency_ms: 0,
    retry_count: 0,
    safe_error_code: state === "fresh" ? null : "SERVICE_TEMPORARILY_UNAVAILABLE",
    status_code: null,
    version: "sites-v1",
    sites_taken_offline: 0,
  }));
}

/*
 * #3157 — the publish probe cannot see "the site is unreachable".
 *
 * probePublicationCandidate runs inside the CMS, against the artifact, BEFORE
 * the live pointer moves. On 2026-09-09 it recorded status_code 200 while
 * https://gogi.sites.usemingla.com had been 404 on every route for over an
 * hour, because the pilot flag was off and the resolver's join was empty. The
 * one gate that exists to stop a broken publish is structurally blind to the
 * failure mode that actually took the site down.
 *
 * So once brand_site_complete_publication has moved the pointer, Core makes
 * ONE real HTTPS request to the site's real public hostname and records what
 * came back. It records; it never rolls back. A transient network blip must
 * not be able to un-publish a customer's website, and the publish callback
 * must never fail because of this check — the pointer has already moved, and
 * telling the CMS otherwise would split the two systems' view of the truth.
 */
const PUBLIC_CHECK_TIMEOUT_MS = 8_000;
const PUBLIC_CHECK_MAX_BYTES = 262_144;
const PUBLIC_CHECK_DIGEST_RE = /data-artifact-digest="([0-9a-f]{64})"/;

export function extractPublishedArtifactDigest(html: string): string | null {
  return PUBLIC_CHECK_DIGEST_RE.exec(html)?.[1] ?? null;
}

export interface PublicHostObservation {
  status_code: number | null;
  observed_digest: string | null;
  reachable: boolean;
}

export async function observePublicHost(
  hostname: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicHostObservation> {
  const host = normalizeSitesHost(hostname);
  if (host === null) {
    return { status_code: null, observed_digest: null, reachable: false };
  }
  try {
    const response = await fetchImpl(`https://${host}/`, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html",
        "cache-control": "no-cache",
        "user-agent": "mingla-sites-publish-check/1 (+issue-3157)",
      },
      signal: AbortSignal.timeout(PUBLIC_CHECK_TIMEOUT_MS),
    });
    let body = "";
    try {
      body = (await response.text()).slice(0, PUBLIC_CHECK_MAX_BYTES);
    } catch {
      // A status with an unreadable body is still a real status.
      body = "";
    }
    return {
      status_code: response.status,
      observed_digest: extractPublishedArtifactDigest(body),
      reachable: response.status >= 200 && response.status < 300,
    };
  } catch {
    // DNS, TLS, connect, timeout: no status at all. That IS the outage shape.
    return { status_code: null, observed_digest: null, reachable: false };
  }
}

export interface PublicCheckInput {
  siteId: string;
  operationId: string;
  publicationId: string;
}

/*
 * The check is expressed against three narrow ports so it can be exercised
 * without a live database or a live website. Everything it does is: find the
 * site's real public hostname, ask that hostname for the home page, and write
 * down what came back.
 */
export interface PublicCheckPorts {
  primaryHostname(siteId: string): Promise<string | null>;
  observe(hostname: string): Promise<PublicHostObservation>;
  record(args: {
    siteId: string;
    operationId: string;
    publicationId: string;
    observedAt: string;
    statusCode: number | null;
    observedDigest: string | null;
    reachable: boolean;
  }): Promise<{ ok: boolean; data: Record<string, unknown> | null }>;
}

function emitPublicCheckObservation(
  input: PublicCheckInput,
  metric: string,
  statusCode: number | null,
): void {
  // #3157 — the 2026-09-09 outage was found by a human loading the site. An
  // unreachable public host after a publish has to make a noise of its own.
  console.info(JSON.stringify({
    event: "mingla_sites_state",
    metric: `publish.public_check.${metric}`,
    request_id: crypto.randomUUID(),
    operation_id: input.operationId,
    site_id: input.siteId,
    publication_id: input.publicationId,
    direction: "cms_to_core",
    route: "/internal/v1/sites/:site_id/publication-results",
    state_transition: "publication_published->public_check_recorded",
    latency_ms: 0,
    retry_count: 0,
    safe_error_code: metric === "reachable"
      ? null
      : "SERVICE_TEMPORARILY_UNAVAILABLE",
    status_code: statusCode,
    version: "sites-v1",
  }));
}

export async function recordPublicReachability(
  ports: PublicCheckPorts,
  input: PublicCheckInput,
): Promise<Record<string, unknown> | null> {
  try {
    const hostname = await ports.primaryHostname(input.siteId);
    if (hostname === null) {
      emitPublicCheckObservation(input, "no_hostname", null);
      return null;
    }
    const observation = await ports.observe(hostname);
    const recorded = await ports.record({
      siteId: input.siteId,
      operationId: input.operationId,
      publicationId: input.publicationId,
      observedAt: new Date().toISOString(),
      statusCode: observation.status_code,
      observedDigest: observation.observed_digest,
      reachable: observation.reachable,
    });
    emitPublicCheckObservation(
      input,
      !recorded.ok
        ? "record_failed"
        : observation.reachable
        ? "reachable"
        : "unreachable",
      observation.status_code,
    );
    return recorded.ok ? recorded.data : null;
  } catch {
    // The pointer has already moved. This check reports; it never decides.
    emitPublicCheckObservation(input, "record_failed", null);
    return null;
  }
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
    // #2829 W9a — Studio reports the owner saved the site's look (design,
    // colours, fonts): "Your look" on the website plan ticks from this, never
    // from the client. Bound to the envelope's site like every other route.
    const lookSavedMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/look-saved$/,
    );
    if (lookSavedMatch) {
      const siteId = requireUuid(lookSavedMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      const designKey = typeof parsed.design_key === "string" ? parsed.design_key : "";
      const { data, error } = await service.rpc("brand_site_record_look_saved", {
        p_site_id: siteId,
        p_design_key: designKey,
      });
      return error
        ? sitesJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 409)
        : sitesJson({ ok: true, data });
    }
    // #2829 W10 — Studio built a preview of this site's draft: it becomes the
    // preview the site's private share links show. Bound to the envelope's
    // site; Core checks the object key names that site.
    const previewArtifactMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/preview-artifacts$/,
    );
    if (previewArtifactMatch) {
      const siteId = requireUuid(previewArtifactMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      const { data, error } = await service.rpc("brand_site_record_preview_artifact", {
        p_site_id: siteId,
        p_artifact_key: typeof parsed.artifact_key === "string" ? parsed.artifact_key : "",
      });
      return error
        ? sitesJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 409)
        : sitesJson({ ok: true, data });
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
      //
      // #3149 wave 5 — `include` is now a LIST. It was compared with `===`
      // against the single value "menu"; read with `getAll` a caller can ask
      // for the menu, the venue, or both, and a caller that still sends one
      // `include=menu` is understood exactly as before.
      const includes = new Set(
        new URL(req.url).searchParams.getAll("include"),
      );
      let menu: unknown[] = [];
      let menuVenueId: string | null = null;
      let venueSlug: string | null = null;
      let brandSlug: string | null = null;
      if (includes.has("menu")) {
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
      }
      if (includes.has("menu") || includes.has("venue")) {
        // Which kitchen receives a website order, and — since #3149 wave 5 —
        // which public venue page a reservation button points at. Both want
        // the same answer, so it is resolved ONCE for either caller.
        //
        // NULL when the brand has no verified venue, or more than one: the
        // website then shows the menu without a cart rather than guessing where
        // dinner should be cooked, and drops its booking button rather than
        // guessing which room is being booked.
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
        /*
         * #3149 wave 5 — the SLUGS for that venue's public page.
         *
         * `venue_public_view` is the anon read model and is defined
         * `WHERE claim_status = 'verified'`, which is exactly the gate the
         * booking link needs: a row here means the page it addresses is
         * publicly reachable. No row means no link, and the block is dropped
         * rather than published pointing at a 404.
         */
        if (includes.has("venue") && menuVenueId) {
          const slugResult = await service
            .from("venue_public_view")
            .select("slug,brand_slug")
            .eq("id", menuVenueId)
            .maybeSingle();
          if (slugResult.error) {
            return sitesJson(
              { ok: false, error: { code: "VALIDATION_FAILED" } },
              409,
            );
          }
          venueSlug = typeof slugResult.data?.slug === "string"
            ? slugResult.data.slug
            : null;
          brandSlug = typeof slugResult.data?.brand_slug === "string"
            ? slugResult.data.brand_slug
            : null;
        }
      }
      // #2829 W4 — the live offerings feed, frozen into the publication as
      // the site's fallback snapshot (`offerings_snapshot`) when Core cannot
      // be reached at request time. Read only when the builder asks for it.
      let feed: unknown = null;
      if (includes.has("feed")) {
        const feedResult = await service.rpc("brand_site_offerings_feed", {
          p_site_id: siteId,
        });
        if (feedResult.error || !feedResult.data) {
          return sitesJson(
            { ok: false, error: { code: "VALIDATION_FAILED" } },
            409,
          );
        }
        feed = feedResult.data;
      }
      return sitesJson({
        ok: true,
        data: {
          offerings: data ?? [],
          feed,
          menu,
          menu_venue_id: menuVenueId,
          venue_slug: venueSlug,
          brand_slug: brandSlug,
        },
      });
    }
    const retentionMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/retention-protection$/,
    );
    const readinessMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/readiness-evidence$/,
    );
    const recoveryStateMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/recovery-state$/,
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
      // #2829 — `evidence_source` travels beside the evidence; Core refuses
      // `local_synthetic` unless its service row is a local one.
      const { evidence_source: evidenceSource, ...evidence } = parsed;
      if (
        (evidenceSource !== undefined &&
          !EVIDENCE_SOURCES.has(String(evidenceSource))) ||
        !validReadinessEvidence(evidence)
      ) {
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
          p_evidence: evidence,
          p_evidence_source: evidenceSource ?? "scheduled_job",
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
    if (recoveryStateMatch && req.method === "POST") {
      const siteId = requireUuid(recoveryStateMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      if (!validRecoveryState(parsed)) {
        return sitesJson(
          { ok: false, error: { code: "VALIDATION_FAILED" } },
          400,
        );
      }
      const { data, error } = await service.rpc(
        "brand_site_record_recovery_state",
        {
          p_state: parsed.state,
          p_observed_at: parsed.observed_at,
        },
      );
      emitRecoveryAlert(String(parsed.state), requireUuid(envelope.operation_id));
      if (error) {
        return sitesJson(
          { ok: false, error: { code: "INVALID_STATE" } },
          409,
        );
      }
      return sitesJson({ ok: true, data });
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
      // #2829 W2 — an owner-fixable refusal names itself (closed list; Core
      // refuses anything else). Absent → the original 3-argument call.
      const reasonCode = parsed.failure_code === "PATH_COLLISION" ||
          parsed.failure_code === "PAGE_LIMIT_EXCEEDED" ||
          // #2829 W9b — a first publish waits until the design checks ran.
          parsed.failure_code === "DESIGN_CHECKS_REQUIRED"
        ? parsed.failure_code
        : null;
      const { data, error } = await service.rpc(
        "brand_site_fail_publication",
        {
          p_site_id: siteId,
          p_operation_id: requireUuid(envelope.operation_id),
          p_publication_id: requireUuid(parsed.publication_id),
          ...(reasonCode ? { p_reason_code: reasonCode } : {}),
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
      const publicationId = requireUuid(parsed.publication_id);
      const operationId = requireUuid(envelope.operation_id);
      // #2829 W3 — the CMS names the generation it wrote (v2 + design, or v1
      // for a rollback) and any font fallbacks; Core validates and records
      // them. A completion without them is the original v1 call.
      const generation = publicationGeneration(parsed);
      const { data, error } = await service.rpc(
        "brand_site_complete_publication",
        {
          p_site_id: siteId,
          p_operation_id: operationId,
          p_publication_id: publicationId,
          p_source_revision_id: String(parsed.source_revision_id ?? ""),
          p_source_digest: requireSha256(parsed.source_digest),
          p_artifact_key: String(parsed.artifact_key ?? ""),
          p_artifact_digest: requireSha256(parsed.artifact_digest),
          p_probe_summary: parsed.probe_summary ?? {},
          ...(generation ?? {}),
        },
      );
      if (error) {
        await markAmbiguous(siteId);
        return sitesJson(
          { ok: false, error: { code: "CALLBACK_AMBIGUOUS" } },
          409,
        );
      }
      // #3157 — the live pointer has now moved. Only from here can anything
      // ask the public host what it actually serves.
      const publicCheck = await recordPublicReachability({
        primaryHostname: async (site) => {
          const { data: host, error: hostError } = await service
            .from("brand_site_hosts")
            .select("hostname")
            .eq("site_id", site)
            .eq("is_primary", true)
            .eq("status", "active")
            .is("retired_at", null)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          return hostError || typeof host?.hostname !== "string"
            ? null
            : host.hostname;
        },
        observe: observePublicHost,
        record: async (args) => {
          const { data: recorded, error: recordError } = await service.rpc(
            "brand_site_record_public_reachability",
            {
              p_site_id: args.siteId,
              p_operation_id: args.operationId,
              p_publication_id: args.publicationId,
              p_observed_at: args.observedAt,
              p_status_code: args.statusCode,
              p_observed_digest: args.observedDigest,
              p_reachable: args.reachable,
            },
          );
          return {
            ok: !recordError,
            data: (recorded ?? null) as Record<string, unknown> | null,
          };
        },
      }, { siteId, operationId, publicationId });
      return sitesJson({
        ok: true,
        data: publicCheck === null
          ? data
          : { ...(data as Record<string, unknown>), public_check: publicCheck },
      });
    }
    const authorizeMatch = path.match(
      /^\/internal\/v1\/sites\/([^/]+)\/authorize$/,
    );
    if (authorizeMatch) {
      // #3651 — the URL site must be the site the envelope was signed for,
      // exactly like every other site-scoped route; the CMS signs with its
      // tenant's own core_site_id, so a tenant can only ask about itself.
      const siteId = requireUuid(authorizeMatch[1]);
      if (siteId !== envelope.site_id) throw new Error("TENANT_MISMATCH");
      const { data, error } = await service.rpc(
        "brand_site_internal_authorize",
        {
          p_site_id: siteId,
          p_user_id: requireUuid(parsed.user_id),
          p_min_rank: Number(parsed.min_rank ?? 20),
        },
      );
      return error
        ? sitesJson({ ok: false, error: { code: "FORBIDDEN" } }, 403)
        : sitesJson({ ok: true, data });
    }
    // #2829 W6 (AD-9) — stream videos (Bunny through Core); inert when Bunny
    // is not configured. Site-bound like every route above.
    if (/^\/internal\/v1\/sites\/[^/]+\/videos\//.test(path)) {
      try {
        const video = await handleSiteVideoRoute(
          { method: req.method, path, body: parsed, envelopeSiteId: envelope.site_id },
          { store: serviceVideoStore(service), bunny: bunnyBinding() },
        );
        if (video) return video;
      } catch (error) {
        if (error instanceof Error && error.message === "TENANT_MISMATCH") throw error;
        if (error instanceof Error && error.message === "VALIDATION_FAILED") {
          return sitesJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400);
        }
        return sitesJson({ ok: false, error: { code: "SERVICE_TEMPORARILY_UNAVAILABLE" } }, 503);
      }
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
