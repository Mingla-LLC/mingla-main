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

/*
 * #2830 — a rejection has to name what it rejected.
 *
 * This returned a bare boolean, and the handler funnelled ten different
 * checks into one `catch` and a bodyless 422. A publish then failed with no
 * way to tell a corrupt asset from a bad canonical URL from a contract
 * violation, and the only route left was to guess and re-publish. That cost
 * an afternoon on the Gogi pilot.
 *
 * The object key and the reason are safe to return: this endpoint is
 * HMAC-authenticated, and the caller supplied the artifact these keys came
 * from. No bytes and no config are ever echoed.
 */
export type MediaVerification =
  | { ok: true }
  | { ok: false; object_key: string; reason: "unreadable" | "digest_mismatch" };

export async function verifyCandidateMedia(
  media: MediaReference[],
  approvedMediaBucket: string,
): Promise<MediaVerification> {
  for (const item of media) {
    const response = await readPrivateObject(
      approvedMediaBucket,
      item.object_key,
      "no-store",
    );
    if (!response.ok) {
      return { ok: false, object_key: item.object_key, reason: "unreadable" };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await sha256(bytes) !== item.integrity) {
      return { ok: false, object_key: item.object_key, reason: "digest_mismatch" };
    }
  }
  return { ok: true };
}

/** A refusal that knows which gate refused. */
export class ProbeRejection extends Error {
  constructor(readonly check: string, readonly detail?: string) {
    super(check);
    this.name = "ProbeRejection";
  }
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
    ) throw new ProbeRejection("request_shape");
    const object = await readPrivateObject(
      config.artifactBucket,
      key,
      "no-store",
    );
    if (!object.ok) throw new ProbeRejection("artifact_unreadable");
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (await sha256(bytes) !== digest) {
      throw new ProbeRejection("artifact_digest_mismatch");
    }
    const serialized = new TextDecoder().decode(bytes);
    let artifact: unknown;
    try {
      artifact = JSON.parse(serialized);
    } catch {
      throw new ProbeRejection("artifact_not_json");
    }
    try {
      assertRestaurantArtifact(artifact);
    } catch (error) {
      // The contract throws a NAMED error. Passing it through is the whole
      // point: "ARTIFACT_BLOCK_INVALID" is actionable, a bare 422 is not.
      throw new ProbeRejection(
        "artifact_contract",
        error instanceof Error ? error.message : undefined,
      );
    }
    if (artifact.site_id !== siteId || artifact.brand_id !== brandId || artifact.publication_id !== publicationId) {
      throw new ProbeRejection("artifact_identity_mismatch");
    }
    const allBlocks = artifact.pages.flatMap((page) => page.blocks);
    const assets = await verifyCandidateMedia(
      artifact.media,
      config.approvedMediaBucket,
    );
    const data = {
      http_ok: true,
      digest_ok: true,
      renderer_ok: artifact.renderer_key === "restaurant-website-v1",
      schema_ok: artifact.schema_version === 1,
      canonical_ok: artifact.site_settings.seo?.canonical_url === "https://gogi.sites.usemingla.com",
      assets_ok: assets.ok,
      accessibility_ok: allBlocks.some((block) => block.type === "hero" && typeof block.heading === "string"),
      consent_ok: true,
      cta_ok: areCandidateLinksSafe(allBlocks),
      leak_check_ok: !/(payload|supabase|vercel|database_url|secret_access_key)/i.test(serialized),
      observed_digest: digest,
      status_code: 200,
    };
    const failed = Object.entries(data)
      .filter(([field, result]) => field.endsWith("_ok") && result !== true)
      .map(([field]) => field);
    if (failed.length > 0) {
      throw new ProbeRejection(
        failed.join(","),
        assets.ok ? undefined : `${assets.reason}:${assets.object_key}`,
      );
    }
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    /*
     * Still a 422 and still fail-closed — only the body changes. Every caller
     * that treated this as pass/fail keeps working; anyone debugging a refused
     * publish now gets the name of the gate that refused it.
     */
    const rejection = error instanceof ProbeRejection
      ? { failed_check: error.check, ...(error.detail ? { detail: error.detail } : {}) }
      : { failed_check: "unexpected_error" };
    return NextResponse.json(
      { ok: false, ...rejection },
      { status: 422, headers: { "cache-control": "no-store" } },
    );
  }
}
