/*
 * #4453 milestone 11 — a share link's own media (`?s=<share token>`).
 *
 * The REAL share loader, preview loader, share view and media route run here;
 * only Core's share lookup, storage and the contract's validation of an
 * invented artifact are stubbed. A share link's media answer from that share's
 * view only: a picture only a hidden or Draft-by-Ari page names, another
 * artifact's picture, another site's link, an expired or revoked link, and the
 * preview key passed as `s` are all refused.
 *
 * MINGLA-INVARIANT: I-SITES-SHARE-MEDIA-SCOPED | issue #4453 | a share link's asset credential is its own token (`?s=`), checked against Core and the link's expiry on every lookup, and serves only media its share view names.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ site: "", key: "", expiresAt: null as string | null, live: true }));
const { headers, loadPublication, resolveHostSite, readPrivateObject, readPrivateObjectRange, host } = vi.hoisted(() => ({
  headers: vi.fn(),
  loadPublication: vi.fn(),
  resolveHostSite: vi.fn(),
  readPrivateObject: vi.fn(),
  readPrivateObjectRange: vi.fn(),
  host: { value: "brand-a.sites.usemingla.com" },
}));

vi.mock("next/headers", () => ({ headers }));
vi.mock("../../../../lib/publication", () => ({ loadPublication, resolveHostSite, requestHost: () => host.value }));
vi.mock("../../../../lib/storageReader", () => ({ readPrivateObject, readPrivateObjectRange }));
vi.mock("../../../../lib/config", () => ({ runtimeConfig: () => ({ approvedMediaBucket: "media", artifactBucket: "artifacts", videoCdnHosts: [] }) }));
vi.mock("../../../../lib/coreGateway", () => ({
  signedCorePost: async ({ body }: { body: { site_id: string; token: string } }) => {
    if (!core.live || body.token !== TOKEN || body.site_id !== core.site) return new Response(null, { status: 404 });
    return Response.json({ ok: true, data: { site_id: body.site_id, artifact_key: core.key, expires_at: core.expiresAt } });
  },
}));
vi.mock("../../../../lib/siteArtifact", async (original) => ({
  ...(await original<typeof import("../../../../lib/siteArtifact")>()),
  declaredSchema: () => 2,
  assertSiteArtifact: () => undefined,
}));

import { clearPreviewAssetCache, clearSharedAssetCache, sharedArtifactForAsset } from "../../../../lib/previewMedia";
import { GET } from "./route";

const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SITE_B = "bbbbbbbb-2222-4222-8222-222222222222";
const PREVIEW_ID = `preview-${"c".repeat(32)}`;
const TOKEN = "S".repeat(20) + "_-" + "h".repeat(21);
const SHOWN = "11111111-2222-4333-8444-555555555555";
const DRAFT_ONLY = "22222222-3333-4444-8555-666666666666";
const HIDDEN_ONLY = "33333333-4444-4555-8666-777777777777";
const FOREIGN = "44444444-5555-4666-8777-888888888888";
const PICTURE = new Uint8Array([1, 2, 3, 4]);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const picture = (id: string, site = SITE_A) => ({
  id, url: `/media/${id}/1440.webp`, alt: "", width: 1440, height: 960,
  integrity: sha(PICTURE), object_key: `approved/${site}/${id}/${sha(PICTURE)}/1440.webp`,
});
const page = (path: string, image: string, extra: Record<string, unknown> = {}) => ({
  key: path || "home", path, title: path || "Home", enabled: true, blocks: [{ type: "gallery", images: [{ id: image, url: `/media/${image}/1440.webp`, alt: "" }] }], ...extra,
});

/** A stored preview: a visible page, a Draft page from Ari and a disabled page, each with its own picture. */
function storedPreview(site = SITE_A, mediaSite = site) {
  const artifact = {
    site_id: site, publication_id: PREVIEW_ID, artifact_schema_version: 2, renderer_key: "sites-v2",
    media: [picture(SHOWN, mediaSite), picture(DRAFT_ONLY, mediaSite), picture(HIDDEN_ONLY, mediaSite)],
    pages: [page("", SHOWN), page("private-hire", DRAFT_ONLY, { enabled: false, draft_by_ari: true }), page("secret", HIDDEN_ONLY, { enabled: false })],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(artifact));
  return { bytes, key: `publications/${site}/${PREVIEW_ID}/${sha(bytes)}.json` };
}

