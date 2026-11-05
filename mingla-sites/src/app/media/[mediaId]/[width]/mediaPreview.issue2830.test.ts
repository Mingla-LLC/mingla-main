/*
 * #2830 — the media route inside a private preview. `?k=` is the capability:
 * the REAL key parser and preview loader run here (only storage, Core and the
 * contract's validation of an invented artifact are stubbed), so another site's
 * key, a real publication's key, a tampered record and a bad key are all
 * refused for the reason they would be in production.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { headers, loadPublication, resolveHostSite, readPrivateObject, readPrivateObjectRange } = vi.hoisted(() => ({
  headers: vi.fn(),
  loadPublication: vi.fn(),
  resolveHostSite: vi.fn(),
  readPrivateObject: vi.fn(),
  readPrivateObjectRange: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers }));
vi.mock("../../../../lib/publication", () => ({ loadPublication, resolveHostSite, requestHost: () => "brand-a.sites.usemingla.com" }));
vi.mock("../../../../lib/storageReader", () => ({ readPrivateObject, readPrivateObjectRange }));
vi.mock("../../../../lib/config", () => ({ runtimeConfig: () => ({ approvedMediaBucket: "media", artifactBucket: "artifacts", videoCdnHosts: [] }) }));
vi.mock("../../../../lib/siteArtifact", async (original) => ({
  ...(await original<typeof import("../../../../lib/siteArtifact")>()),
  declaredSchema: () => 2,
  assertSiteArtifact: () => undefined,
}));

import { clearPreviewAssetCache } from "../../../../lib/previewMedia";
import { GET, HEAD } from "./route";

const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SITE_B = "bbbbbbbb-2222-4222-8222-222222222222";
const PREVIEW_ID = `preview-${"c".repeat(32)}`;
const MEDIA = "11111111-2222-4333-8444-555555555555";
const VIDEO = "22222222-3333-4444-8555-666666666666";
const PICTURE = new Uint8Array([1, 2, 3, 4]);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const CLIP = new Uint8Array(16).fill(7);

const reference = (site = SITE_A) => ({
  id: MEDIA,
  url: `/media/${MEDIA}/1440.webp`,
  alt: "",
  width: 1440,
  height: 960,
  integrity: sha(PICTURE),
  object_key: `approved/${site}/${MEDIA}/${sha(PICTURE)}/1440.webp`,
  variants: [{ name: "w1600", url: `/media/${MEDIA}/w1600.webp`, width: 1600, height: 1000, integrity: sha(PICTURE), object_key: `approved/${site}/${MEDIA}/${sha(PICTURE)}/w1600.webp` }],
});
const video = {
  id: VIDEO, url: `/media/${VIDEO}/video.mp4`, alt: "", width: 0, height: 0, integrity: sha(CLIP),
  object_key: `approved/${SITE_A}/${VIDEO}/${sha(CLIP)}/master.mp4`, bytes: CLIP.length, chunk_size: 1024 * 1024, chunk_digests: [sha(CLIP)],
};

function storedPreview(media: unknown[], site = SITE_A) {
  const bytes = new TextEncoder().encode(JSON.stringify({ site_id: site, publication_id: PREVIEW_ID, media }));
  const key = `publications/${site}/${PREVIEW_ID}/${sha(bytes)}.json`;
  return { bytes, key };
}

function stubStorage(artifact: { bytes: Uint8Array; key: string }) {
  readPrivateObject.mockImplementation(async (bucket: string, key: string) => {
    if (bucket === "artifacts") return key === artifact.key ? new Response(artifact.bytes as BodyInit) : new Response(null, { status: 404 });
    return new Response(PICTURE as BodyInit);
  });
}

const call = (handler: typeof GET, mediaId: string, width: string, query = "", init?: RequestInit) =>
  handler(new Request(`https://brand-a.sites.usemingla.com/media/${mediaId}/${width}${query}`, init), { params: Promise.resolve({ mediaId, width }) });
const withKey = (key: string) => `?k=${encodeURIComponent(key)}`;

beforeEach(() => {
  vi.clearAllMocks();
  clearPreviewAssetCache();
  headers.mockResolvedValue(new Headers());
  // A site with a draft and no publication: the case this fixes.
  loadPublication.mockRejectedValue(new Error("NOT_FOUND"));
  resolveHostSite.mockResolvedValue({ site_id: SITE_A, brand_id: "b", hostname: "brand-a.sites.usemingla.com" });
});

describe("#2830 /media with a preview key", () => {
  it("serves a draft's picture on a site with no publication, privately", async () => {
    const artifact = storedPreview([reference()]);
    stubStorage(artifact);
    const response = await call(GET, MEDIA, "1440.webp", withKey(artifact.key));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PICTURE);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(loadPublication).not.toHaveBeenCalled();
  });

  it("serves a responsive variant from its own record, and HEAD agrees", async () => {
    const artifact = storedPreview([reference()]);
    stubStorage(artifact);
    expect((await call(GET, MEDIA, "w1600.webp", withKey(artifact.key))).status).toBe(200);
    const head = await call(HEAD, MEDIA, "w1600.webp", withKey(artifact.key));
    expect(head.status).toBe(200);
    expect(head.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers video ranges, and no video response is cacheable", async () => {
    const artifact = storedPreview([video]);
    stubStorage(artifact);
    readPrivateObjectRange.mockResolvedValue(CLIP);
    const ranged = await call(GET, VIDEO, "video.mp4", withKey(artifact.key), { headers: { range: "bytes=0-3" } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("cache-control")).toBe("private, no-store");
    const unchanged = await call(GET, VIDEO, "video.mp4", withKey(artifact.key), { headers: { "if-none-match": `"${sha(CLIP)}"` } });
    expect(unchanged.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses another site's key on this host, and reads nothing", async () => {
    const artifact = storedPreview([reference(SITE_B)], SITE_B);
    stubStorage(artifact);
    const response = await call(GET, MEDIA, "1440.webp", withKey(artifact.key));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(readPrivateObject).not.toHaveBeenCalled();
  });

  it("refuses a real publication's artifact key, even with a publication live", async () => {
    const published = `publications/${SITE_A}/${MEDIA}/${"e".repeat(64)}.json`;
    loadPublication.mockResolvedValue({ artifact: { site_id: SITE_A, media: [reference()] } });
    readPrivateObject.mockResolvedValue(new Response(PICTURE as BodyInit));
    expect((await call(GET, MEDIA, "1440.webp", withKey(published))).status).toBe(404);
    expect(resolveHostSite).not.toHaveBeenCalled();
    expect(readPrivateObject).not.toHaveBeenCalled();
  });

  it("a bad or empty key never falls back to the publication", async () => {
    loadPublication.mockResolvedValue({ artifact: { site_id: SITE_A, media: [reference()] } });
    readPrivateObject.mockResolvedValue(new Response(PICTURE as BodyInit));
    for (const query of ["?k=", "?k=nonsense", `?k=${encodeURIComponent(`../${SITE_A}`)}`]) {
      expect((await call(GET, MEDIA, "1440.webp", query)).status, query).toBe(404);
    }
    expect(readPrivateObject).not.toHaveBeenCalled();
  });

  it("refuses bytes that are not the key's digest", async () => {
    const artifact = storedPreview([reference()]);
    stubStorage({ ...artifact, bytes: new TextEncoder().encode("{}") });
    expect((await call(GET, MEDIA, "1440.webp", withKey(artifact.key))).status).toBe(404);
  });

  it("serves only media the draft lists, under this site's own prefix", async () => {
    const unlisted = storedPreview([]);
    stubStorage(unlisted);
    expect((await call(GET, MEDIA, "1440.webp", withKey(unlisted.key))).status).toBe(404);
    const foreign = storedPreview([reference(SITE_B)]);
    stubStorage(foreign);
    expect((await call(GET, MEDIA, "1440.webp", withKey(foreign.key))).status).toBe(404);
  });

  it("re-reads nothing for a page's many files, and never holds a refusal", async () => {
    const artifact = storedPreview([reference()]);
    stubStorage(artifact);
    resolveHostSite.mockRejectedValueOnce(new Error("NOT_FOUND"));
    expect((await call(GET, MEDIA, "1440.webp", withKey(artifact.key))).status).toBe(404);
    expect((await call(GET, MEDIA, "1440.webp", withKey(artifact.key))).status).toBe(200);
    expect((await call(GET, MEDIA, "w1600.webp", withKey(artifact.key))).status).toBe(200);
    expect(resolveHostSite).toHaveBeenCalledTimes(2);
  });
});

describe("#2830 /media without a key is unchanged", () => {
  it("no key on an unpublished site is still a 404", async () => {
    readPrivateObject.mockResolvedValue(new Response(PICTURE as BodyInit));
    const response = await call(GET, MEDIA, "1440.webp");
    expect(response.status).toBe(404);
    expect(readPrivateObject).not.toHaveBeenCalled();
  });

  it("a published site's media keeps its path and its year-long immutable headers", async () => {
    loadPublication.mockResolvedValue({ artifact: { site_id: SITE_A, media: [reference()] } });
    readPrivateObject.mockResolvedValue(new Response(PICTURE as BodyInit));
    const response = await call(GET, MEDIA, "1440.webp");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(resolveHostSite).not.toHaveBeenCalled();
  });

  it("a published video keeps its immutable headers", async () => {
    loadPublication.mockResolvedValue({ artifact: { site_id: SITE_A, media: [video] } });
    readPrivateObjectRange.mockResolvedValue(CLIP);
    const response = await call(GET, VIDEO, "video.mp4", "", { headers: { range: "bytes=0-3" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});
