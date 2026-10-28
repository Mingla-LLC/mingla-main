// MINGLA-INVARIANT: I-PROPOSED-2829-10 | issue #2829 | Video served by the Sites runtime answers byte ranges with per-chunk integrity verification; a chunk that fails its digest is never sent.
/*
 * #2829 W6 R-11 — the media route answers Range for a file video: 206 with
 * Content-Range / Accept-Ranges / ETag / Content-Length, HEAD, 416, an
 * open-ended range capped at 8 MiB, multi-range by size, and a tampered chunk
 * refused with 502 and no bytes. Storage is an in-memory object honouring
 * Range like Supabase Storage does. Images keep the whole-object check.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { headers, loadPublication, requestHost, readPrivateObject } = vi.hoisted(() => ({
  headers: vi.fn(),
  loadPublication: vi.fn(),
  requestHost: vi.fn(),
  readPrivateObject: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers }));
vi.mock("../../../../lib/publication", () => ({ loadPublication, requestHost }));
vi.mock("../../../../lib/config", () => ({ runtimeConfig: () => ({ approvedMediaBucket: "sites-media-approved" }) }));
vi.mock("../../../../lib/storageReader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/storageReader")>();
  return {
    ...actual,
    readPrivateObject,
    readPrivateObjectRange: (bucket: string, key: string, range: { start: number; end: number }) =>
      actual.readPrivateObjectRange(bucket, key, range, readPrivateObject),
  };
});

import { GET, HEAD } from "./route";

const MiB = 1024 * 1024;
const SITE = "aaaaaaaa-1111-4111-8111-111111111111";
const VIDEO_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const IMAGE_ID = "cccccccc-3333-4333-8333-333333333333";
const SIZE = 9 * MiB + 4321;

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let stored: Uint8Array;
const film = new Uint8Array(SIZE).map((_, index) => (index * 7 + (index >> 16)) & 0xff);
const digests = Array.from({ length: Math.ceil(SIZE / MiB) }, (_, index) => sha(film.subarray(index * MiB, Math.min((index + 1) * MiB, SIZE))));
const INTEGRITY = sha(film);
const VIDEO_KEY = `approved/${SITE}/${VIDEO_ID}/${INTEGRITY}/master.mp4`;
const image = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
const IMAGE_KEY = `approved/${SITE}/${IMAGE_ID}/${sha(image)}/1440.webp`;

/** Supabase Storage honours `Range: bytes=a-b` with 206 + Content-Range. */
function storageResponse(key: string, range?: { start: number; end: number }): Response {
  const object = key === VIDEO_KEY ? stored : key === IMAGE_KEY ? image : null;
  if (!object) return new Response(null, { status: 404 });
  if (!range) return new Response(Buffer.from(object), { status: 200 });
  const end = Math.min(range.end, object.byteLength - 1);
  return new Response(Buffer.from(object.subarray(range.start, end + 1)), {
    status: 206,
    headers: { "content-range": `bytes ${range.start}-${end}/${object.byteLength}` },
  });
}

const call = (method: "GET" | "HEAD", id: string, file: string, requestHeaders: Record<string, string> = {}) => {
  const request = new Request(`https://a.sites.usemingla.com/media/${id}/${file}`, { method, headers: requestHeaders });
  const context = { params: Promise.resolve({ mediaId: id, width: file }) };
  return method === "GET" ? GET(request, context) : HEAD(request, context);
};
const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());

beforeEach(() => {
  vi.clearAllMocks();
  stored = film.slice();
  headers.mockResolvedValue(new Headers());
  requestHost.mockReturnValue("a.sites.usemingla.com");
  loadPublication.mockResolvedValue({
    artifact: {
      site_id: SITE,
      media: [
        {
          id: VIDEO_ID, url: `/media/${VIDEO_ID}/video.mp4`, alt: "", width: 0, height: 0, integrity: INTEGRITY, object_key: VIDEO_KEY,
          bytes: SIZE, chunk_size: MiB, chunk_digests: digests, duration_ms: 12_000,
        },
        { id: IMAGE_ID, url: `/media/${IMAGE_ID}/1440.webp`, alt: "", width: 1440, height: 960, integrity: sha(image), object_key: IMAGE_KEY },
      ],
    },
  });
  readPrivateObject.mockImplementation(async (_bucket: string, key: string, _cache: string, range?: { start: number; end: number }) =>
    storageResponse(key, range));
});

