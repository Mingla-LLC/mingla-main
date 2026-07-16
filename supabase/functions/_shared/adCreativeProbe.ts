/**
 * adCreativeProbe.ts — the ISSUE-866 server-side byte-probe (Amendment A1-6a).
 *
 * "[DESIGN DECISION] The creative validator is a server-side byte-probe, not a
 * form check. Never trust admin-supplied dimensions." (PIPELINE_BLUEPRINT §1.5)
 *
 * Pure-TypeScript header/box parsing — the Deno edge runtime has NO ffprobe,
 * NO ImageMagick, NO canvas. What this probe CAN derive deterministically:
 *   images  — mime + width/height for PNG, JPEG, GIF, WebP (VP8/VP8L/VP8X)
 *   video   — MP4/MOV (ISO BMFF): container brand, duration (mvhd), display
 *             dimensions (video tkhd), audio-track PRESENCE (hdlr 'soun'),
 *             best-effort sample-entry fourcc (stsd), overall container
 *             bitrate (bytes×8 ÷ duration)
 *   always  — sha256 content hash of the exact bytes (A1-1 cache keying)
 *
 * What it can NOT derive (typed as not-evaluable downstream; A1-3 stop-and-
 * amend posture — flagged in the WP3 report, never improvised):
 *   frame-level luma (black-bar/letterbox detection), watermark detection,
 *   audio loudness (−16 LUFS), exact fps, non-MP4/MOV containers.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProbedKind = "image" | "video";

export interface CreativeProbeResult {
  kind: ProbedKind;
  mimeType: string;
  /** Container/codec detail where derivable (e.g. "mp4/isom", "mov/qt "). */
  container: string | null;
  width: number | null;
  height: number | null;
  /** width/height, rounded to 4 dp; null when either dimension is unknown. */
  aspectRatio: number | null;
  durationSeconds: number | null;
  /** Video only: an audio ('soun') track exists. null = not derivable. */
  hasAudio: boolean | null;
  /** Best-effort video sample-entry fourcc (e.g. "avc1", "hvc1"). */
  videoCodecFourcc: string | null;
  /** Overall container bitrate in kbps (bytes×8 ÷ duration ÷ 1000); video only. */
  overallBitrateKbps: number | null;
  byteSize: number;
  /** sha256 hex of the exact bytes (A1-1: the content-hash cache key). */
  contentHash: string;
}

export class CreativeProbeError extends Error {
  readonly detail: string;
  constructor(detail: string, message: string) {
    super(message);
    this.name = "CreativeProbeError";
    this.detail = detail;
  }
}

// ── Hashing (A1-1) ────────────────────────────────────────────────────────────

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source: Uint8Array = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", source.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Byte readers ──────────────────────────────────────────────────────────────

function u16be(b: Uint8Array, off: number): number {
  return (b[off] << 8) | b[off + 1];
}
function u16le(b: Uint8Array, off: number): number {
  return b[off] | (b[off + 1] << 8);
}
function u32be(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}
function u64be(b: Uint8Array, off: number): number {
  // Safe for realistic media sizes/durations (< 2^53).
  return u32be(b, off) * 0x1_0000_0000 + u32be(b, off + 4);
}
function ascii(b: Uint8Array, off: number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += String.fromCharCode(b[off + i]);
  return out;
}

// ── Image parsers ─────────────────────────────────────────────────────────────

interface Dims {
  width: number;
  height: number;
}

