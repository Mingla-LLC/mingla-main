/*
 * #2830 — offering covers and map squares in a private preview: the same key
 * rule as /media (see mediaPreview.issue2830.test.ts), on a site with no
 * publication. Without a key each route still answers from the publication.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { headers, loadPublication, previewArtifactForAsset, siteOfferings, pathForToken } = vi.hoisted(() => ({
  headers: vi.fn(),
  loadPublication: vi.fn(),
  previewArtifactForAsset: vi.fn(),
  siteOfferings: vi.fn(),
  pathForToken: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers }));
vi.mock("../../lib/publication", () => ({ loadPublication, requestHost: () => "brand-a.sites.usemingla.com" }));
vi.mock("../../lib/previewMedia", async (original) => ({ ...(await original<typeof import("../../lib/previewMedia")>()), previewArtifactForAsset }));
vi.mock("../../lib/offeringsFeed", () => ({ siteOfferings }));
vi.mock("../../lib/offeringMedia", async (original) => ({ ...(await original<typeof import("../../lib/offeringMedia")>()), pathForToken }));
vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ coreBaseUrl: "https://core.example", approvedMediaBucket: "media" }) }));

import { GET as om } from "../om/[token]/[variant]/route";
import { GET as map } from "../map/[z]/[x]/[y]/route";
import { planStaticMap } from "../../lib/staticMap";

const SITE = "aaaaaaaa-1111-4111-8111-111111111111";
const TOKEN = "A".repeat(43);
const KEY = encodeURIComponent(`publications/${SITE}/preview-${"c".repeat(32)}/${"d".repeat(64)}.json`);
const draft = { site_id: SITE, artifact_schema_version: 2, renderer_key: "sites-v2", offering_media: [], pages: [{ blocks: [{ type: "map_embed", latitude: 6.5, longitude: 3.4 }] }] };
const tile = planStaticMap(6.5, 3.4)!.tiles[0]!;

const getOm = (query = "") => om(new Request(`https://brand-a.sites.usemingla.com/om/${TOKEN}/original${query}`), { params: Promise.resolve({ token: TOKEN, variant: "original" }) });
const getMap = (query = "") => map(new Request(`https://brand-a.sites.usemingla.com${tile.path}${query}`), { params: Promise.resolve({ z: String(tile.z), x: String(tile.x), y: String(tile.y) }) });

beforeEach(() => {
  vi.clearAllMocks();
  headers.mockResolvedValue(new Headers());
  loadPublication.mockRejectedValue(new Error("NOT_FOUND"));
  previewArtifactForAsset.mockRejectedValue(new Error("NOT_FOUND"));
  siteOfferings.mockResolvedValue({ source: "live", offerings: [{ cover: { path: "event_covers/a.jpg" } }] });
  pathForToken.mockResolvedValue("event_covers/a.jpg");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png", "content-length": "3" } })));
});

describe("#2830 /om in a preview", () => {
  it("a valid key serves the cover on an unpublished site, privately", async () => {
    previewArtifactForAsset.mockResolvedValue(draft);
    const response = await getOm(`?k=${KEY}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(siteOfferings).toHaveBeenCalledWith({ site_id: SITE }, draft);
    expect(loadPublication).not.toHaveBeenCalled();
  });

  it("a refused key is a 404 and never falls back; no key on an unpublished site is a 404", async () => {
    loadPublication.mockResolvedValue({ artifact: draft, resolution: { site_id: SITE } });
    expect((await getOm("?k=nonsense")).status).toBe(404);
    expect(loadPublication).not.toHaveBeenCalled();
    loadPublication.mockRejectedValue(new Error("NOT_FOUND"));
    expect((await getOm()).status).toBe(404);
  });

  it("a published cover keeps its immutable headers", async () => {
    loadPublication.mockResolvedValue({ artifact: draft, resolution: { site_id: SITE } });
    const response = await getOm();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(previewArtifactForAsset).not.toHaveBeenCalled();
  });
});

describe("#2830 /map in a preview", () => {
  it("a valid key serves the draft's own square on an unpublished site, privately", async () => {
    previewArtifactForAsset.mockResolvedValue(draft);
    const response = await getMap(`?k=${KEY}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("a square the draft doesn't draw, a refused key and no key are all 404", async () => {
    previewArtifactForAsset.mockResolvedValue({ ...draft, pages: [{ blocks: [] }] });
    expect((await getMap(`?k=${KEY}`)).status).toBe(404);
    previewArtifactForAsset.mockRejectedValue(new Error("NOT_FOUND"));
    expect((await getMap("?k=nonsense")).status).toBe(404);
    expect((await getMap()).status).toBe(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("a published square keeps its immutable headers", async () => {
    loadPublication.mockResolvedValue({ artifact: draft });
    const response = await getMap();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});
