import { createStreamUploadIntent, refreshStreamVideo, streamVideoCapability } from "../lib/streamVideo";
import type { Endpoint, PayloadRequest } from "payload";
import { ARI_DESIGNER_ACTIONS, ARI_REFUSAL_CODES, AriRefusal, assertFirstPublishChecked, loadDraftState, parseAriEvidence, runAriDesignerAction } from "../lib/ariSiteActions";
import { searchCatalogFonts, type FontCategory } from "../contracts/generated/fontCatalog.ts";
import {
  buildPublicationArtifact,
  buildRollbackPublicationArtifact,
  publicationDraftDigest,
  probePublicationCandidate,
  V1_RENDERER_KEY,
} from "../lib/artifactBuilder";
import { buildExportEntries, buildZip, EXPORT_LINK_TTL_SECONDS, exportObjectKey } from "../lib/siteExport";
import {
  callCore,
  readCorePublicationSource,
  readCoreRetentionProjection,
  reconcileVerificationPath,
  verifyCoreRequest,
} from "../lib/gateway";
import {
  completeUpload,
  createUploadGrant,
  restoreTombstonedMedia,
  runRetentionSweep,
  tombstoneMedia,
} from "../lib/mediaPipeline";
import { presignedGet, readObject, writeObject } from "../lib/objectStore";
import {
  applyStudioMediaSelection,
  studioMediaTargets,
} from "../lib/studioMediaSelection";
import { base64url } from "../lib/crypto";
import { cmsConfig } from "../lib/config";
import { businessPreviewFrameAncestor } from "../lib/origins";
import { sitesJsonResponse } from "../lib/http";
import {
  emitCmsObservation,
  observeCmsEndpoint,
} from "../lib/observability";
import {
  assertMutationRequest,
  decodePreviewGrant,
  encodeSession,
  encodePreviewGrant,
  isSitesRendererKey,
  sessionFromHeaders,
  studioReturnLocation,
  studioReturnLocationFromContext,
  STUDIO_COOKIE,
  STUDIO_CSRF_COOKIE,
} from "../lib/session";
import {
  loadStudioMediaAttachRecords,
  requireAuthenticatedStudioRequest,
  studioMediaGrantRequest,
} from "../lib/studioRequestAuth";
import { ensureStudioUserShadow } from "../lib/studioUserShadow";
import { findAllTenantPages } from "../lib/tenantPages";
import { tenantMediaInUse } from "../lib/mediaHolders";
import { findTenantContent } from "../lib/siteContent";
import {
  ariPageSummaries,
  assertNoPathCollision,
  isHomePage,
  tenantPagePaths,
} from "../lib/pageTree";
import { DESIGN_KEYS, type DesignKey } from "../contracts/generated/designs.ts";
import { previewPagePath } from "../lib/previewPath";
import { reportPreviewBuilt } from "../lib/previewBuiltReport";

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return sitesJsonResponse(data, status, headers);
}
async function objectBody(
  req: PayloadRequest,
): Promise<Record<string, unknown>> {
  const value = await req.json?.();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("VALIDATION_FAILED");
  return value as Record<string, unknown>;
}
function safeFailure(error: unknown, returnUrl?: string) {
  // #2829 W2 — Studio's field-level refusals (e.g. the page tree) are a
  // validation failure to every caller that is not Studio's own form.
  if (error instanceof Error && error.name === "ValidationError") {
    error = new Error("VALIDATION_FAILED");
  }
  const code =
    error instanceof Error &&
    [
      "FORBIDDEN",
      "INVALID_STATE",
      "VALIDATION_FAILED",
      "REVISION_CONFLICT",
      "SESSION_EXPIRED",
      "MEDIA_REJECTED",
      "MEDIA_PROCESSING",
      "PUBLISH_FAILED_LAST_GOOD_PRESERVED",
      "IDEMPOTENCY_CONFLICT",
      // #2829 — a named refusal, never a truncated site.
      "PAGE_LIMIT_EXCEEDED",
      "PATH_COLLISION",
      // #2829 W9b — a first publish waits until the design checks have run.
      "DESIGN_CHECKS_REQUIRED",
      // #2829 W6 — stream video is off (Bunny not configured): use file video.
      "STREAM_VIDEO_UNAVAILABLE",
      // #2829 W11 (A11) — media removal refused: where it is still used.
      "MEDIA_IN_USE_DRAFT",
      "MEDIA_IN_USE_LIVE",
    ].includes(error.message)
      ? error.message
      : "SERVICE_TEMPORARILY_UNAVAILABLE";
  return json(
    {
      ok: false,
      error: {
        code,
        message:
          code === "MEDIA_REJECTED"
            /*
             * #2830 — say what is accepted, and do not call a video an image.
             *
             * This copy said "That image could not be accepted." for every
             * rejection. Video uploads were refused with it while the pipeline
             * behind the gate was fully capable of video, and the message sent
             * whoever hit it looking for a problem with their picture. A
             * rejection that names no requirement is a dead end.
             */
            ? "That file could not be accepted. Images must be JPEG, PNG or WebP under 20 MB; video must be MP4 (H.264, fast start) up to 50 MB."
            // #2829 W11 (A11) — say where removed media is still used.
            : code === "MEDIA_IN_USE_DRAFT"
              ? "This is still used in your draft website. Take it off the page or entry that uses it, then remove it."
              : code === "MEDIA_IN_USE_LIVE"
                ? "Your live website (or a version you can restore) still shows this. Publish a version without it, then remove it."
                : "Website tools are temporarily unavailable.",
        retryable: [
          "MEDIA_PROCESSING",
          "SERVICE_TEMPORARILY_UNAVAILABLE",
        ].includes(code),
        ...(returnUrl ? { return_url: returnUrl } : {}),
      },
    },
    code === "FORBIDDEN" || code === "SESSION_EXPIRED"
      ? 403
      : code === "SERVICE_TEMPORARILY_UNAVAILABLE"
        ? 503
        : 409,
  );
}

async function exchange(req: PayloadRequest): Promise<Response> {
  let failureReturn: string | undefined;
  try {
    const body = await objectBody(req);
    const code = String(body.code || "");
    if (body.destination !== "studio") throw new Error("SESSION_EXPIRED");
    if (body.return_surface !== "web" && body.return_surface !== "native") {
      throw new Error("SESSION_EXPIRED");
    }
    const destination = "studio" as const;
    const siteIdHint = String(body.site_id || "");
    const brandIdHint = String(body.brand_id || "");
    if (
      !/^[0-9a-f-]{36}$/i.test(siteIdHint) ||
      !/^[0-9a-f-]{36}$/i.test(brandIdHint)
    ) {
      throw new Error("SESSION_EXPIRED");
    }
    failureReturn = studioReturnLocationFromContext(
      {
        site_id: siteIdHint,
        brand_id: brandIdHint,
        return_surface: body.return_surface,
      },
      "exchange_expired",
    );
    const result = await callCore(
      "/internal/v1/editor-exchanges/consume",
      siteIdHint,
      crypto.randomUUID(),
      { code, destination },
    );
    const now = Math.floor(Date.now() / 1000);
    const tenantResult = await req.payload.find({
      collection: "tenants",
      overrideAccess: true,
      where: { core_site_id: { equals: result.site_id } },
      limit: 1,
      depth: 0,
    });
    const tenant = tenantResult.docs[0];
    if (
      !tenant ||
      String(result.site_id) !== siteIdHint ||
      String(result.brand_id) !== brandIdHint
    ) throw new Error("SESSION_EXPIRED");
    await ensureStudioUserShadow(req, String(result.user_id));
    const session = await encodeSession({
      version: 1,
      site_id: String(result.site_id),
      brand_id: String(result.brand_id),
      user_id: String(result.user_id),
      rank: Number(result.rank),
      tenant_id: String(tenant.id),
      issued_at: now,
      absolute_expires_at: Math.floor(
        Date.parse(String(result.absolute_expires_at)) / 1000,
      ),
      idle_expires_at: Math.floor(
        Date.parse(String(result.idle_expires_at)) / 1000,
      ),
      nonce: crypto.randomUUID(),
      return_surface: body.return_surface,
      primary_hostname: typeof result.primary_hostname === "string"
        ? result.primary_hostname
        : null,
    });
    const csrf = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const headers = new Headers();
    headers.append(
      "set-cookie",
      `${STUDIO_COOKIE}=${encodeURIComponent(session)}; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=Lax`,
    );
    headers.append(
      "set-cookie",
      `${STUDIO_CSRF_COOKIE}=${csrf}; Path=/; Max-Age=1800; Secure; SameSite=Lax`,
    );
    return json(
      {
        ok: true,
        data: {
          destination,
          redirect: "/admin",
        },
      },
      200,
      headers,
    );
  } catch (error) {
    return safeFailure(error, failureReturn);
  }
}

