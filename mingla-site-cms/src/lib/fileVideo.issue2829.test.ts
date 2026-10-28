/*
 * #2829 W6 (T-W6, AD-9) — file videos in Studio and the publication builder.
 *
 *  - MP4 sniffing: ftyp brands isom/iso2/mp41/mp42/avc1 only; `moov` before
 *    `mdat` (fast start) or a plain refusal; H.264 video / AAC audio only;
 *    the length from `mvhd` (v0 and v1) and the size from `tkhd`.
 *  - Approval: up to 50 MiB (pictures keep 20 MiB); the per-1 MiB chunk
 *    digests and the length are recorded; a non-fast-start file is REJECTED
 *    with VIDEO_NOT_FASTSTART and a wrong codec with VIDEO_CODEC.
 *  - A hero video is at most 15 s: refused on save with the plain reason.
 *  - The builder freezes size, chunk digests and length into the artifact
 *    (computing them from verified bytes for a video approved before W6),
 *    which then passes the v2 contract.
 * Synthetic MP4s are built box by box here (no binary fixtures).
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();
vi.mock("./config", () => ({
  cmsConfig: () => ({
    approvedBucket: "approved-bucket",
    recoveryBucket: "recovery-bucket",
    quarantineBucket: "quarantine-bucket",
    artifactBucket: "artifact-bucket",
  }),
}));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./objectStore", () => ({
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => {
    stored.set(`${bucket}:${key}`, bytes);
  },
  deleteObject: async (bucket: string, key: string) => {
    stored.delete(`${bucket}:${key}`);
  },
  presignedQuarantinePut: async () => ({ url: "https://upload.invalid", headers: {} }),
}));

import { chunkDigests, inspectMp4 } from "./mp4Inspect";
import { completeUpload, createUploadGrant } from "./mediaPipeline";
import { assertHeroVideoLengths, heroVideoProblem, HERO_VIDEO_LENGTH_UNKNOWN_MESSAGE } from "./videoRules";
import { fileVideoIntegrity, fitsHero, isFileVideoRecord, isStreamVideoRecord, streamVideoRef } from "./siteVideoRefs";
import { HERO_VIDEO_TOO_LONG_MESSAGE } from "../contracts/generated/video.ts";

const MiB = 1024 * 1024;
const TENANT = "00000000-0000-4000-8000-000000000e01";
const SITE = "00000000-0000-4000-8000-000000000e02";
const MEDIA = "00000000-0000-4000-8000-000000000e03";

// ---- a tiny MP4 writer -------------------------------------------------------
const ascii = (text: string) => new TextEncoder().encode(text);
const u32 = (value: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
};
const box = (type: string, ...parts: Uint8Array[]) => {
  const body = concat(...parts);
  return concat(u32(body.byteLength + 8), ascii(type), body);
};
const zeros = (n: number) => new Uint8Array(n);

function mvhd(durationMs: number, version: 0 | 1 = 0) {
  const timescale = 600;
  const duration = Math.round((durationMs / 1000) * timescale);
  if (version === 1) {
    return box("mvhd", new Uint8Array([1, 0, 0, 0]), zeros(16), u32(timescale), u32(0), u32(duration), zeros(80));
  }
  return box("mvhd", zeros(4), zeros(8), u32(timescale), u32(duration), zeros(80));
}
function trak(handler: "vide" | "soun", codec: string, width = 0, height = 0) {
  const tkhd = box("tkhd", zeros(4), zeros(72), u32(width << 16), u32(height << 16));
  const hdlr = box("hdlr", zeros(4), zeros(4), ascii(handler), zeros(12), zeros(1));
  const stsd = box("stsd", zeros(4), u32(1), box(codec, zeros(78)));
  return box("trak", tkhd, box("mdia", hdlr, box("minf", box("stbl", stsd))));
}
function mp4(options: {
  brand?: string;
  durationMs?: number;
  mvhdVersion?: 0 | 1;
  faststart?: boolean;
  video?: string;
  audio?: string | null;
  payloadBytes?: number;
} = {}) {
  const ftyp = box("ftyp", ascii(options.brand ?? "isom"), u32(512), ascii("isomiso2avc1mp41"));
  const moov = box(
    "moov",
    mvhd(options.durationMs ?? 10_000, options.mvhdVersion ?? 0),
    trak("vide", options.video ?? "avc1", 1920, 1080),
    ...(options.audio === null ? [] : [trak("soun", options.audio ?? "mp4a")]),
  );
  const payload = new Uint8Array(options.payloadBytes ?? 4096).map((_, index) => (index * 13) & 0xff);
  const mdat = box("mdat", payload);
  return options.faststart === false ? concat(ftyp, mdat, moov) : concat(ftyp, moov, mdat);
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

beforeEach(() => stored.clear());

describe("#2829 MP4 inspection", () => {
  it("reads a fast-start H.264/AAC file: length (mvhd v0 and v1) and frame size", () => {
    expect(inspectMp4(mp4({ durationMs: 12_500 }))).toMatchObject({ ok: true, durationMs: 12_500, width: 1920, height: 1080 });
    expect(inspectMp4(mp4({ durationMs: 84_600, mvhdVersion: 1 }))).toMatchObject({ ok: true, durationMs: 84_600 });
    expect(inspectMp4(mp4({ audio: null }))).toMatchObject({ ok: true, audioCodecs: [] });
  });

  it("refuses an index after the data (not fast start)", () => {
    expect(inspectMp4(mp4({ faststart: false }))).toEqual({ ok: false, reason: "NOT_FASTSTART" });
  });

  it("accepts only the spec's ftyp brands", () => {
    for (const brand of ["isom", "iso2", "mp41", "mp42", "avc1"]) expect(inspectMp4(mp4({ brand })).ok).toBe(true);
    for (const brand of ["iso5", "dash", "qt  ", "M4V "]) expect(inspectMp4(mp4({ brand }))).toEqual({ ok: false, reason: "NOT_MP4" });
  });

  it("refuses video that is not H.264 and audio that is not AAC", () => {
    expect(inspectMp4(mp4({ video: "hvc1" }))).toEqual({ ok: false, reason: "CODEC" });
    expect(inspectMp4(mp4({ audio: "Opus" }))).toEqual({ ok: false, reason: "CODEC" });
  });

  it("calls a truncated or mis-sized file malformed rather than guessing", () => {
    const file = mp4();
    expect(inspectMp4(file.subarray(0, file.byteLength - 3))).toEqual({ ok: false, reason: "MALFORMED" });
  });

  it("chunks are SHA-256 of each 1 MiB piece, the last one short", async () => {
    const bytes = new Uint8Array(2 * MiB + 5).map((_, index) => index & 0xff);
    const digests = await chunkDigests(bytes, MiB);
    expect(digests).toEqual([sha(bytes.subarray(0, MiB)), sha(bytes.subarray(MiB, 2 * MiB)), sha(bytes.subarray(2 * MiB))]);
  });
});

/** A Payload stand-in holding one media row. */
function uploadRequest(declared: string, bytes: number) {
  const updates: Array<Record<string, unknown>> = [];
  let row: Record<string, unknown> = {
    id: MEDIA,
    tenant: TENANT,
    state: "UPLOADING",
    declared_mime: declared,
    bytes,
    quarantine_key: `quarantine/${SITE}/${MEDIA}/key`,
  };
  const req = {
    context: {},
    user: { id: "u1", tenantId: TENANT, siteId: SITE },
    payload: {
      findByID: async () => row,
      create: async (input: { data: Record<string, unknown> }) => ({ id: MEDIA, ...input.data }),
      update: async (input: { data: Record<string, unknown> }) => {
        updates.push(input.data);
        row = { ...row, ...input.data };
        return row;
      },
    },
  };
  return { req, updates, row: () => row };
}

