import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { sha256 } from "../../../../lib/crypto";
import { runtimeConfig } from "../../../../lib/config";
import { loadPublication, requestHost } from "../../../../lib/publication";
import { readPrivateObject, readPrivateObjectRange } from "../../../../lib/storageReader";
import { emitPublicObservation } from "../../../../lib/observability";
import {
  ChunkIntegrityError,
  etagFor,
  planVideoRange,
  readVerifiedRange,
  verifiedVideoStream,
  type VideoIntegrity,
} from "../../../../lib/videoRange";
import type { MediaReference } from "../../../../contracts/artifact";

const IMMUTABLE = "public, max-age=31536000, immutable";
const notFound = () => new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });

type Params = { params: Promise<{ mediaId: string; width: string }> };

/** The media record this host's publication carries for the URL, or null. */
async function resolveReference(context: Params): Promise<{ reference: MediaReference; isVideo: boolean; siteId: string } | null> {
  const { mediaId, width } = await context.params;
  // #2830 — one media door. `video.mp4` joins the width renditions rather than
  // getting its own route, so lookup, tenancy and headers stay in one place.
  const isVideo = width === "video.mp4";
  const variantName = /^(c400|c768|w1600)\.webp$/.exec(width)?.[1] ?? null;
  if (!/^[0-9a-f-]{36}$/i.test(mediaId) || (!isVideo && !variantName && !/^(320|640|960|1440|1920)\.webp$/.test(width))) return null;
  const { artifact } = await loadPublication(requestHost(await headers()));
  const media = artifact.media as MediaReference[];
  // #2829 W7b — a picture's extra rendition is served from ITS OWN record
  // (own key, own digest) inside the picture's media entry.
  const reference = variantName
    ? (() => {
      const owner = media.find((item) => item.id === mediaId);
      const variant = owner?.variants?.find((row) => row.name === variantName && row.url === `/media/${mediaId}/${width}`);
      return owner && variant
        ? { id: owner.id, url: variant.url, alt: owner.alt, width: variant.width, height: variant.height, integrity: variant.integrity, object_key: variant.object_key }
        : undefined;
    })()
    : media.find((item) => item.id === mediaId && item.url.endsWith(`/${width}`));
  if (
    !reference ||
    !reference.object_key.startsWith(`approved/${artifact.site_id}/${mediaId}/`) ||
    !reference.object_key.endsWith(isVideo ? ".mp4" : ".webp")
  ) return null;
  return { reference, isVideo, siteId: artifact.site_id };
}

function videoIntegrity(reference: MediaReference): VideoIntegrity | null {
  if (
    typeof reference.bytes !== "number" ||
    typeof reference.chunk_size !== "number" ||
    !Array.isArray(reference.chunk_digests)
  ) return null;
  return {
    bytes: reference.bytes,
    chunk_size: reference.chunk_size,
    chunk_digests: reference.chunk_digests,
    integrity: reference.integrity,
  };
}

function videoHeaders(video: VideoIntegrity, extra: Record<string, string>): Headers {
  return new Headers({
    "content-type": "video/mp4",
    "accept-ranges": "bytes",
    etag: etagFor(video.integrity),
    "cache-control": IMMUTABLE,
    // The digest of the whole file (the representation), true for a 200 and a 206 alike.
    "repr-digest": `sha-256=:${Buffer.from(video.integrity, "hex").toString("base64")}:`,
    "x-content-type-options": "nosniff",
    ...extra,
  });
}

function observeChunkRefusal(siteId: string, error: unknown) {
  emitPublicObservation({
    event: "mingla_sites_request",
    metric: error instanceof ChunkIntegrityError ? "public.media.chunk_integrity_refused" : "public.media.storage_unavailable",
    request_id: crypto.randomUUID(),
    operation_id: null,
    site_id: siteId,
    publication_id: null,
    direction: "public_runtime",
    route: "/media/[mediaId]/video.mp4",
    state_transition: "range_requested->chunk_refused",
    latency_ms: 0,
    retry_count: 0,
    safe_error_code: error instanceof ChunkIntegrityError ? "ARTIFACT_DIGEST_MISMATCH" : null,
    status_code: 502,
    version: "sites-v1",
  });
}