async function returnToMingla(req: PayloadRequest): Promise<Response> {
  try {
    const session = await sessionFromHeaders(req.headers);
    if (!session) throw new Error("SESSION_EXPIRED");
    const headers = new Headers({
      location: studioReturnLocation(session),
      "cache-control": "no-store, private",
    });
    headers.append(
      "set-cookie",
      `${STUDIO_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`,
    );
    headers.append(
      "set-cookie",
      `${STUDIO_CSRF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`,
    );
    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (error) {
    return safeFailure(error);
  }
}

async function provisionOrReconcile(req: PayloadRequest): Promise<Response> {
  let bodyText = "";
  try {
    bodyText = (await req.text?.()) || "";
    const path = reconcileVerificationPath(req.url || "http://local");
    const envelope = await verifyCoreRequest(req, bodyText, path);
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    const brandId = String(body.brand_id || "");
    if (
      body.kind !== "provision" ||
      body.site_id !== envelope.site_id ||
      !/^[0-9a-f-]{36}$/i.test(brandId) ||
      !isSitesRendererKey(body.renderer_key) ||
      body.renderer_version !== 1 ||
      // #2829 — Core names the brand and the site's address; nothing about a
      // particular brand is assumed here.
      typeof body.display_name !== "string" ||
      body.display_name.trim().length < 1 ||
      body.display_name.length > 120 ||
      typeof body.primary_hostname !== "string" ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
        .test(body.primary_hostname)
    )
      throw new Error("VALIDATION_FAILED");
    const displayName = body.display_name.trim();
    const primaryHostname = body.primary_hostname;
    const rendererKey = body.renderer_key;
    const designKey: DesignKey = typeof body.design_key === "string" &&
        (DESIGN_KEYS as readonly string[]).includes(body.design_key)
      ? body.design_key as DesignKey
      : "atelier";
    let tenant = (
      await req.payload.find({
        collection: "tenants",
        overrideAccess: true,
        where: { core_site_id: { equals: envelope.site_id } },
        limit: 1,
        depth: 0,
      })
    ).docs[0];
    if (tenant && tenant.core_brand_id !== brandId)
      throw new Error("TENANT_MISMATCH");
    if (tenant && !tenant.primary_hostname) {
      tenant = await req.payload.update({
        collection: "tenants",
        id: tenant.id,
        overrideAccess: true,
        data: { primary_hostname: primaryHostname },
      });
    }
    if (!tenant) {
      tenant = await req.payload.create({
        collection: "tenants",
        overrideAccess: true,
        data: {
          name: displayName,
          core_site_id: envelope.site_id,
          core_brand_id: brandId,
          status: "active",
          primary_hostname: primaryHostname,
          renderer_key: rendererKey,
          renderer_version: 1,
        },
      });
    }
    // #2829 — a tenant whose first documents were never written (a provision
    // that failed half way) gets them on the next provision call, instead of
    // being stuck with an empty Studio that can never publish.
    const existingHome = (await findAllTenantPages(req, tenant.id, {
      overrideAccess: true,
    }))[0];
    if (!existingHome) {
      const tenantId = tenant.id;
      // #2829 — the first documents of a NEW tenant are written by Core's
      // signed provisioning call, which carries no Studio user. Marked as
      // server-side (Local API) work so the multi-tenant plugin's
      // "user may assign this tenant" check — which every userless REST
      // request fails — does not refuse them; the signed envelope and the
      // tenant lookup above are the authority here.
      const provisioningRequest = {
        ...req,
        payloadAPI: "local",
        context: {
          ...req.context,
          minglaSignedCore: true,
          minglaInternalTenantId: String(tenantId),
        },
      } as PayloadRequest;
      // #2829 W2 — the home page is the page with no slug and no parent.
      const homePage = await req.payload.create({
        collection: "pages",
        overrideAccess: true,
        req: provisioningRequest,
        data: {
          tenant: tenantId,
          slug: "",
          title: "Home",
          kind: "standard",
          enabled: true,
          revision: 1,
          blocks: [],
        },
        draft: true,
      });
      await req.payload.create({
        collection: "navigation",
        overrideAccess: true,
        req: provisioningRequest,
        data: {
          tenant: tenantId,
          label: "Main navigation",
          items: [{ label: "Home", target_type: "page", page: homePage.id }],
        },
        draft: true,
      });
      await req.payload.create({
        collection: "footer",
        overrideAccess: true,
        req: provisioningRequest,
        data: { tenant: tenantId, label: "Website footer" },
        draft: true,
      });
      await req.payload.create({
        collection: "site-settings",
        overrideAccess: true,
        req: provisioningRequest,
        data: {
          tenant: tenantId,
          display_name: displayName,
          analytics_consent_mode: "optional",
          renderer_key: rendererKey,
          design: designKey,
        },
        draft: true,
      });
    }
    await callCore(
      `/internal/v1/sites/${envelope.site_id}/provision-results`,
      envelope.site_id,
      envelope.operation_id,
      { tenant_id: String(tenant.id), status: "draft" },
    );
    return json({ ok: true, site_id: envelope.site_id, status: "draft" }, 202);
  } catch (error) {
    return safeFailure(error);
  }
}

/** #2829 W8 — a hostname Core signed into a publish, or null. */
export function primaryHostnameFromCore(value: unknown): string | null {
  return typeof value === "string" && value.length >= 4 && value.length <= 253 &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value)
    ? value
    : null;
}