describe("#2829 file video approval", () => {
  it("grants up to 50 MiB for a video and keeps pictures at 20 MiB", async () => {
    const video = await createUploadGrant(uploadRequest("video/mp4", 1).req as never, { filename: "f.mp4", content_type: "video/mp4", bytes: 50 * MiB });
    expect(video.maximum_bytes).toBe(50 * MiB);
    await expect(createUploadGrant(uploadRequest("video/mp4", 1).req as never, { filename: "f.mp4", content_type: "video/mp4", bytes: 50 * MiB + 1 }))
      .rejects.toThrow("MEDIA_REJECTED");
    await expect(createUploadGrant(uploadRequest("image/jpeg", 1).req as never, { filename: "p.jpg", content_type: "image/jpeg", bytes: 20 * MiB + 1 }))
      .rejects.toThrow("MEDIA_REJECTED");
  });

  it("records the chunk digests and the length of a fast-start video", async () => {
    const file = mp4({ durationMs: 9_000, payloadBytes: 2 * MiB + 100 });
    const { req, row } = uploadRequest("video/mp4", file.byteLength);
    stored.set(`quarantine-bucket:quarantine/${SITE}/${MEDIA}/key`, file);
    await completeUpload(req as never, MEDIA, sha(file), file.byteLength);
    const ready = row();
    expect(ready.state).toBe("READY");
    expect(ready.kind).toBe("file_video");
    expect(ready.duration_ms).toBe(9_000);
    const master = (ready.rendition_manifest as { master: Record<string, unknown> }).master;
    expect(master.chunk_size).toBe(MiB);
    expect(master.chunk_digests).toEqual(await chunkDigests(file, MiB));
    expect(master.bytes).toBe(file.byteLength);
  });

  it("refuses a video without fast start, and one with the wrong codec, naming why", async () => {
    for (const [file, code] of [[mp4({ faststart: false }), "VIDEO_NOT_FASTSTART"], [mp4({ video: "hvc1" }), "VIDEO_CODEC"]] as const) {
      const { req, row } = uploadRequest("video/mp4", file.byteLength);
      stored.set(`quarantine-bucket:quarantine/${SITE}/${MEDIA}/key`, file);
      await expect(completeUpload(req as never, MEDIA, sha(file), file.byteLength)).rejects.toThrow("MEDIA_REJECTED");
      expect(row()).toMatchObject({ state: "REJECTED", rejection_code: code });
    }
  });
});

