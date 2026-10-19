// #3040 — INDEPENDENT TESTER adversarial suite for @mingla/video-upload.
// Written by the tester, not the implementor. It attacks what a hostile or
// broken TUS server, a fractional duration and an impatient host can do:
//   P1  60.0–60.5 s: fractional clip lengths always resolve to an INTEGER the
//       server accepts, and 60,500.5 ms is past the tolerance.
//   P2  the 5 s ad minimum at 4.9 s and just under 5 s; covers never refused.
//   P3  a server that never advances the offset ends in a named integrity
//       error, never a loop and never 100%.
//   P4  a server claiming MORE bytes than the file has is refused, never
//       reported as a finished upload.
//   P5  an abort while a PATCH is on the wire rejects at once, with no 100%.
//   P6  a source over 100 MiB is refused before ANY network call.
//
// Invariant I-VIDEO-LIMITS-PARITY (declared in packages/video-upload/__tests__/purity_and_parity.test.mjs): the client tolerance maps 60,001–60,500 ms to an integer 60,000 and nothing past it
// Invariant I-VIDEO-ONE-UPLOADER (declared in packages/video-upload/__tests__/videoUpload.test.mjs): the one web uploader never reports success it did not confirm with the server
//
// FAILS ON REVERT:
//   P1  drop Math.round in resolveRawClipDurationMs
//   P2  AD_MIN_DURATION_MS lowered below 4,900
//   P3  `serverOffset <= chunkStart` relaxed to `<`
//   P4  the `offset > total` guard after the first HEAD removed
//   P5  the abort listener in patchTusChunkXhr removed
//   P6  the SOURCE_MAX_BYTES guard in uploadSourceWeb removed
import { test } from "node:test";
import assert from "node:assert/strict";

import { isAdVideoTooShort, resolveRawClipDurationMs, uploadSourceWeb, VIDEO_LIMITS } from "../index.js";

test("P1 fractional clips in the 60.0–60.5 s band resolve to an integer the server accepts", () => {
  for (const ms of [60_000.4, 60_000.6, 60_250.5, 60_499.9, 60_500.4]) {
    const resolved = resolveRawClipDurationMs(ms);
    assert.ok(Number.isInteger(resolved), `${ms} resolved to a non-integer ${resolved}`);
    assert.ok(resolved <= VIDEO_LIMITS.MAX_DURATION_MS, `${ms} resolved past the cap: ${resolved}`);
  }
  // Just past the tolerance after rounding: declared as-is, so the pick is refused.
  assert.equal(resolveRawClipDurationMs(60_500.5), 60_501);
  assert.ok(Number.isInteger(resolveRawClipDurationMs(12_345.67)));
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, "60000", null, undefined]) {
    assert.equal(resolveRawClipDurationMs(bad), 0, `garbage ${String(bad)} was not refused as unknown`);
  }
});

test("P2 the ad minimum: 4.9 s and 4,999.99 ms are too short, 5 s is not; it is not a cover rule", () => {
  assert.equal(isAdVideoTooShort(4_900), true);
  assert.equal(isAdVideoTooShort(4_999.99), true);
  assert.equal(isAdVideoTooShort(5_000), false);
  assert.equal(isAdVideoTooShort(60_000), false);
  assert.equal(VIDEO_LIMITS.AD_MIN_DURATION_MS, 5_000);
  assert.throws(() => {
    "use strict";
    VIDEO_LIMITS.AD_MIN_DURATION_MS = 1;
  }, TypeError, "the limits table is mutable at runtime");
});

