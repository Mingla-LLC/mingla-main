/*
 * #2829 W7c (amendment A13.1) — `/om/<token>/c400|c768|w1600` serves the
 * cover's publish-time renditions from THIS site's Sites storage, under the
 * key its publication records for that cover, only when the bytes are the
 * recorded digest. No recorded rendition, another site's key or a digest
 * mismatch is a 404; Mingla's storage is never asked for a rendition.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { headers, loadPublication, requestHost, siteOfferings, readPrivateObject } = vi.hoisted(() => ({
  headers: vi.fn(),
  loadPublication: vi.fn(),
  requestHost: vi.fn(),
  siteOfferings: vi.fn(),
  readPrivateObject: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers }));
vi.mock("../../../../lib/publication", () => ({ loadPublication, requestHost }));
vi.mock("../../../../lib/offeringsFeed", () => ({ siteOfferings }));
vi.mock("../../../../lib/storageReader", () => ({ readPrivateObject }));
vi.mock("../../../../lib/config", () => ({
  runtimeConfig: () => ({ coreBaseUrl: "https://core.example.supabase.co", runtimeHmac: Buffer.alloc(32, 7).toString("base64"), approvedMediaBucket: "sites-media-approved" }),
}));

import { GET } from "./route";
import { offeringCoverSources, offeringMediaToken } from "../../../../lib/offeringMedia";
import { offeringMediaKey, type OfferingCoverMedia } from "../../../../contracts/generated/artifactV2.ts";

const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SITE_B = "bbbbbbbb-2222-4222-8222-222222222222";
const PATH = "event_covers/brand-a/coast.jpg";
const SOURCE = "c".repeat(64);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9]);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fetchMock = vi.fn();

function media(siteId = SITE_A, integrity = digest(WEBP)): OfferingCoverMedia[] {
  return [{
    path: PATH, source_width: 2560, source_height: 1707,
    variants: [
      { name: "c400", width: 400, height: 300, integrity, object_key: offeringMediaKey(siteId, SOURCE, "c400") },
      { name: "c768", width: 768, height: 576, integrity, object_key: offeringMediaKey(siteId, SOURCE, "c768") },
      { name: "w1600", width: 1600, height: 1067, integrity, object_key: offeringMediaKey(siteId, SOURCE, "w1600") },
    ],
  }];
}

function publish(offeringMedia?: OfferingCoverMedia[]) {
  loadPublication.mockResolvedValue({
    artifact: { artifact_schema_version: 2, renderer_key: "sites-v2", site_id: SITE_A, offerings_snapshot: [], ...(offeringMedia ? { offering_media: offeringMedia } : {}) },
    resolution: { site_id: SITE_A },
  });
}

const get = (token: string, variant: string) =>
  GET(new Request(`https://a.sites.usemingla.com/om/${token}/${variant}`), { params: Promise.resolve({ token, variant }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  headers.mockResolvedValue(new Headers());
  requestHost.mockReturnValue("a.sites.usemingla.com");
  siteOfferings.mockResolvedValue({ source: "live", offerings: [{ cover: { path: PATH, type: "image" } }] });
  readPrivateObject.mockImplementation(async () => new Response(WEBP));
  publish(media());
});

describe("#2829 W7c /om renditions", () => {
  it("serves each rendition from Sites storage under its recorded key, verified, immutable", async () => {
    const token = await offeringMediaToken(SITE_A, PATH);
    for (const name of ["c400", "c768", "w1600"] as const) {
      const response = await get(token, name);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(WEBP);
      expect(readPrivateObject).toHaveBeenLastCalledWith("sites-media-approved", offeringMediaKey(SITE_A, SOURCE, name), "force-cache");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s with no recorded rendition, a key for another site, or bytes that are not the digest", async () => {
    const token = await offeringMediaToken(SITE_A, PATH);
    publish(undefined);
    expect((await get(token, "c400")).status).toBe(404);
    publish(media(SITE_B));
    expect((await get(token, "c400")).status).toBe(404);
    publish(media(SITE_A, "0".repeat(64)));
    expect((await get(token, "c400")).status).toBe(404);
    publish(media());
    expect((await get(await offeringMediaToken(SITE_B, PATH), "c400")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("#2829 W7c card picture sources", () => {
  it("offers the renditions as srcset with the 768 crop as src, plus the larger stored cover", async () => {
    const sources = await offeringCoverSources(SITE_A, { cover: { path: PATH, type: "image" } }, media());
    const base = `/om/${await offeringMediaToken(SITE_A, PATH)}`;
    expect(sources).toEqual({
      src: `${base}/c768`,
      srcSet: `${base}/c400 400w, ${base}/c768 768w, ${base}/w1600 1600w, ${base}/original 2560w`,
    });
  });

  it("uses the stored cover alone for a cover with no renditions yet (new since the last publish)", async () => {
    const base = `/om/${await offeringMediaToken(SITE_A, "event_covers/brand-a/new.jpg")}`;
    expect(await offeringCoverSources(SITE_A, { cover: { path: "event_covers/brand-a/new.jpg", type: "image" } }, media()))
      .toEqual({ src: `${base}/original`, srcSet: null });
    expect(await offeringCoverSources(SITE_A, { cover: null }, media())).toBeNull();
  });
});