describe("#2829 hero videos are at most 15 seconds", () => {
  const request = (durations: Record<string, number | null>) => ({
    context: {},
    user: { id: "u1", tenantId: TENANT, siteId: SITE },
    payload: {
      find: async () => ({ docs: Object.entries(durations).map(([id, duration_ms]) => ({ id, duration_ms })) }),
    },
  });

  it("accepts 15 s, refuses 15.001 s with the plain reason on the hero's video field", async () => {
    expect(heroVideoProblem(15_000)).toBeNull();
    expect(heroVideoProblem(15_001)).toBe(HERO_VIDEO_TOO_LONG_MESSAGE);
    expect(HERO_VIDEO_TOO_LONG_MESSAGE).toBe("Hero videos can be up to 15 seconds");
    await expect(assertHeroVideoLengths(request({ v10: 10_000 }) as never, [{ blockType: "hero", video: "v10" }])).resolves.toBeUndefined();
    const refusal = await assertHeroVideoLengths(
      request({ v20: 20_000 }) as never,
      [{ blockType: "rich_text" }, { blockType: "hero", video: "v20" }],
    ).catch((error: { data?: { errors?: unknown } }) => error);
    expect((refusal as { data: { errors: unknown } }).data.errors).toEqual([{ path: "blocks.1.video", message: HERO_VIDEO_TOO_LONG_MESSAGE }]);
  });

  it("refuses a hero video whose length is unknown; a film (video_feature) may be any length", async () => {
    const unknown = await assertHeroVideoLengths(request({ vx: null }) as never, [{ blockType: "hero", video: "vx" }])
      .catch((error: { data?: { errors?: Array<{ message: string }> } }) => error);
    expect((unknown as { data: { errors: Array<{ message: string }> } }).data.errors[0]!.message).toBe(HERO_VIDEO_LENGTH_UNKNOWN_MESSAGE);
    await expect(assertHeroVideoLengths(request({ long: 600_000 }) as never, [{ blockType: "video_feature", video: "long" }])).resolves.toBeUndefined();
    expect(fitsHero(15_000)).toBe(true);
    expect(fitsHero(15_001)).toBe(false);
    expect(fitsHero(undefined)).toBe(false);
  });
});

