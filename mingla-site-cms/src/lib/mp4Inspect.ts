/*
 * #2829 W6 (AD-9) — what a site's file video must be, read from its own boxes.
 *
 * A browser plays an MP4 inline and seekably only when it is H.264 video (with
 * AAC audio, if any) and "fast start": the `moov` index box comes BEFORE the
 * `mdat` media data, so playback can begin from the first bytes instead of
 * fetching the end of the file first. The length comes from `mvhd`, so a hero
 * loop can be held to 15 seconds. No ffmpeg: this reads box headers only.
 */

export type Mp4Inspection =
  | {
    ok: true;
    durationMs: number;
    width: number;
    height: number;
    videoCodecs: string[];
    audioCodecs: string[];
  }
  | { ok: false; reason: "NOT_MP4" | "NOT_FASTSTART" | "CODEC" | "MALFORMED" };

/** The `ftyp` major brands accepted for a file video (spec AD-9). */
export const FILE_VIDEO_BRANDS = new Set(["isom", "iso2", "mp41", "mp42", "avc1"]);
const VIDEO_CODECS = new Set(["avc1", "avc3"]);
const AUDIO_CODECS = new Set(["mp4a"]);

type Box = { type: string; start: number; headerSize: number; size: number };

function ascii(bytes: Uint8Array, offset: number, length = 4): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** The boxes laid end to end in [start, end). Throws on a size that does not fit. */
function boxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset, false);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) throw new Error("MALFORMED");
      const high = view.getUint32(offset + 8, false);
      const low = view.getUint32(offset + 12, false);
      size = high * 2 ** 32 + low;
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) throw new Error("MALFORMED");
    out.push({ type: ascii(bytes, offset + 4), start: offset, headerSize, size });
    offset += size;
  }
  if (offset !== end) throw new Error("MALFORMED");
  return out;
}

const child = (bytes: Uint8Array, parent: Box, type: string, skip = 0) =>
  boxes(bytes, parent.start + parent.headerSize + skip, parent.start + parent.size).find((box) => box.type === type);
const children = (bytes: Uint8Array, parent: Box, type: string) =>
  boxes(bytes, parent.start + parent.headerSize, parent.start + parent.size).filter((box) => box.type === type);

function mvhdDurationMs(bytes: Uint8Array, mvhd: Box): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const body = mvhd.start + mvhd.headerSize;
  const version = bytes[body];
  let timescale: number;
  let duration: number;
  if (version === 1) {
    timescale = view.getUint32(body + 20, false);
    duration = view.getUint32(body + 24, false) * 2 ** 32 + view.getUint32(body + 28, false);
  } else {
    timescale = view.getUint32(body + 12, false);
    duration = view.getUint32(body + 16, false);
  }
  if (!timescale) throw new Error("MALFORMED");
  return Math.round((duration / timescale) * 1000);
}

function tkhdSize(bytes: Uint8Array, tkhd: Box): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const body = tkhd.start + tkhd.headerSize;
  const version = bytes[body];
  // width/height are the last 8 bytes (16.16 fixed point).
  const at = body + (version === 1 ? 88 : 76);
  return { width: view.getUint32(at, false) >>> 16, height: view.getUint32(at + 4, false) >>> 16 };
}

export function inspectMp4(bytes: Uint8Array): Mp4Inspection {
  try {
    if (bytes.byteLength < 16 || ascii(bytes, 4) !== "ftyp" || !FILE_VIDEO_BRANDS.has(ascii(bytes, 8))) {
      return { ok: false, reason: "NOT_MP4" };
    }
    const top = boxes(bytes, 0, bytes.byteLength);
    const moovIndex = top.findIndex((box) => box.type === "moov");
    const mdatIndex = top.findIndex((box) => box.type === "mdat");
    if (moovIndex < 0 || mdatIndex < 0) return { ok: false, reason: "MALFORMED" };
    if (moovIndex > mdatIndex) return { ok: false, reason: "NOT_FASTSTART" };
    const moov = top[moovIndex]!;
    const mvhd = child(bytes, moov, "mvhd");
    if (!mvhd) return { ok: false, reason: "MALFORMED" };
    const durationMs = mvhdDurationMs(bytes, mvhd);
    const videoCodecs: string[] = [];
    const audioCodecs: string[] = [];
    let width = 0;
    let height = 0;
    for (const trak of children(bytes, moov, "trak")) {
      const mdia = child(bytes, trak, "mdia");
      const hdlr = mdia && child(bytes, mdia, "hdlr");
      const minf = mdia && child(bytes, mdia, "minf");
      const stbl = minf && child(bytes, minf, "stbl");
      const stsd = stbl && child(bytes, stbl, "stsd");
      if (!hdlr || !stsd) continue;
      const handler = ascii(bytes, hdlr.start + hdlr.headerSize + 8);
      // stsd: version/flags (4) + entry count (4), then sample entries.
      const entries = boxes(bytes, stsd.start + stsd.headerSize + 8, stsd.start + stsd.size);
      const codecs = entries.map((entry) => entry.type);
      if (handler === "vide") {
        videoCodecs.push(...codecs);
        const tkhd = child(bytes, trak, "tkhd");
        if (tkhd && !width) ({ width, height } = tkhdSize(bytes, tkhd));
      } else if (handler === "soun") {
        audioCodecs.push(...codecs);
      }
    }
    if (
      videoCodecs.length === 0 ||
      !videoCodecs.every((codec) => VIDEO_CODECS.has(codec)) ||
      !audioCodecs.every((codec) => AUDIO_CODECS.has(codec))
    ) return { ok: false, reason: "CODEC" };
    return { ok: true, durationMs, width, height, videoCodecs, audioCodecs };
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
}

/** SHA-256 of each 1 MiB chunk, in order (the runtime verifies ranges with these). */
export async function chunkDigests(bytes: Uint8Array, chunkSize: number): Promise<string[]> {
  const digests: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const piece = bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength));
    const hash = await crypto.subtle.digest("SHA-256", piece);
    digests.push([...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join(""));
  }
  return digests;
}
