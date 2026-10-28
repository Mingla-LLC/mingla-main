import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { artifactFontDigests } from "../../../contracts/generated/artifactV2.ts";
import { runtimeConfig } from "../../../lib/config";
import { sha256 } from "../../../lib/crypto";
import { loadPreviewArtifact, parsePreviewArtifactKey } from "../../../lib/previewArtifact";
import { loadPublication, requestHost, resolveHostSite } from "../../../lib/publication";
import { isV2Artifact, type SiteArtifact } from "../../../lib/siteArtifact";
import { readPrivateObject } from "../../../lib/storageReader";

/*
 * #2829 AD-3 / S-1 — a site's own font files, from its own origin.
 *
 * Serves `fonts/<digest>.woff2` from the approved-media bucket ONLY when the
 * artifact this host serves (its active publication, or — with `?k=` — its
 * own private preview) lists that digest. Brand B's host never serves brand
 * A's font: an unlisted digest is a 404 like any unknown path. The bytes are
 * re-hashed against the digest before they leave.
 *
 * `access-control-allow-origin: *` on fonts only, so a page on another Mingla
 * origin can use the site's fonts; the files are public open-source works.
 */
const DIGEST = /^[0-9a-f]{64}$/;

function notFound() {
  return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request, context: { params: Promise<{ digest: string }> }) {
  try {
    const { digest } = await context.params;
    if (!DIGEST.test(digest)) return notFound();
    const incoming = await headers();
    const host = requestHost(incoming);
    const previewParam = new URL(request.url).searchParams.get("k");
    let artifact: SiteArtifact;
    if (previewParam !== null) {
      const parsed = parsePreviewArtifactKey(previewParam);
      if (!parsed) return notFound();
      artifact = await loadPreviewArtifact(parsed, await resolveHostSite(host));
    } else {
      artifact = (await loadPublication(host)).artifact;
    }
    if (!isV2Artifact(artifact) || !artifactFontDigests(artifact).has(digest)) return notFound();
    const object = await readPrivateObject(runtimeConfig().approvedMediaBucket, `fonts/${digest}.woff2`, "force-cache");
    if (!object.ok) return notFound();
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (await sha256(bytes) !== digest) return notFound();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "font/woff2",
        "cache-control": previewParam !== null ? "private, no-store" : "public, max-age=31536000, immutable",
        "access-control-allow-origin": "*",
        "content-digest": `sha-256=:${Buffer.from(digest, "hex").toString("base64")}:`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
