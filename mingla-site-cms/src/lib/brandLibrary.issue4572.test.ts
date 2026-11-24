/*
 * #4572 item 3 (D3) — the brand's logo, cover still and event flyers come into
 * the website library once. Core's list is checked whole (one bad ref refuses
 * the envelope); a still is read only from an allowed https stream host with
 * no redirects and at most 15 MB; a non-image is skipped; a picture already
 * there (same checksum) is reused.
 * FAILS-ON-REVERT: without parseLibrarySources / importBrandLibrary the compose
 * envelope ignores library_sources and nothing is imported.
 */
import { describe, expect, it, vi } from "vitest";

const completeUpload = vi.fn(async () => ({ id: "new-media", state: "READY" }));
vi.mock("./mediaPipeline", () => ({ completeUpload, createUploadGrant: vi.fn(async () => ({ media_id: "new-media" })) }));
vi.mock("./objectStore", () => ({ writeObject: vi.fn(async () => undefined) }));
vi.mock("./config", () => ({ cmsConfig: () => ({ quarantineBucket: "q" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: vi.fn() }));

const { importBrandLibrary, libraryHeroPicture, parseLibrarySources, streamStillFetcher, videoCdnHosts } = await import("./brandLibrary");
const VIDEO = "0f5f3a0e-2b9c-4c1e-9d55-7a3f2c1b0e9d";
const still = { host: "vz-abc123.b-cdn.net", video_id: VIDEO, file: "thumbnail.jpg" };
const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), contentType: "image/jpeg" };

function scoped(existing: Record<string, unknown>[] = []) {
  return { payload: { find: vi.fn(async () => ({ docs: existing })), findByID: vi.fn(async () => ({ quarantine_key: "quarantine/x" })) } } as never;
}

describe("#4572 D3 — brand pictures into the library", () => {
  it("parses Core's list, and refuses the whole envelope on one bad ref", () => {
    const good = [
      { kind: "brand_logo", label: "Logo - Kolanut", path: "brand_avatars/b/logo.png" },
      { kind: "brand_cover", label: "Cover - Kolanut", stream_poster: still },
      { kind: "event_flyer", label: "Flyer - Inhabited Forms", path: "event_covers/e/f.jpg" },
    ];
    expect(parseLibrarySources(good)).toHaveLength(3);
    expect(parseLibrarySources(undefined)).toEqual([]);
    for (const bad of [
      [{ kind: "brand_logo", label: "x", path: "brand_avatars/../secret" }],
      [{ kind: "brand_logo", label: "x", path: "private_bucket/a.jpg" }],
      [{ kind: "brand_logo", label: "x", path: "brand_avatars/a.jpg", stream_poster: still }],
      [{ kind: "other", label: "x", path: "brand_avatars/a.jpg" }],
      [{ kind: "event_flyer", label: "x", stream_poster: { ...still, file: "../x.jpg" } }],
      Array.from({ length: 14 }, () => good[0]),
    ]) expect(parseLibrarySources(bad)).toBeNull();
  });

  it("imports each source once, in order, and picks the cover still for the hero", async () => {
    const fetchCover = vi.fn(async () => jpeg);
    const fetchStill = vi.fn(async () => jpeg);
    completeUpload.mockResolvedValueOnce({ id: "logo-m", state: "READY" }).mockResolvedValueOnce({ id: "cover-m", state: "READY" });
    const items = await importBrandLibrary(scoped(), "t1", parseLibrarySources([
      { kind: "brand_logo", label: "Logo - Kolanut", path: "brand_avatars/b/logo.png" },
      { kind: "brand_cover", label: "Cover - Kolanut", stream_poster: still },
    ])!, { fetchCover, fetchStill });
    expect(items).toEqual([{ kind: "brand_logo", mediaId: "logo-m" }, { kind: "brand_cover", mediaId: "cover-m" }]);
    expect(libraryHeroPicture(items)).toBe("cover-m");
    expect(libraryHeroPicture([{ kind: "event_flyer", mediaId: "f" }])).toBe("f");
  });

  it("a second run reuses what is there (checksum) and adds nothing", async () => {
    completeUpload.mockClear();
    const items = await importBrandLibrary(scoped([{ id: "already" }]), "t1", [{ kind: "brand_logo", label: "Logo", path: "brand_avatars/b/logo.png" }], { fetchCover: async () => jpeg, fetchStill: async () => null });
    expect(items).toEqual([{ kind: "brand_logo", mediaId: "already" }]);
    expect(completeUpload).not.toHaveBeenCalled();
  });

  it("stills: an off-list host, a redirect, over 15 MB or a non-image are skipped", async () => {
    const ok = streamStillFetcher(["vz-abc123.b-cdn.net"], async () => new Response(jpeg.bytes, { status: 200, headers: { "content-type": "image/jpeg" } }));
    expect(await ok(still)).not.toBeNull();
    expect(await ok({ ...still, host: "vz-evil.b-cdn.net" })).toBeNull();
    const redirect = streamStillFetcher(["vz-abc123.b-cdn.net"], async (_url, init) => {
      expect(init.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "https://evil.example" } });
    });
    expect(await redirect(still)).toBeNull();
    const huge = streamStillFetcher(["vz-abc123.b-cdn.net"], async () => new Response("x", { status: 200, headers: { "content-length": String(16 * 1024 * 1024) } }));
    expect(await huge(still)).toBeNull();
    const items = await importBrandLibrary(scoped(), "t1", [{ kind: "event_flyer", label: "Flyer", stream_poster: still }], { fetchCover: async () => null, fetchStill: async () => ({ bytes: new Uint8Array([1]), contentType: "text/html" }) });
    expect(items).toEqual([]);
    expect(videoCdnHosts("vz-a.b-cdn.net, BAD HOST ,vz-b.b-cdn.net")).toEqual(["vz-a.b-cdn.net", "vz-b.b-cdn.net"]);
  });
});