describe("#2829 the builder's video references", () => {
  it("uses the digests recorded at approval without reading storage", async () => {
    const digests = ["a".repeat(64), "b".repeat(64)];
    const read = vi.fn();
    const record = {
      id: MEDIA, state: "READY", detected_mime: "video/mp4", kind: "file_video", duration_ms: 9000,
      rendition_manifest: { master: { key: "k", digest: "d".repeat(64), bytes: MiB + 1, chunk_size: MiB, chunk_digests: digests } },
    };
    expect(await fileVideoIntegrity(record, read)).toEqual({ bytes: MiB + 1, chunk_size: MiB, chunk_digests: digests, duration_ms: 9000 });
    expect(read).not.toHaveBeenCalled();
  });

  it("computes them from VERIFIED bytes for a video approved before W6, and refuses bytes that do not match", async () => {
    const file = mp4({ durationMs: 7_000, payloadBytes: MiB });
    const record = {
      id: MEDIA, state: "READY", detected_mime: "video/mp4",
      rendition_manifest: { master: { key: "approved/legacy.mp4", digest: sha(file), bytes: file.byteLength } },
    };
    const integrity = await fileVideoIntegrity(record, async () => file);
    expect(integrity).toEqual({ bytes: file.byteLength, chunk_size: MiB, chunk_digests: await chunkDigests(file, MiB), duration_ms: 7_000 });
    const tampered = file.slice();
    tampered[100] ^= 1;
    await expect(fileVideoIntegrity(record, async () => tampered)).rejects.toThrow("MEDIA_PROCESSING");
  });

  it("tells file and stream videos apart and freezes a stream video's CDN rendition", () => {
    const stream = {
      id: "00000000-0000-4000-8000-000000000e09", state: "READY", kind: "stream_video", detected_mime: "video/mp4",
      stream_url: "https://vz-x.b-cdn.net/aaaaaaaa-1111-4111-8111-111111111111/play_720p.mp4", stream_host: "vz-x.b-cdn.net",
      width: null, height: 720, duration_ms: 9000,
    };
    expect(isStreamVideoRecord(stream)).toBe(true);
    expect(isFileVideoRecord(stream)).toBe(false);
    expect(streamVideoRef(stream)).toEqual({ id: stream.id, url: stream.stream_url, host: "vz-x.b-cdn.net", width: 0, height: 720, duration_ms: 9000 });
    expect(() => streamVideoRef({ ...stream, stream_host: "elsewhere.example" })).toThrow("ARTIFACT_MEDIA_MISMATCH");
  });
});

