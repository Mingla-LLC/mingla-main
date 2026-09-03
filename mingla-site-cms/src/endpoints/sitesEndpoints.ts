import type { Endpoint, PayloadRequest } from "payload";
import {
  buildPublicationArtifact,
  buildRollbackPublicationArtifact,
  publicationDraftDigest,
  probePublicationCandidate,
} from "../lib/artifactBuilder";
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
import { readObject } from "../lib/objectStore";
import {
  applyStudioMediaSelection,
  referencedStudioMediaIds,
  studioMediaTargets,
} from "../lib/studioMediaSelection";
import { base64url } from "../lib/crypto";
import { cmsConfig } from "../lib/config";
import { MINGLA_BUSINESS_ORIGIN } from "../lib/origins";
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
            ? "That image could not be accepted."
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
      body.renderer_key !== "restaurant-website-v1" ||
      body.renderer_version !== 1
    )
      throw new Error("VALIDATION_FAILED");
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
    if (!tenant) {
      tenant = await req.payload.create({
        collection: "tenants",
        overrideAccess: true,
        data: {
          name: "Gogi Restaurant",
          core_site_id: envelope.site_id,
          core_brand_id: brandId,
          status: "active",
          renderer_key: "restaurant-website-v1",
          renderer_version: 1,
        },
      });
      const tenantId = tenant.id;
      const provisioningRequest = {
        ...req,
        context: {
          ...req.context,
          minglaSignedCore: true,
          minglaInternalTenantId: String(tenantId),
        },
      } as PayloadRequest;
      await req.payload.create({
        collection: "pages",
        overrideAccess: true,
        req: provisioningRequest,
        data: {
          tenant: tenantId,
          role: "home",
          slug: "/",
          title: "Home",
          enabled: true,
          nav_label: "Home",
          nav_order: 0,
          revision: 1,
          blocks: [],
        },
        draft: true,
      });
      await req.payload.create({
        collection: "navigation",
        overrideAccess: true,
        req: provisioningRequest,
        data: { tenant: tenantId, label: "Main navigation", pages: [] },
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
          display_name: "Gogi Restaurant",
          canonical_url: "https://gogi.sites.usemingla.com",
          analytics_consent_mode: "optional",
          renderer_key: "restaurant-website-v1",
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
    const tenant = (
      await req.payload.find({
        collection: "tenants",
        overrideAccess: true,
        where: { core_site_id: { equals: envelope.site_id } },
        limit: 1,
        depth: 0,
      })
    ).docs[0];
    if (!tenant) throw new Error("NOT_FOUND");
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
    const canReuse =
      typeof job.artifact_key === "string" &&
      typeof job.artifact_digest === "string" &&
      /^[0-9a-f]{64}$/.test(job.artifact_digest);
    const built = canReuse
      ? { artifactKey: job.artifact_key!, artifactDigest: job.artifact_digest! }
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
                schema_version: 1,
                renderer_version: 1,
                exact_revision: true,
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
      ].includes(error.message);
    let failureRecorded = false;
    if (definitiveFailure && callbackContext) {
      try {
        await callCore(
          `/internal/v1/sites/${callbackContext.siteId}/publication-failures`,
          callbackContext.siteId,
          callbackContext.operationId,
          { publication_id: callbackContext.publicationId },
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
    const [pages, media, settings] = await Promise.all([
      req.payload.find({
        collection: "pages",
        overrideAccess: false,
        req: request,
        draft: true,
        depth: 0,
        limit: 5,
        sort: "nav_order",
        where: tenantWhere,
      }),
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
      req.payload.find({
        collection: "site-settings",
        overrideAccess: false,
        req: request,
        draft: true,
        depth: 0,
        limit: 1,
        where: tenantWhere,
      }),
    ]);
    const referenced = referencedStudioMediaIds(pages.docs);
    const setting = settings.docs[0];
    for (const value of [setting?.logo, setting?.social_image]) {
      const id = value && typeof value === "object" && "id" in value
        ? String(value.id)
        : typeof value === "string" || typeof value === "number"
          ? String(value)
          : null;
      if (id) referenced.add(id);
    }
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
      renderer_key: "restaurant-website-v1",
      renderer_version: 1,
      issued_at: issuedAt,
      expires_at: issuedAt + 1800,
      nonce: crypto.randomUUID(),
      return_surface: body.return_surface,
    });
    const expiresAt = new Date((issuedAt + 1800) * 1000).toISOString();
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
    const [pages, settings, navigation, footer, media] = await Promise.all([
      req.payload.find({
        collection: "pages", overrideAccess: false, req: request, draft: true,
        depth: 0, limit: 5, where: tenantWhere, sort: "nav_order",
      }),
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
    ]);
    const home = pages.docs.find(
      (page) => page.role === "home" && page.enabled === true,
    );
    if (!home || !settings.docs[0]) throw new Error("VALIDATION_FAILED");
    const digest = await publicationDraftDigest({
      pages: pages.docs,
      settings: settings.docs[0],
      navigation: navigation.docs[0] ?? null,
      footer: footer.docs[0] ?? null,
      media: media.docs,
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
      renderer_key: "restaurant-website-v1",
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
  "propose_site_content_update",
  "propose_site_settings_update",
  "attach_approved_site_media",
  "validate_site_draft",
]);

function plainTextToLexical(value: string): Record<string, unknown> {
  return {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: "ltr",
      children: [
        {
          type: "paragraph",
          format: "",
          indent: 0,
          version: 1,
          direction: "ltr",
          textFormat: 0,
          textStyle: "",
          children: [
            {
              type: "text",
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text: value,
              version: 1,
            },
          ],
        },
      ],
    },
  };
}

function normalizeAriBlocks(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const block = raw as Record<string, unknown>;
    if (block.blockType !== "rich_text" || typeof block.content !== "string") {
      return block;
    }
    return { ...block, content: plainTextToLexical(block.content) };
  });
}

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
        req.payload.find({
          collection: "pages",
          req: scoped,
          overrideAccess: false,
          draft: true,
          depth: 0,
          limit: 5,
          sort: "nav_order",
          where: tenantWhere,
        }),
      ]);
      return json({
        ok: true,
        data: {
          site_id: envelope.site_id,
          renderer: "Restaurant Website v1",
          status: tenant.status,
          settings: settings.docs[0] ?? null,
          pages: pages.docs.map((page) => ({
            id: page.id,
            role: page.role,
            title: page.title,
            enabled: page.enabled,
            revision: page.revision,
            updatedAt: page.updatedAt,
          })),
        },
      });
    }
    if (action === "list_site_pages") {
      const pages = await req.payload.find({
        collection: "pages",
        req: scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        limit: 5,
        sort: "nav_order",
        where: tenantWhere,
      });
      return json({
        ok: true,
        data: pages.docs.map((page) => ({
          id: page.id,
          role: page.role,
          title: page.title,
          enabled: page.enabled,
          revision: page.revision,
          updatedAt: page.updatedAt,
        })),
      });
    }
    const pageRole = String(args.page_role || "");
    const page = pageRole
      ? (
          await req.payload.find({
            collection: "pages",
            req: scoped,
            overrideAccess: false,
            draft: true,
            depth: 0,
            limit: 1,
            where: { and: [tenantWhere, { role: { equals: pageRole } }] },
          })
        ).docs[0]
      : null;
    if (action === "get_site_page") {
      if (!page) throw new Error("NOT_FOUND");
      return json({ ok: true, data: page });
    }
    if (action === "propose_site_content_update") {
      if (!page || String(args.expected_revision) !== String(page.revision))
        throw new Error("REVISION_CONFLICT");
      const changes =
        args.changes &&
        typeof args.changes === "object" &&
        !Array.isArray(args.changes)
          ? (args.changes as Record<string, unknown>)
          : {};
      const allowed = new Set([
        "title",
        "enabled",
        "nav_label",
        "nav_order",
        "blocks",
        "seo",
      ]);
      if (
        !Object.keys(changes).length ||
        Object.keys(changes).some((key) => !allowed.has(key))
      )
        throw new Error("VALIDATION_FAILED");
      const updated = await req.payload.update({
        collection: "pages",
        id: page.id,
        req: scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        data: {
          ...changes,
          ...(Object.prototype.hasOwnProperty.call(changes, "blocks")
            ? { blocks: normalizeAriBlocks(changes.blocks) }
            : {}),
          revision: page.revision,
        } as never,
      });
      return json({
        ok: true,
        data: {
          site_id: envelope.site_id,
          page_role: updated.role,
          previous_revision: page.revision,
          revision: updated.revision,
          draft_only: true,
          updatedAt: updated.updatedAt,
        },
      });
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
      const allowed = new Set([
        "display_name",
        "short_description",
        "logo",
        "background_color",
        "foreground_color",
        "accent_color",
        "typography",
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
    if (action === "attach_approved_site_media") {
      if (!page || String(args.expected_revision) !== String(page.revision))
        throw new Error("REVISION_CONFLICT");
      const mediaId = String(args.media_id || "");
      const media = await req.payload.findByID({
        collection: "media",
        id: mediaId,
        req: scoped,
        overrideAccess: false,
        depth: 0,
      });
      if (media.state !== "READY") throw new Error("MEDIA_PROCESSING");
      const blockIndex = Number(args.block_index);
      const field = String(args.field || "");
      const blocks = Array.isArray(page.blocks)
        ? structuredClone(page.blocks)
        : [];
      const block = blocks[blockIndex] as Record<string, unknown> | undefined;
      if (
        !Number.isInteger(blockIndex) ||
        !block ||
        !["media", "images"].includes(field)
      )
        throw new Error("VALIDATION_FAILED");
      if (
        field === "media" &&
        !["hero", "media_feature"].includes(String(block.blockType))
      )
        throw new Error("VALIDATION_FAILED");
      if (field === "images" && block.blockType !== "gallery")
        throw new Error("VALIDATION_FAILED");
      if (field === "media") block.media = media.id;
      else
        block.images = [
          ...(Array.isArray(block.images) ? block.images : []),
          { media: media.id, alt: String(args.alt || "") },
        ].slice(0, 12);
      const updated = await req.payload.update({
        collection: "pages",
        id: page.id,
        req: scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        data: { blocks, revision: page.revision },
      });
      return json({
        ok: true,
        data: {
          site_id: envelope.site_id,
          page_role: updated.role,
          media_id: media.id,
          previous_revision: page.revision,
          revision: updated.revision,
          draft_only: true,
        },
      });
    }
    const [settings, pages, navigation, footer, media] = await Promise.all([
      req.payload.find({
        collection: "site-settings",
        req: scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        limit: 1,
        where: tenantWhere,
      }),
      req.payload.find({
        collection: "pages",
        req: scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        limit: 5,
        sort: "nav_order",
        where: tenantWhere,
      }),
      req.payload.find({
        collection: "navigation",
        req: scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        limit: 1,
        where: tenantWhere,
      }),
      req.payload.find({
        collection: "footer",
        req: scoped,
        overrideAccess: false,
        draft: true,
        depth: 0,
        limit: 1,
        where: tenantWhere,
      }),
      req.payload.find({
        collection: "media",
        req: scoped,
        overrideAccess: false,
        depth: 0,
        limit: 500,
        sort: "id",
        where: { and: [tenantWhere, { state: { equals: "READY" } }] },
      }),
    ]);
    const home = pages.docs.find(
      (candidate) => candidate.role === "home" && candidate.enabled === true,
    );
    if (!settings.docs[0] || !home) throw new Error("VALIDATION_FAILED");
    const draftDigest = await publicationDraftDigest({
      pages: pages.docs,
      settings: settings.docs[0],
      navigation: navigation.docs[0] ?? null,
      footer: footer.docs[0] ?? null,
      media: media.docs,
    });
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
    const [pages, settings, navigation, footer, media] = await Promise.all([
      req.payload.find({
        collection: "pages",
        overrideAccess: false,
        req: scoped,
        draft: true,
        depth: 0,
        limit: 5,
        where: tenantWhere,
        sort: "nav_order",
      }),
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
    ]);
    const home = pages.docs.find((page) => page.role === "home");
    if (!home || !settings.docs[0]) throw new Error("NOT_FOUND");
    const currentDigest = await publicationDraftDigest({
      pages: pages.docs,
      settings: settings.docs[0],
      navigation: navigation.docs[0] ?? null,
      footer: footer.docs[0] ?? null,
      media: media.docs,
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
    const target = new URL(
      "/preview",
      cmsConfig().publicRuntimeOrigin,
    );
    target.searchParams.set("k", built.artifactKey);
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

export const sitesEndpoints: Endpoint[] = [
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