describe("#2829 file video Range (R-11)", () => {
  it("answers bytes=0-1 with 206 and every range header", async () => {
    const response = await call("GET", VIDEO_ID, "video.mp4", { range: "bytes=0-1" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 0-1/${SIZE}`);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("etag")).toBe(`"${INTEGRITY}"`);
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(Array.from(await bytesOf(response))).toEqual(Array.from(film.subarray(0, 2)));
  });

  it("reads only the covering chunk from storage, never the whole file", async () => {
    await call("GET", VIDEO_ID, "video.mp4", { range: "bytes=5000000-5000099" });
    expect(readPrivateObject).toHaveBeenCalledTimes(1);
    expect(readPrivateObject.mock.calls[0]![3]).toEqual({ start: 4 * MiB, end: 5 * MiB - 1 });
  });

  it("serves middle and last ranges byte-exact", async () => {
    for (const [start, end] of [[MiB - 5, MiB + 5], [SIZE - 100, SIZE - 1]]) {
      const response = await call("GET", VIDEO_ID, "video.mp4", { range: `bytes=${start}-${end}` });
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(`bytes ${start}-${end}/${SIZE}`);
      expect(Buffer.from(await bytesOf(response)).equals(Buffer.from(film.subarray(start!, end! + 1)))).toBe(true);
    }
  });

  it("caps an open-ended range at 8 MiB", async () => {
    const response = await call("GET", VIDEO_ID, "video.mp4", { range: "bytes=100-" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 100-${100 + 8 * MiB - 1}/${SIZE}`);
    expect((await bytesOf(response)).byteLength).toBe(8 * MiB);
  });

  it("is 416 past the end (naming the size), and for several ranges on a file over 8 MiB", async () => {
    for (const range of ["bytes=99999999-", "bytes=0-1,4-5"]) {
      const response = await call("GET", VIDEO_ID, "video.mp4", { range });
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe(`bytes */${SIZE}`);
      expect((await bytesOf(response)).byteLength).toBe(0);
    }
    expect(readPrivateObject).not.toHaveBeenCalled();
  });

  it("HEAD reports length, ranges and ETag without reading storage", async () => {
    const whole = await call("HEAD", VIDEO_ID, "video.mp4");
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-length")).toBe(String(SIZE));
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("etag")).toBe(`"${INTEGRITY}"`);
    const part = await call("HEAD", VIDEO_ID, "video.mp4", { range: "bytes=10-19" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 10-19/${SIZE}`);
    expect(readPrivateObject).not.toHaveBeenCalled();
  });

  it("refuses a tampered chunk with 502 and no bytes; other chunks still serve", async () => {
    stored[2 * MiB + 77] ^= 0xff;
    const bad = await call("GET", VIDEO_ID, "video.mp4", { range: `bytes=${2 * MiB}-${2 * MiB + 99}` });
    expect(bad.status).toBe(502);
    expect((await bytesOf(bad)).byteLength).toBe(0);
    expect(bad.headers.get("cache-control")).toBe("no-store");
    const good = await call("GET", VIDEO_ID, "video.mp4", { range: "bytes=0-99" });
    expect(good.status).toBe(206);
  });

  it("a whole-file GET streams every byte verified; a bad first chunk is 502", async () => {
    const response = await call("GET", VIDEO_ID, "video.mp4");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(SIZE));
    expect(Buffer.from(await bytesOf(response)).equals(Buffer.from(film))).toBe(true);
    stored[3] ^= 1;
    expect((await call("GET", VIDEO_ID, "video.mp4")).status).toBe(502);
  });

  it("If-None-Match on the current version is 304", async () => {
    const response = await call("GET", VIDEO_ID, "video.mp4", { "if-none-match": `"${INTEGRITY}"` });
    expect(response.status).toBe(304);
  });

  it("leaves images on the whole-object check (and 404s a tampered image)", async () => {
    const ok = await call("GET", IMAGE_ID, "1440.webp");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("accept-ranges")).toBeNull();
    image[0] = 0;
    expect((await call("GET", IMAGE_ID, "1440.webp")).status).toBe(404);
  });

  it("404s a media id this host's publication does not carry", async () => {
    expect((await call("GET", "dddddddd-4444-4444-8444-444444444444", "video.mp4", { range: "bytes=0-1" })).status).toBe(404);
  });
});