/*
 * #2829 W6 (AD-9) — a file video answers byte ranges, verifying each 1 MiB
 * chunk it serves against the digests frozen into the publication. It never
 * hashes the whole file per request and never sends a byte of a chunk that
 * does not match (502 instead).
 */
async function serveVideo(request: Request, video: VideoIntegrity, objectKey: string, siteId: string, head: boolean): Promise<Response> {
  const incoming = request.headers;
  const plan = planVideoRange({
    size: video.bytes,
    etag: etagFor(video.integrity),
    range: incoming.get("range"),
    ifRange: incoming.get("if-range"),
    ifNoneMatch: incoming.get("if-none-match"),
  });
  if (plan.status === 304) return new NextResponse(null, { status: 304, headers: videoHeaders(video, {}) });
  if (plan.status === 416) {
    return new NextResponse(null, {
      status: 416,
      headers: videoHeaders(video, { "content-range": `bytes */${video.bytes}`, "cache-control": "no-store" }),
    });
  }
  const length = plan.end - plan.start + 1;
  const responseHeaders = videoHeaders(video, {
    "content-length": String(length),
    ...(plan.status === 206 ? { "content-range": `bytes ${plan.start}-${plan.end}/${video.bytes}` } : {}),
  });
  if (head) return new NextResponse(null, { status: plan.status, headers: responseHeaders });
  const bucket = runtimeConfig().approvedMediaBucket;
  const fetchBytes = (start: number, end: number) => readPrivateObjectRange(bucket, objectKey, { start, end });
  try {
    if (plan.status === 206) {
      const bytes = await readVerifiedRange(video, plan.start, plan.end, fetchBytes);
      return new NextResponse(Buffer.from(bytes), { status: 206, headers: responseHeaders });
    }
    const stream = await verifiedVideoStream(video, fetchBytes, (error) => observeChunkRefusal(siteId, error));
    return new NextResponse(stream, { status: 200, headers: responseHeaders });
  } catch (error) {
    observeChunkRefusal(siteId, error);
    return new NextResponse(null, { status: 502, headers: { "cache-control": "no-store" } });
  }
}

/*
 * TEMPORARY(#2829): v1 rollback renderer — remove once every site has a v2
 * last-good publication. A v1 publication's video carries no chunk digests,
 * so it is still verified whole, exactly as before W6. Every v2 video carries
 * chunk digests (the v2 contract requires them).
 */
async function serveWholeVerified(reference: MediaReference, isVideo: boolean): Promise<Response> {
  const object = await readPrivateObject(runtimeConfig().approvedMediaBucket, reference.object_key, "force-cache");
  if (!object.ok) return notFound();
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (await sha256(bytes) !== reference.integrity) return notFound();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": isVideo ? "video/mp4" : "image/webp",
      "cache-control": IMMUTABLE,
      "content-digest": `sha-256=:${Buffer.from(reference.integrity, "hex").toString("base64")}:`,
      "x-content-type-options": "nosniff",
    },
  });
}

async function handle(request: Request, context: Params, head: boolean): Promise<Response> {
  try {
    const resolved = await resolveReference(context);
    if (!resolved) return notFound();
    const video = resolved.isVideo ? videoIntegrity(resolved.reference) : null;
    if (video) return await serveVideo(request, video, resolved.reference.object_key, resolved.siteId, head);
    // Images (and v1 videos) are verified whole; a HEAD reports what a GET would.
    const response = await serveWholeVerified(resolved.reference, resolved.isVideo);
    return head ? new NextResponse(null, { status: response.status, headers: response.headers }) : response;
  } catch {
    return notFound();
  }
}

export async function GET(request: Request, context: Params) {
  return handle(request, context, false);
}

export async function HEAD(request: Request, context: Params) {
  return handle(request, context, true);
}
