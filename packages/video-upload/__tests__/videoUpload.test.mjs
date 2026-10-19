// #3040 — packages/video-upload behaviour (node:test). Run:
//   node --test packages/video-upload/__tests__/
// MINGLA-INVARIANT: I-VIDEO-ONE-UPLOADER | issue #3040 | exactly one web TUS implementation exists (this package)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  VIDEO_LIMITS,
  VideoUploadError,
  headTusOffset,
  isAdVideoTooShort,
  resolveRawClipDurationMs,
  sha256OfBlob,
  tusMetadata,
} from "../index.js";

test("VIDEO_LIMITS is frozen and carries the §2 numbers", () => {
  assert.ok(Object.isFrozen(VIDEO_LIMITS));
  assert.equal(VIDEO_LIMITS.MAX_DURATION_MS, 60000);
  assert.equal(VIDEO_LIMITS.SOURCE_DURATION_TOLERANCE_MS, 500);
  assert.equal(VIDEO_LIMITS.SOURCE_MAX_BYTES, 104857600);
  assert.equal(VIDEO_LIMITS.AD_MIN_DURATION_MS, 5000);
  assert.equal(VIDEO_LIMITS.FINAL_MAX_BYTES, 67108864);
  assert.equal(VIDEO_LIMITS.MAX_RENDITION_HEIGHT, 1080);
  assert.equal(VIDEO_LIMITS.NATIVE_COMPRESSION_MAX_EDGE_PX, 1920);
  assert.equal(VIDEO_LIMITS.NATIVE_COMPRESSION_BITRATE_BPS, 8000000);
  assert.equal(VIDEO_LIMITS.TUS_CHUNK_NATIVE_BYTES, 2 * 1024 * 1024);
  assert.equal(VIDEO_LIMITS.TUS_CHUNK_WEB_BYTES, 8 * 1024 * 1024);
});

test("resolveRawClipDurationMs clamps only the 500 ms tolerance band", () => {
  assert.equal(resolveRawClipDurationMs(60030), 60000);
  assert.equal(resolveRawClipDurationMs(60500), 60000);
  assert.equal(resolveRawClipDurationMs(60501), 60501);
  assert.equal(resolveRawClipDurationMs(59999.6), 60000);
  assert.equal(resolveRawClipDurationMs(8000), 8000);
  assert.equal(resolveRawClipDurationMs(Number.NaN), 0);
});

test("isAdVideoTooShort enforces the 5 s ad minimum only", () => {
  assert.equal(isAdVideoTooShort(4200), true);
  assert.equal(isAdVideoTooShort(4999), true);
  assert.equal(isAdVideoTooShort(5000), false);
  assert.equal(isAdVideoTooShort(0), false);
});

test("tusMetadata base64-encodes filetype, title and sha256 in order", () => {
  const value = tusMetadata({ filetype: "video/mp4", title: "job-1", sha256: "ab" });
  assert.equal(
    value,
    `filetype ${Buffer.from("video/mp4").toString("base64")},title ${Buffer.from("job-1").toString("base64")},sha256 ${Buffer.from("ab").toString("base64")}`,
  );
  assert.equal(tusMetadata(undefined), `filetype ${Buffer.from("video/mp4").toString("base64")}`);
});

test("sha256OfBlob matches Node crypto and refuses an oversized blob before reading", async () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 31) & 255);
  const blob = new Blob([bytes]);
  const expected = createHash("sha256").update(bytes).digest("hex");
  assert.equal(await sha256OfBlob(blob), expected);

  let read = false;
  const huge = { size: VIDEO_LIMITS.SOURCE_MAX_BYTES + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } };
  await assert.rejects(() => sha256OfBlob(huge), (error) => error instanceof VideoUploadError && error.code === "source_too_large");
  assert.equal(read, false);
});

test("headTusOffset returns the server offset and names HTTP failures", async () => {
  const ok = async () => ({ ok: true, status: 200, headers: { get: () => "4096" } });
  assert.equal(await headTusOffset({ url: "https://x", fetchImpl: ok }), 4096);
  const gone = async () => ({ ok: false, status: 410, headers: { get: () => null } });
  await assert.rejects(
    () => headTusOffset({ url: "https://x", fetchImpl: gone }),
    (error) => error.code === "transport_integrity_failed" && error.detail === "tus_head_http_410",
  );
  const network = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(
    () => headTusOffset({ url: "https://x", fetchImpl: network }),
    (error) => error.code === "source_upload_failed" && error.detail === "tus_head_transport_failed",
  );
});

test("an aborted signal cancels before any request", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    () => headTusOffset({ url: "https://x", signal: controller.signal, fetchImpl: async () => { called = true; } }),
    (error) => error.code === "source_upload_cancelled",
  );
  assert.equal(called, false);
});
