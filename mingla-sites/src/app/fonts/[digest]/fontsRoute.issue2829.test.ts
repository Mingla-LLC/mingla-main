/*
 * #2829 AD-3 / S-1 (T-W3, SC-3 font half) — the /fonts/<digest> route serves
 * a font file only when the artifact the REQUEST HOST serves lists it, proves
 * the bytes match the digest, and never serves another site's font, a v1
 * site's, or anything unlisted. Previews are bound to their own host too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const { headers, loadPublication, requestHost, resolveHostSite, readPrivateObject, loadPreviewArtifact } = vi.hoisted(() => ({
  headers: vi.fn(),
  loadPublication: vi.fn(),
  requestHost: vi.fn(),
  resolveHostSite: vi.fn(),
  readPrivateObject: vi.fn(),
  loadPreviewArtifact: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers }));
vi.mock("../../../lib/publication", () => ({ loadPublication, requestHost, resolveHostSite }));
vi.mock("../../../lib/storageReader", () => ({ readPrivateObject }));
vi.mock("../../../lib/config", () => ({ runtimeConfig: () => ({ approvedMediaBucket: "sites-media-approved" }) }));
vi.mock("../../../lib/previewArtifact", async (original) => ({
  ...(await original<typeof import("../../../lib/previewArtifact")>()),
  loadPreviewArtifact,
}));

import { GET } from "./route";

const FONT = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]);
const DIGEST = createHash("sha256").update(FONT).digest("hex");
const OTHER = "f".repeat(64);
const v2 = (digests: string[]) => ({
  artifact_schema_version: 2,
  renderer_key: "sites-v2",
  font_assets: digests.map((digest) => ({ family: "Fraunces", weight: 400, style: "normal", unicode_range: "", digest, bytes: 8 })),
});

const get = (digest: string, query = "") =>
  GET(new Request(`https://brand-a.sites.usemingla.com/fonts/${digest}${query}`), { params: Promise.resolve({ digest }) });

beforeEach(() => {
  vi.clearAllMocks();
  headers.mockResolvedValue(new Headers({ host: "brand-a.sites.usemingla.com" }));
  requestHost.mockReturnValue("brand-a.sites.usemingla.com");
  readPrivateObject.mockResolvedValue(new Response(FONT));
});

describe("#2829 /fonts/<digest>", () => {
  it("serves a listed font, re-hashed, immutable, from the site itself", async () => {
    loadPublication.mockResolvedValue({ artifact: v2([DIGEST]) });
    const response = await get(DIGEST);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/woff2");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(FONT);
    expect(readPrivateObject).toHaveBeenCalledWith("sites-media-approved", `fonts/${DIGEST}.woff2`, "force-cache");
  });

  it("404s a digest this host's artifact does not list (another brand's font)", async () => {
    loadPublication.mockResolvedValue({ artifact: v2([OTHER]) });
    expect((await get(DIGEST)).status).toBe(404);
    expect(readPrivateObject).not.toHaveBeenCalled();
  });

  it("404s on a v1 site, a malformed digest, an unknown host and tampered bytes", async () => {
    loadPublication.mockResolvedValue({ artifact: { schema_version: 1, renderer_key: "restaurant-website-v1" } });
    expect((await get(DIGEST)).status).toBe(404);
    expect((await get("../../etc/passwd")).status).toBe(404);
    loadPublication.mockRejectedValue(new Error("NOT_FOUND"));
    expect((await get(DIGEST)).status).toBe(404);
    loadPublication.mockResolvedValue({ artifact: v2([DIGEST]) });
    readPrivateObject.mockResolvedValue(new Response(new Uint8Array([9, 9, 9])));
    expect((await get(DIGEST)).status).toBe(404);
  });

  it("a preview's font loads only through that preview on its own host, never cached publicly", async () => {
    const key = `publications/${"a".repeat(8)}-aaaa-4aaa-8aaa-${"a".repeat(12)}/preview-${"c".repeat(32)}/${"d".repeat(64)}.json`;
    resolveHostSite.mockResolvedValue({ site_id: "x" });
    loadPreviewArtifact.mockResolvedValue(v2([DIGEST]));
    const response = await get(DIGEST, `?k=${encodeURIComponent(key)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(loadPublication).not.toHaveBeenCalled();
    expect((await get(DIGEST, "?k=not-a-key")).status).toBe(404);
    loadPreviewArtifact.mockRejectedValue(new Error("NOT_FOUND"));
    expect((await get(DIGEST, `?k=${encodeURIComponent(key)}`)).status).toBe(404);
  });
});
