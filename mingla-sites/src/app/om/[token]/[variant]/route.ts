import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { runtimeConfig } from "../../../../lib/config";
import { siteOfferings } from "../../../../lib/offeringsFeed";
import { isOmRendition, OM_VARIANTS, pathForToken, variantPath } from "../../../../lib/offeringMedia";
import { sha256 } from "../../../../lib/crypto";
import { readPrivateObject } from "../../../../lib/storageReader";
import { OFFERING_MEDIA_KEY_RE } from "../../../../contracts/generated/artifactV2.ts";
import { loadPublication, requestHost } from "../../../../lib/publication";
import { isV2Artifact } from "../../../../lib/siteArtifact";

/*
 * #2829 AD-6 / S-4 — an offering cover on a site.
 *
 * The token names one cover in THIS site's own feed (offeringMedia.ts); the
 * picture is fetched from Mingla's public storage origin only (the configured
 * Core origin — never a host from the request), redirects are refused, only
 * image types are passed on, and size is capped. Stored files and their
 * stored `_thumb` only: no image transformations (the Supabase spend cap).
 * Responses are immutable so the CDN, not storage, serves repeat views.
 *
 * #2829 W7c (A13.1) — `c400`, `c768` and `w1600` are the cover's renditions
 * the CMS made at publish: read from this site's own Sites storage under the
 * key the publication names for that cover, and served only when the bytes
 * are the digest the publication records. No rendition recorded → 404 (the
 * card then uses the stored cover).
 */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const MAX_BYTES = 15 * 1024 * 1024;

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; variant: string }> },
) {
  try {
    const { token, variant } = await context.params;
    if (!(OM_VARIANTS as readonly string[]).includes(variant)) return notFound();
    const { artifact, resolution } = await loadPublication(requestHost(await headers()));
    if (!isV2Artifact(artifact)) return notFound();
    const view = await siteOfferings(resolution, artifact);
    const path = await pathForToken(resolution.site_id, token, view.offerings);
    if (!path) return notFound();
    if (isOmRendition(variant)) {
      const rendition = (artifact.offering_media ?? []).find((row) => row.path === path)?.variants.find((row) => row.name === variant);
      const key = rendition ? OFFERING_MEDIA_KEY_RE.exec(rendition.object_key) : null;
      if (!rendition || !key || key[1] !== resolution.site_id || key[1] !== artifact.site_id) return notFound();
      const object = await readPrivateObject(runtimeConfig().approvedMediaBucket, rendition.object_key, "force-cache");
      if (!object.ok) return notFound();
      const stored = new Uint8Array(await object.arrayBuffer());
      if (stored.byteLength === 0 || stored.byteLength > MAX_BYTES || await sha256(stored) !== rendition.integrity) return notFound();
      return new NextResponse(Buffer.from(stored), {
        headers: {
          "content-type": "image/webp",
          "cache-control": "public, max-age=31536000, immutable",
          "content-digest": `sha-256=:${Buffer.from(rendition.integrity, "hex").toString("base64")}:`,
          "x-content-type-options": "nosniff",
        },
      });
    }
    const encoded = variantPath(path, variant as "original" | "thumb").split("/").map(encodeURIComponent).join("/");
    const upstream = await fetch(`${runtimeConfig().coreBaseUrl}/storage/v1/object/public/${encoded}`, {
      redirect: "manual",
      cache: "force-cache",
    });
    const type = (upstream.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const declared = Number(upstream.headers.get("content-length") ?? "0");
    if (upstream.status !== 200 || !IMAGE_TYPES.has(type) || declared > MAX_BYTES) return notFound();
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return notFound();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