async function publish(req: PayloadRequest): Promise<Response> {
  let bodyText = "";
  let jobId: number | string | null = null;
  let callbackContext: {
    siteId: string;
    operationId: string;
    publicationId: string;
  } | null = null;
  try {
    bodyText = (await req.text?.()) || "";
    const path = "/api/internal/publications";
    const envelope = await verifyCoreRequest(req, bodyText, path);
    const body = JSON.parse(bodyText) as Record<string, unknown> & {
      authorization?: {
        site_id?: unknown;
        status?: unknown;
        publication_id?: unknown;
        revision_id?: unknown;
        generated_at?: unknown;
        rollback_source_publication_id?: unknown;
      };
    };
    if (
      body.authorization?.site_id !== envelope.site_id ||
      body.authorization?.status !== "authorized"
    )
      throw new Error("FORBIDDEN");
    let tenant = (
      await req.payload.find({
        collection: "tenants",
        overrideAccess: true,
        where: { core_site_id: { equals: envelope.site_id } },
        limit: 1,
        depth: 0,
      })
    ).docs[0];
    if (!tenant) throw new Error("NOT_FOUND");
    // #2829 W8 — Core signs the site's CURRENT main address into every
    // publish (a brand's own domain, or the Mingla subdomain again after a
    // disconnect). The tenant's copy follows it before the artifact is built,
    // so the canonical is the address the runtime serves as primary.
    const corePrimary = primaryHostnameFromCore(body.primary_hostname);
    if (corePrimary && corePrimary !== tenant.primary_hostname) {
      tenant = await req.payload.update({
        collection: "tenants",
        id: tenant.id,
        overrideAccess: true,
        data: { primary_hostname: corePrimary },
      });
    }
    const publicationId = String(body.authorization.publication_id || "");
    const revisionId = String(
      body.authorization.revision_id || body.expected_revision || "",
    );
    const sourceDigest = String(body.source_digest || "");
    const generatedAt = String(body.authorization.generated_at || "");
    const rollbackSourcePublicationId = String(
      body.authorization.rollback_source_publication_id || "",
    );
    if (
      !/^[0-9a-f-]{36}$/i.test(publicationId) ||
      !/^[0-9a-f]{64}$/.test(sourceDigest) ||
      (rollbackSourcePublicationId !== "" &&
        !/^[0-9a-f-]{36}$/i.test(rollbackSourcePublicationId)) ||
      !Number.isFinite(Date.parse(generatedAt))
    )
      throw new Error("VALIDATION_FAILED");
    callbackContext = {
      siteId: envelope.site_id,
      operationId: envelope.operation_id,
      publicationId,
    };
    const existing = (
      await req.payload.find({
        collection: "publication-jobs",
        overrideAccess: true,
        depth: 0,
        limit: 1,
        where: { operation_id: { equals: envelope.operation_id } },
      })
    ).docs[0];
    if (
      existing &&
      (String(existing.tenant) !== String(tenant.id) ||
        existing.source_revision_id !== revisionId ||
        existing.source_digest !== sourceDigest)
    )
      throw new Error("IDEMPOTENCY_CONFLICT");
    const job =
      existing ??
      (await req.payload.create({
        collection: "publication-jobs",
        overrideAccess: true,
        data: {
          tenant: tenant.id,
          operation_id: envelope.operation_id,
          source_revision_id: revisionId,
          source_digest: sourceDigest,
          status: "validating",
          retry_count: 0,
        },
      }));
    jobId = job.id;
    /*
     * #2829 W9b (L4) — a site's FIRST publish needs the six design checks run
     * on exactly this draft (their results are warnings; running them is the
     * requirement). Nothing goes live and the owner is told to run them.
     * Later publishes and restores never wait on them.
     */
    if (!rollbackSourcePublicationId) await assertFirstPublishChecked(req, String(tenant.id), sourceDigest);
    const canReuse =
      typeof job.artifact_key === "string" &&
      typeof job.artifact_digest === "string" &&
      /^[0-9a-f]{64}$/.test(job.artifact_digest);
    // #2829 W3 — the generation and font warnings travel with the job, so a
    // retried publish reports exactly what the first attempt wrote.
    const recorded = (job.validation_result ?? {}) as Record<string, unknown>;
    const built = canReuse
      ? {
          artifactKey: job.artifact_key!,
          artifactDigest: job.artifact_digest!,
          generation: (recorded.generation ?? {
            artifact_schema_version: 1,
            renderer_key: "restaurant-website-v1",
            design_key: null,
            design_version: null,
          }) as { artifact_schema_version: 1 | 2; renderer_key: "restaurant-website-v1" | "sites-v2"; design_key: string | null; design_version: number | null },
          fontWarnings: (Array.isArray(recorded.font_warnings) ? recorded.font_warnings : []) as unknown[],
        }
      : await (async () => {
          await req.payload.update({
            collection: "publication-jobs",
            id: job.id,
            overrideAccess: true,
            data: {
              status: "materializing",
              retry_count: Number(job.retry_count || 0) + (existing ? 1 : 0),
            },
          });
          const materialized = rollbackSourcePublicationId
            ? await buildRollbackPublicationArtifact({
                siteId: envelope.site_id,
                brandId: String(tenant.core_brand_id),
                publicationId,
                sourceRevisionId: revisionId,
                sourceDigest,
                generatedAt,
                rollbackSourcePublicationId,
                rollbackSource: await readCorePublicationSource(
                  envelope.site_id,
                  rollbackSourcePublicationId,
                  envelope.operation_id,
                ),
              })
            : await buildPublicationArtifact(req, {
                tenant,
                operationId: envelope.operation_id,
                publicationId,
                sourceRevisionId: revisionId,
                sourceDigest,
                generatedAt,
              });
          await req.payload.update({
            collection: "publication-jobs",
            id: job.id,
            overrideAccess: true,
            data: {
              status: "probing",
              artifact_key: materialized.artifactKey,
              artifact_digest: materialized.artifactDigest,
              validation_result: {
                schema_version: materialized.generation.artifact_schema_version,
                renderer_version: 1,
                exact_revision: true,
                generation: materialized.generation,
                font_warnings: materialized.fontWarnings,
              },
            },
          });
          return materialized;
        })();
    const probe = await probePublicationCandidate({
      siteId: envelope.site_id,
      brandId: String(tenant.core_brand_id),
      publicationId,
      artifactKey: built.artifactKey,
      artifactDigest: built.artifactDigest,
      rendererVersion: 1,
      artifactSchemaVersion: built.generation.artifact_schema_version,
      rendererKey: built.generation.renderer_key,
      primaryHostname: String(tenant.primary_hostname ?? ""),
    });
    const result = await callCore(
      `/internal/v1/sites/${envelope.site_id}/publication-results`,
      envelope.site_id,
      envelope.operation_id,
      {
        publication_id: publicationId,
        source_revision_id: revisionId,
        source_digest: sourceDigest,
        artifact_key: built.artifactKey,
        artifact_digest: built.artifactDigest,
        probe_summary: probe,
        // #2829 W3 — what was written, for Core to record (and the owner to see).
        artifact_schema_version: built.generation.artifact_schema_version,
        renderer_key: built.generation.renderer_key,
        design_key: built.generation.design_key,
        design_version: built.generation.design_version,
        font_warnings: built.fontWarnings.length ? built.fontWarnings : null,
      },
    );
    await req.payload.update({
      collection: "publication-jobs",
      id: job.id,
      overrideAccess: true,
      data: { status: "published", failure_code: null },
    });
    return json({ ok: true, data: result }, 202);
  } catch (error) {
    const definitiveFailure =
      error instanceof Error &&
      [
        "REVISION_CONFLICT",
        "MEDIA_REJECTED",
        "MEDIA_PROCESSING",
        "VALIDATION_FAILED",
        "PROBE_FAILED",
        "ARTIFACT_DIGEST_MISMATCH",
        "PAGE_LIMIT_EXCEEDED",
        "PATH_COLLISION",
        "DESIGN_CHECKS_REQUIRED",
      ].includes(error.message);
    let failureRecorded = false;
    if (definitiveFailure && callbackContext) {
      try {
        await callCore(
          `/internal/v1/sites/${callbackContext.siteId}/publication-failures`,
          callbackContext.siteId,
          callbackContext.operationId,
          {
            publication_id: callbackContext.publicationId,
            // #2829 W2 — a refusal the owner can fix names itself, so the
            // Business app can say what to change instead of "try again".
            ...(error instanceof Error &&
              ["PATH_COLLISION", "PAGE_LIMIT_EXCEEDED", "DESIGN_CHECKS_REQUIRED"].includes(error.message)
              ? { failure_code: error.message }
              : {}),
          },
        );
        failureRecorded = true;
      } catch {
        emitCmsObservation({
          event: "mingla_sites_state",
          metric: "publish.failure_callback.ambiguous",
          request_id: crypto.randomUUID(),
          operation_id: callbackContext.operationId,
          site_id: callbackContext.siteId,
          publication_id: callbackContext.publicationId,
          direction: "core_to_cms",
          route: "/internal/publications",
          state_transition: "publish_failed->callback_ambiguous",
          latency_ms: 0,
          retry_count: 0,
          safe_error_code: "CORE_UNAVAILABLE",
          status_code: null,
          version: "sites-v1",
        });
      }
    }
    if (jobId !== null) {
      try {
        await req.payload.update({
          collection: "publication-jobs",
          id: jobId,
          overrideAccess: true,
          data: {
            status:
              error instanceof Error &&
              ["CORE_UNAVAILABLE", "SERVICE_TEMPORARILY_UNAVAILABLE"].includes(
                error.message,
              )
                ? "ambiguous"
                : "failed",
            failure_code:
              error instanceof Error &&
              [
                "REVISION_CONFLICT",
                "MEDIA_PROCESSING",
                "VALIDATION_FAILED",
                "PROBE_FAILED",
                "ARTIFACT_DIGEST_MISMATCH",
                "PAGE_LIMIT_EXCEEDED",
                "PATH_COLLISION",
                "DESIGN_CHECKS_REQUIRED",
              ].includes(error.message)
                ? error.message
                : "SERVICE_TEMPORARILY_UNAVAILABLE",
          },
        });
      } catch {
        emitCmsObservation({
          event: "mingla_sites_state",
          metric: "publish.job_state_persist.failure",
          request_id: crypto.randomUUID(),
          operation_id: callbackContext?.operationId ?? null,
          site_id: callbackContext?.siteId ?? null,
          publication_id: callbackContext?.publicationId ?? null,
          direction: "core_to_cms",
          route: "/internal/publications",
          state_transition: "publish_failed->job_state_persist_failed",
          latency_ms: 0,
          retry_count: 0,
          safe_error_code: "SERVICE_TEMPORARILY_UNAVAILABLE",
          status_code: null,
          version: "sites-v1",
        });
      }
    }
    return safeFailure(
      failureRecorded
        ? new Error("PUBLISH_FAILED_LAST_GOOD_PRESERVED")
        : error,
    );
  }
}