function serve(stored: { bytes: Uint8Array; key: string }, site = SITE_A) {
  core.site = site;
  core.key = stored.key;
  readPrivateObject.mockImplementation(async (bucket: string, key: string) => {
    if (bucket === "artifacts") return key === stored.key ? new Response(stored.bytes as BodyInit) : new Response(null, { status: 404 });
    return new Response(PICTURE as BodyInit);
  });
}

const get = (mediaId: string, query: string) =>
  GET(new Request(`https://${host.value}/media/${mediaId}/1440.webp${query}`), { params: Promise.resolve({ mediaId, width: "1440.webp" }) });
const shareQuery = `?s=${TOKEN}`;

beforeEach(() => {
  vi.clearAllMocks();
  clearPreviewAssetCache();
  clearSharedAssetCache();
  host.value = "brand-a.sites.usemingla.com";
  core.expiresAt = null;
  core.live = true;
  headers.mockResolvedValue(new Headers());
  loadPublication.mockRejectedValue(new Error("NOT_FOUND"));
  resolveHostSite.mockImplementation(async (name: string) => ({
    site_id: name.startsWith("brand-b") ? SITE_B : SITE_A, brand_id: "b", hostname: name,
  }));
});

describe("#4453 M11 /media with a share token", () => {
  it("serves a picture the share view shows, privately, without the preview key", async () => {
    serve(storedPreview());
    const response = await get(SHOWN, shareQuery);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(loadPublication).not.toHaveBeenCalled();
  });

  it("refuses a picture only a Draft page from Ari or a hidden page names", async () => {
    serve(storedPreview());
    expect((await get(DRAFT_ONLY, shareQuery)).status).toBe(404);
    expect((await get(HIDDEN_ONLY, shareQuery)).status).toBe(404);
  });

  it("refuses another artifact's picture, and a record stored under another site", async () => {
    serve(storedPreview());
    expect((await get(FOREIGN, shareQuery)).status).toBe(404);
    clearSharedAssetCache();
    serve(storedPreview(SITE_A, SITE_B));
    expect((await get(SHOWN, shareQuery)).status).toBe(404);
  });

  it("refuses the link on another brand's address, and a Core answer naming another site's preview", async () => {
    serve(storedPreview());
    host.value = "brand-b.sites.usemingla.com";
    expect((await get(SHOWN, shareQuery)).status).toBe(404);
    host.value = "brand-a.sites.usemingla.com";
    clearSharedAssetCache();
    const other = storedPreview(SITE_B);
    serve(other);
    core.site = SITE_A; // Core answers for site A with site B's key
    expect((await get(SHOWN, shareQuery)).status).toBe(404);
  });

  it("an expired link's media die: refused when Core reports it expired, and once a held answer passes its expiry", async () => {
    const stored = storedPreview();
    serve(stored);
    core.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect((await get(SHOWN, shareQuery)).status).toBe(404);
    clearSharedAssetCache();
    const now = Date.parse("2026-11-17T10:00:00Z");
    core.expiresAt = new Date(now + 5_000).toISOString();
    await expect(sharedArtifactForAsset(TOKEN, host.value, now)).resolves.toMatchObject({ site_id: SITE_A });
    // Still inside the 30 s hold, but past the link's own expiry.
    await expect(sharedArtifactForAsset(TOKEN, host.value, now + 6_000)).rejects.toThrow("NOT_FOUND");
  });

  it("a revoked link (Core answers nothing) is refused", async () => {
    serve(storedPreview());
    core.live = false;
    expect((await get(SHOWN, shareQuery)).status).toBe(404);
  });

  it("the preview key never works as `s`, and the share token never works as `k`", async () => {
    const stored = storedPreview();
    serve(stored);
    expect((await get(SHOWN, `?s=${encodeURIComponent(stored.key)}`)).status).toBe(404);
    expect((await get(SHOWN, `?k=${TOKEN}`)).status).toBe(404);
  });
});