// A scriptable TUS server. `onPatch(state, size)` decides what a PATCH does.
const makeServer = ({ startOffset = 0, onPatch, hang = false } = {}) => {
  const state = { offset: startOffset, heads: 0, patches: 0 };
  const fetchImpl = async () => {
    state.heads += 1;
    return { ok: true, status: 200, headers: { get: (name) => (name === "Upload-Offset" ? String(state.offset) : null) } };
  };
  class FakeXhr {
    constructor() { this.upload = {}; this.status = 0; }
    open() {}
    setRequestHeader() {}
    getResponseHeader(name) { return name === "Upload-Offset" ? String(state.offset) : null; }
    abort() { this.aborted = true; }
    send(blob) {
      state.patches += 1;
      if (state.patches > 20) throw new Error("runaway PATCH loop");
      this.upload.onprogress?.({ loaded: blob.size });
      if (hang) return; // the request never completes on its own
      queueMicrotask(() => {
        onPatch?.(state, blob.size);
        this.status = 204;
        this.onload?.();
      });
    }
  }
  return { state, fetchImpl, FakeXhr };
};
const transport = { url: "https://tus.example/upload/adversarial", headers: { AuthorizationSignature: "sig" } };

test("P3 a server that never advances the offset ends in an integrity error, never a loop, never 100%", async () => {
  const { state, fetchImpl, FakeXhr } = makeServer({ onPatch: () => { /* drops every byte */ } });
  const events = [];
  await assert.rejects(
    uploadSourceWeb({
      file: new Blob([new Uint8Array(4 * 1024)]), transport, chunkBytes: 1024, fetchImpl, XhrImpl: FakeXhr,
      onProgress: (event) => events.push(event),
    }),
    (error) => error.code === "transport_integrity_failed" && error.detail === "tus_offset_not_advanced",
  );
  assert.equal(state.patches, 1, `the uploader retried a stuck offset ${state.patches} times`);
  assert.ok(events.every((event) => event.percent < 100 && event.final !== true), "a stuck upload reported 100%");
});

test("P4 a server claiming more bytes than the file has is refused, never reported as finished", async () => {
  const { state, fetchImpl, FakeXhr } = makeServer({ startOffset: 9_999_999 });
  const events = [];
  await assert.rejects(
    uploadSourceWeb({
      file: new Blob([new Uint8Array(2 * 1024)]), transport, chunkBytes: 1024, fetchImpl, XhrImpl: FakeXhr,
      onProgress: (event) => events.push(event),
    }),
    (error) => error.code === "transport_integrity_failed",
  );
  assert.equal(state.patches, 0);
  assert.ok(!events.some((event) => event.final === true || event.percent === 100), "an impossible offset was reported as done");
});

test("P5 an abort while a PATCH is on the wire rejects at once and never reports 100%", async () => {
  const { fetchImpl, FakeXhr } = makeServer({ hang: true });
  const controller = new AbortController();
  const events = [];
  const upload = uploadSourceWeb({
    file: new Blob([new Uint8Array(4 * 1024)]), transport, chunkBytes: 1024, fetchImpl, XhrImpl: FakeXhr,
    signal: controller.signal, onProgress: (event) => events.push(event),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  const outcome = await Promise.race([
    upload.then(() => "resolved", (error) => `rejected:${error.code}`),
    new Promise((resolve) => setTimeout(() => resolve("hung"), 500)),
  ]);
  assert.equal(outcome, "rejected:source_upload_cancelled");
  assert.ok(!events.some((event) => event.percent === 100), "an aborted upload reported 100%");
});

test("P6 a source over 100 MiB is refused before any network call", async () => {
  const { state, fetchImpl, FakeXhr } = makeServer();
  // A Blob-shaped stand-in: allocating 100 MiB in a unit test is pointless.
  const huge = { size: VIDEO_LIMITS.SOURCE_MAX_BYTES + 1, slice: () => new Blob([]) };
  await assert.rejects(
    uploadSourceWeb({ file: huge, transport, fetchImpl, XhrImpl: FakeXhr }),
    (error) => error.code === "source_too_large",
  );
  assert.equal(state.heads, 0, "a too-large source reached the server (HEAD)");
  assert.equal(state.patches, 0, "a too-large source reached the server (PATCH)");
});
