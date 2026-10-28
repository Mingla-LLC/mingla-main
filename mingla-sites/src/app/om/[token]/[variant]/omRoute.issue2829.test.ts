/*
 * #2829 AD-6 / S-4 (T-W4) — `/om/<token>/<variant>` serves an offering cover
 * only when the token was minted for THIS host's site and a cover in its own
 * feed. A forged token, another site's token, a variant outside the list, an
 * upstream redirect or a non-image answer is a 404. The upstream origin is
 * the configured Core storage origin, never anything from the request.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { headers, loadPublication, requestHost, siteOfferings } = vi.hoisted(() => ({
  headers: vi.fn(),
  loadPublication: vi.fn(),
  requestHost: vi.fn(),
  siteOfferings: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers }));
vi.mock("../../../../lib/publication", () => ({ loadPublication, requestHost }));
vi.mock("../../../../lib/offeringsFeed", () => ({ siteOfferings }));
vi.mock("../../../../lib/config", () => ({
  runtimeConfig: () => ({ coreBaseUrl: "https://core.example.supabase.co", runtimeHmac: Buffer.alloc(32, 7).toString("base64") }),
}));

import { GET } from "./route";
import { offeringMediaToken } from "../../../../lib/offeringMedia";

const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SITE_B = "bbbbbbbb-2222-4222-8222-222222222222";
const PATH = "event_covers/brand-a/bali.jpg";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const fetchMock = vi.fn();

const get = (token: string, variant = "original") =>
  GET(new Request(`https://a.sites.usemingla.com/om/${token}/${variant}`), { params: Promise.resolve({ token, variant }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  headers.mockResolvedValue(new Headers());
  requestHost.mockReturnValue("a.sites.usemingla.com");
  loadPublication.mockResolvedValue({
    artifact: { artifact_schema_version: 2, renderer_key: "sites-v2", site_id: SITE_A, offerings_snapshot: [] },
    resolution: { site_id: SITE_A },
  });
  siteOfferings.mockResolvedValue({ source: "live", offerings: [{ cover: { path: PATH, type: "image" } }, { cover: null }] });
  fetchMock.mockResolvedValue(new Response(PNG, { headers: { "content-type": "image/png", "content-length": String(PNG.length) } }));
});

describe("#2829 /om", () => {
  it("serves this site's own cover, immutable, from the Core storage origin only", async () => {
    const response = await get(await offeringMediaToken(SITE_A, PATH));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://core.example.supabase.co/storage/v1/object/public/event_covers/brand-a/bali.jpg",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("serves the stored thumbnail for the thumb variant", async () => {
    await get(await offeringMediaToken(SITE_A, PATH), "thumb");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://core.example.supabase.co/storage/v1/object/public/event_covers/brand-a/bali_thumb.jpg");
  });

  it("404s a forged token, another site's token, and an unknown variant — without touching storage", async () => {
    for (const response of [
      await get("A".repeat(43)),
      await get(await offeringMediaToken(SITE_B, PATH)),
      await get(await offeringMediaToken(SITE_A, "event_covers/brand-b/other.jpg")),
      await get(await offeringMediaToken(SITE_A, PATH), "w1440"),
      await get("not-a-token"),
    ]) {
      expect(response.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an upstream redirect or a non-image answer", async () => {
    const token = await offeringMediaToken(SITE_A, PATH);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://evil.example.com/x.png" } }));
    expect((await get(token)).status).toBe(404);
    fetchMock.mockResolvedValueOnce(new Response("<html>", { headers: { "content-type": "text/html" } }));
    expect((await get(token)).status).toBe(404);
  });

  it("404s on a v1 site (no feed there)", async () => {
    loadPublication.mockResolvedValue({ artifact: { artifact_schema_version: 1, site_id: SITE_A }, resolution: { site_id: SITE_A } });
    expect((await get(await offeringMediaToken(SITE_A, PATH))).status).toBe(404);
  });
});
