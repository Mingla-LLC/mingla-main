/**
 * ISSUE-866 WP3 — mingla-tester ADVERSARIAL suite (APPEND-ONLY; QA-owned).
 *
 * Attacks DIFFERENT angles than the implementor's 123-test happy-path suites:
 *   - REAL-ENCODER fixtures: two genuine ffmpeg/x264+aac MP4s and a genuine
 *     cwebp VP8L WebP are embedded (base64) — the probe is held to real
 *     encoder output forever, not just synthetic boxes. Ground truth was
 *     verified against ffprobe + `shasum -a 256` in the WP3 QA run.
 *   - corrupt/truncated headers, box-size overflow, zero-duration-with-audio
 *     (patched mvhd), extension-vs-magic-bytes masquerade, the >64 MB fetch
 *     guard (lying Content-Length), byte-cap and duration BOUNDARIES,
 *     same-length hash-collision cache attacks, waiter-path hash defenses,
 *     token-scrub on the failure write path, unicode file names, chunked-Snap
 *     INIT/ADD(retry)/FINALIZE wire shape, Google magic-byte gate +
 *     duplicate-name suffix + resumable-header contract, resolver-level
 *     Reddit fail-close.
 *
 * FAILS-ON-REVERT ANCHOR (tester's, at a DIFFERENT line than the implementor's
 * audio-reject anchor in adCreativeMatrix.ts): the content-hash match guard in
 * resolveCreativeRef step 4 (adCreative.ts — "cached.content_hash ===
 * creative.content_hash"). Deleting that guard makes the cached `ready` ref
 * return unconditionally — the "hash-collision attack" and "changed bytes"
 * tests below then FAIL (stale platform asset silently reused; on Google,
 * immutable-asset staleness — GR-53). Verified by true line-deletion in the
 * WP3 QA run.
 *
 * ZERO live platform calls: every network seam is an injected deps.fetchImpl
 * or a scoped globalThis.fetch stub (metaGraph resolves fetch globally by WP1
 * design).
 *
 * Run: deno test --allow-env --allow-read --no-check \
 *   supabase/functions/_shared/__tests__/issue866_wp3_tester_adversarial.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { AdConnectionRow, Lane, Platform } from "../adChannel.ts";
import {
  type AdCreativeRow,
  CREATIVE_FETCH_MAX_BYTES,
  CREATIVE_UPLOAD_ADAPTERS,
  CreativeByteSourceError,
  CreativeLaneNotProvisionedError,
  type CreativeRefDb,
  type CreativeRefRow,
  CreativeUploadError,
  type CreativeUploadAdapter,
  type CreativeUploadedRef,
  fetchCreativeBytes,
  googleAssetName,
  googleCreativeAdapter,
  metaCreativeAdapter,
  META_VIDEO_POLL_MAX_ATTEMPTS,
  resolveCreativeRef,
  snapchatCreativeAdapter,
  SNAP_SINGLE_SHOT_MAX_BYTES,
  tiktokCreativeAdapter,
} from "../adCreative.ts";
import { probeCreativeBytes, sha256Hex } from "../adCreativeProbe.ts";
import { type CreativeMediaFacts, validateCreativeForChannel } from "../adCreativeMatrix.ts";
import { makeJpeg } from "./adCreativeProbe.test.ts";

// ── REAL-ENCODER fixtures (embedded; see header) ─────────────────────────────
// tiny_audio_90x160_1s.mp4  — ffmpeg lavfi testsrc+sine → libx264 + AAC, 90×160, 1 s
// tiny_noaudio_90x160_1s.mp4 — same encode with -an (NO audio track)
// webp_lossless_800x600.webp — cwebp -lossless from an 800×600 PNG (VP8L)
const REAL_MP4_AUDIO_B64 = "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";
const REAL_MP4_NOAUDIO_B64 = "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";
const REAL_WEBP_B64 = "UklGRjYAAABXRUJQVlA4TCkAAAAvH8OVAAcQ9Y/+BwQkSf//kxH9z/jPf/7zn//85z//+c9//vOf//yfTQA=";
// Independent ground truth (macOS `shasum -a 256` over the exact fixture bytes):
const REAL_MP4_AUDIO_SHA256 = "a8ea6112a0bf8683842b95152a0af903394c841f8967781264a20bd30bc1adfb";
const REAL_MP4_NOAUDIO_SHA256 = "6f3e22eafa1cc111aca6c4d3e40a7443b34f187e48df761564e04795bd4191ba";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const REAL_MP4_AUDIO = b64ToBytes(REAL_MP4_AUDIO_B64);
const REAL_MP4_NOAUDIO = b64ToBytes(REAL_MP4_NOAUDIO_B64);
const REAL_WEBP = b64ToBytes(REAL_WEBP_B64);

const MB = 1024 * 1024;
const NO_SLEEP = (): Promise<void> => Promise.resolve();

// ── P. Byte-probe vs REAL encoders + corruption ──────────────────────────────

Deno.test("QA-P1 REAL ffmpeg x264+AAC MP4: dims/duration/audio/fourcc/hash probe correctly", async () => {
  const probe = await probeCreativeBytes(REAL_MP4_AUDIO);
  assertEquals(probe.kind, "video");
  assertEquals(probe.mimeType, "video/mp4");
  assertEquals(probe.width, 90);
  assertEquals(probe.height, 160);
  assertEquals(probe.durationSeconds, 1);
  assertEquals(probe.hasAudio, true);
  assertEquals(probe.videoCodecFourcc, "avc1");
  assertEquals(probe.byteSize, 6094);
  assertEquals(probe.contentHash, REAL_MP4_AUDIO_SHA256);
});

Deno.test("QA-P2 REAL silent ffmpeg MP4 (-an): hasAudio=false from real encoder output", async () => {
  const probe = await probeCreativeBytes(REAL_MP4_NOAUDIO);
  assertEquals(probe.hasAudio, false);
  assertEquals(probe.width, 90);
  assertEquals(probe.contentHash, REAL_MP4_NOAUDIO_SHA256);
});

Deno.test("QA-P3 REAL cwebp VP8L lossless: 800×600 parsed from a real encoder", async () => {
  const probe = await probeCreativeBytes(REAL_WEBP);
  assertEquals(probe.mimeType, "image/webp");
  assertEquals(probe.width, 800);
  assertEquals(probe.height, 600);
});

Deno.test("QA-P4 zero-duration mvhd with a REAL audio track: duration 0, bitrate null (no div-by-zero)", async () => {
  const patched = REAL_MP4_AUDIO.slice();
  let idx = -1;
  for (let i = 0; i + 4 <= patched.length; i++) {
    if (patched[i] === 0x6d && patched[i + 1] === 0x76 && patched[i + 2] === 0x68 && patched[i + 3] === 0x64) {
      idx = i;
      break;
    }
  }
  assert(idx > 0, "mvhd box present in the real fixture");
  const durOff = idx + 4 + 16; // v0 payload: duration u32 at +16
  patched[durOff] = 0;
  patched[durOff + 1] = 0;
  patched[durOff + 2] = 0;
  patched[durOff + 3] = 0;
  const probe = await probeCreativeBytes(patched);
  assertEquals(probe.durationSeconds, 0);
  assertEquals(probe.hasAudio, true);
  assertEquals(probe.overallBitrateKbps, null, "0-duration must not fabricate a bitrate");
});

Deno.test("QA-P5 extension is a lie: WebP bytes behind a .png name probe as image/webp (magic bytes win)", async () => {
  // The caller only ever hands the probe BYTES — this pins that nothing
  // upstream can smuggle a mime through a file extension.
  const probe = await probeCreativeBytes(REAL_WEBP);
  assertEquals(probe.mimeType, "image/webp");
});

Deno.test("QA-P6 truncated REAL MP4 (cut before moov): no fabricated dimensions or duration", async () => {
  const truncated = REAL_MP4_AUDIO.slice(0, 40); // complete ftyp, moov unreachable
  const probe = await probeCreativeBytes(truncated);
  assertEquals(probe.kind, "video");
  assertEquals(probe.width, null);
  assertEquals(probe.height, null);
  assertEquals(probe.durationSeconds, null);
});

Deno.test("QA-P7 box-size overflow: a box claiming to extend past the buffer stops the walk fail-close", async () => {
  const overflow = REAL_MP4_AUDIO.slice(0, 32 + 8); // keep real ftyp + one bogus header
  overflow[32] = 0x7f; // size = 0x7fffffff — way past the buffer
  overflow[33] = 0xff;
  overflow[34] = 0xff;
  overflow[35] = 0xff;
  const probe = await probeCreativeBytes(overflow);
  assertEquals(probe.width, null, "an overflowing box must not yield parsed data");
  assertEquals(probe.durationSeconds, null);
});

Deno.test("QA-P8 zero-byte and garbage buffers are refused fail-close", async () => {
  await assertRejects(() => probeCreativeBytes(new Uint8Array(0)));
  await assertRejects(() => probeCreativeBytes(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])));
});

// ── Fetch guard (CREATIVE_FETCH_MAX_BYTES) ───────────────────────────────────

Deno.test("QA-G1 >64MB guard: a lying Content-Length rejects BEFORE buffering", async () => {
  const fetchImpl = (() =>
    Promise.resolve(
      new Response(new Uint8Array([1, 2, 3]) as unknown as BodyInit, {
        status: 200,
        headers: { "content-length": String(CREATIVE_FETCH_MAX_BYTES + 1) },
      }),
    )) as typeof fetch;
  await assertRejects(
    () => fetchCreativeBytes("https://cdn.example.com/huge.mp4", { fetchImpl }),
    CreativeByteSourceError,
    "edge buffer guard",
  );
});

Deno.test("QA-G2 guard: a body LARGER than the cap (no Content-Length header) is still caught post-buffer", async () => {
  const fetchImpl = (() => Promise.resolve(new Response(new Uint8Array(2048) as unknown as BodyInit, { status: 200 }))) as typeof fetch;
  await assertRejects(
    () => fetchCreativeBytes("https://cdn.example.com/sneaky.mp4", { fetchImpl }, 1024),
    CreativeByteSourceError,
  );
});

// ── M. Matrix cross-channel + boundaries ─────────────────────────────────────

function facts(overrides: Partial<CreativeMediaFacts> = {}): CreativeMediaFacts {
  return {
    kind: "image",
    mimeType: "image/jpeg",
    container: null,
    width: 2400,
    height: 2400,
    aspectRatio: 1,
    durationSeconds: null,
    hasAudio: null,
    byteSize: 2 * MB,
    overallBitrateKbps: null,
    posterPresent: true,
    variantRatios: [],
    ...overrides,
  };
}

function videoFacts(overrides: Partial<CreativeMediaFacts> = {}): CreativeMediaFacts {
  return facts({
    kind: "video",
    mimeType: "video/mp4",
    container: "mp4/isom",
    width: 1080,
    height: 1920,
    aspectRatio: 0.5625,
    durationSeconds: 30,
    hasAudio: true,
    byteSize: 10 * MB,
    overallBitrateKbps: 2000,
    ...overrides,
  });
}

Deno.test("QA-M1 one 6MB 1:1 JPEG, three verdicts: Meta PASSES, Google and Snap HARD-REJECT", () => {
  const f = facts({ byteSize: 6 * MB });
  const meta = validateCreativeForChannel("meta", f);
  const google = validateCreativeForChannel("google", f);
  const snap = validateCreativeForChannel("snapchat", f);
  assertEquals(meta.ok, true, "Meta's cap is 30 MB — 6 MB must pass");
  assert(!meta.checks.some((c) => c.rule === "image.max_bytes"));
  assertEquals(google.ok, false);
  assert(google.checks.some((c) => c.rule === "image.max_bytes" && c.level === "reject"));
  assertEquals(snap.ok, false);
  assert(snap.checks.some((c) => c.rule === "image.max_bytes" && c.level === "reject"));
});

Deno.test("QA-M2 Google byte-cap boundary: exactly 5,120 KB passes; one byte over rejects", () => {
  const atCap = validateCreativeForChannel("google", facts({ byteSize: 5120 * 1024 }));
  assert(!atCap.checks.some((c) => c.rule === "image.max_bytes"));
  const overCap = validateCreativeForChannel("google", facts({ byteSize: 5120 * 1024 + 1 }));
  assert(overCap.checks.some((c) => c.rule === "image.max_bytes" && c.level === "reject"));
});

Deno.test("QA-M3 TikTok policy boundary: 60 s passes, 61 s rejects (the 10-minute trap)", () => {
  const ok60 = validateCreativeForChannel("tiktok", videoFacts({ durationSeconds: 60 }));
  assert(!ok60.checks.some((c) => c.rule === "video.duration_policy"));
  const bad61 = validateCreativeForChannel("tiktok", videoFacts({ durationSeconds: 61 }));
  assert(bad61.checks.some((c) => c.rule === "video.duration_policy" && c.level === "reject"));
});

Deno.test("QA-M4 Meta Advantage+ duration boundaries: 5 s and 180 s pass; 4 s and 181 s reject", () => {
  for (const okDur of [5, 180]) {
    const r = validateCreativeForChannel("meta", videoFacts({ durationSeconds: okDur }));
    assert(!r.checks.some((c) => c.rule === "video.duration"), `${okDur}s must pass`);
  }
  for (const badDur of [4, 181]) {
    const r = validateCreativeForChannel("meta", videoFacts({ durationSeconds: badDur }));
    assert(r.checks.some((c) => c.rule === "video.duration" && c.level === "reject"), `${badDur}s must reject`);
  }
});

Deno.test("QA-M5 zero-duration video: duration rejects on TikTok (0<5) and Snap (0<3); no crash on bitrate", () => {
  const f = videoFacts({ durationSeconds: 0, overallBitrateKbps: null });
  const tk = validateCreativeForChannel("tiktok", f);
  assert(tk.checks.some((c) => c.rule === "video.duration_policy" && c.level === "reject"));
  const sn = validateCreativeForChannel("snapchat", f);
  assert(sn.checks.some((c) => c.rule === "video.duration" && c.level === "reject"));
});

Deno.test("QA-M6 Reddit image dims row is [3P]: off-list ratio WARNS, never rejects", () => {
  const r = validateCreativeForChannel("reddit", facts({ width: 1000, height: 400, aspectRatio: 2.5 }));
  assertEquals(r.ok, true);
  assert(r.checks.some((c) => c.rule === "image.dims" && c.level === "warn" && c.confidence === "3P"));
});

Deno.test("QA-M7 Snap single-shot boundary: exactly 32 MB has no chunked warn; 32 MB + 1 warns", () => {
  const at = validateCreativeForChannel("snapchat", videoFacts({ byteSize: 32 * MB }));
  assert(!at.checks.some((c) => c.rule === "video.chunked_path"));
  const over = validateCreativeForChannel("snapchat", videoFacts({ byteSize: 32 * MB + 1 }));
  assert(over.checks.some((c) => c.rule === "video.chunked_path" && c.level === "warn"));
});

// ── R. Resolver cache-key attacks (in-memory CreativeRefDb) ──────────────────

function connection(platform: Platform, overrides: Partial<AdConnectionRow> = {}): AdConnectionRow {
  return {
    id: "00000000-0000-0000-0000-00000000c0a1",
    platform,
    lane: "consumer",
    display_name: `${platform} · Consumer`,
    external_account_id: "acct-qa",
    external_org_id: null,
    auth_kind: "system_user_token",
    token_env_var: "META_SYSTEM_USER_TOKEN",
    extra: {},
    status: "connected",
    currency: "USD",
    timezone: null,
    min_daily_budget_cents: 100,
    account_status: "ACTIVE",
    token_last_verified_at: null,
    connected: true,
    ...overrides,
  };
}

function metaCleanImage(overrides: Partial<AdCreativeRow> = {}): AdCreativeRow {
  return {
    id: "00000000-0000-0000-0000-00000000aa01",
    kind: "image",
    name: "qa-adversarial",
    source_url: "https://cdn.example.com/qa.jpg",
    storage_bucket: null,
    storage_path: null,
    bunny_video_id: null,
    poster_url: null,
    mp4_master_url: null,
    place_id: null,
    brand_id: null,
    width: 2400,
    height: 2400,
    aspect_ratio: 1,
    duration_seconds: null,
    mime_type: "image/jpeg",
    byte_size: 2 * MB,
    has_audio: null,
    content_hash: "hash-live",
    ai_generated: true,
    variants: {},
    status: "active",
    ...overrides,
  };
}

interface RefState {
  connection: AdConnectionRow | null;
  creative: AdCreativeRow | null;
  refs: CreativeRefRow[]; // successive getRef reads pop from the front; last repeats
  uploading: number;
  ready: { ref: CreativeUploadedRef; contentHash: string }[];
  failed: string[];
}

function refDb(state: RefState): CreativeRefDb {
  let reads = 0;
  return {
    // deno-lint-ignore require-await
    getConnection: async () => state.connection,
    // deno-lint-ignore require-await
    getCreative: async () => state.creative,
    // deno-lint-ignore require-await
    getRef: async () => {
      const idx = Math.min(reads, state.refs.length - 1);
      reads++;
      return state.refs.length > 0 ? state.refs[idx] : null;
    },
    // deno-lint-ignore require-await
    upsertRefUploading: async () => {
      state.uploading++;
    },
    // deno-lint-ignore require-await
    markRefReady: async (_c, _p, _l, _a, ref, contentHash) => {
      state.ready.push({ ref, contentHash });
    },
    // deno-lint-ignore require-await
    markRefFailed: async (_c, _p, _l, _a, error) => {
      state.failed.push(error);
    },
  };
}

function ref(overrides: Partial<CreativeRefRow> = {}): CreativeRefRow {
  return {
    id: "00000000-0000-0000-0000-00000000rr01",
    creative_id: "00000000-0000-0000-0000-00000000aa01",
    platform: "meta",
    lane: "consumer",
    external_account_id: "acct-qa",
    external_kind: "image",
    external_ref: "stale-platform-ref",
    external_ref_extra: {},
    content_hash: "hash-stale",
    status: "ready",
    error: null,
    uploaded_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function counting(platform: Platform): { adapter: CreativeUploadAdapter; calls: () => number } {
  let n = 0;
  return {
    adapter: {
      platform,
      // deno-lint-ignore require-await
      upload: async (): Promise<CreativeUploadedRef> => {
        n++;
        return { external_kind: "image", external_ref: `fresh-${n}`, external_ref_extra: {}, external_account_id: "acct-qa" };
      },
    },
    calls: () => n,
  };
}

function withAdapter(platform: Platform, adapter: CreativeUploadAdapter): Record<Platform, CreativeUploadAdapter> {
  return { ...CREATIVE_UPLOAD_ADAPTERS, [platform]: adapter };
}

Deno.test("QA-R1 hash-collision attack: SAME LENGTH, different bytes → different sha256 → FRESH upload", async () => {
  // Two equal-length buffers differing in one byte — a size/name-keyed cache
  // would treat these as identical; the content-hash key must not.
  const a = new Uint8Array(4096).fill(7);
  const b = a.slice();
  b[2048] = 8;
  const hashA = await sha256Hex(a);
  const hashB = await sha256Hex(b);
  assert(hashA !== hashB, "sha256 must differ on a 1-byte flip at equal length");
  // PROTECTED GUARD (tester fails-on-revert anchor): resolveCreativeRef step 4
  // returns a cached `ready` ref ONLY on content_hash match. Deleting that
  // guard makes this test fail — the stale platform ref would be reused for
  // different bytes (GR-53: on Google that silently serves a stale immutable
  // asset).
  const { adapter, calls } = counting("meta");
  const state: RefState = {
    connection: connection("meta"),
    creative: metaCleanImage({ content_hash: hashA, byte_size: 4096 }),
    refs: [ref({ content_hash: hashB })],
    uploading: 0,
    ready: [],
    failed: [],
  };
  const result = await resolveCreativeRef(refDb(state), state.creative!.id, "meta", "consumer", {
    adapters: withAdapter("meta", adapter),
    sleep: NO_SLEEP,
  });
  assertEquals(calls(), 1, "hash mismatch MUST force a fresh platform upload");
  assertEquals(result.external_ref, "fresh-1");
  assertEquals(state.ready[0]?.contentHash, hashA, "the ready row must snapshot the CURRENT hash");
});

Deno.test("QA-R2 corrupt cache row: status=ready with external_ref NULL is a miss, never a null ref", async () => {
  const { adapter, calls } = counting("meta");
  const state: RefState = {
    connection: connection("meta"),
    creative: metaCleanImage(),
    refs: [ref({ content_hash: "hash-live", external_ref: null })],
    uploading: 0,
    ready: [],
    failed: [],
  };
  const result = await resolveCreativeRef(refDb(state), state.creative!.id, "meta", "consumer", {
    adapters: withAdapter("meta", adapter),
    sleep: NO_SLEEP,
  });
  assertEquals(calls(), 1);
  assertEquals(result.external_ref, "fresh-1");
});

Deno.test("QA-R3 token-laden adapter failure: the FAILED row write is scrubbed (no Bearer/EAA token survives)", async () => {
  const hostile: CreativeUploadAdapter = {
    platform: "meta",
    // deno-lint-ignore require-await
    upload: async (): Promise<CreativeUploadedRef> => {
      throw new Error("Meta said no. Authorization: Bearer EAAsupersecrettokenvalue99887766554433 leaked in a stack");
    },
  };
  const state: RefState = {
    connection: connection("meta"),
    creative: metaCleanImage(),
    refs: [],
    uploading: 0,
    ready: [],
    failed: [],
  };
  await assertRejects(
    () =>
      resolveCreativeRef(refDb(state), state.creative!.id, "meta", "consumer", {
        adapters: withAdapter("meta", hostile),
        sleep: NO_SLEEP,
      }),
    CreativeUploadError,
  );
  assertEquals(state.failed.length, 1);
  assert(!state.failed[0].includes("EAAsupersecret"), `token leaked into the error column: ${state.failed[0]}`);
  assert(!/Bearer\s+EAA/i.test(state.failed[0]));
});

Deno.test("QA-R4 waiter path: an `uploading` row that turns ready WITH a matching hash returns cached, zero uploads", async () => {
  const { adapter, calls } = counting("meta");
  const state: RefState = {
    connection: connection("meta"),
    creative: metaCleanImage(),
    refs: [
      ref({ status: "uploading", external_ref: null, content_hash: "hash-live" }),
      ref({ status: "ready", external_ref: "winner-ref", content_hash: "hash-live" }),
    ],
    uploading: 0,
    ready: [],
    failed: [],
  };
  const result = await resolveCreativeRef(refDb(state), state.creative!.id, "meta", "consumer", {
    adapters: withAdapter("meta", adapter),
    sleep: NO_SLEEP,
  });
  assertEquals(result.external_ref, "winner-ref");
  assertEquals(calls(), 0, "the waiter must reuse the winner's upload");
});

Deno.test("QA-R5 waiter hash defense: an `uploading` row that turns ready with a MISMATCHED hash is NOT returned", async () => {
  const { adapter, calls } = counting("meta");
  const state: RefState = {
    connection: connection("meta"),
    creative: metaCleanImage({ content_hash: "hash-live" }),
    refs: [
      ref({ status: "uploading", external_ref: null, content_hash: "hash-stale" }),
      ref({ status: "ready", external_ref: "stale-winner", content_hash: "hash-stale" }),
    ],
    uploading: 0,
    ready: [],
    failed: [],
  };
  const result = await resolveCreativeRef(refDb(state), state.creative!.id, "meta", "consumer", {
    adapters: withAdapter("meta", adapter),
    sleep: NO_SLEEP,
  });
  assertEquals(calls(), 1, "a stale-hash winner must not satisfy the waiter");
  assertEquals(result.external_ref, "fresh-1");
});

Deno.test("QA-R6 resolver-level Reddit fail-close: typed lane error AND the ref row is marked failed", async () => {
  const state: RefState = {
    connection: connection("reddit", { platform: "reddit", token_env_var: "REDDIT_REFRESH_TOKEN", auth_kind: "refresh_token" }),
    creative: metaCleanImage(),
    refs: [],
    uploading: 0,
    ready: [],
    failed: [],
  };
  await assertRejects(
    () => resolveCreativeRef(refDb(state), state.creative!.id, "reddit", "consumer", { sleep: NO_SLEEP }),
    CreativeLaneNotProvisionedError,
  );
  assertEquals(state.failed.length, 1, "fail-close must land on the ref row for retry visibility");
});

// ── W. Wire-shape (mock-intercepted adapters; NO live platform writes) ───────

function withEnv(pairs: [string, string][], fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const prior = pairs.map(([n]) => [n, Deno.env.get(n)] as const);
    for (const [n, v] of pairs) Deno.env.set(n, v);
    try {
      await fn();
    } finally {
      for (const [name, value] of prior) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  };
}

const META_ENV: [string, string][] = [
  ["META_SYSTEM_USER_TOKEN", "EAAqaMetaTokenValue000111222333"],
  ["META_AD_ACCOUNT_ID", "acct-qa"],
  ["META_PAGE_ID", "page-qa"],
];
const SNAP_ENV: [string, string][] = [
  ["SNAPCHAT_REFRESH_TOKEN", "snap-refresh-QAQAQA"],
  ["SNAPCHAT_CLIENT_ID", "snap-client-qa"],
  ["SNAPCHAT_CLIENT_SECRET", "snap-secret-QQQQQQQQ"],
];
const GOOGLE_ENV: [string, string][] = [
  ["GOOGLE_ADS_REFRESH_TOKEN", "g-refresh-qa"],
  ["GOOGLE_ADS_OAUTH_CLIENT_ID", "g-client-qa"],
  ["GOOGLE_ADS_OAUTH_CLIENT_SECRET", "g-secret-qa"],
  ["GOOGLE_ADS_DEVELOPER_TOKEN", "g-devtoken-qa"],
];

Deno.test(
  "QA-W1 Meta video stuck in transcoding: bounded poll then typed timeout, poster NEVER fetched",
  withEnv(META_ENV, async () => {
    let statusPolls = 0;
    let posterFetched = false;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("/advideos")) {
        return Promise.resolve(new Response(JSON.stringify({ id: "vid-stuck" }), { status: 200 }));
      }
      if (url.includes("vid-stuck")) {
        statusPolls++;
        return Promise.resolve(new Response(JSON.stringify({ status: { video_status: "processing" } }), { status: 200 }));
      }
      if (url.includes("poster")) {
        posterFetched = true;
        return Promise.resolve(new Response(makeJpeg(1080, 1920) as unknown as BodyInit, { status: 200 }));
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? ""}`);
    }) as typeof fetch;
    try {
      await assertRejects(
        () =>
          metaCreativeAdapter.upload(
            metaCleanImage({
              kind: "video",
              mp4_master_url: "https://cdn.example.com/stuck-master.mp4",
              poster_url: "https://cdn.example.com/poster.jpg",
              bunny_video_id: "bunny-stuck",
              duration_seconds: 30,
              has_audio: true,
              mime_type: "video/mp4",
            }),
            { lane: "consumer" as Lane, external_account_id: "acct-qa", tokenEnvVar: "META_SYSTEM_USER_TOKEN", connection: connection("meta") },
            { sleep: NO_SLEEP },
          ),
        CreativeUploadError,
        "still processing",
      );
    } finally {
      globalThis.fetch = priorFetch;
    }
    assertEquals(statusPolls, META_VIDEO_POLL_MAX_ATTEMPTS, "the poll must be BOUNDED at the constant");
    assertEquals(posterFetched, false, "fail-close BEFORE any poster/thumbnail work");
  }),
);

Deno.test(
  "QA-W2 TikTok unicode name + collision: timestamp suffix lands INSIDE the extension; both ids captured from an ARRAY envelope",
  withEnv([["TIKTOK_ACCESS_TOKEN", "tiktok-token-QA"]], async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      bodies.push({ url, ...body });
      assertEquals(new Headers(init?.headers).get("Access-Token"), "tiktok-token-QA");
      if (url.includes("/file/name/check/")) {
        return Promise.resolve(new Response(JSON.stringify({ code: 0, message: "OK", data: { is_exist: true } }), { status: 200 }));
      }
      if (url.includes("/file/image/ad/upload/")) {
        assertEquals(body.upload_type, "UPLOAD_BY_URL");
        assertEquals(body.image_url, "https://cdn.example.com/qa.jpg");
        // Array-shaped data (TikTok returns lists on some paths) — both ids required.
        return Promise.resolve(new Response(
          JSON.stringify({ code: 0, message: "OK", data: [{ image_id: "img-999", material_id: "mat-999" }] }),
          { status: 200 },
        ));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const result = await tiktokCreativeAdapter.upload(
      metaCleanImage({ name: "Lagos 夜景 🌃" }),
      { lane: "consumer" as Lane, external_account_id: "adv-qa", tokenEnvVar: "TIKTOK_ACCESS_TOKEN" },
      { fetchImpl, sleep: NO_SLEEP },
    );
    assertEquals(result.external_ref, "mat-999");
    assertEquals(result.external_ref_extra.image_id, "img-999");
    const uploadBody = bodies.find((b) => String(b.url).includes("/image/ad/upload/"));
    assert(uploadBody, "upload call happened");
    const fileName = String(uploadBody!.file_name);
    assert(/^Lagos 夜景 🌃_\d+\.img$/.test(fileName), `collision suffix must precede the extension, got: ${fileName}`);
  }),
);

Deno.test(
  "QA-W3 TikTok video: Smart-Fix flags ON in the wire body; fix_task_id/flaw_types captured in extra",
  withEnv([["TIKTOK_ACCESS_TOKEN", "tiktok-token-QA"]], async () => {
    const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (url.includes("/file/name/check/")) {
        return Promise.resolve(new Response(JSON.stringify({ code: 0, message: "OK", data: { is_exist: false } }), { status: 200 }));
      }
      if (url.includes("/file/video/ad/upload/")) {
        assertEquals(body.upload_type, "UPLOAD_BY_URL");
        assertEquals(body.flaw_detect, true);
        assertEquals(body.auto_fix_enabled, true);
        assertEquals(body.auto_bind_enabled, true);
        return Promise.resolve(new Response(
          JSON.stringify({
            code: 0,
            message: "OK",
            data: { video_id: "vid-777", material_id: "mat-777", fix_task_id: "fix-1", flaw_types: ["LOW_RESOLUTION"] },
          }),
          { status: 200 },
        ));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const result = await tiktokCreativeAdapter.upload(
      metaCleanImage({ kind: "video", mp4_master_url: "https://cdn.example.com/qa-master.mp4", poster_url: "https://x/p.jpg", bunny_video_id: "b1", duration_seconds: 30, has_audio: true, mime_type: "video/mp4" }),
      { lane: "consumer" as Lane, external_account_id: "adv-qa", tokenEnvVar: "TIKTOK_ACCESS_TOKEN" },
      { fetchImpl, sleep: NO_SLEEP },
    );
    assertEquals(result.external_ref, "mat-777");
    assertEquals(result.external_ref_extra.video_id, "vid-777");
    assertEquals(result.external_ref_extra.fix_task_id, "fix-1");
  }),
);

Deno.test(
  "QA-W4 Snap chunked >32MB: INIT → ADD ×3 (with a per-chunk retry) → FINALIZE → poll READY; multipart bodies",
  withEnv(SNAP_ENV, async () => {
    const SIZE = 70 * MB; // ceil(70/32) = 3 chunks
    const bigBytes = new Uint8Array(SIZE);
    const addParts: number[] = [];
    let addFailuresInjected = 0;
    let finalized = false;
    let polls = 0;
    const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("accounts.snapchat.com")) {
        assertStringIncludes(String(init?.body), "grant_type=refresh_token");
        return Promise.resolve(new Response(JSON.stringify({ access_token: "minted-qa" }), { status: 200 }));
      }
      if (url.includes("cdn.example.com/huge-master.mp4")) {
        return Promise.resolve(new Response(bigBytes as unknown as BodyInit, { status: 200 }));
      }
      if (url.endsWith("/adaccounts/acct-qa/media")) {
        return Promise.resolve(new Response(
          JSON.stringify({ request_status: "SUCCESS", media: [{ sub_request_status: "SUCCESS", media: { id: "media-chunky" } }] }),
          { status: 200 },
        ));
      }
      if (url.includes("action=INIT")) {
        assertStringIncludes(url, `file_size=${SIZE}`);
        return Promise.resolve(new Response(JSON.stringify({ request_status: "SUCCESS", result: { upload_id: "up-42" } }), { status: 200 }));
      }
      if (url.includes("action=ADD")) {
        assert(init?.body instanceof FormData, "chunk ADD must be multipart/form-data");
        assertStringIncludes(url, "upload_id=up-42");
        const part = Number(new URL(url).searchParams.get("part_number"));
        if (part === 2 && addFailuresInjected === 0) {
          addFailuresInjected++;
          return Promise.resolve(new Response(JSON.stringify({ request_status: "FAILURE", debug_message: "flaky chunk" }), { status: 200 }));
        }
        addParts.push(part);
        return Promise.resolve(new Response(JSON.stringify({ request_status: "SUCCESS" }), { status: 200 }));
      }
      if (url.includes("action=FINALIZE")) {
        finalized = true;
        return Promise.resolve(new Response(JSON.stringify({ request_status: "SUCCESS" }), { status: 200 }));
      }
      if (url.endsWith("/media/media-chunky")) {
        polls++;
        return Promise.resolve(new Response(
          JSON.stringify({ request_status: "SUCCESS", media: [{ sub_request_status: "SUCCESS", media: { id: "media-chunky", media_status: polls >= 2 ? "READY" : "PENDING_UPLOAD" } }] }),
          { status: 200 },
        ));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const result = await snapchatCreativeAdapter.upload(
      metaCleanImage({
        kind: "video",
        mp4_master_url: "https://cdn.example.com/huge-master.mp4",
        poster_url: "https://x/p.jpg",
        bunny_video_id: "b-huge",
        duration_seconds: 30,
        has_audio: true,
        mime_type: "video/mp4",
        byte_size: SIZE,
      }),
      { lane: "consumer" as Lane, external_account_id: "acct-qa", tokenEnvVar: "SNAPCHAT_REFRESH_TOKEN" },
      { fetchImpl, sleep: NO_SLEEP },
    );
    assertEquals(result.external_ref, "media-chunky");
    assertEquals(addParts, [1, 2, 3], "chunk parts must arrive in order (part 2 retried once)");
    assertEquals(addFailuresInjected, 1, "the injected chunk failure was consumed by the retry");
    assert(finalized, "FINALIZE must complete the chunked upload");
    assert(SIZE > SNAP_SINGLE_SHOT_MAX_BYTES);
  }),
);

Deno.test(
  "QA-W5 Snap FINALIZE smuggles a nested sub_request_status FAILURE inside a 200/SUCCESS envelope → typed throw",
  withEnv(SNAP_ENV, async () => {
    const fetchImpl = ((input: URL | Request | string, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("accounts.snapchat.com")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "minted-qa" }), { status: 200 }));
      }
      if (url.includes("cdn.example.com/huge-master.mp4")) {
        return Promise.resolve(new Response(new Uint8Array(40 * MB) as unknown as BodyInit, { status: 200 }));
      }
      if (url.endsWith("/adaccounts/acct-qa/media")) {
        return Promise.resolve(new Response(
          JSON.stringify({ request_status: "SUCCESS", media: [{ sub_request_status: "SUCCESS", media: { id: "media-fin" } }] }),
          { status: 200 },
        ));
      }
      if (url.includes("action=INIT")) {
        return Promise.resolve(new Response(JSON.stringify({ request_status: "SUCCESS", result: { upload_id: "up-f" } }), { status: 200 }));
      }
      if (url.includes("action=ADD")) {
        return Promise.resolve(new Response(JSON.stringify({ request_status: "SUCCESS" }), { status: 200 }));
      }
      if (url.includes("action=FINALIZE")) {
        // HTTP 200, top-level SUCCESS — the failure hides two levels down.
        return Promise.resolve(new Response(
          JSON.stringify({ request_status: "SUCCESS", result: { chunks: [{ sub_request_status: "FAILURE", debug_message: "chunk checksum mismatch" }] } }),
          { status: 200 },
        ));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    await assertRejects(
      () =>
        snapchatCreativeAdapter.upload(
          metaCleanImage({
            kind: "video",
            mp4_master_url: "https://cdn.example.com/huge-master.mp4",
            poster_url: "https://x/p.jpg",
            bunny_video_id: "b-fin",
            duration_seconds: 30,
            has_audio: true,
            mime_type: "video/mp4",
            byte_size: 40 * MB,
          }),
          { lane: "consumer" as Lane, external_account_id: "acct-qa", tokenEnvVar: "SNAPCHAT_REFRESH_TOKEN" },
          { fetchImpl, sleep: NO_SLEEP },
        ),
      CreativeUploadError,
      "sub_request_status",
    );
  }),
);

Deno.test(
  "QA-W6 Google magic-byte gate: WebP bytes (whatever the URL claims) throw BEFORE any assets:mutate call",
  withEnv(GOOGLE_ENV, async () => {
    let mutateCalls = 0;
    const fetchImpl = ((input: URL | Request | string, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "g-minted" }), { status: 200 }));
      }
      if (url.includes("cdn.example.com/lying.png")) {
        return Promise.resolve(new Response(REAL_WEBP as unknown as BodyInit, { status: 200 }));
      }
      if (url.includes("assets:mutate")) {
        mutateCalls++;
        return Promise.resolve(new Response(JSON.stringify({ results: [{ resourceName: "x" }] }), { status: 200 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    await assertRejects(
      () =>
        googleCreativeAdapter.upload(
          metaCleanImage({ aspect_ratio: 1.91, width: 1200, height: 628, source_url: "https://cdn.example.com/lying.png" }),
          { lane: "consumer" as Lane, external_account_id: "123-456-7890", tokenEnvVar: "GOOGLE_ADS_REFRESH_TOKEN" },
          { fetchImpl, sleep: NO_SLEEP },
        ),
      CreativeUploadError,
      "JPG or PNG",
    );
    assertEquals(mutateCalls, 0, "no Google asset may be created from rejected bytes");
  }),
);

Deno.test(
  "QA-W7 Google duplicate-name: retry carries a suffixed name AND the identical base64 payload",
  withEnv(GOOGLE_ENV, async () => {
    const mutateNames: string[] = [];
    const mutatePayloads: string[] = [];
    const jpegBytes = makeJpeg(1200, 628);
    const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "g-minted" }), { status: 200 }));
      }
      if (url.includes("cdn.example.com/wide.jpg")) {
        return Promise.resolve(new Response(jpegBytes as unknown as BodyInit, { status: 200 }));
      }
      if (url.includes("assets:mutate")) {
        const body = JSON.parse(String(init?.body)) as {
          operations: { create: { name: string; imageAsset: { data: string } } }[];
        };
        mutateNames.push(body.operations[0].create.name);
        mutatePayloads.push(body.operations[0].create.imageAsset.data);
        if (mutateNames.length === 1) {
          return Promise.resolve(new Response(JSON.stringify({ error: { message: "DUPLICATE_ASSET name already exists" } }), { status: 400 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ results: [{ resourceName: "customers/1/assets/42" }] }), { status: 200 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const creative = metaCleanImage({
      id: "00000000-0000-0000-0000-00000000aa07",
      aspect_ratio: 1.91,
      width: 1200,
      height: 628,
      source_url: "https://cdn.example.com/wide.jpg",
      content_hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    });
    const result = await googleCreativeAdapter.upload(
      creative,
      { lane: "consumer" as Lane, external_account_id: "123-456-7890", tokenEnvVar: "GOOGLE_ADS_REFRESH_TOKEN" },
      { fetchImpl, sleep: NO_SLEEP },
    );
    assertEquals(result.external_ref, "customers/1/assets/42");
    assertEquals(mutateNames.length, 2);
    const base = googleAssetName(creative.id, "1.91:1", creative.content_hash);
    assertEquals(mutateNames[0], base);
    assert(new RegExp(`^${base}_\\d+$`).test(mutateNames[1]), `suffix shape: ${mutateNames[1]}`);
    assertEquals(mutatePayloads[0], mutatePayloads[1], "the retry must carry the SAME bytes");
    assert(/^mingla_[0-9a-f-]+_1_91_1_[0-9a-f]{12}$/.test(base), `sanitized name shape: ${base}`);
  }),
);

Deno.test(
  "QA-W8 Google video resumable-header contract + REJECTED state fails close",
  withEnv(GOOGLE_ENV, async () => {
    let startHeaders: Headers | null = null;
    let uploadHeaders: Headers | null = null;
    let polls = 0;
    const rejectAfter: string[] = ["PENDING", "UPLOADED", "REJECTED"];
    const fetchImpl = ((input: URL | Request | string, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "g-minted" }), { status: 200 }));
      }
      if (url.includes("cdn.example.com/yt-master.mp4")) {
        return Promise.resolve(new Response(new Uint8Array(1024) as unknown as BodyInit, { status: 200 }));
      }
      if (url.includes("youTubeVideoUploads:create")) {
        startHeaders = new Headers(init?.headers);
        return Promise.resolve(new Response("{}", { status: 200, headers: { "X-Goog-Upload-URL": "https://resumable.example/qa-upload" } }));
      }
      if (url === "https://resumable.example/qa-upload") {
        uploadHeaders = new Headers(init?.headers);
        return Promise.resolve(new Response(JSON.stringify({ resourceName: "customers/1/youTubeVideoUploads/77" }), { status: 200 }));
      }
      if (url.includes("youTubeVideoUploads/77")) {
        const state = rejectAfter[Math.min(polls, rejectAfter.length - 1)];
        polls++;
        return Promise.resolve(new Response(JSON.stringify({ state }), { status: 200 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    await assertRejects(
      () =>
        googleCreativeAdapter.upload(
          metaCleanImage({
            kind: "video",
            mp4_master_url: "https://cdn.example.com/yt-master.mp4",
            poster_url: "https://x/p.jpg",
            bunny_video_id: "b-yt",
            duration_seconds: 30,
            has_audio: true,
            mime_type: "video/mp4",
          }),
          { lane: "consumer" as Lane, external_account_id: "123-456-7890", tokenEnvVar: "GOOGLE_ADS_REFRESH_TOKEN" },
          { fetchImpl, sleep: NO_SLEEP },
        ),
      CreativeUploadError,
      "REJECTED",
    );
    assert(startHeaders !== null);
    assertEquals((startHeaders as unknown as Headers).get("X-Goog-Upload-Protocol"), "resumable");
    assertEquals((startHeaders as unknown as Headers).get("X-Goog-Upload-Command"), "start");
    assertEquals((startHeaders as unknown as Headers).get("X-Goog-Upload-Header-Content-Length"), "1024");
    assert(uploadHeaders !== null);
    assertEquals((uploadHeaders as unknown as Headers).get("X-Goog-Upload-Command"), "upload, finalize");
    assertEquals((uploadHeaders as unknown as Headers).get("X-Goog-Upload-Offset"), "0");
    assertEquals(polls, 3, "poll must stop AT the terminal state");
  }),
);