async function uploadGrant(req: PayloadRequest): Promise<Response> {
  try {
    assertMutationRequest(req.headers);
    const { request } = await requireAuthenticatedStudioRequest(req);
    const body = await objectBody(req);
    return json({
      ok: true,
      data: await createUploadGrant(request, {
        filename: String(body.filename || "image"),
        content_type: String(body.content_type || ""),
        bytes: Number(body.bytes),
      }),
    });
  } catch (error) {
    return safeFailure(error);
  }
}
/*
 * #2829 W6 (AD-9) — stream video (Bunny through Core). Off unless Core has
 * Bunny configured; Studio then uses the standard file upload above.
 */
async function streamCapability(req: PayloadRequest): Promise<Response> {
  try {
    const { request } = await requireAuthenticatedStudioRequest(req);
    return json({ ok: true, data: await streamVideoCapability(request) });
  } catch (error) {
    return safeFailure(error);
  }
}
async function streamIntent(req: PayloadRequest): Promise<Response> {
  try {
    assertMutationRequest(req.headers);
    const { request } = await requireAuthenticatedStudioRequest(req);
    const body = await objectBody(req);
    return json({
      ok: true,
      data: await createStreamUploadIntent(request, {
        filename: String(body.filename || "video"),
        content_type: String(body.content_type || ""),
        bytes: Number(body.bytes),
      }),
    });
  } catch (error) {
    return safeFailure(error);
  }
}
async function streamStatus(req: PayloadRequest): Promise<Response> {
  try {
    const { request } = await requireAuthenticatedStudioRequest(req);
    const id = new URL(req.url || "http://local").pathname.split("/").at(-2)!;
    return json({ ok: true, data: await refreshStreamVideo(request, id) });
  } catch (error) {
    return safeFailure(error);
  }
}
async function uploadComplete(req: PayloadRequest): Promise<Response> {
  try {
    assertMutationRequest(req.headers);
    const { request } = await requireAuthenticatedStudioRequest(req);
    const body = await objectBody(req);
    const id = new URL(req.url || "http://local").pathname.split("/").at(-2)!;
    const media = await completeUpload(
      request,
      id,
      String(body.checksum || ""),
      Number(body.bytes),
    );
    if (!media) throw new Error("MEDIA_REJECTED");
    return json({
      ok: true,
      data: {
        media_id: String(media.id),
        state: media.state,
        rejection_code: media.rejection_code ?? null,
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

async function mediaStatus(req: PayloadRequest): Promise<Response> {
  try {
    const { request } = await requireAuthenticatedStudioRequest(req);
    const id = new URL(req.url || "http://local").pathname.split("/").at(-1)!;
    const media = await req.payload.findByID({
      collection: "media",
      id,
      overrideAccess: false,
      req: studioMediaGrantRequest(request),
      depth: 0,
    });
    return json({
      ok: true,
      data: {
        media_id: String(media.id),
        state: media.state,
        rejection_code: media.rejection_code ?? null,
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

async function studioMediaLibrary(req: PayloadRequest): Promise<Response> {
  try {
    const { session, request } = await requireAuthenticatedStudioRequest(req);
    const tenant = await req.payload.findByID({
      collection: "tenants",
      id: session.tenant_id,
      overrideAccess: true,
      depth: 0,
    });
    if (
      String(tenant.core_site_id) !== session.site_id ||
      String(tenant.core_brand_id) !== session.brand_id
    ) {
      throw new Error("FORBIDDEN");
    }
    const mediaScoped = studioMediaGrantRequest(request);
    const tenantWhere = { tenant: { equals: session.tenant_id } };
    const [pages, media] = await Promise.all([
      findAllTenantPages(request, session.tenant_id)
        .then((docs) => ({ docs })),
      req.payload.find({
        collection: "media",
        overrideAccess: false,
        req: mediaScoped,
        depth: 0,
        limit: 100,
        showHiddenFields: true,
        sort: "-updatedAt",
        where: tenantWhere,
      }),
    ]);
    // #2829 W11 (A11) — "in use" is the same full scan removal checks
    // (every page, content entry, setting, navigation and footer field), so
    // the library never offers to remove something the server refuses.
    const referenced = await tenantMediaInUse(request, session.tenant_id);
    return json({
      ok: true,
      data: {
        media: media.docs.map((item) => ({
          id: String(item.id),
          filename: String(item.original_filename_safe || "Website image"),
          state: item.state,
          width: typeof item.width === "number" ? item.width : null,
          height: typeof item.height === "number" ? item.height : null,
          rejection_code: item.rejection_code ?? null,
          thumbnail_url:
            item.state === "READY"
              ? `/api/mingla/media/${encodeURIComponent(String(item.id))}/thumbnail`
              : null,
          in_use: referenced.has(String(item.id)),
          recoverable_until:
            item.state === "TOMBSTONED" &&
              typeof item.recovery_until === "string"
              ? item.recovery_until
              : null,
        })),
        targets: studioMediaTargets(pages.docs),
        close_url: "/admin/collections/pages",
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

async function studioMediaThumbnail(req: PayloadRequest): Promise<Response> {
  try {
    const { request } = await requireAuthenticatedStudioRequest(req);
    const id = new URL(req.url || "http://local").pathname.split("/").at(-2)!;
    const media = await req.payload.findByID({
      collection: "media",
      id,
      overrideAccess: false,
      req: studioMediaGrantRequest(request),
      depth: 0,
    });
    const manifest = media.rendition_manifest as {
      renditions?: Array<{ key?: string; width?: number }>;
    } | null;
    const rendition = manifest?.renditions?.find((item) => item.width === 640) ??
      manifest?.renditions?.find((item) => typeof item.key === "string");
    if (media.state !== "READY" || typeof rendition?.key !== "string") {
      throw new Error("MEDIA_PROCESSING");
    }
    return new Response(
      Buffer.from(await readObject(cmsConfig().approvedBucket, rendition.key)),
      {
        status: 200,
        headers: {
          "cache-control": "no-store, private",
          "content-type": "image/webp",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    return safeFailure(error);
  }
}

async function studioMediaAttach(req: PayloadRequest): Promise<Response> {
  try {
    assertMutationRequest(req.headers);
    const { request } = await requireAuthenticatedStudioRequest(req);
    const body = await objectBody(req);
    const mediaId = new URL(req.url || "http://local").pathname.split("/").at(-2)!;
    const { page, media } = await loadStudioMediaAttachRecords(
      request,
      String(body.page_id || ""),
      mediaId,
    );
    if (media.state !== "READY") throw new Error("MEDIA_PROCESSING");
    if (body.field !== "media" && body.field !== "images") {
      throw new Error("VALIDATION_FAILED");
    }
    const blocks = applyStudioMediaSelection(page, String(media.id), {
      expectedRevision: String(body.expected_revision || ""),
      blockIndex: Number(body.block_index),
      field: body.field,
      imageIndex:
        body.image_index === null
          ? null
          : Number(body.image_index),
      alt: String(body.alt || ""),
      decorative: body.decorative === true,
    });
    const updated = await req.payload.update({
      collection: "pages",
      id: page.id,
      overrideAccess: false,
      req: request,
      draft: true,
      depth: 0,
      data: { blocks: blocks as never, revision: page.revision },
    });
    return json({
      ok: true,
      data: {
        page_id: String(updated.id),
        media_id: String(media.id),
        draft_revision: String(updated.revision),
        state: 8,
        return_url: `/admin/collections/pages/${encodeURIComponent(String(updated.id))}`,
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

async function mediaTombstone(req: PayloadRequest): Promise<Response> {
  try {
    assertMutationRequest(req.headers);
    const { request } = await requireAuthenticatedStudioRequest(req);
    const id = new URL(req.url || "http://local").pathname.split("/").at(-2)!;
    const result = await tombstoneMedia(request, id);
    return json({
      ok: true,
      data: {
        media_id: result.id,
        state: result.state,
        recovery_until: result.recovery_until,
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

async function mediaRestore(req: PayloadRequest): Promise<Response> {
  try {
    assertMutationRequest(req.headers);
    const { request } = await requireAuthenticatedStudioRequest(req);
    const id = new URL(req.url || "http://local").pathname.split("/").at(-2)!;
    const result = await restoreTombstonedMedia(request, id);
    return json({
      ok: true,
      data: {
        media_id: result.id,
        state: result.state,
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

async function retentionSweep(req: PayloadRequest): Promise<Response> {
  let raw = "";
  try {
    raw = (await req.text?.()) || "";
    const envelope = await verifyCoreRequest(
      req,
      raw,
      "/api/internal/retention-sweep",
    );
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (Object.keys(body).length !== 0) throw new Error("VALIDATION_FAILED");
    const tenant = (
      await req.payload.find({
        collection: "tenants",
        overrideAccess: true,
        depth: 0,
        limit: 1,
        where: { core_site_id: { equals: envelope.site_id } },
      })
    ).docs[0];
    if (!tenant) throw new Error("FORBIDDEN");
    const protection = await readCoreRetentionProjection(
      envelope.site_id,
      envelope.operation_id,
    );
    return json({
      ok: true,
      data: await runRetentionSweep(
        req,
        envelope.site_id,
        String(tenant.id),
        protection.protected_artifact_keys,
      ),
    });
  } catch (error) {
    return safeFailure(error);
  }
}

type InternalActor = {
  siteId: string;
  brandId: string;
  tenantId: string;
  userId: string;
  rank: number;
};

function signedCoreRequest(
  req: PayloadRequest,
  actor: InternalActor,
): PayloadRequest {
  return {
    ...req,
    context: { ...req.context, minglaSignedCore: true },
    user: {
      id: actor.userId,
      collection: "studio-users",
      siteId: actor.siteId,
      brandId: actor.brandId,
      tenantId: actor.tenantId,
      rank: actor.rank,
      tenants: [{ tenant: actor.tenantId }],
    } as never,
  };
}

function previewGrantRequest(
  req: PayloadRequest,
  actor: InternalActor,
): PayloadRequest {
  const context = { ...req.context };
  delete context.minglaSignedCore;
  return {
    ...req,
    context,
    user: {
      id: actor.userId,
      collection: "studio-users",
      siteId: actor.siteId,
      brandId: actor.brandId,
      tenantId: actor.tenantId,
      rank: actor.rank,
      tenants: [{ tenant: actor.tenantId }],
    } as never,
  };
}

async function tenantForSignedRequest(
  req: PayloadRequest,
  siteId: string,
  brandId: string,
) {
  const tenant = (
    await req.payload.find({
      collection: "tenants",
      overrideAccess: true,
      depth: 0,
      limit: 1,
      where: { core_site_id: { equals: siteId } },
    })
  ).docs[0];
  if (!tenant || tenant.core_brand_id !== brandId) {
    throw new Error("FORBIDDEN");
  }
  return tenant;
}

async function mintPreview(req: PayloadRequest): Promise<Response> {
  let raw = "";
  try {
    raw = (await req.text?.()) || "";
    const envelope = await verifyCoreRequest(req, raw, "/api/mingla/previews");
    const body = JSON.parse(raw) as Record<string, unknown> & {
      authorization?: Record<string, unknown>;
    };
    if (
      body.authorization?.status !== "authorized" ||
      body.authorization?.site_id !== envelope.site_id ||
      body.user_id === undefined
    )
      throw new Error("FORBIDDEN");
    const brandId = String(body.brand_id || "");
    const userId = String(body.user_id || "");
    const tenant = await tenantForSignedRequest(req, envelope.site_id, brandId);
    const issuedAt = Math.floor(Date.now() / 1000);
    const sourceRevision = String(
      body.expected_revision || body.authorization.revision_id || "",
    );
    const sourceDigest = String(body.source_digest || "");
    if (
      !/^[0-9a-f]{64}$/.test(sourceDigest) ||
      (body.return_surface !== "web" && body.return_surface !== "native")
    ) {
      throw new Error("VALIDATION_FAILED");
    }
    const previewToken = await encodePreviewGrant({
      version: 1,
      issuer: "mingla-site-cms",
      audience: "mingla-studio-preview",
      site_id: envelope.site_id,
      brand_id: brandId,
      user_id: userId,
      tenant_id: String(tenant.id),
      source_revision: sourceRevision,
      source_digest: sourceDigest,
      // #2829 — the builder produces v1 artifacts until the W3 renderer.
      renderer_key: V1_RENDERER_KEY,
      renderer_version: 1,
      issued_at: issuedAt,
      expires_at: issuedAt + 1800,
      nonce: crypto.randomUUID(),
      return_surface: body.return_surface,
    });
    const expiresAt = new Date((issuedAt + 1800) * 1000).toISOString();
    // #2829 W2 — every page can be previewed: the owner picks one from this
    // list and the preview opens at that page's address (`&path=`).
    const previewPages = await (async () => {
      const scopedPreview = signedCoreRequest(req, {
        siteId: envelope.site_id,
        brandId,
        tenantId: String(tenant.id),
        userId,
        rank: 20,
      });
      const docs = await findAllTenantPages(scopedPreview, tenant.id);
      const paths = tenantPagePaths(docs);
      return docs
        .filter((page) => page.enabled === true || isHomePage(page))
        .map((page) => ({ path: paths.get(String(page.id)) ?? "", title: String(page.title ?? "") }))
        .sort((left, right) => left.path.localeCompare(right.path));
    })();
    await callCore(
      `/internal/v1/sites/${envelope.site_id}/preview-results`,
      envelope.site_id,
      envelope.operation_id,
      { revision_id: sourceRevision, expires_at: expiresAt },
    );
    return json({
      ok: true,
      data: {
        site_id: envelope.site_id,
        source_revision: sourceRevision,
        expires_at: expiresAt,
        preview_url: `${cmsConfig().cmsOrigin}/preview?token=${encodeURIComponent(previewToken)}`,
        pages: previewPages,
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

async function studioPreview(req: PayloadRequest): Promise<Response> {
  try {
    const { session, request } = await requireAuthenticatedStudioRequest(req);
    const tenant = await req.payload.findByID({
      collection: "tenants",
      id: session.tenant_id,
      overrideAccess: true,
      depth: 0,
    });
    if (
      String(tenant.core_site_id) !== session.site_id ||
      String(tenant.core_brand_id) !== session.brand_id
    ) {
      throw new Error("FORBIDDEN");
    }
    const tenantWhere = { tenant: { equals: session.tenant_id } };
    const [pages, settings, navigation, footer, media, content] = await Promise.all([
      findAllTenantPages(request, session.tenant_id)
        .then((docs) => ({ docs })),
      req.payload.find({
        collection: "site-settings", overrideAccess: false, req: request,
        draft: true, depth: 0, limit: 1, where: tenantWhere,
      }),
      req.payload.find({
        collection: "navigation", overrideAccess: false, req: request,
        draft: true, depth: 0, limit: 1, where: tenantWhere,
      }),
      req.payload.find({
        collection: "footer", overrideAccess: false, req: request, draft: true,
        depth: 0, limit: 1, where: tenantWhere,
      }),
      req.payload.find({
        collection: "media", overrideAccess: false,
        req: studioMediaGrantRequest(request), depth: 0,
        limit: 500, sort: "id",
        where: { and: [tenantWhere, { state: { equals: "READY" } }] },
      }),
      // #2829 W5 — the content collections the publish will freeze.
      findTenantContent(request, session.tenant_id),
    ]);
    const home = pages.docs.find(
      (page) => isHomePage(page) && page.enabled === true,
    );
    if (!home || !settings.docs[0]) throw new Error("VALIDATION_FAILED");
    const digest = await publicationDraftDigest({
      pages: pages.docs,
      settings: settings.docs[0],
      navigation: navigation.docs[0] ?? null,
      footer: footer.docs[0] ?? null,
      media: media.docs,
      content,
    });
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await encodePreviewGrant({
      version: 1,
      issuer: "mingla-site-cms",
      audience: "mingla-studio-preview",
      site_id: session.site_id,
      brand_id: session.brand_id,
      user_id: session.user_id,
      tenant_id: session.tenant_id,
      source_revision: String(home.revision),
      source_digest: digest,
      // #2829 — the builder produces v1 artifacts until the W3 renderer.
      renderer_key: V1_RENDERER_KEY,
      renderer_version: 1,
      issued_at: issuedAt,
      expires_at: issuedAt + 1800,
      nonce: crypto.randomUUID(),
      return_surface: session.return_surface,
    });
    return new Response(null, {
      status: 302,
      headers: {
        location: `/preview?token=${encodeURIComponent(token)}&site_id=${encodeURIComponent(session.site_id)}`,
        "cache-control": "no-store, private",
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

const ARI_ACTIONS = new Set([
  "get_brand_site",
  "list_site_pages",
  "get_site_page",
  // #2829 W3 — the Business "Website design" screen saves the look here
  // (owner token values and fonts; Ari proposes through propose_site_tokens).
  "propose_site_settings_update",
  "validate_site_draft",
  // #2829 W3 — the Business "Your look" screen and Ari search the Google
  // Fonts catalogue here, so neither bundles the ~160 KB catalogue.
  "search_fonts",
  // #2829 W9b — Ari as the website designer (lib/ariSiteActions.ts).
  ...ARI_DESIGNER_ACTIONS,
]);

async function ari(req: PayloadRequest): Promise<Response> {
  let raw = "";
  try {
    raw = (await req.text?.()) || "";
    const envelope = await verifyCoreRequest(req, raw, "/api/internal/ari");
    const body = JSON.parse(raw) as Record<string, unknown>;
    const allowedOuter = new Set([
      "action",
      "site_id",
      "brand_id",
      "user_id",
      "rank",
      "args",
      // #2829 W9b — the Mingla facts Core signed in (offerings, brand words).
      "evidence",
    ]);
    if (Object.keys(body).some((key) => !allowedOuter.has(key))) {
      throw new Error("VALIDATION_FAILED");
    }
    const action = String(body.action || "");
    const brandId = String(body.brand_id || "");
    const userId = String(body.user_id || "");
    const rank = Number(body.rank);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    if (
      !ARI_ACTIONS.has(action) ||
      body.site_id !== envelope.site_id ||
      !/^[0-9a-f-]{36}$/i.test(brandId) ||
      !/^[0-9a-f-]{36}$/i.test(userId) ||
      !Number.isInteger(rank) ||
      rank < 20
    )
      throw new Error("FORBIDDEN");
    const tenant = await tenantForSignedRequest(req, envelope.site_id, brandId);
    const scoped = signedCoreRequest(req, {
      siteId: envelope.site_id,
      brandId,
      tenantId: String(tenant.id),
      userId,
      rank,
    });
    const tenantWhere = { tenant: { equals: tenant.id } };

    if (ARI_DESIGNER_ACTIONS.has(action)) {
      try {
        const data = await runAriDesignerAction(action, args, {
          req,
          scoped,
          tenantId: String(tenant.id),
          siteId: envelope.site_id,
          brandId,
          userId,
          rank,
          evidence: parseAriEvidence(body.evidence, brandId),
        });
        return json({ ok: true, data });
      } catch (error) {
        if (error instanceof AriRefusal && ARI_REFUSAL_CODES.has(error.message)) {
          return json(
            { ok: false, error: { code: error.message, ...error.extra } },
            error.message === "FORBIDDEN" ? 403 : error.message === "NOT_FOUND" || error.message === "PAGE_NOT_FOUND" ? 404 : 409,
          );
        }
        // Content refusals (QUOTE_REQUIRED, …) carry their own codes.
        if (error instanceof Error && ARI_REFUSAL_CODES.has(error.message)) {
          const extra = (error as Error & { extra?: Record<string, unknown> }).extra ?? {};
          return json({ ok: false, error: { code: error.message, ...extra } }, 409);
        }
        throw error;
      }
    }

    if (action === "get_brand_site") {
      const [settings, pages] = await Promise.all([
        req.payload.find({
          collection: "site-settings",
          req: scoped,
          overrideAccess: false,
          draft: true,
          depth: 0,
          limit: 1,
          where: tenantWhere,
        }),
        findAllTenantPages(scoped, tenant.id)
          .then((docs) => ({ docs })),
      ]);
      return json({
        ok: true,
        data: {
          site_id: envelope.site_id,
          renderer: "sites-v2",
          status: tenant.status,
          settings: settings.docs[0] ?? null,
          pages: ariPageSummaries(pages.docs),
        },
      });
    }
    if (action === "search_fonts") {
      const query = typeof args.query === "string" ? args.query.slice(0, 64) : "";
      const category = typeof args.category === "string" &&
          ["sans-serif", "serif", "display", "handwriting", "monospace"].includes(args.category)
        ? (args.category as FontCategory)
        : undefined;
      return json({
        ok: true,
        data: searchCatalogFonts(query, { category, limit: 30 }).map((font) => ({
          family: font.family,
          category: font.category,
          weights: font.weights,
        })),
      });
    }
    if (action === "list_site_pages") {
      const pages = await findAllTenantPages(scoped, tenant.id);
      return json({ ok: true, data: ariPageSummaries(pages) });
    }
    /*
     * #2829 W2 — a page is addressed by its path (`page_path`: "" is home,
     * "resources/faqs"). Ari's current tools still send a fixed `page_role`;
     * that is read as the top-level page of the same name (home → ""), which
     * is exactly where the W2 data migration put every role page.
     */
    const wantedPath = typeof args.page_path === "string"
      ? args.page_path
      : typeof args.page_role === "string" && args.page_role
        ? (args.page_role === "home" ? "" : args.page_role)
        : null;
    const page = wantedPath === null
      ? null
      : await (async () => {
          const all = await findAllTenantPages(scoped, tenant.id);
          const paths = tenantPagePaths(all);
          return all.find((candidate) => paths.get(String(candidate.id)) === wantedPath) ?? null;
        })();
    if (action === "get_site_page") {
      if (!page) throw new Error("NOT_FOUND");
      return json({ ok: true, data: page });
    }
    if (action === "propose_site_settings_update") {
      const settings = (
        await req.payload.find({
          collection: "site-settings",
          req: scoped,
          overrideAccess: false,
          draft: true,
          depth: 0,
          limit: 1,
          where: tenantWhere,
        })
      ).docs[0];
      if (
        !settings ||
        String(args.expected_revision) !== String(settings.updatedAt)
      )
        throw new Error("REVISION_CONFLICT");
      const changes =
        args.changes &&
        typeof args.changes === "object" &&
        !Array.isArray(args.changes)
          ? (args.changes as Record<string, unknown>)
          : {};
      // #2829 W3 — the look is design + token values + fonts (validated by
      // site-contracts on save); colours are stored exactly as sent.
      const allowed = new Set([
        "display_name",
        "short_description",
        "logo",
        "design",
        "tokens",
        "fonts",
        "radius",
        "button_shape",
        "motion",
        "seo_title",
        "seo_description",
        "social_image",
      ]);
      if (
        !Object.keys(changes).length ||
        Object.keys(changes).some((key) => !allowed.has(key))
      )
        throw new Error("VALIDATION_FAILED");
      const updated = await req.payload.update({
        collection: "site-settings",
        id: settings.id,
        req: scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        data: changes,
      });
      return json({
        ok: true,
        data: {
          site_id: envelope.site_id,
          previous_revision: settings.updatedAt,
          revision: updated.updatedAt,
          draft_only: true,
        },
      });
    }
    // #2829 W9b — the draft is read ONE way (lib/ariSiteActions.ts
    // loadDraftState), so the digest validate reports, the one design checks
    // store and the one Publish checks are the same number.
    const draft = await loadDraftState(req, scoped, String(tenant.id));
    const home = draft.pages.find(
      (candidate) => isHomePage(candidate) && candidate.enabled === true,
    );
    if (!draft.settings || !home) throw new Error("VALIDATION_FAILED");
    // #2829 W2 — refuse a draft two things would answer the same address in,
    // before anyone presses Publish (the builder refuses it again).
    assertNoPathCollision(draft.pages as never, draft.settings);
    const draftDigest = draft.digest;
    const pages = { totalDocs: draft.pages.length };
    return json({
      ok: true,
      data: {
        site_id: envelope.site_id,
        valid: true,
        renderer: "Restaurant Website v1",
        home_revision: String(home.revision),
        draft_digest: draftDigest,
        checked_pages: pages.totalDocs,
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

function escapeHtml(value: unknown): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => entities[character],
  );
}

/**
 * #2830 — marks a stored artifact as a PREVIEW rather than a publication.
 *
 * Preview artifacts are written by the same builder, to the same bucket, under
 * the same `publications/<site>/<publicationId>/<digest>.json` shape — that
 * sameness is the point, because it is what makes preview and published
 * identical by construction. This prefix is what still tells them apart, so a
 * reaper can find and expire preview objects, and so the public runtime can
 * refuse to serve a real publication through the preview route.
 */
export const PREVIEW_PUBLICATION_PREFIX = "preview-";

async function previewDraft(req: PayloadRequest): Promise<Response> {
  try {
    const url = new URL(req.url || "http://local");
    const grant = await decodePreviewGrant(url.searchParams.get("token"));
    const requestedSite = url.searchParams.get("site_id");
    if (!grant || requestedSite !== grant.site_id) throw new Error("FORBIDDEN");
    const scoped = previewGrantRequest(req, {
      siteId: grant.site_id,
      brandId: grant.brand_id,
      tenantId: grant.tenant_id,
      userId: grant.user_id,
      rank: 20,
    });
    const tenantWhere = { tenant: { equals: grant.tenant_id } };
    const [pages, settings, navigation, footer, media, content] = await Promise.all([
      findAllTenantPages(scoped, grant.tenant_id)
        .then((docs) => ({ docs })),
      req.payload.find({
        collection: "site-settings",
        overrideAccess: false,
        req: scoped,
        draft: true,
        depth: 0,
        limit: 1,
        where: tenantWhere,
      }),
      req.payload.find({
        collection: "navigation",
        overrideAccess: false,
        req: scoped,
        draft: true,
        depth: 0,
        limit: 1,
        where: tenantWhere,
      }),
      req.payload.find({
        collection: "footer",
        overrideAccess: false,
        req: scoped,
        draft: true,
        depth: 0,
        limit: 1,
        where: tenantWhere,
      }),
      req.payload.find({
        collection: "media",
        overrideAccess: false,
        req: studioMediaGrantRequest(scoped),
        depth: 0,
        limit: 500,
        sort: "id",
        where: { and: [tenantWhere, { state: { equals: "READY" } }] },
      }),
      // #2829 W5 — the content collections the publish will freeze.
      findTenantContent(scoped, grant.tenant_id),
    ]);
    const home = pages.docs.find((page) => isHomePage(page));
    if (!home || !settings.docs[0]) throw new Error("NOT_FOUND");
    const currentDigest = await publicationDraftDigest({
      pages: pages.docs,
      settings: settings.docs[0],
      navigation: navigation.docs[0] ?? null,
      footer: footer.docs[0] ?? null,
      media: media.docs,
      content,
    });
    if (
      String(home.revision) !== grant.source_revision ||
      currentDigest !== grant.source_digest
    )
      throw new Error("REVISION_CONFLICT");
    /*
     * #2830 — THE CMS NO LONGER RENDERS. It used to build its own HTML here,
     * which meant Mingla shipped TWO renderers: this one, and RestaurantV1 in
     * the public runtime. They diverged badly — this one special-cased hero and
     * hours and then emitted a heading plus one paragraph for EVERY other block
     * type, so it dropped images, galleries, CTAs, offering grids, menu links,
     * FAQs and testimonials, and used a different typeface. A brand owner
     * previewed one website, approved it, and published a different one. That
     * defeats the whole point of a review step, and it violated one-owner-per-
     * truth.
     *
     * Now: build the artifact with the SAME builder publication uses, store it
     * as the SAME kind of object at a `preview-` prefixed publication id, and
     * redirect to the public runtime, which renders it with the SAME
     * RestaurantV1 component and the SAME stylesheet. Preview equals published
     * by construction rather than by two implementations agreeing.
     *
     * The unguessable key in the redirect is the capability, exactly as the
     * signed token in the incoming URL already was — this changes no trust
     * boundary and introduces no new secret. Everything above still applies:
     * the grant is decoded and scoped, and the revision/digest conflict check
     * has already refused a draft that moved since the grant was minted.
     */
    const tenant = await req.payload.findByID({
      collection: "tenants",
      id: grant.tenant_id,
      overrideAccess: true,
      depth: 0,
    });
    if (
      String(tenant.core_site_id) !== grant.site_id ||
      String(tenant.core_brand_id) !== grant.brand_id
    ) throw new Error("FORBIDDEN");
    const previewNonce = crypto.randomUUID().replace(/-/g, "");
    const built = await buildPublicationArtifact(req, {
      tenant,
      operationId: grant.nonce,
      publicationId: `${PREVIEW_PUBLICATION_PREFIX}${previewNonce}`,
      sourceRevisionId: grant.source_revision,
      sourceDigest: grant.source_digest,
      generatedAt: new Date().toISOString(),
    });
    // #2829 W10 — this is now the site's newest preview (private share links show it).
    await reportPreviewBuilt(grant.site_id, built.artifactKey);
    // #2829 — a preview is shown on the site's OWN address (the runtime
    // refuses a preview key for any other host's site). Scheme and port come
    // from the runtime origin, the host from Core's primary hostname.
    const target = new URL("/preview", cmsConfig().publicRuntimeOrigin);
    const previewHost = String(tenant.primary_hostname ?? "");
    if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])$/.test(previewHost)) {
      throw new Error("INVALID_STATE");
    }
    target.hostname = previewHost;
    target.searchParams.set("k", built.artifactKey);
    // #2829 W2 — open the preview at the page the owner chose. Only a shape-
    // valid page path travels; the runtime resolves it inside the SAME
    // preview artifact, so it can never reach anything else.
    const requestedPath = previewPagePath(url.searchParams.get("path"));
    if (requestedPath) target.searchParams.set("path", requestedPath);
    // #2829 W9f — forward a Business Vercel preview ancestor (pattern-checked).
    const frameAncestor = businessPreviewFrameAncestor(url.searchParams.get("fa"));
    if (frameAncestor) target.searchParams.set("fa", frameAncestor);
    return new Response(null, {
      status: 302,
      headers: {
        location: target.toString(),
        "cache-control": "no-store, private",
        "x-robots-tag": "noindex, nofollow",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

/**
 * #2829 — "View live site": the signed-in tenant's OWN primary address, from
 * the signed Core grant in the session. Nothing else is ever a target.
 */
async function liveSite(req: PayloadRequest): Promise<Response> {
  try {
    const session = await sessionFromHeaders(req.headers);
    const host = session?.primary_hostname;
    if (!session || typeof host !== "string") throw new Error("NOT_FOUND");
    const target = new URL("/", cmsConfig().publicRuntimeOrigin);
    target.hostname = host;
    return new Response(null, {
      status: 302,
      headers: { location: target.toString(), "cache-control": "no-store, private" },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

/**
 * #2829 — "Download everything" (signed Core→CMS, rank 50 checked in Core).
 * Writes one zip of every page, block, setting, collection entry, navigation,
 * footer and the active artifact, with a signed 24-hour link to each approved
 * media original inside it, and returns a 24-hour link to the zip.
 */
async function exportSite(req: PayloadRequest): Promise<Response> {
  try {
    const raw = (await req.text?.()) || "";
    const envelope = await verifyCoreRequest(req, raw, "/api/internal/exports");
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (
      body.kind !== "export" ||
      body.site_id !== envelope.site_id ||
      body.operation_id !== envelope.operation_id ||
      typeof body.brand_id !== "string"
    ) throw new Error("VALIDATION_FAILED");
    const tenant = (await req.payload.find({
      collection: "tenants",
      overrideAccess: true,
      where: { core_site_id: { equals: envelope.site_id } },
      limit: 1,
      depth: 0,
    })).docs[0];
    if (!tenant || tenant.core_brand_id !== body.brand_id) throw new Error("TENANT_MISMATCH");
    const tenantWhere = { tenant: { equals: tenant.id } };
    const readAll = async (collection: "pages" | "navigation" | "footer" | "site-settings" | "media") =>
      (await req.payload.find({
        collection,
        overrideAccess: true,
        where: tenantWhere,
        limit: 0,
        pagination: false,
        depth: 0,
        draft: collection !== "media",
        // The master object key is a hidden system field; the export needs it.
        showHiddenFields: collection === "media",
      })).docs as unknown as Record<string, unknown>[];
    const [pages, navigation, footer, settings, media, collections, workLog] = await Promise.all([
      readAll("pages"), readAll("navigation"), readAll("footer"),
      readAll("site-settings"), readAll("media"),
      // #2829 W9f — the content collections too (SC-7: every collection entry).
      findTenantContent(req, tenant.id, { overrideAccess: true }),
      // #2829 W9b — "Why it looks like this" travels with the site.
      req.payload.find({
        collection: "work-log",
        overrideAccess: true,
        where: tenantWhere,
        pagination: false,
        depth: 0,
        sort: "createdAt",
      }).then((result) => (result.docs as unknown as Record<string, unknown>[]).map((doc) => ({
        part: doc.part, decision: doc.decision, cites: doc.cites, actor: doc.actor, tool: doc.tool ?? null,
        target: doc.target ?? null, created_at: doc.createdAt,
      }))),
    ]);
    const config = cmsConfig();
    const artifactKey = body.active_artifact_key;
    let activeArtifact: Uint8Array | null = null;
    if (typeof artifactKey === "string") {
      if (!/^publications\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}\.json$/.test(artifactKey) ||
        !artifactKey.startsWith(`publications/${envelope.site_id}/`)) {
        throw new Error("TENANT_MISMATCH");
      }
      activeArtifact = await readObject(config.artifactBucket, artifactKey);
    }
    // #2829 W9f — media originals travel as signed links, never as bytes in
    // the zip (see buildExportEntries for the 503 this removed).
    const entries = await buildExportEntries({
      siteId: envelope.site_id,
      brandId: String(body.brand_id),
      tenantName: tenant.name,
      address: tenant.primary_hostname ?? null,
      exportedAt: new Date().toISOString(),
      pages, navigation, footer, settings,
      collections,
      workLog,
      media,
      activeArtifact,
      signMediaLink: (key) => presignedGet(config.approvedBucket, key, EXPORT_LINK_TTL_SECONDS),
    });
    const zip = buildZip(entries);
    const key = exportObjectKey(envelope.site_id, envelope.operation_id);
    await writeObject(config.artifactBucket, key, zip, "application/zip");
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    return json({
      ok: true,
      data: {
        download_url: await presignedGet(config.artifactBucket, key, 86_400),
        expires_at: expiresAt,
        bytes: zip.byteLength,
        entries: entries.length,
      },
    });
  } catch (error) {
    return safeFailure(error);
  }
}

export const sitesEndpoints: Endpoint[] = [
  {
    path: "/mingla/live-site",
    method: "get",
    handler: observeCmsEndpoint("/mingla/live-site", "customer_to_cms", liveSite),
  },
  {
    path: "/internal/exports",
    method: "post",
    handler: observeCmsEndpoint("/internal/exports", "core_to_cms", exportSite),
  },
  {
    path: "/mingla/exchange",
    method: "post",
    handler: observeCmsEndpoint(
      "/mingla/exchange",
      "customer_to_cms",
      exchange,
    ),
  },
  {
    path: "/mingla/return",
    method: "get",
    handler: observeCmsEndpoint(
      "/mingla/return",
      "studio_to_cms",
      returnToMingla,
    ),
  },
  {
    path: "/mingla/studio-preview",
    method: "get",
    handler: observeCmsEndpoint(
      "/mingla/studio-preview",
      "studio_to_cms",
      studioPreview,
    ),
  },
  {
    path: "/mingla/media/upload-grants",
    method: "post",
    handler: observeCmsEndpoint(
      "/mingla/media/upload-grants",
      "studio_to_cms",
      uploadGrant,
    ),
  },
  {
    path: "/mingla/videos/capability",
    method: "get",
    handler: observeCmsEndpoint("/mingla/videos/capability", "studio_to_cms", streamCapability),
  },
  {
    path: "/mingla/videos/stream-intent",
    method: "post",
    handler: observeCmsEndpoint("/mingla/videos/stream-intent", "studio_to_cms", streamIntent),
  },
  {
    path: "/mingla/videos/:mediaId/stream-status",
    method: "get",
    handler: observeCmsEndpoint("/mingla/videos/{mediaId}/stream-status", "studio_to_cms", streamStatus),
  },
  {
    path: "/mingla/media/:mediaId/complete",
    method: "post",
    handler: observeCmsEndpoint(
      "/mingla/media/{mediaId}/complete",
      "studio_to_cms",
      uploadComplete,
    ),
  },
  {
    path: "/mingla/media-library",
    method: "get",
    handler: observeCmsEndpoint(
      "/mingla/media-library",
      "studio_to_cms",
      studioMediaLibrary,
    ),
  },
  {
    path: "/mingla/media/:mediaId/thumbnail",
    method: "get",
    handler: observeCmsEndpoint(
      "/mingla/media/{mediaId}/thumbnail",
      "studio_to_cms",
      studioMediaThumbnail,
    ),
  },
  {
    path: "/mingla/media/:mediaId/attach",
    method: "post",
    handler: observeCmsEndpoint(
      "/mingla/media/{mediaId}/attach",
      "studio_to_cms",
      studioMediaAttach,
    ),
  },
  {
    path: "/mingla/media/:mediaId",
    method: "get",
    handler: observeCmsEndpoint(
      "/mingla/media/{mediaId}",
      "studio_to_cms",
      mediaStatus,
    ),
  },
  {
    path: "/mingla/media/:mediaId/tombstone",
    method: "post",
    handler: observeCmsEndpoint(
      "/mingla/media/{mediaId}/tombstone",
      "studio_to_cms",
      mediaTombstone,
    ),
  },
  {
    path: "/mingla/media/:mediaId/restore",
    method: "post",
    handler: observeCmsEndpoint(
      "/mingla/media/{mediaId}/restore",
      "studio_to_cms",
      mediaRestore,
    ),
  },
  {
    path: "/mingla/previews",
    method: "get",
    handler: observeCmsEndpoint(
      "/mingla/previews",
      "studio_to_cms",
      previewDraft,
    ),
  },
  {
    path: "/mingla/previews",
    method: "post",
    handler: observeCmsEndpoint(
      "/mingla/previews",
      "core_to_cms",
      mintPreview,
    ),
  },
  {
    path: "/internal/reconcile/:operationId",
    method: "post",
    handler: observeCmsEndpoint(
      "/internal/reconcile/{operationId}",
      "core_to_cms",
      provisionOrReconcile,
    ),
  },
  {
    path: "/internal/publications",
    method: "post",
    handler: observeCmsEndpoint(
      "/internal/publications",
      "core_to_cms",
      publish,
    ),
  },
  {
    path: "/internal/retention-sweep",
    method: "post",
    handler: observeCmsEndpoint(
      "/internal/retention-sweep",
      "core_to_cms",
      retentionSweep,
    ),
  },
  {
    path: "/internal/ari",
    method: "post",
    handler: observeCmsEndpoint("/internal/ari", "core_to_cms", ari),
  },
];
