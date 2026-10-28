import { sha256 } from "./crypto";
import { MAX_RANGE_RESPONSE_BYTES, VIDEO_CHUNK_BYTES } from "../contracts/generated/video.ts";

/*
 * #2829 W6 (AD-9) — byte ranges for a site's file videos, verified per chunk.
 *
 * Browsers (Safari above all) will not play or seek an MP4 whose server does
 * not answer `Range`. The old media route hashed the whole file on every
 * request and always answered 200 with every byte, so a 36 MB film was read in
 * full for each seek and iOS refused to play it inline.
 *
 * Each video's SHA-256 per 1 MiB chunk is computed when it is approved and
 * frozen into the publication. A range is answered by fetching only the chunks
 * that cover it, verifying each one, and slicing: a chunk that does not match
 * its digest is never served (the request fails with 502 instead).
 *
 * Rules (RFC 9110 §14):
 * - `bytes=a-b`, `bytes=a-`, `bytes=-n` → 206 with Content-Range. Any one
 *   response carries at most 8 MiB; an open-ended or larger range is answered
 *   with its first 8 MiB (the client asks again from where it got to).
 * - A start beyond the end, or `bytes=-0` → 416 naming the size (`Content-Range: bytes` star-slash-size).
 * - More than one range → 416 for files over 8 MiB; the whole file (200) for
 *   files of 8 MiB or less.
 * - A Range header that is not valid `bytes=` syntax is ignored (200), as is
 *   any Range when `If-Range` names a different version.
 */

export type VideoIntegrity = {
  bytes: number;
  chunk_size: number;
  chunk_digests: string[];
  integrity: string;
};

export type RangePlan =
  | { status: 200; start: 0; end: number }
  | { status: 206; start: number; end: number }
  | { status: 304 }
  | { status: 416 };

type RangeSpec = { start: number | null; end: number | null };

function parseSpecs(header: string): RangeSpec[] | null {
  const match = /^\s*bytes\s*=\s*(.+)$/i.exec(header);
  if (!match) return null;
  const specs: RangeSpec[] = [];
  for (const raw of match[1]!.split(",")) {
    const part = raw.trim();
    const single = /^(\d*)-(\d*)$/.exec(part);
    if (!single || (single[1] === "" && single[2] === "")) return null;
    const start = single[1] === "" ? null : Number(single[1]);
    const end = single[2] === "" ? null : Number(single[2]);
    if ((start !== null && !Number.isSafeInteger(start)) || (end !== null && !Number.isSafeInteger(end))) return null;
    if (start !== null && end !== null && end < start) return null;
    specs.push({ start, end });
  }
  return specs.length ? specs : null;
}

export function etagFor(integrity: string): string {
  return `"${integrity}"`;
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").map((value) => value.trim().replace(/^W\//, "")).some((value) => value === etag || value === "*");
}

/** What to answer for one request, before any byte is read. */
export function planVideoRange(input: {
  size: number;
  etag: string;
  range: string | null;
  ifRange: string | null;
  ifNoneMatch: string | null;
}): RangePlan {
  const { size, etag } = input;
  const full: RangePlan = { status: 200, start: 0, end: size - 1 };
  if (input.range === null || input.range === "") {
    return etagMatches(input.ifNoneMatch, etag) ? { status: 304 } : full;
  }
  // If-Range with any other validator (an older version, or a date) → the
  // whole current file, never a slice of a different one.
  if (input.ifRange !== null && input.ifRange.trim() !== etag) return full;
  const specs = parseSpecs(input.range);
  if (!specs) return full;
  if (specs.length > 1) return size > MAX_RANGE_RESPONSE_BYTES ? { status: 416 } : full;
  const spec = specs[0]!;
  let start: number;
  let end: number;
  if (spec.start === null) {
    // Suffix: the last n bytes.
    const length = spec.end ?? 0;
    if (length === 0) return { status: 416 };
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    if (spec.start >= size) return { status: 416 };
    start = spec.start;
    end = spec.end === null ? size - 1 : Math.min(spec.end, size - 1);
  }
  end = Math.min(end, start + MAX_RANGE_RESPONSE_BYTES - 1);
  return { status: 206, start, end };
}

export class ChunkIntegrityError extends Error {
  constructor(public readonly chunk: number) {
    super("CHUNK_INTEGRITY");
  }
}

/** Reads bytes [start, end] (inclusive) of the stored object. */
export type ByteRangeFetcher = (start: number, end: number) => Promise<Uint8Array>;

/**
 * Bytes [start, end] of the video, fetched as whole covering chunks and each
 * chunk verified against its digest before any of its bytes are returned.
 */
export async function readVerifiedRange(
  video: VideoIntegrity,
  start: number,
  end: number,
  fetchBytes: ByteRangeFetcher,
): Promise<Uint8Array> {
  const chunk = video.chunk_size;
  if (chunk !== VIDEO_CHUNK_BYTES || start < 0 || end < start || end >= video.bytes) throw new Error("RANGE_INVALID");
  const first = Math.floor(start / chunk);
  const last = Math.floor(end / chunk);
  const spanStart = first * chunk;
  const spanEnd = Math.min((last + 1) * chunk, video.bytes) - 1;
  const span = await fetchBytes(spanStart, spanEnd);
  if (span.byteLength !== spanEnd - spanStart + 1) throw new ChunkIntegrityError(first);
  for (let index = first; index <= last; index += 1) {
    const offset = (index - first) * chunk;
    const piece = span.subarray(offset, Math.min(offset + chunk, span.byteLength));
    if ((await sha256(piece)) !== video.chunk_digests[index]) throw new ChunkIntegrityError(index);
  }
  return span.subarray(start - spanStart, end - spanStart + 1);
}

/**
 * The whole file as a stream of verified chunk groups (8 MiB at a time). The
 * first group is read and verified BEFORE the response starts, so an early bad
 * chunk is a 502; a later one ends the stream with an error, and no byte of a
 * chunk that failed its digest is ever sent.
 */
export async function verifiedVideoStream(
  video: VideoIntegrity,
  fetchBytes: ByteRangeFetcher,
  onError: (error: unknown) => void = () => {},
): Promise<ReadableStream<Uint8Array>> {
  const group = MAX_RANGE_RESPONSE_BYTES;
  const firstEnd = Math.min(group, video.bytes) - 1;
  const firstGroup = await readVerifiedRange(video, 0, firstEnd, fetchBytes);
  let next = firstEnd + 1;
  let sentFirst = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentFirst) {
        sentFirst = true;
        controller.enqueue(firstGroup);
        if (next >= video.bytes) controller.close();
        return;
      }
      const end = Math.min(next + group, video.bytes) - 1;
      try {
        controller.enqueue(await readVerifiedRange(video, next, end, fetchBytes));
      } catch (error) {
        onError(error);
        controller.error(error);
        return;
      }
      next = end + 1;
      if (next >= video.bytes) controller.close();
    },
  });
}
