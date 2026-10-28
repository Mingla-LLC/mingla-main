import { runtimeConfig } from "./config";
import { loadResolvedArtifact, requestHost, resolveHost } from "./publication";
import type { StreamVideoRef } from "../contracts/generated/video.ts";

/*
 * #2829 W6 (AD-9) — which videos a published site may actually play.
 *
 * A file video plays from the site's own media route. A stream video plays
 * from its CDN host only when that host is on the runtime's allowlist
 * (`SITES_VIDEO_CDN_HOSTS`); otherwise the block shows its poster, and the
 * host never enters the page's Content-Security-Policy. Nothing from the
 * request decides either.
 */

type ArtifactVideos = {
  media?: ReadonlyArray<{ url: string; object_key: string; chunk_digests?: unknown }>;
  stream_videos?: readonly StreamVideoRef[];
};

/** The URL to play for a block's video field, or null (poster only). */
export function playableVideoUrl(
  artifact: ArtifactVideos,
  url: unknown,
  allowedHosts?: readonly string[],
): string | null {
  if (typeof url !== "string" || !url) return null;
  if (url.startsWith("/media/")) {
    return (artifact.media ?? []).some((item) => item.url === url && item.object_key.endsWith(".mp4")) ? url : null;
  }
  const stream = (artifact.stream_videos ?? []).find((item) => item.url === url);
  return stream && (allowedHosts ?? configuredHosts()).includes(stream.host) ? url : null;
}

function configuredHosts(): readonly string[] {
  try {
    return runtimeConfig().videoCdnHosts;
  } catch {
    return [];
  }
}

/** The allowed stream hosts this artifact plays from (for media-src). */
export function streamVideoHosts(
  artifact: ArtifactVideos,
  allowedHosts: readonly string[] = runtimeConfig().videoCdnHosts,
): string[] {
  const hosts = new Set<string>();
  for (const item of artifact.stream_videos ?? []) if (allowedHosts.includes(item.host)) hosts.add(item.host);
  return [...hosts].sort();
}

/**
 * The stream hosts for the active publication of the host a request arrived
 * on. Any failure (no site, no publication) is "none": the policy then
 * allows only the site's own media, which is always safe.
 */
export async function requestStreamVideoHosts(headers: Headers): Promise<string[]> {
  try {
    const allowed = runtimeConfig().videoCdnHosts;
    if (!allowed.length) return [];
    const resolved = await resolveHost(requestHost(headers));
    return streamVideoHosts(await loadResolvedArtifact(resolved.value) as ArtifactVideos, allowed);
  } catch {
    return [];
  }
}

/** #2829 W6 — the visitor asked for less data (`Save-Data: on`): poster only. */
export function wantsLessData(headers: Headers): boolean {
  return (headers.get("save-data") ?? "").trim().toLowerCase() === "on";
}