/** PNG: 8-byte signature, then IHDR (width u32be @16, height u32be @20). */
export function parsePng(bytes: Uint8Array): Dims | null {
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

/** JPEG: scan markers for a SOF frame header (height @+5, width @+7). */
export function parseJpeg(bytes: Uint8Array): Dims | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let off = 2;
  while (off + 9 < bytes.length) {
    if (bytes[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = bytes[off + 1];
    // Standalone markers without a length segment.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01 || marker === 0xff) {
      off += 2;
      continue;
    }
    const segLen = u16be(bytes, off + 2);
    if (segLen < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      return { height: u16be(bytes, off + 5), width: u16be(bytes, off + 7) };
    }
    off += 2 + segLen;
  }
  return null;
}

/** GIF87a/GIF89a: logical screen width u16le @6, height u16le @8. */
export function parseGif(bytes: Uint8Array): Dims | null {
  if (bytes.length < 10) return null;
  const header = ascii(bytes, 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

/** WebP: RIFF….WEBP with VP8 (lossy), VP8L (lossless), or VP8X (extended). */
export function parseWebp(bytes: Uint8Array): Dims | null {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    // 24-bit little-endian (width−1) @24, (height−1) @27.
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (chunk === "VP8 ") {
    // Lossy keyframe: 3-byte frame tag @20, then 3-byte start code 9D 01 2A.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  }
  return null;
}

// ── MP4/MOV (ISO BMFF) box walker ─────────────────────────────────────────────

interface BmffInfo {
  brand: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  videoCodecFourcc: string | null;
}

interface BoxHeader {
  type: string;
  /** Offset of the box payload (after the size+type header). */
  payloadStart: number;
  /** Offset just past the end of the box. */
  end: number;
}

function* iterateBoxes(bytes: Uint8Array, start: number, end: number): Generator<BoxHeader> {
  let off = start;
  while (off + 8 <= end) {
    let size = u32be(bytes, off);
    const type = ascii(bytes, off + 4, 4);
    let payloadStart = off + 8;
    if (size === 1) {
      if (off + 16 > end) return;
      size = u64be(bytes, off + 8);
      payloadStart = off + 16;
    } else if (size === 0) {
      size = end - off; // box extends to end of file
    }
    if (size < 8 || off + size > end) return; // corrupt — stop, do not fabricate
    yield { type, payloadStart, end: off + size };
    off += size;
  }
}

function findBox(bytes: Uint8Array, start: number, end: number, type: string): BoxHeader | null {
  for (const box of iterateBoxes(bytes, start, end)) {
    if (box.type === type) return box;
  }
  return null;
}

/** Parses an ISO BMFF (MP4/MOV) buffer for the probe-relevant facts. */
export function parseBmff(bytes: Uint8Array): BmffInfo | null {
  if (bytes.length < 16) return null;
  const ftyp = findBox(bytes, 0, bytes.length, "ftyp");
  if (!ftyp) return null;
  const brand = ascii(bytes, ftyp.payloadStart, 4);

  const moov = findBox(bytes, 0, bytes.length, "moov");
  if (!moov) {
    return {
      brand,
      durationSeconds: null,
      width: null,
      height: null,
      hasAudio: false,
      hasVideo: false,
      videoCodecFourcc: null,
    };
  }

  // mvhd → movie timescale + duration.
  let durationSeconds: number | null = null;
  const mvhd = findBox(bytes, moov.payloadStart, moov.end, "mvhd");
  if (mvhd) {
    const version = bytes[mvhd.payloadStart];
    if (version === 1) {
      const timescale = u32be(bytes, mvhd.payloadStart + 20);
      const duration = u64be(bytes, mvhd.payloadStart + 24);
      if (timescale > 0) durationSeconds = duration / timescale;
    } else {
      const timescale = u32be(bytes, mvhd.payloadStart + 12);
      const duration = u32be(bytes, mvhd.payloadStart + 16);
      if (timescale > 0) durationSeconds = duration / timescale;
    }
  }

  let width: number | null = null;
  let height: number | null = null;
  let hasAudio = false;
  let hasVideo = false;
  let videoCodecFourcc: string | null = null;

  for (const trak of iterateBoxes(bytes, moov.payloadStart, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = findBox(bytes, trak.payloadStart, trak.end, "mdia");
    if (!mdia) continue;
    const hdlr = findBox(bytes, mdia.payloadStart, mdia.end, "hdlr");
    if (!hdlr) continue;
    const handler = ascii(bytes, hdlr.payloadStart + 8, 4);

    if (handler === "soun") {
      hasAudio = true;
      continue;
    }
    if (handler !== "vide") continue;
    hasVideo = true;

    // tkhd → display width/height (16.16 fixed point at payload end).
    const tkhd = findBox(bytes, trak.payloadStart, trak.end, "tkhd");
    if (tkhd && width === null) {
      const version = bytes[tkhd.payloadStart];
      const dimOff = tkhd.payloadStart + (version === 1 ? 88 : 76);
      if (dimOff + 8 <= tkhd.end) {
        const w = u32be(bytes, dimOff) / 65536;
        const h = u32be(bytes, dimOff + 4) / 65536;
        if (w > 0 && h > 0) {
          width = Math.round(w);
          height = Math.round(h);
        }
      }
    }

    // stsd → first sample-entry fourcc (best-effort codec identification).
    if (videoCodecFourcc === null) {
      const minf = findBox(bytes, mdia.payloadStart, mdia.end, "minf");
      const stbl = minf ? findBox(bytes, minf.payloadStart, minf.end, "stbl") : null;
      const stsd = stbl ? findBox(bytes, stbl.payloadStart, stbl.end, "stsd") : null;
      if (stsd && stsd.payloadStart + 16 <= stsd.end) {
        videoCodecFourcc = ascii(bytes, stsd.payloadStart + 12, 4);
      }
    }
  }

  return { brand, durationSeconds, width, height, hasAudio, hasVideo, videoCodecFourcc };
}

// ── The probe ─────────────────────────────────────────────────────────────────

const MOV_BRANDS = new Set(["qt  ", "M4V ", "M4A "]);

/**
 * Probes the ACTUAL BYTES (A1-6a — admin-supplied dimensions are ignored) and
 * returns the canonical metadata + content hash. Throws CreativeProbeError
 * (detail "probe_unsupported_format") when the bytes are not one of the
 * parseable formats — the caller surfaces it fail-close; it NEVER guesses.
 */
export async function probeCreativeBytes(bytes: Uint8Array): Promise<CreativeProbeResult> {
  if (bytes.length === 0) {
    throw new CreativeProbeError("probe_empty_bytes", "The creative source resolved to zero bytes.");
  }
  const contentHash = await sha256Hex(bytes);
  const byteSize = bytes.length;

  const png = parsePng(bytes);
  if (png) {
    return imageResult("image/png", png, byteSize, contentHash);
  }
  const jpeg = parseJpeg(bytes);
  if (jpeg) {
    return imageResult("image/jpeg", jpeg, byteSize, contentHash);
  }
  const gif = parseGif(bytes);
  if (gif) {
    return imageResult("image/gif", gif, byteSize, contentHash);
  }
  const webp = parseWebp(bytes);
  if (webp) {
    return imageResult("image/webp", webp, byteSize, contentHash);
  }

  const bmff = parseBmff(bytes);
  if (bmff) {
    const isMov = MOV_BRANDS.has(bmff.brand);
    const durationSeconds = bmff.durationSeconds;
    const overallBitrateKbps = durationSeconds && durationSeconds > 0
      ? Math.round((byteSize * 8) / durationSeconds / 1000)
      : null;
    // QA F-3: hasAudio=false is a POSITIVE claim ("a moov was walked and no
    // 'soun' trak exists"). A truncated/moov-less file where NO trak of either
    // kind was parsed yields null (unknown) — the matrix surfaces null as a
    // failSafe not_evaluable that still hard-blocks audio-required channels;
    // certainty is never fabricated from absence.
    const trakParsed = bmff.hasVideo || bmff.hasAudio;
    return {
      kind: "video",
      mimeType: isMov ? "video/quicktime" : "video/mp4",
      container: `${isMov ? "mov" : "mp4"}/${bmff.brand}`,
      width: bmff.width,
      height: bmff.height,
      aspectRatio: ratioOf(bmff.width, bmff.height),
      durationSeconds,
      hasAudio: trakParsed ? bmff.hasAudio : null,
      videoCodecFourcc: bmff.videoCodecFourcc,
      overallBitrateKbps,
      byteSize,
      contentHash,
    };
  }

  throw new CreativeProbeError(
    "probe_unsupported_format",
    "Unrecognized media bytes — the probe parses PNG, JPEG, GIF, WebP images and MP4/MOV video. " +
      "Other containers cannot be validated in the edge runtime and are refused fail-close.",
  );
}

function imageResult(
  mimeType: string,
  dims: Dims,
  byteSize: number,
  contentHash: string,
): CreativeProbeResult {
  return {
    kind: "image",
    mimeType,
    container: null,
    width: dims.width,
    height: dims.height,
    aspectRatio: ratioOf(dims.width, dims.height),
    durationSeconds: null,
    hasAudio: null,
    videoCodecFourcc: null,
    overallBitrateKbps: null,
    byteSize,
    contentHash,
  };
}

export function ratioOf(width: number | null, height: number | null): number | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  return Math.round((width / height) * 10000) / 10000;
}
