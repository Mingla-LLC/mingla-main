/**
 * ISSUE-866 WP3 — adCreativeProbe.ts byte-probe tests (implementor happy-path
 * suite; APPEND-ONLY).
 *
 * A1-6a contract: the probe derives width/height/mime/duration/audio-presence/
 * content-hash from the ACTUAL BYTES — tiny in-repo binary fixtures are built
 * programmatically below (PNG/JPEG/GIF/WebP headers; synthetic ISO-BMFF MP4/MOV
 * with mvhd/tkhd/hdlr/stsd boxes). No file I/O, no network.
 *
 * Run: deno test --allow-env --allow-read --no-check \
 *   supabase/functions/_shared/__tests__/adCreativeProbe.test.ts
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  CreativeProbeError,
  parseBmff,
  parseGif,
  parseJpeg,
  parsePng,
  parseWebp,
  probeCreativeBytes,
  ratioOf,
  sha256Hex,
} from "../adCreativeProbe.ts";

// ── Fixture builders (tiny, deterministic, in-repo) ───────────────────────────

function u16beBytes(v: number): number[] {
  return [(v >> 8) & 0xff, v & 0xff];
}
function u32beBytes(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}
function asciiBytes(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

export function makePng(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
    ...u32beBytes(13), ...asciiBytes("IHDR"),
    ...u32beBytes(width), ...u32beBytes(height),
    8, 6, 0, 0, 0, // bit depth + color type + compression + filter + interlace
  ]);
}

export function makeJpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    ...u16beBytes(17), // segment length
    8, // precision
    ...u16beBytes(height), ...u16beBytes(width),
    3, 0, 0, 0, 0, 0, 0, 0, 0, 0, // component data padding
  ]);
}

export function makeGif(width: number, height: number): Uint8Array {
  return new Uint8Array([
    ...asciiBytes("GIF89a"),
    width & 0xff, (width >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
    0, 0, 0, // packed + bg + ratio
  ]);
}

export function makeWebpVp8x(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return new Uint8Array([
    ...asciiBytes("RIFF"), 22, 0, 0, 0, ...asciiBytes("WEBP"),
    ...asciiBytes("VP8X"), 10, 0, 0, 0,
    0, 0, 0, 0, // flags + reserved
    w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff,
    h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff,
  ]);
}

function bmffBox(type: string, ...payloads: (Uint8Array | number[])[]): Uint8Array {
  const parts = payloads.map((p) => p instanceof Uint8Array ? p : new Uint8Array(p));
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  out.set(u32beBytes(size), 0);
  out.set(asciiBytes(type), 4);
  let off = 8;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

function mvhdV0(timescale: number, duration: number): number[] {
  return [
    0, 0, 0, 0, // version + flags
    ...u32beBytes(0), ...u32beBytes(0), // creation + modification
    ...u32beBytes(timescale), ...u32beBytes(duration),
    ...new Array(80).fill(0), // rate/volume/reserved/matrix/predefined/next_track_id
  ];
}

function tkhdV0(width: number, height: number): number[] {
  return [
    0, 0, 0, 0, // version + flags
    ...new Array(72).fill(0), // creation..matrix (v0: dims at payload offset 76)
    ...u32beBytes(width << 16), ...u32beBytes(height << 16), // 16.16 fixed point
  ];
}

function hdlr(handler: string): number[] {
  return [
    0, 0, 0, 0, // version + flags
    0, 0, 0, 0, // predefined
    ...asciiBytes(handler),
    ...new Array(12).fill(0), // reserved
    0, // name terminator
  ];
}

function stsd(fourcc: string): number[] {
  return [
    0, 0, 0, 0, // version + flags
    ...u32beBytes(1), // entry count
    ...u32beBytes(16), ...asciiBytes(fourcc), // one minimal sample entry
    ...new Array(8).fill(0),
  ];
}

export function makeMp4(opts: {
  durationSeconds: number;
  width: number;
  height: number;
  withAudio: boolean;
  brand?: string;
  codec?: string;
}): Uint8Array {
  const brand = opts.brand ?? "isom";
  const ftyp = bmffBox("ftyp", [...asciiBytes(brand), 0, 0, 0, 0, ...asciiBytes(brand)]);
  const videoTrak = bmffBox(
    "trak",
    bmffBox("tkhd", tkhdV0(opts.width, opts.height)),
    bmffBox(
      "mdia",
      bmffBox("hdlr", hdlr("vide")),
      bmffBox("minf", bmffBox("stbl", bmffBox("stsd", stsd(opts.codec ?? "avc1")))),
    ),
  );
  const traks = [videoTrak];
  if (opts.withAudio) {
    traks.push(bmffBox("trak", bmffBox("mdia", bmffBox("hdlr", hdlr("soun")))));
  }
  const moov = bmffBox(
    "moov",
    bmffBox("mvhd", mvhdV0(1000, Math.round(opts.durationSeconds * 1000))),
    ...traks,
  );
  return concat(ftyp, moov);
}

// ── Image header parsing ──────────────────────────────────────────────────────

Deno.test("PNG: dimensions parsed from IHDR", () => {
  assertEquals(parsePng(makePng(1200, 628)), { width: 1200, height: 628 });
});

Deno.test("JPEG: dimensions parsed from the SOF0 frame header", () => {
  assertEquals(parseJpeg(makeJpeg(1080, 1920)), { width: 1080, height: 1920 });
});

Deno.test("GIF: logical-screen dimensions parsed little-endian", () => {
  assertEquals(parseGif(makeGif(640, 480)), { width: 640, height: 480 });
});

Deno.test("WebP VP8X: 24-bit extended dimensions parsed", () => {
  assertEquals(parseWebp(makeWebpVp8x(1440, 1800)), { width: 1440, height: 1800 });
});

Deno.test("cross-parser: a PNG is not mistaken for JPEG/GIF/WebP", () => {
  const png = makePng(10, 10);
  assertEquals(parseJpeg(png), null);
  assertEquals(parseGif(png), null);
  assertEquals(parseWebp(png), null);
});

Deno.test("probe: PNG bytes → image/png with probed dims and ratio", async () => {
  const result = await probeCreativeBytes(makePng(1080, 1080));
  assertEquals(result.kind, "image");
  assertEquals(result.mimeType, "image/png");
  assertEquals(result.width, 1080);
  assertEquals(result.height, 1080);
  assertEquals(result.aspectRatio, 1);
  assertEquals(result.hasAudio, null);
});

Deno.test("probe: JPEG bytes → image/jpeg", async () => {
  const result = await probeCreativeBytes(makeJpeg(1200, 628));
  assertEquals(result.mimeType, "image/jpeg");
  assertEquals(ratioOf(result.width, result.height), 1.9108);
});

Deno.test("probe: GIF is identified as image/gif (Meta/TikTok/Google reject it downstream)", async () => {
  const result = await probeCreativeBytes(makeGif(300, 300));
  assertEquals(result.mimeType, "image/gif");
});

Deno.test("probe: WebP is identified as image/webp", async () => {
  const result = await probeCreativeBytes(makeWebpVp8x(600, 600));
  assertEquals(result.mimeType, "image/webp");
});

// ── MP4/MOV box parsing ───────────────────────────────────────────────────────

Deno.test("MP4: duration, display dims, video+audio tracks, codec fourcc", () => {
  const mp4 = makeMp4({ durationSeconds: 30, width: 1080, height: 1920, withAudio: true });
  const info = parseBmff(mp4);
  assert(info !== null);
  assertEquals(info.brand, "isom");
  assertEquals(info.durationSeconds, 30);
  assertEquals(info.width, 1080);
  assertEquals(info.height, 1920);
  assertEquals(info.hasVideo, true);
  assertEquals(info.hasAudio, true);
  assertEquals(info.videoCodecFourcc, "avc1");
});

Deno.test("MP4: audio-track PRESENCE is derived — silent video probes hasAudio=false", () => {
  const silent = makeMp4({ durationSeconds: 15, width: 720, height: 1280, withAudio: false });
  const info = parseBmff(silent);
  assert(info !== null);
  assertEquals(info.hasAudio, false);
  assertEquals(info.hasVideo, true);
});

Deno.test("MOV: the qt brand maps to video/quicktime", async () => {
  const mov = makeMp4({ durationSeconds: 10, width: 1920, height: 1080, withAudio: true, brand: "qt  " });
  const result = await probeCreativeBytes(mov);
  assertEquals(result.kind, "video");
  assertEquals(result.mimeType, "video/quicktime");
  assertEquals(result.container, "mov/qt  ");
});

Deno.test("probe: MP4 → video facts incl. overall container bitrate", async () => {
  const mp4 = makeMp4({ durationSeconds: 30, width: 1080, height: 1920, withAudio: true });
  const result = await probeCreativeBytes(mp4);
  assertEquals(result.kind, "video");
  assertEquals(result.mimeType, "video/mp4");
  assertEquals(result.durationSeconds, 30);
  assertEquals(result.hasAudio, true);
  assertEquals(result.aspectRatio, 0.5625); // 9:16
  assertEquals(result.overallBitrateKbps, Math.round((mp4.length * 8) / 30 / 1000));
});

Deno.test("probe: unknown bytes are REFUSED fail-close (never guessed)", async () => {
  await assertRejects(
    () => probeCreativeBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])),
    CreativeProbeError,
    "Unrecognized media bytes",
  );
});

Deno.test("probe: empty bytes are refused", async () => {
  await assertRejects(() => probeCreativeBytes(new Uint8Array(0)), CreativeProbeError);
});

Deno.test("MP4: a truncated/corrupt box walk stops instead of fabricating data", () => {
  const mp4 = makeMp4({ durationSeconds: 30, width: 1080, height: 1920, withAudio: true });
  const truncated = mp4.subarray(0, 24); // ftyp only survives
  const info = parseBmff(truncated);
  assert(info !== null);
  assertEquals(info.durationSeconds, null);
  assertEquals(info.width, null);
});

// ── Content hash (A1-1 cache keying) ──────────────────────────────────────────

Deno.test("content hash: stable for identical bytes, distinct for changed bytes", async () => {
  const a1 = await sha256Hex(makePng(100, 100));
  const a2 = await sha256Hex(makePng(100, 100));
  const b = await sha256Hex(makePng(100, 101));
  assertEquals(a1, a2);
  assertNotEquals(a1, b);
  assertEquals(a1.length, 64); // sha256 hex
});

Deno.test("content hash: probe result carries the exact sha256 of the input", async () => {
  const bytes = makeJpeg(640, 640);
  const result = await probeCreativeBytes(bytes);
  assertEquals(result.contentHash, await sha256Hex(bytes));
  assertEquals(result.byteSize, bytes.length);
});

Deno.test("content hash: subarray views hash identically to copies (offset safety)", async () => {
  const padded = concat(new Uint8Array([9, 9, 9]), makePng(50, 50));
  const view = padded.subarray(3);
  assertEquals(await sha256Hex(view), await sha256Hex(makePng(50, 50)));
});
