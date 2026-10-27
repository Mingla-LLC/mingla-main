/**
 * #2829 W10 (S2, "build for a client") — private share-preview links.
 *
 *   GET  /v1/sites/<id>/share-links                   the site's links (rank 50)
 *   POST /v1/sites/<id>/share-links                   {ttl_days 1..14, operation_id?, source_digest?, expected_revision?}
 *   POST /v1/sites/<id>/share-links/<linkId>/revoke   (rank 50)
 *
 * The token is minted HERE (where the Sites pepper lives) and returned once;
 * Core stores only its peppered digest. Every rank check is Core's (the RPCs
 * re-derive the caller from the user JWT). When the caller sends the draft
 * it is looking at (source digest + revision), a fresh preview of that draft
 * is built first, so the link shows the draft as it is when shared; a failed
 * build never loses the link (it then shows the newest earlier preview).
 */
import { sitesJson } from "../_shared/sitesContracts.ts";
import { newSitesShareToken, sitesShareTokenDigest } from "../_shared/sitesSecurity.ts";

type JsonObject = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string } | null };

export type SiteShareContext = {
  userRpc: (fn: string, args: JsonObject) => Promise<RpcResult>;
  /** Builds a preview of the caller's current draft (true when Studio built it). */
  buildFreshPreview: (args: { siteId: string; operationId: string; sourceDigest: string; expectedRevision: string }) => Promise<boolean>;
  /** Whether the site has a built preview a link can show. */
  previewReady: (siteId: string) => Promise<boolean>;
  /** `<scheme>://<site's main address>[:port]` — where visitors open the site. */
  siteOrigin: (siteId: string) => Promise<string | null>;
};

export type ShareFailureCode = "FORBIDDEN" | "VALIDATION_FAILED" | "INVALID_STATE" | "NOT_FOUND" | "SERVICE_TEMPORARILY_UNAVAILABLE";

const MESSAGES: Record<ShareFailureCode, string> = {
  FORBIDDEN: "Only brand admins and owners can share a private preview.",
  VALIDATION_FAILED: "Choose how long the link should work (1 to 14 days).",
  INVALID_STATE: "This website already has 20 working preview links. Turn one off first.",
  NOT_FOUND: "That preview link doesn't exist.",
  SERVICE_TEMPORARILY_UNAVAILABLE: "Website tools are temporarily unavailable. Please try again.",
};

export function shareFailure(code: ShareFailureCode, status: number): Response {
  return sitesJson({
    ok: false,
    error: { code, message: MESSAGES[code], retryable: code === "SERVICE_TEMPORARILY_UNAVAILABLE" },
  }, status);
}

export function shareFailureFromRpc(message: string): Response {
  if (message.includes("sites_forbidden")) return shareFailure("FORBIDDEN", 403);
  if (message.includes("sites_validation_failed")) return shareFailure("VALIDATION_FAILED", 400);
  if (message.includes("sites_invalid_state")) return shareFailure("INVALID_STATE", 409);
  return shareFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/;

export async function handleSiteShareRoute(
  path: string,
  method: string,
  input: JsonObject,
  ctx: SiteShareContext,
): Promise<Response | null> {
  const listMatch = path.match(/^\/v1\/sites\/([^/]+)\/share-links$/);
  const revokeMatch = path.match(/^\/v1\/sites\/([^/]+)\/share-links\/([^/]+)\/revoke$/);
  if (!listMatch && !revokeMatch) return null;
  const siteId = (listMatch ?? revokeMatch)![1];
  if (!UUID_RE.test(siteId)) return shareFailure("VALIDATION_FAILED", 400);

  if (listMatch && method === "GET") {
    const { data, error } = await ctx.userRpc("brand_site_list_preview_links", { p_site_id: siteId });
    if (error) return shareFailureFromRpc(error.message);
    return sitesJson({ ok: true, data: { links: Array.isArray(data) ? data : [] } });
  }

  if (listMatch && method === "POST") {
    const ttl = input.ttl_days;
    if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 1 || ttl > 14) return shareFailure("VALIDATION_FAILED", 400);
    const token = newSitesShareToken();
    const { data, error } = await ctx.userRpc("brand_site_create_preview_link", {
      p_site_id: siteId,
      p_ttl_days: ttl,
      p_token_digest: await sitesShareTokenDigest(token),
    });
    if (error) return shareFailureFromRpc(error.message);
    const link = (data ?? {}) as JsonObject;
    const sourceDigest = typeof input.source_digest === "string" ? input.source_digest : "";
    const operationId = typeof input.operation_id === "string" ? input.operation_id : "";
    if (SHA_RE.test(sourceDigest) && UUID_RE.test(operationId)) {
      // Best effort: the link exists either way.
      await ctx.buildFreshPreview({
        siteId,
        operationId,
        sourceDigest,
        expectedRevision: String(input.expected_revision ?? ""),
      }).catch(() => false);
    }
    const origin = await ctx.siteOrigin(siteId);
    if (!origin) return shareFailure("SERVICE_TEMPORARILY_UNAVAILABLE", 503);
    return sitesJson({
      ok: true,
      data: {
        id: link.id,
        created_at: link.created_at,
        expires_at: link.expires_at,
        // Shown once: Mingla keeps only a digest of it.
        url: `${origin}/preview/share/${token}`,
        preview_ready: await ctx.previewReady(siteId),
      },
    }, 201);
  }

  if (revokeMatch && method === "POST") {
    const linkId = revokeMatch[2];
    if (!UUID_RE.test(linkId)) return shareFailure("VALIDATION_FAILED", 400);
    const { data, error } = await ctx.userRpc("brand_site_revoke_preview_link", { p_link_id: linkId });
    if (error) return shareFailureFromRpc(error.message);
    return sitesJson({ ok: true, data });
  }

  return shareFailure("NOT_FOUND", 404);
}
