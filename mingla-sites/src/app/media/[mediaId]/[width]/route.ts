import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { sha256 } from "../../../../lib/crypto";
import { runtimeConfig } from "../../../../lib/config";
import { loadPublication, normalizePublicHost } from "../../../../lib/publication";

export async function GET(
  _request: Request,
  context: { params: Promise<{ mediaId: string; width: string }> },
) {
  try {
    const { mediaId, width } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(mediaId) || !/^(320|640|960|1440|1920)\.webp$/.test(width)) throw new Error();
    const incoming = await headers();
    const host = normalizePublicHost(incoming.get("x-forwarded-host") || incoming.get("host"));
    const { artifact } = await loadPublication(host);
    const reference = artifact.media.find(
      (item) => item.id === mediaId && item.url.endsWith(`/${width}`),
    );
    if (
      !reference ||
      !reference.object_key.startsWith(`approved/${artifact.site_id}/${mediaId}/`) ||
      !reference.object_key.endsWith(".webp")
    ) throw new Error();
    const config = runtimeConfig();
    const object = await fetch(
      `${config.artifactReadBaseUrl}/${encodeURIComponent(config.approvedMediaBucket)}/${reference.object_key}`,
      { headers: { authorization: `Bearer ${config.artifactReadToken}` }, cache: "force-cache" },
    );
    if (!object.ok) throw new Error();
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (await sha256(bytes) !== reference.integrity) throw new Error();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=31536000, immutable",
        "content-digest": `sha-256=:${Buffer.from(reference.integrity, "hex").toString("base64")}:`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
}
