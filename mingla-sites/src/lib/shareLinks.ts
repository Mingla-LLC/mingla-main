import { cache } from "react";
import { signedCorePost, type SiteBinding } from "./coreGateway";
import { loadPreviewArtifact, parsePreviewArtifactKey } from "./previewArtifact";
import { resolveHostSite } from "./publication";
import type { SiteArtifact } from "./siteArtifact";

/*
 * #2829 W10 (S2) — a private share-preview link: `/preview/share/<token>` on
 * the site's own address. Core answers, for the site it resolved for THIS
 * host, the site's newest built preview while the link is live (not expired,
 * not revoked); anything else is not found. The token is a 256-bit random
 * string; Core only ever sees its peppered digest.
 */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** The header proxy.ts sets on /preview/share/<token> requests (read by the layout). */
export const SHARE_TOKEN_HEADER = "x-mingla-share-token";
export const SHARE_PATH_PREFIX = "/preview/share/";

export function shareTokenFromPath(pathname: string): string | null {
  if (!pathname.startsWith(SHARE_PATH_PREFIX)) return null;
  const token = pathname.slice(SHARE_PATH_PREFIX.length).replace(/\/$/, "");
  return SHARE_TOKEN.test(token) ? token : null;
}

export type SharedPreviewKey = { artifactKey: string; expiresAt: string | null };
export type SharePreviewFetcher = (site: SiteBinding, token: string) => Promise<SharedPreviewKey | null>;

export const fetchSharePreview: SharePreviewFetcher = async (site, token) => {
  const response = await signedCorePost({
    edgeFunction: "brand-site-runtime-resolve",
    path: `/internal/v1/sites/${site.site_id}/share-preview`,
    site,
    body: { site_id: site.site_id, token },
  });
  if (!response.ok) return null;
  const payload = await response.json() as { ok?: unknown; data?: { site_id?: unknown; artifact_key?: unknown; expires_at?: unknown } };
  if (payload?.ok !== true || payload.data?.site_id !== site.site_id || typeof payload.data.artifact_key !== "string") return null;
  return {
    artifactKey: payload.data.artifact_key,
    expiresAt: typeof payload.data.expires_at === "string" ? payload.data.expires_at : null,
  };
};

export async function loadSharedPreview(
  host: string,
  token: string,
  deps: {
    fetcher?: SharePreviewFetcher;
    resolveHost?: typeof resolveHostSite;
    loadArtifact?: typeof loadPreviewArtifact;
  } = {},
): Promise<{ artifact: SiteArtifact; key: string; expiresAt: string | null }> {
  if (!SHARE_TOKEN.test(token)) throw new Error("NOT_FOUND");
  const hostSite = await (deps.resolveHost ?? resolveHostSite)(host);
  const shared = await (deps.fetcher ?? fetchSharePreview)({ site_id: hostSite.site_id }, token);
  if (!shared) throw new Error("NOT_FOUND");
  // Only a preview object of THIS host's site (shape, site and digest are
  // checked again by the preview loader).
  const parsed = parsePreviewArtifactKey(shared.artifactKey);
  if (!parsed || parsed.siteId !== hostSite.site_id) throw new Error("NOT_FOUND");
  const artifact = await (deps.loadArtifact ?? loadPreviewArtifact)(parsed, hostSite);
  return { artifact, key: parsed.key, expiresAt: shared.expiresAt };
}

/** One Core lookup per request, shared by the layout and the page. */
export const sharedPreviewForRequest = cache((host: string, token: string) => loadSharedPreview(host, token));
