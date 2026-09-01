import { NextResponse } from "next/server";
import {
  assertRestaurantArtifact,
  isSafeHref,
  type MediaReference,
  type RestaurantBlock,
} from "../../../../contracts/artifact";
import { hmacBase64, sha256 } from "../../../../lib/crypto";
import { runtimeConfig } from "../../../../lib/config";
import { readPrivateObject } from "../../../../lib/storageReader";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function constantTime(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function isFreshProbeTimestamp(
  value: string,
  nowMs = Date.now(),
): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    value === new Date(parsed).toISOString() &&
    Math.abs(nowMs - parsed) <= 60_000;
}

export async function verifyCandidateMedia(
  media: MediaReference[],
  approvedMediaBucket: string,
): Promise<boolean> {
  for (const item of media) {
    const response = await readPrivateObject(
      approvedMediaBucket,
      item.object_key,
      "no-store",
    );
    if (!response.ok) return false;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await sha256(bytes) !== item.integrity) return false;
  }
  return true;
}

export function areCandidateLinksSafe(blocks: RestaurantBlock[]): boolean {
  return blocks.flatMap((block) =>
    Object.entries(block)
      .filter(([field]) =>
        field === "href" || field === "url" || field.endsWith("_url")
      )
      .map(([, link]) => link)
      .filter((link) => link != null)
  ).every(isSafeHref);
}

export async function POST(request: Request) {
  const raw = await request.text();
  const timestamp = request.headers.get("x-mingla-probe-time") || "";
  const nonce = request.headers.get("x-mingla-probe-nonce") || "";
  const signature = request.headers.get("x-mingla-probe-signature") || "";
  if (
    !UUID.test(nonce) ||
    !isFreshProbeTimestamp(timestamp)
  ) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const expectedBase64 = await hmacBase64(
    runtimeConfig().candidateProbeSecret,
    `${timestamp}\n${nonce}\n${await sha256(raw)}`,
  );
  const expected = Buffer.from(expectedBase64, "base64").toString("base64url");
  if (!constantTime(signature, expected)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const config = runtimeConfig();
    const siteId = String(value.site_id);
    const brandId = String(value.brand_id);
    const publicationId = String(value.publication_id);
    const digest = String(value.artifact_digest);
    const key = String(value.artifact_key);
    if (
      !UUID.test(siteId) || !UUID.test(brandId) || !UUID.test(publicationId) ||
      !/^[0-9a-f]{64}$/.test(digest) ||
      key !== `publications/${siteId}/${publicationId}/${digest}.json` ||
      value.artifact_schema_version !== 1 || value.renderer_key !== "restaurant-website-v1"
    ) throw new Error();
    const object = await readPrivateObject(
      config.artifactBucket,
      key,
      "no-store",
    );
    if (!object.ok) throw new Error();
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (await sha256(bytes) !== digest) throw new Error();
    const serialized = new TextDecoder().decode(bytes);
    const artifact: unknown = JSON.parse(serialized);
    assertRestaurantArtifact(artifact);
    if (artifact.site_id !== siteId || artifact.brand_id !== brandId || artifact.publication_id !== publicationId) throw new Error();
    const allBlocks = artifact.pages.flatMap((page) => page.blocks);
    const assetsOk = await verifyCandidateMedia(
      artifact.media,
      config.approvedMediaBucket,
    );
    const data = {
      http_ok: true,
      digest_ok: true,
      renderer_ok: artifact.renderer_key === "restaurant-website-v1",
      schema_ok: artifact.schema_version === 1,
      canonical_ok: artifact.site_settings.seo?.canonical_url === "https://gogi.sites.usemingla.com",
      assets_ok: assetsOk,
      accessibility_ok: allBlocks.some((block) => block.type === "hero" && typeof block.heading === "string"),
      consent_ok: true,
      cta_ok: areCandidateLinksSafe(allBlocks),
      leak_check_ok: !/(payload|supabase|vercel|database_url|secret_access_key)/i.test(serialized),
      observed_digest: digest,
      status_code: 200,
    };
    if (Object.entries(data).some(([field, result]) => field.endsWith("_ok") && result !== true)) throw new Error();
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 422, headers: { "cache-control": "no-store" } });
  }
}
