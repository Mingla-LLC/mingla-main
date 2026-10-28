/*
 * #2829 W6 (T-W6) — the Range parser and responder, and per-chunk
 * verification. Single, suffix, open-ended (capped at 8 MiB), unsatisfiable,
 * multi-range (by file size), invalid syntax, If-Range and If-None-Match.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ChunkIntegrityError,
  etagFor,
  planVideoRange,
  readVerifiedRange,
  verifiedVideoStream,
  type VideoIntegrity,
} from "./videoRange";

const MiB = 1024 * 1024;
const ETAG = etagFor("e".repeat(64));
const plan = (size: number, range: string | null, extra: { ifRange?: string; ifNoneMatch?: string } = {}) =>
  planVideoRange({ size, etag: ETAG, range, ifRange: extra.ifRange ?? null, ifNoneMatch: extra.ifNoneMatch ?? null });

function fileOf(bytes: number): { data: Uint8Array; video: VideoIntegrity } {
  const data = new Uint8Array(bytes);
  for (let index = 0; index < bytes; index += 1) data[index] = (index * 31 + (index >> 12)) & 0xff;
  const digests: string[] = [];
  for (let offset = 0; offset < bytes; offset += MiB) {
    digests.push(createHash("sha256").update(data.subarray(offset, Math.min(offset + MiB, bytes))).digest("hex"));
  }
  return {
    data,
    video: {
      bytes,
      chunk_size: MiB,
      chunk_digests: digests,
      integrity: createHash("sha256").update(data).digest("hex"),
    },
  };
}

describe("#2829 planVideoRange", () => {
  const SIZE = 35_942_422;

  it("answers a closed range, a first-two-bytes probe and a last byte", () => {
    expect(plan(SIZE, "bytes=0-1")).toEqual({ status: 206, start: 0, end: 1 });
    expect(plan(SIZE, "bytes=1000-1999")).toEqual({ status: 206, start: 1000, end: 1999 });
    expect(plan(SIZE, `bytes=${SIZE - 1}-${SIZE - 1}`)).toEqual({ status: 206, start: SIZE - 1, end: SIZE - 1 });
  });

  it("clamps an end past the file and caps any one answer at 8 MiB", () => {
    expect(plan(100, "bytes=50-1000")).toEqual({ status: 206, start: 50, end: 99 });
    expect(plan(SIZE, "bytes=0-")).toEqual({ status: 206, start: 0, end: 8 * MiB - 1 });
    expect(plan(SIZE, "bytes=20000000-")).toEqual({ status: 206, start: 20_000_000, end: 20_000_000 + 8 * MiB - 1 });
    expect(plan(SIZE, `bytes=${SIZE - 10}-`)).toEqual({ status: 206, start: SIZE - 10, end: SIZE - 1 });
    expect(plan(SIZE, "bytes=0-30000000")).toEqual({ status: 206, start: 0, end: 8 * MiB - 1 });
  });

  it("answers a suffix range with the last n bytes", () => {
    expect(plan(SIZE, "bytes=-500")).toEqual({ status: 206, start: SIZE - 500, end: SIZE - 1 });
    expect(plan(100, "bytes=-500")).toEqual({ status: 206, start: 0, end: 99 });
  });

  it("is 416 for a start beyond the end and for bytes=-0", () => {
    expect(plan(SIZE, "bytes=99999999-")).toEqual({ status: 416 });
    expect(plan(SIZE, `bytes=${SIZE}-`)).toEqual({ status: 416 });
    expect(plan(SIZE, "bytes=-0")).toEqual({ status: 416 });
  });

  it("refuses several ranges on a file over 8 MiB and sends a small file whole", () => {
    expect(plan(SIZE, "bytes=0-1,5-6")).toEqual({ status: 416 });
    expect(plan(4 * MiB, "bytes=0-1,5-6")).toEqual({ status: 200, start: 0, end: 4 * MiB - 1 });
    expect(plan(8 * MiB, "bytes=0-1, 5-6")).toEqual({ status: 200, start: 0, end: 8 * MiB - 1 });
  });

  it("ignores a Range that is not valid bytes syntax (whole file)", () => {
    for (const header of ["items=0-1", "bytes=5-1", "bytes=abc", "bytes=-", "bytes="]) {
      expect(plan(100, header)).toEqual({ status: 200, start: 0, end: 99 });
    }
  });

  it("If-Range: the same version gets the range, any other gets the whole file", () => {
    expect(plan(100, "bytes=0-1", { ifRange: ETAG })).toEqual({ status: 206, start: 0, end: 1 });
    expect(plan(100, "bytes=0-1", { ifRange: '"older"' })).toEqual({ status: 200, start: 0, end: 99 });
  });

  it("If-None-Match on the same version is 304 (no body)", () => {
    expect(plan(100, null, { ifNoneMatch: ETAG })).toEqual({ status: 304 });
    expect(plan(100, null, { ifNoneMatch: '"other"' })).toEqual({ status: 200, start: 0, end: 99 });
  });
});

describe("#2829 readVerifiedRange", () => {
  const { data, video } = fileOf(3 * MiB + 12_345);
  const fetchBytes = vi.fn(async (start: number, end: number) => data.slice(start, end + 1));

  it("returns exactly the requested bytes, across chunk boundaries, reading only covering chunks", async () => {
    for (const [start, end] of [[0, 1], [MiB - 3, MiB + 3], [2 * MiB + 5, 3 * MiB + 12_344], [17, 17]] as const) {
      fetchBytes.mockClear();
      const bytes = await readVerifiedRange(video, start, end, fetchBytes);
      expect(Buffer.from(bytes).equals(Buffer.from(data.subarray(start, end + 1)))).toBe(true);
      const [[spanStart, spanEnd]] = fetchBytes.mock.calls as unknown as [[number, number]];
      expect(spanStart).toBe(Math.floor(start / MiB) * MiB);
      expect(spanEnd).toBe(Math.min((Math.floor(end / MiB) + 1) * MiB, video.bytes) - 1);
    }
  });

  it("refuses a chunk that does not match its digest, naming the chunk", async () => {
    const tampered = data.slice();
    tampered[MiB + 10] ^= 0xff;
    const read = (start: number, end: number) => readVerifiedRange(video, start, end, async (s, e) => tampered.slice(s, e + 1));
    await expect(read(MiB, MiB + 1)).rejects.toEqual(new ChunkIntegrityError(1));
    // A range in an untouched chunk is still served.
    expect((await read(0, 9)).byteLength).toBe(10);
  });

  it("refuses a short read from storage", async () => {
    await expect(readVerifiedRange(video, 0, 9, async (s, e) => data.slice(s, e))).rejects.toBeInstanceOf(ChunkIntegrityError);
  });

  it("streams the whole file verified; a later bad chunk ends the stream without its bytes", async () => {
    const big = fileOf(10 * MiB);
    const whole = await new Response(await verifiedVideoStream(big.video, async (s, e) => big.data.slice(s, e + 1))).arrayBuffer();
    expect(Buffer.from(whole).equals(Buffer.from(big.data))).toBe(true);

    const tampered = big.data.slice();
    tampered[9 * MiB + 1] ^= 1;
    const errors: unknown[] = [];
    const stream = await verifiedVideoStream(big.video, async (s, e) => tampered.slice(s, e + 1), (error) => errors.push(error));
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.value?.byteLength).toBe(8 * MiB);
    await expect(reader.read()).rejects.toEqual(new ChunkIntegrityError(9));
    expect(errors).toHaveLength(1);
  });

  it("refuses to start a stream whose first chunks fail", async () => {
    const tampered = data.slice();
    tampered[0] ^= 1;
    await expect(verifiedVideoStream(video, async (s, e) => tampered.slice(s, e + 1))).rejects.toEqual(new ChunkIntegrityError(0));
  });
});