describe("#2829 the builder publishes videos the v2 contract accepts", () => {
  const BRAND = "00000000-0000-4000-8000-000000000e04";
  const VIDEO = "00000000-0000-4000-8000-000000000e05";
  const POSTER = "00000000-0000-4000-8000-000000000e06";
  const STREAM = "00000000-0000-4000-8000-000000000e07";
  type Doc = Record<string, unknown>;
  const payloadWith = (collections: Record<string, Doc[]>) => ({
    find: async (input: Doc) => ({ docs: collections[String(input.collection)] ?? [], totalDocs: (collections[String(input.collection)] ?? []).length }),
    findByID: async () => {
      throw new Error("NOT_FOUND");
    },
  });
  const poster = {
    id: POSTER, tenant: TENANT, state: "READY", detected_mime: "image/webp", width: 1440, height: 960,
    rendition_manifest: { version: 1, master: {}, renditions: [{ width: 1440, target_width: 1440, digest: "c".repeat(64), key: `approved/${SITE}/${POSTER}/${"c".repeat(64)}/1440.webp` }] },
  };
  const film = (durationMs: number) => ({
    id: VIDEO, tenant: TENANT, state: "READY", detected_mime: "video/mp4", kind: "file_video", duration_ms: durationMs,
    rendition_manifest: {
      version: 1,
      master: { key: `approved/${SITE}/${VIDEO}/${"b".repeat(64)}/master.mp4`, digest: "b".repeat(64), bytes: 2 * MiB + 1, chunk_size: MiB, chunk_digests: ["1".repeat(64), "2".repeat(64), "3".repeat(64)] },
      renditions: [],
    },
  });
  const stream = {
    id: STREAM, tenant: TENANT, state: "READY", detected_mime: "video/mp4", kind: "stream_video", duration_ms: 8000, height: 720,
    stream_url: "https://vz-x.b-cdn.net/aaaaaaaa-1111-4111-8111-111111111111/play_720p.mp4", stream_host: "vz-x.b-cdn.net",
  };
  async function build(blocks: Doc[], media: Doc[]) {
    const { buildPublicationArtifact, publicationDraftDigest } = await import("./artifactBuilder");
    const pages = [{ id: "home", tenant: TENANT, slug: "", parent: null, kind: "standard", title: "Home", enabled: true, blocks }];
    const settings = { id: "s", tenant: TENANT, display_name: "Video site" };
    const collections: Record<string, Doc[]> = { pages, navigation: [], footer: [], "site-settings": [settings], media };
    const sourceDigest = await publicationDraftDigest({ pages, navigation: null, footer: null, settings, media });
    return buildPublicationArtifact({ context: {}, payload: payloadWith(collections) } as never, {
      tenant: { id: TENANT, core_site_id: SITE, core_brand_id: BRAND, primary_hostname: "video.sites.localhost" },
      operationId: "op-w6",
      publicationId: "00000000-0000-4000-8000-000000000e08",
      sourceRevisionId: "rev-w6",
      sourceDigest,
      generatedAt: "2026-10-26T00:00:00Z",
    } as never);
  }
  const hero = (video: string) => ({ blockType: "hero", heading: "Hello", media: POSTER, video, ctas: [] });
  const filmBlock = (video: string) => ({ blockType: "video_feature", heading: "Our film", video, poster: POSTER });

  it("freezes size, chunk digests and length into a file video (contract-valid)", async () => {
    const { artifact, serialized } = await build([hero(VIDEO), filmBlock(VIDEO)], [poster, film(12_000)]);
    const ref = (artifact.media as Doc[]).find((item) => item.id === VIDEO)!;
    expect(ref).toMatchObject({ url: `/media/${VIDEO}/video.mp4`, bytes: 2 * MiB + 1, chunk_size: MiB, duration_ms: 12_000 });
    expect(ref.chunk_digests).toHaveLength(3);
    const { assertArtifactV2 } = await import("../contracts/generated/artifactV2.ts");
    expect(() => assertArtifactV2(JSON.parse(serialized))).not.toThrow();
  });

  it("refuses to publish a hero whose video is longer than 15 seconds (a film may be long)", async () => {
    await expect(build([hero(VIDEO)], [poster, film(20_000)])).rejects.toThrow("VALIDATION_FAILED");
    await expect(build([filmBlock(VIDEO)], [poster, film(600_000)])).resolves.toBeTruthy();
  });

  it("publishes a stream video as a stream reference, never as a stored media object", async () => {
    const { artifact, serialized } = await build([hero(STREAM)], [poster, stream]);
    expect(artifact.stream_videos).toEqual([{ id: STREAM, url: stream.stream_url, host: "vz-x.b-cdn.net", width: 0, height: 720, duration_ms: 8000 }]);
    expect((artifact.media as Doc[]).some((item) => item.id === STREAM)).toBe(false);
    const page = (artifact.pages as Array<{ blocks: Doc[] }>)[0]!;
    expect(page.blocks[0]!.video_url).toBe(stream.stream_url);
    const { assertArtifactV2 } = await import("../contracts/generated/artifactV2.ts");
    expect(() => assertArtifactV2(JSON.parse(serialized))).not.toThrow();
  });
});
